// Command-line password reset — the guaranteed recovery path for a locked-out
// landlord, works without email being configured.
//
//   npm run set-password -- landlord@example.com "my-new-password"
//
// (run from the project root or the server/ folder)

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
  console.error('Usage: npm run set-password -- <email> <newPassword>');
  process.exit(1);
}
if (password.length < 8) {
  console.error('New password must be at least 8 characters.');
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  const landlord = await prisma.landlord.findUnique({ where: { email: email.toLowerCase() } });
  if (!landlord) {
    console.error(`No landlord account found for "${email}".`);
    process.exit(1);
  }
  await prisma.landlord.update({
    where: { id: landlord.id },
    data: { passwordHash: await bcrypt.hash(password, 10) },
  });
  console.log(`Password updated for ${landlord.email}. You can now log in with the new password.`);
} finally {
  await prisma.$disconnect();
}
