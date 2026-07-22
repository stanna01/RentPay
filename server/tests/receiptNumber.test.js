import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { formatReceiptNumber, nextReceiptNumber } from '../src/receiptNumber.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, '..');

test('formatReceiptNumber pads to 4 digits and includes year', () => {
  assert.equal(formatReceiptNumber(2026, 1), 'RCT-2026-0001');
  assert.equal(formatReceiptNumber(2026, 42), 'RCT-2026-0042');
  assert.equal(formatReceiptNumber(2026, 1234), 'RCT-2026-1234');
  assert.equal(formatReceiptNumber(2027, 1), 'RCT-2027-0001'); // year rollover
});

// --- Concurrency test against an isolated temporary SQLite database ----------
const dbName = `test-receipts-${Date.now()}.db`;
// connection_limit=1 serializes access so the concurrency test exercises the
// numbering guarantee deterministically without SQLite "database is locked".
const dbUrl = `file:./prisma/${dbName}?connection_limit=1`;
let prisma;
let PrismaClient;

before(async () => {
  execSync('npx prisma db push --skip-generate', {
    cwd: serverDir,
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: 'ignore',
  });
  ({ PrismaClient } = await import('@prisma/client'));
  prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
});

after(async () => {
  if (prisma) await prisma.$disconnect();
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    const f = path.join(serverDir, 'prisma', dbName + suffix);
    if (fs.existsSync(f)) fs.rmSync(f, { force: true });
  }
});

test('nextReceiptNumber issues unique consecutive numbers under concurrency', async () => {
  const year = 2026;
  const N = 25;
  // Fire N concurrent transactions all reserving a number for the same year.
  const results = await Promise.all(
    Array.from({ length: N }, () =>
      // Generous maxWait/timeout: with a single serialized connection the queued
      // transactions must be allowed to wait their turn rather than time out.
      prisma.$transaction((tx) => nextReceiptNumber(tx, year), {
        maxWait: 30000,
        timeout: 30000,
      })
    )
  );

  const seqs = results.map((r) => r.seq).sort((a, b) => a - b);
  // Exactly 1..N, no gaps, no duplicates.
  assert.deepEqual(seqs, Array.from({ length: N }, (_, i) => i + 1));

  const numbers = new Set(results.map((r) => r.receiptNumber));
  assert.equal(numbers.size, N, 'all receipt numbers must be unique');

  // The stored counter must equal N.
  const counter = await prisma.receiptCounter.findUnique({ where: { year } });
  assert.equal(counter.lastSeq, N);
});

test('nextReceiptNumber continues sequentially after existing numbers', async () => {
  const year = 2030;
  await prisma.receiptCounter.create({ data: { year, lastSeq: 100 } });
  const r = await prisma.$transaction((tx) => nextReceiptNumber(tx, year));
  assert.equal(r.seq, 101);
  assert.equal(r.receiptNumber, 'RCT-2030-0101');
});
