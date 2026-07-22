-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Tenancy" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "roomNumber" INTEGER NOT NULL,
    "bed" TEXT NOT NULL DEFAULT 'A',
    "tenantId" INTEGER NOT NULL,
    "moveInDate" DATETIME NOT NULL,
    "moveOutDate" DATETIME,
    "monthlyRent" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Tenancy_roomNumber_fkey" FOREIGN KEY ("roomNumber") REFERENCES "Room" ("number") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Tenancy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Tenancy" ("createdAt", "id", "monthlyRent", "moveInDate", "moveOutDate", "roomNumber", "tenantId") SELECT "createdAt", "id", "monthlyRent", "moveInDate", "moveOutDate", "roomNumber", "tenantId" FROM "Tenancy";
DROP TABLE "Tenancy";
ALTER TABLE "new_Tenancy" RENAME TO "Tenancy";
CREATE INDEX "Tenancy_roomNumber_bed_idx" ON "Tenancy"("roomNumber", "bed");
CREATE INDEX "Tenancy_tenantId_idx" ON "Tenancy"("tenantId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
