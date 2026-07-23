// Atomic, sequential, never-reused receipt numbers: RCT-YYYY-NNNN.
//
// The ReceiptCounter row for a year is the single serialization point. We run
// the increment inside a transaction; SQLite serializes writes, so concurrent
// callers each get a distinct consecutive sequence value.

export function formatReceiptNumber(year, seq) {
  return `RCT-${year}-${String(seq).padStart(4, '0')}`;
}

/**
 * Reserve the next receipt number for the given year. Must be called inside a
 * Prisma interactive transaction (tx) so the INSERT and the LAST_INSERT_ID()
 * read run on the same connection.
 *
 * MySQL has no RETURNING, so we use the classic atomic-counter idiom:
 * LAST_INSERT_ID(expr) both stores `expr` and sets the session value, which we
 * then read back. This is fully atomic and correct under concurrent callers.
 */
/**
 * Ensure the counter row for a year exists. Call this ONCE, outside the payment
 * transaction, before nextReceiptNumber. Keeping the INSERT out of the hot path
 * means concurrent nextReceiptNumber calls only ever UPDATE — a single clean
 * row lock, so no InnoDB deadlocks. Mixing INSERT and UPDATE on the same key
 * across concurrent transactions is what deadlocks.
 */
export async function ensureReceiptCounter(client, year = new Date().getFullYear()) {
  await client.$executeRawUnsafe(
    'INSERT IGNORE INTO `ReceiptCounter` (`year`, `lastSeq`) VALUES (?, 0)',
    year
  );
}

export async function nextReceiptNumber(tx, year = new Date().getFullYear()) {
  // UPDATE-only: bump the counter and read the new value back on this
  // connection via LAST_INSERT_ID (MySQL has no RETURNING). The row is
  // guaranteed to exist because the caller ran ensureReceiptCounter first.
  await tx.$executeRawUnsafe(
    'UPDATE `ReceiptCounter` SET `lastSeq` = LAST_INSERT_ID(`lastSeq` + 1) WHERE `year` = ?',
    year
  );
  const rows = await tx.$queryRawUnsafe('SELECT LAST_INSERT_ID() AS seq');
  const seq = Number(rows[0].seq);
  return { year, seq, receiptNumber: formatReceiptNumber(year, seq) };
}
