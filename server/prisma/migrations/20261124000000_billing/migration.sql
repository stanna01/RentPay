-- Billing (Phase 2): charges instead of recalculated months, terms, waivers,
-- rent increases with notice, and notices to tenants.
--
-- WARNING: this release does not move old payment records into the new
-- ledger. PaymentPeriod and ArrearsAdjustment are dropped. Nothing had been
-- deployed when it was written, so the supported upgrade is a fresh database:
-- npm run db:reset (see docs/UPGRADE.md).

-- Property: how rent is billed
ALTER TABLE `Property` ADD COLUMN `billingCycle` VARCHAR(191) NOT NULL DEFAULT 'MONTHLY',
    ADD COLUMN `dueDay` INTEGER NOT NULL DEFAULT 5;

-- Tenancy: rent is per month or per term now
ALTER TABLE `Tenancy` RENAME COLUMN `monthlyRent` TO `rent`;

-- Payment: what the receipt says, frozen at payment time
ALTER TABLE `Payment` ADD COLUMN `receiptLines` JSON NULL,
    ADD COLUMN `creditAfter` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `balanceAfter` INTEGER NOT NULL DEFAULT 0;

-- The month-based records are replaced by charges and allocations
ALTER TABLE `PaymentPeriod` DROP FOREIGN KEY `PaymentPeriod_paymentId_fkey`;
DROP TABLE `PaymentPeriod`;
ALTER TABLE `ArrearsAdjustment` DROP FOREIGN KEY `ArrearsAdjustment_tenancyId_fkey`;
DROP TABLE `ArrearsAdjustment`;

-- Email queue: receipts or notices
ALTER TABLE `EmailQueue` DROP FOREIGN KEY `EmailQueue_receiptId_fkey`;
ALTER TABLE `EmailQueue` MODIFY `receiptId` INTEGER NULL,
    ADD COLUMN `noticeRecipientId` INTEGER NULL;

-- CreateTable
CREATE TABLE `BillingTerm` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `propertyId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NOT NULL,
    `dueDate` DATE NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BillingTerm_propertyId_startDate_idx`(`propertyId`, `startDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Charge` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenancyId` INTEGER NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `amount` INTEGER NOT NULL,
    `dueDate` DATE NOT NULL,
    `periodStart` DATE NULL,
    `periodKey` VARCHAR(191) NULL,
    `termId` INTEGER NULL,
    `createdById` INTEGER NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancelledById` INTEGER NULL,
    `cancelReason` VARCHAR(191) NOT NULL DEFAULT '',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Charge_tenancyId_dueDate_idx`(`tenancyId`, `dueDate`),
    UNIQUE INDEX `Charge_tenancyId_periodKey_key`(`tenancyId`, `periodKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Allocation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `paymentId` INTEGER NOT NULL,
    `chargeId` INTEGER NOT NULL,
    `amount` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Allocation_paymentId_idx`(`paymentId`),
    INDEX `Allocation_chargeId_idx`(`chargeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Waiver` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `chargeId` INTEGER NOT NULL,
    `amount` INTEGER NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `createdById` INTEGER NOT NULL,
    `reversedAt` DATETIME(3) NULL,
    `reversedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Waiver_chargeId_idx`(`chargeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RentIncrease` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `propertyId` INTEGER NOT NULL,
    `roomIds` JSON NULL,
    `newRent` INTEGER NOT NULL,
    `startsOn` DATE NOT NULL,
    `noticeId` INTEGER NULL,
    `createdById` INTEGER NOT NULL,
    `appliedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RentIncrease_propertyId_idx`(`propertyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RentChange` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenancyId` INTEGER NOT NULL,
    `rentIncreaseId` INTEGER NULL,
    `oldRent` INTEGER NOT NULL,
    `newRent` INTEGER NOT NULL,
    `startsOn` DATE NOT NULL,
    `createdById` INTEGER NOT NULL,
    `appliedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RentChange_tenancyId_startsOn_idx`(`tenancyId`, `startsOn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notice` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `propertyId` INTEGER NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(191) NOT NULL,
    `message` TEXT NOT NULL,
    `createdById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Notice_propertyId_createdAt_idx`(`propertyId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NoticeRecipient` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `noticeId` INTEGER NOT NULL,
    `tenantId` INTEGER NOT NULL,
    `email` VARCHAR(191) NOT NULL DEFAULT '',
    `message` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `sentAt` DATETIME(3) NULL,
    `lastError` VARCHAR(191) NOT NULL DEFAULT '',

    INDEX `NoticeRecipient_noticeId_idx`(`noticeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- AddForeignKey
ALTER TABLE `BillingTerm` ADD CONSTRAINT `BillingTerm_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `Property`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Charge` ADD CONSTRAINT `Charge_tenancyId_fkey` FOREIGN KEY (`tenancyId`) REFERENCES `Tenancy`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Charge` ADD CONSTRAINT `Charge_termId_fkey` FOREIGN KEY (`termId`) REFERENCES `BillingTerm`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Allocation` ADD CONSTRAINT `Allocation_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `Payment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Allocation` ADD CONSTRAINT `Allocation_chargeId_fkey` FOREIGN KEY (`chargeId`) REFERENCES `Charge`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Waiver` ADD CONSTRAINT `Waiver_chargeId_fkey` FOREIGN KEY (`chargeId`) REFERENCES `Charge`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RentIncrease` ADD CONSTRAINT `RentIncrease_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `Property`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RentChange` ADD CONSTRAINT `RentChange_tenancyId_fkey` FOREIGN KEY (`tenancyId`) REFERENCES `Tenancy`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RentChange` ADD CONSTRAINT `RentChange_rentIncreaseId_fkey` FOREIGN KEY (`rentIncreaseId`) REFERENCES `RentIncrease`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notice` ADD CONSTRAINT `Notice_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `Property`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NoticeRecipient` ADD CONSTRAINT `NoticeRecipient_noticeId_fkey` FOREIGN KEY (`noticeId`) REFERENCES `Notice`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NoticeRecipient` ADD CONSTRAINT `NoticeRecipient_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailQueue` ADD CONSTRAINT `EmailQueue_receiptId_fkey` FOREIGN KEY (`receiptId`) REFERENCES `Receipt`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailQueue` ADD CONSTRAINT `EmailQueue_noticeRecipientId_fkey` FOREIGN KEY (`noticeRecipientId`) REFERENCES `NoticeRecipient`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

