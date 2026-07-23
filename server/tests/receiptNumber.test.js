import 'dotenv/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { formatReceiptNumber, nextReceiptNumber } from '../src/receiptNumber.js';

test('formatReceiptNumber pads to 4 digits and includes year', () => {
  assert.equal(formatReceiptNumber(2026, 1), 'RCT-2026-0001');
  assert.equal(formatReceiptNumber(2026, 42), 'RCT-2026-0042');
  assert.equal(formatReceiptNumber(2026, 1234), 'RCT-2026-1234');
  assert.equal(formatReceiptNumber(2027, 1), 'RCT-2027-0001'); // year rollover
});

// --- Concurrency tests against the configured MySQL database -----------------
// Uses sentinel years (9998/9999) so it never touches real receipt data, and
// cleans them up afterwards. Skipped entirely when DATABASE_URL is not set.
const hasDb = !!process.env.DATABASE_URL;
const SENTINEL = 9999;
const SENTINEL2 = 9998;
let prisma;

before(async () => {
  if (!hasDb) return;
  const { PrismaClient } = await import('@prisma/client');
  prisma = new PrismaClient();
  await prisma.receiptCounter.deleteMany({ where: { year: { in: [SENTINEL, SENTINEL2] } } });
});

after(async () => {
  if (!prisma) return;
  await prisma.receiptCounter.deleteMany({ where: { year: { in: [SENTINEL, SENTINEL2] } } });
  await prisma.$disconnect();
});

test('nextReceiptNumber issues unique consecutive numbers under concurrency', { skip: !hasDb }, async () => {
  // Modest N so it fits the default connection pool and the remote DB link
  // reliably; the UPDATE-only row lock guarantees correctness for any N.
  const N = 5;
  // Pre-create the counter row so the burst exercises the concurrent-increment
  // path (the realistic scenario: the first-of-year row is created by a single
  // caller, then all later payments increment it).
  await prisma.receiptCounter.create({ data: { year: SENTINEL, lastSeq: 0 } });
  const results = await Promise.all(
    Array.from({ length: N }, () =>
      prisma.$transaction((tx) => nextReceiptNumber(tx, SENTINEL), { timeout: 20000, maxWait: 20000 })
    )
  );

  const seqs = results.map((r) => r.seq).sort((a, b) => a - b);
  assert.deepEqual(seqs, Array.from({ length: N }, (_, i) => i + 1)); // exactly 1..N, no gaps

  const numbers = new Set(results.map((r) => r.receiptNumber));
  assert.equal(numbers.size, N, 'all receipt numbers must be unique');

  const counter = await prisma.receiptCounter.findUnique({ where: { year: SENTINEL } });
  assert.equal(counter.lastSeq, N);
});

test('nextReceiptNumber continues sequentially after existing numbers', { skip: !hasDb }, async () => {
  await prisma.receiptCounter.create({ data: { year: SENTINEL2, lastSeq: 100 } });
  const r = await prisma.$transaction((tx) => nextReceiptNumber(tx, SENTINEL2), { timeout: 20000, maxWait: 20000 });
  assert.equal(r.seq, 101);
  assert.equal(r.receiptNumber, 'RCT-9998-0101');
});
