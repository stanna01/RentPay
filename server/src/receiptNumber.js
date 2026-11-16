// Atomic, sequential, never-reused receipt numbers, per property per year:
// RCT-CODE-YYYY-NNNN (e.g. RCT-KC-2026-0001). Receipts issued before
// multi-property support keep their original RCT-YYYY-NNNN numbers.
//
// The ReceiptCounter row for (property, year) is the single serialization
// point; the increment runs inside the payment transaction.

export function formatReceiptNumber(code, year, seq) {
  return `RCT-${code}-${year}-${String(seq).padStart(4, '0')}`;
}

/**
 * Ensure the counter row for a property/year exists. Call this ONCE, outside
 * the payment transaction, before nextReceiptNumber. Keeping the INSERT out of
 * the hot path means concurrent nextReceiptNumber calls only ever UPDATE — a
 * single clean row lock, so no InnoDB deadlocks. Mixing INSERT and UPDATE on
 * the same key across concurrent transactions is what deadlocks.
 */
export async function ensureReceiptCounter(client, propertyId, year) {
  await client.$executeRawUnsafe(
    'INSERT IGNORE INTO `ReceiptCounter` (`propertyId`, `year`, `lastSeq`) VALUES (?, ?, 0)',
    propertyId,
    year
  );
}

/**
 * Reserve the next receipt number. Must be called inside a Prisma interactive
 * transaction (tx) so the UPDATE and the LAST_INSERT_ID() read run on the same
 * connection.
 *
 * MySQL has no RETURNING, so we use the classic atomic-counter idiom:
 * LAST_INSERT_ID(expr) both stores `expr` and sets the session value, which we
 * then read back. This is fully atomic and correct under concurrent callers.
 */
export async function nextReceiptNumber(tx, { propertyId, code, year }) {
  await tx.$executeRawUnsafe(
    'UPDATE `ReceiptCounter` SET `lastSeq` = LAST_INSERT_ID(`lastSeq` + 1) WHERE `propertyId` = ? AND `year` = ?',
    propertyId,
    year
  );
  const rows = await tx.$queryRawUnsafe('SELECT LAST_INSERT_ID() AS seq');
  const seq = Number(rows[0].seq);
  return { year, seq, receiptNumber: formatReceiptNumber(code, year, seq) };
}
