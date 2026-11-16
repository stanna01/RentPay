import 'dotenv/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { formatReceiptNumber, nextReceiptNumber, ensureReceiptCounter } from '../src/receiptNumber.js';

test('formatReceiptNumber pads to 4 digits and includes property code and year', () => {
  assert.equal(formatReceiptNumber('KC', 2026, 1), 'RCT-KC-2026-0001');
  assert.equal(formatReceiptNumber('KC', 2026, 42), 'RCT-KC-2026-0042');
  assert.equal(formatReceiptNumber('MAIN', 2026, 1234), 'RCT-MAIN-2026-1234');
  assert.equal(formatReceiptNumber('KC', 2027, 1), 'RCT-KC-2027-0001'); // year rollover
});

// --- Concurrency tests against a MySQL TEST database ---------------------------
// These write to the database, so they only run when you opt in with
// TEST_DATABASE=1 (point DATABASE_URL at a throwaway database first — never at
// production). They use sentinel years and a sentinel property, and clean up.
const hasDb = process.env.TEST_DATABASE === '1' && !!process.env.DATABASE_URL;
const SENTINEL = 9999;
const SENTINEL2 = 9998;
let prisma;
let property;

before(async () => {
  if (!hasDb) return;
  const { PrismaClient } = await import('@prisma/client');
  prisma = new PrismaClient();
  property = await prisma.property.upsert({
    where: { code: 'ZZTEST' },
    create: { name: 'Receipt counter test', code: 'ZZTEST' },
    update: {},
  });
  await prisma.receiptCounter.deleteMany({ where: { propertyId: property.id } });
});

after(async () => {
  if (!prisma) return;
  await prisma.receiptCounter.deleteMany({ where: { propertyId: property.id } });
  await prisma.property.delete({ where: { id: property.id } });
  await prisma.$disconnect();
});

test('nextReceiptNumber issues unique consecutive numbers under concurrency', { skip: !hasDb }, async () => {
  // Modest N so it fits the default connection pool and the remote DB link
  // reliably; the UPDATE-only row lock guarantees correctness for any N.
  const N = 5;
  const args = { propertyId: property.id, code: property.code, year: SENTINEL };
  await ensureReceiptCounter(prisma, property.id, SENTINEL);
  const results = await Promise.all(
    Array.from({ length: N }, () =>
      prisma.$transaction((tx) => nextReceiptNumber(tx, args), { timeout: 20000, maxWait: 20000 })
    )
  );

  const seqs = results.map((r) => r.seq).sort((a, b) => a - b);
  assert.deepEqual(seqs, Array.from({ length: N }, (_, i) => i + 1)); // exactly 1..N, no gaps

  const numbers = new Set(results.map((r) => r.receiptNumber));
  assert.equal(numbers.size, N, 'all receipt numbers must be unique');

  const counter = await prisma.receiptCounter.findUnique({
    where: { propertyId_year: { propertyId: property.id, year: SENTINEL } },
  });
  assert.equal(counter.lastSeq, N);
});

test('nextReceiptNumber continues sequentially after existing numbers', { skip: !hasDb }, async () => {
  await prisma.receiptCounter.create({ data: { propertyId: property.id, year: SENTINEL2, lastSeq: 100 } });
  const r = await prisma.$transaction(
    (tx) => nextReceiptNumber(tx, { propertyId: property.id, code: property.code, year: SENTINEL2 }),
    { timeout: 20000, maxWait: 20000 }
  );
  assert.equal(r.seq, 101);
  assert.equal(r.receiptNumber, 'RCT-ZZTEST-9998-0101');
});
