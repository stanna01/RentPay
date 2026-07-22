import { PrismaClient } from '@prisma/client';

// Single shared Prisma client for the whole server process.
export const prisma = new PrismaClient();

// Ensure the singleton Setting row (id=1) always exists.
export async function ensureSettings() {
  const existing = await prisma.setting.findUnique({ where: { id: 1 } });
  if (!existing) {
    await prisma.setting.create({ data: { id: 1 } });
  }
  return prisma.setting.findUnique({ where: { id: 1 } });
}
