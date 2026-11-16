-- Admin role, multi-property, payment voiding, arrears adjustments, login
-- throttling and audit log.
--
-- Hand-written so that EXISTING DATA IS PRESERVED:
--   * the Landlord account becomes a User with role ADMIN (same password);
--   * the current property (Setting.propertyName/Address) becomes Property #1;
--   * all rooms, tenants and receipt counters are attached to Property #1;
--   * Tenancy.roomNumber is mapped to the new Room.id surrogate key.
--
-- TAKE A BACKUP FIRST (docs/BACKUP.md) and rehearse on a copy of the database.

-- ---------------------------------------------------------------------------
-- 1. Users (rename Landlord → User and promote the existing account to ADMIN)
-- ---------------------------------------------------------------------------
RENAME TABLE `Landlord` TO `User`;
ALTER TABLE `User` RENAME INDEX `Landlord_email_key` TO `User_email_key`;
ALTER TABLE `User`
    ADD COLUMN `name` VARCHAR(191) NOT NULL DEFAULT '',
    ADD COLUMN `role` VARCHAR(191) NOT NULL DEFAULT 'LANDLORD',
    ADD COLUMN `isActive` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `tokenVersion` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `mustChangePassword` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `lastLoginAt` DATETIME(3) NULL;
UPDATE `User` SET `role` = 'ADMIN';

