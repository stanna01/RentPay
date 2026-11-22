-- Multi-landlord: every property belongs to an Organization (a landlord
-- business). Roles become SUPER_ADMIN (platform) and LANDLORD (one business).
-- Per-user property access (PropertyAccess) is replaced by organization
-- membership.

-- CreateTable
CREATE TABLE `Organization` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `organizationId` INTEGER NULL;
ALTER TABLE `Property` ADD COLUMN `organizationId` INTEGER NULL;
ALTER TABLE `AuditLog` ADD COLUMN `organizationId` INTEGER NULL;

-- An earlier migration always creates a placeholder property ("My Property",
-- code MAIN). On a fresh database it is still empty, so remove it rather than
-- invent a landlord to own it. A placeholder that holds anything is kept.
DELETE FROM `Property`
WHERE `code` = 'MAIN' AND `name` = 'My Property'
  AND NOT EXISTS (SELECT 1 FROM `Room` WHERE `Room`.`propertyId` = `Property`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `Tenant` WHERE `Tenant`.`propertyId` = `Property`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `ReceiptCounter` WHERE `ReceiptCounter`.`propertyId` = `Property`.`id`);

-- Existing data (if any): everything that was there becomes the first landlord
-- business; old ADMINs become super admins, old LANDLORDs join that business.
INSERT INTO `Organization` (`name`, `updatedAt`)
SELECT 'First landlord', CURRENT_TIMESTAMP(3) FROM DUAL
WHERE EXISTS (SELECT 1 FROM `Property`) OR EXISTS (SELECT 1 FROM `User` WHERE `role` = 'LANDLORD');

UPDATE `Property` SET `organizationId` = (SELECT MIN(`id`) FROM `Organization`);
UPDATE `User` SET `organizationId` = (SELECT MIN(`id`) FROM `Organization`) WHERE `role` = 'LANDLORD';
UPDATE `User` SET `role` = 'SUPER_ADMIN', `tokenVersion` = `tokenVersion` + 1 WHERE `role` = 'ADMIN';

ALTER TABLE `Property` MODIFY `organizationId` INTEGER NOT NULL;

-- DropTable
ALTER TABLE `PropertyAccess` DROP FOREIGN KEY `PropertyAccess_userId_fkey`;
ALTER TABLE `PropertyAccess` DROP FOREIGN KEY `PropertyAccess_propertyId_fkey`;
DROP TABLE `PropertyAccess`;

-- CreateIndex
CREATE INDEX `User_organizationId_idx` ON `User`(`organizationId`);
CREATE INDEX `Property_organizationId_idx` ON `Property`(`organizationId`);
CREATE INDEX `AuditLog_organizationId_id_idx` ON `AuditLog`(`organizationId`, `id`);

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Property` ADD CONSTRAINT `Property_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
