// Atomic, sequential, never-reused receipt numbers: RCT-YYYY-NNNN.
//
// The ReceiptCounter row for a year is the single serialization point. We run
// the increment inside a transaction; SQLite serializes writes, so concurrent
// callers each get a distinct consecutive sequence value.

export function formatReceiptNumber(year, seq) {
  return `RCT-${year}-${String(seq).padStart(4, '0')}`;
}

/**
 * Reserve the next receipt number for the given year.
 * Pass a Prisma transaction client (tx) so it participates in the caller's
 * transaction; falls back to the shared client if none is given.
 */
export async function nextReceiptNumber(tx, year = new Date().getFullYear()) {
  // Upsert-then-increment guarantees the counter row exists and advances by 1.
  const counter = await tx.receiptCounter.upsert({
    where: { year },
    create: { year, lastSeq: 1 },
    update: { lastSeq: { increment: 1 } },
  });
  return { year, seq: counter.lastSeq, receiptNumber: formatReceiptNumber(year, counter.lastSeq) };
}