-- ---------------------------------------------------------------------------
-- 2. Properties (Property #1 from the existing settings row)
-- ---------------------------------------------------------------------------
CREATE TABLE `Property` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `address` VARCHAR(191) NOT NULL DEFAULT '',
    `code` VARCHAR(191) NOT NULL,
    `archivedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Property_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `Property` (`id`, `name`, `address`, `code`, `updatedAt`)
SELECT 1,
       COALESCE((SELECT `propertyName` FROM `Setting` WHERE `id` = 1), 'My Property'),
       COALESCE((SELECT `propertyAddress` FROM `Setting` WHERE `id` = 1), ''),
       'MAIN',
       CURRENT_TIMESTAMP(3);

ALTER TABLE `Setting` DROP COLUMN `propertyAddress`, DROP COLUMN `propertyName`;

CREATE TABLE `PropertyAccess` (
    `userId` INTEGER NOT NULL,
    `propertyId` INTEGER NOT NULL,

    INDEX `PropertyAccess_propertyId_idx`(`propertyId`),
    PRIMARY KEY (`userId`, `propertyId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 3. Rooms: surrogate id + propertyId; Tenancy.roomNumber → Tenancy.roomId
-- ---------------------------------------------------------------------------
ALTER TABLE `Tenancy` DROP FOREIGN KEY `Tenancy_roomNumber_fkey`;
DROP INDEX `Tenancy_roomNumber_bed_idx` ON `Tenancy`;

ALTER TABLE `Room` DROP PRIMARY KEY,
    ADD COLUMN `id` INTEGER NOT NULL AUTO_INCREMENT FIRST,
    ADD COLUMN `propertyId` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `bedCount` INTEGER NOT NULL DEFAULT 2,
    ADD COLUMN `archivedAt` DATETIME(3) NULL,
    ADD PRIMARY KEY (`id`);
ALTER TABLE `Room` ALTER COLUMN `propertyId` DROP DEFAULT;
CREATE UNIQUE INDEX `Room_propertyId_number_key` ON `Room`(`propertyId`, `number`);

ALTER TABLE `Tenancy`
    ADD COLUMN `roomId` INTEGER NULL,
    ADD COLUMN `activeBedKey` VARCHAR(191) NULL;
UPDATE `Tenancy` t JOIN `Room` r ON r.`number` = t.`roomNumber` SET t.`roomId` = r.`id`;
ALTER TABLE `Tenancy` MODIFY `roomId` INTEGER NOT NULL;
ALTER TABLE `Tenancy` DROP COLUMN `roomNumber`;

-- Mark current tenancies with their bed key. If (due to the old race) a bed
-- somehow has two current tenancies, only the newest gets the key.
UPDATE `Tenancy` t
JOIN (
    SELECT MAX(`id`) AS `id` FROM `Tenancy`
    WHERE `moveOutDate` IS NULL
    GROUP BY `roomId`, `bed`
) cur ON cur.`id` = t.`id`
SET t.`activeBedKey` = CONCAT(t.`roomId`, '-', t.`bed`);

CREATE UNIQUE INDEX `Tenancy_activeBedKey_key` ON `Tenancy`(`activeBedKey`);
CREATE INDEX `Tenancy_roomId_bed_idx` ON `Tenancy`(`roomId`, `bed`);

-- ---------------------------------------------------------------------------
-- 4. Tenants belong to a property; soft delete
-- ---------------------------------------------------------------------------
ALTER TABLE `Tenant`
    ADD COLUMN `propertyId` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `deletedAt` DATETIME(3) NULL;
ALTER TABLE `Tenant` ALTER COLUMN `propertyId` DROP DEFAULT;
CREATE INDEX `Tenant_propertyId_idx` ON `Tenant`(`propertyId`);

-- ---------------------------------------------------------------------------
-- 5. Payments can be voided / corrected; receipts keep a VOID copy
-- ---------------------------------------------------------------------------
ALTER TABLE `Payment`
    ADD COLUMN `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN `voidedAt` DATETIME(3) NULL,
    ADD COLUMN `voidedById` INTEGER NULL,
    ADD COLUMN `voidReason` VARCHAR(191) NOT NULL DEFAULT '',
    ADD COLUMN `replacesPaymentId` INTEGER NULL,
    ADD COLUMN `createdById` INTEGER NULL;
CREATE INDEX `Payment_status_idx` ON `Payment`(`status`);

ALTER TABLE `Receipt` ADD COLUMN `voidPdf` LONGBLOB NULL;

-- ---------------------------------------------------------------------------
-- 6. Receipt counters are per property per year
-- ---------------------------------------------------------------------------
ALTER TABLE `ReceiptCounter` DROP PRIMARY KEY,
    ADD COLUMN `propertyId` INTEGER NOT NULL DEFAULT 1 FIRST,
    ADD PRIMARY KEY (`propertyId`, `year`);
ALTER TABLE `ReceiptCounter` ALTER COLUMN `propertyId` DROP DEFAULT;

-- ---------------------------------------------------------------------------
-- 7. New tables: arrears adjustments, login throttling, audit log
-- ---------------------------------------------------------------------------
CREATE TABLE `ArrearsAdjustment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenancyId` INTEGER NOT NULL,
    `month` INTEGER NOT NULL,
    `year` INTEGER NOT NULL,
    `amount` INTEGER NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `createdById` INTEGER NOT NULL,
    `reversedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ArrearsAdjustment_tenancyId_idx`(`tenancyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `LoginThrottle` (
    `email` VARCHAR(191) NOT NULL,
    `failedCount` INTEGER NOT NULL DEFAULT 0,
    `lockoutLevel` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `lastFailedAt` DATETIME(3) NULL,

    PRIMARY KEY (`email`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AuditLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NULL,
    `action` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NOT NULL DEFAULT '',
    `entityId` VARCHAR(191) NOT NULL DEFAULT '',
    `before` JSON NULL,
    `after` JSON NULL,
    `ip` VARCHAR(191) NOT NULL DEFAULT '',
    `userAgent` VARCHAR(255) NOT NULL DEFAULT '',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    INDEX `AuditLog_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `AuditLog_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 8. Foreign keys
-- ---------------------------------------------------------------------------
ALTER TABLE `PropertyAccess` ADD CONSTRAINT `PropertyAccess_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PropertyAccess` ADD CONSTRAINT `PropertyAccess_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `Property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Room` ADD CONSTRAINT `Room_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `Property`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Tenant` ADD CONSTRAINT `Tenant_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `Property`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Tenancy` ADD CONSTRAINT `Tenancy_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `Room`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ReceiptCounter` ADD CONSTRAINT `ReceiptCounter_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `Property`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ArrearsAdjustment` ADD CONSTRAINT `ArrearsAdjustment_tenancyId_fkey` FOREIGN KEY (`tenancyId`) REFERENCES `Tenancy`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
