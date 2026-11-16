import 'dotenv/config';
if (!process.env.TZ) process.env.TZ = 'Africa/Lusaka';

import app from './app.js';
import { prisma, ensureSettings } from './db.js';
import { startEmailWorker } from './email.js';
import { assertSecureConfig } from './config.js';
import { encryptSecret, decryptSecret, needsReencrypt } from './crypto.js';

const PORT = process.env.PORT || 4000;

/** Re-encrypt a stored SMTP password with the current key (one-off upgrade). */
async function upgradeStoredSecrets() {
  const s = await ensureSettings();
  if (!needsReencrypt(s.smtpPass)) return;
  const plain = decryptSecret(s.smtpPass);
  if (!plain) return; // unreadable with current keys — admin must re-enter it
  await prisma.setting.update({ where: { id: 1 }, data: { smtpPass: encryptSecret(plain) } });
  console.log('[security] SMTP password re-encrypted with the current key.');
}

async function start() {
  assertSecureConfig();
  await upgradeStoredSecrets();
  startEmailWorker();
  app.listen(PORT, () => {
    console.log(`RentReceipt server listening on http://localhost:${PORT}`);
  });
}

start().catch((e) => {
  console.error('Failed to start server:', e);
  process.exit(1);
});

// Graceful shutdown.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

