// Command-line password reset — the guaranteed recovery path for a locked-out
// user, works without email being configured. Requires server access, so it
// is trusted: it also clears any login lockout and signs out all sessions.
//
//   npm run set-password -- user@example.com "my-new-password"
//
// (run from the project root or the server/ folder)

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { passwordProblem } from '../src/passwordPolicy.js';

const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
  console.error('Usage: npm run set-password -- <email> <newPassword>');
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  const key = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: key } });
  if (!user) {
    console.error(`No account found for "${email}".`);
    process.exit(1);
  }
  const problem = passwordProblem(password, { email: user.email, role: user.role });
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(password, 12),
      tokenVersion: { increment: 1 }, // sign out every existing session
      mustChangePassword: false,
      isActive: true,
    },
  });
  await prisma.loginThrottle.deleteMany({ where: { email: key } });
  await prisma.auditLog.create({
    data: { userId: user.id, action: 'password.reset_cli', entityType: 'user', entityId: String(user.id) },
  });
  console.log(`Password updated for ${user.email}. Any lockout was cleared and all sessions were signed out.`);
} finally {
  await prisma.$disconnect();
}
