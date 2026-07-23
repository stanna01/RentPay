// A4 receipt PDF rendering with pdf-lib. Pure JS, no headless browser.
// A receipt PDF is generated ONCE and saved; reprint/re-send reads the file.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { formatKwacha, amountInWords } from './money.js';

const A4 = { width: 595.28, height: 841.89 }; // points
const MARGIN = 50;
const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatDate(d) {
  const date = new Date(d);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

/**
 * Build the receipt PDF and return its bytes (Uint8Array). The bytes are stored
 * in the database (Receipt.pdf); nothing is written to disk.
 * data = {
 *   receiptNumber, datePaid, propertyName, propertyAddress,
 *   tenantName, roomLabel, method, amount (ngwee),
 *   periods: [{month, year, amountApplied, expectedRent}],
 *   totalExpected (ngwee), totalBalance (ngwee)
 * }
 */
export async function buildReceiptPdf(data) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([A4.width, A4.height]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const ink = rgb(0.1, 0.1, 0.12);
  const muted = rgb(0.42, 0.45, 0.5);
  const line = rgb(0.82, 0.84, 0.87);
  const accent = rgb(0.09, 0.42, 0.29); // green

  let y = A4.height - MARGIN;

  const text = (str, x, yy, { size = 11, f = font, color = ink } = {}) =>
    page.drawText(String(str ?? ''), { x, y: yy, size, font: f, color });

  const rightText = (str, xRight, yy, opts = {}) => {
    const f = opts.f || font;
    const size = opts.size || 11;
    const w = f.widthOfTextAtSize(String(str ?? ''), size);
    text(str, xRight - w, yy, opts);
  };

  const hr = (yy) =>
    page.drawLine({
      start: { x: MARGIN, y: yy },
      end: { x: A4.width - MARGIN, y: yy },
      thickness: 1,
      color: line,
    });

  // --- Header ---------------------------------------------------------------
  text(data.propertyName || 'Property', MARGIN, y, { size: 20, f: bold, color: accent });
  rightText('RENT RECEIPT', A4.width - MARGIN, y, { size: 16, f: bold, color: ink });
  y -= 18;
  if (data.propertyAddress) {
    text(data.propertyAddress, MARGIN, y, { size: 10, color: muted });
  }
  rightText(`No. ${data.receiptNumber}`, A4.width - MARGIN, y, { size: 11, f: bold, color: ink });
  y -= 16;
  rightText(`Date: ${formatDate(data.datePaid)}`, A4.width - MARGIN, y, { size: 10, color: muted });
  y -= 18;
  hr(y);
  y -= 28;

  // --- Received from --------------------------------------------------------
  text('RECEIVED FROM', MARGIN, y, { size: 9, f: bold, color: muted });
  text('ROOM', A4.width - MARGIN - 120, y, { size: 9, f: bold, color: muted });
  y -= 16;
  text(data.tenantName || '', MARGIN, y, { size: 13, f: bold });
  text(String(data.roomLabel), A4.width - MARGIN - 120, y, { size: 13, f: bold });
  y -= 30;

  // --- Amount box -----------------------------------------------------------
  const boxH = 58;
  page.drawRectangle({
    x: MARGIN,
    y: y - boxH,
    width: A4.width - 2 * MARGIN,
    height: boxH,
    color: rgb(0.96, 0.98, 0.97),
    borderColor: line,
    borderWidth: 1,
  });
  text('AMOUNT RECEIVED', MARGIN + 14, y - 18, { size: 9, f: bold, color: muted });
  text(formatKwacha(data.amount), MARGIN + 14, y - 42, { size: 22, f: bold, color: accent });
  rightText(data.method ? methodLabel(data.method) : '', A4.width - MARGIN - 14, y - 18, {
    size: 10,
    color: muted,
  });
  y -= boxH + 18;

  // --- Amount in words ------------------------------------------------------
  text('AMOUNT IN WORDS', MARGIN, y, { size: 9, f: bold, color: muted });
  y -= 15;
  const words = amountInWords(data.amount);
  wrapText(page, words, MARGIN, y, {
    font,
    size: 11,
    color: ink,
    maxWidth: A4.width - 2 * MARGIN,
    lineHeight: 15,
  });
  y -= 15 * Math.max(1, Math.ceil(font.widthOfTextAtSize(words, 11) / (A4.width - 2 * MARGIN)));
  y -= 22;

  // --- Period(s) covered table ---------------------------------------------
  text('PERIOD COVERED', MARGIN, y, { size: 9, f: bold, color: muted });
  y -= 18;
  const colMonth = MARGIN;
  const colExpected = A4.width - MARGIN - 260;
  const colApplied = A4.width - MARGIN - 130;
  const colBal = A4.width - MARGIN;
  text('Month', colMonth, y, { size: 9, f: bold, color: muted });
  rightText('Expected', colExpected + 60, y, { size: 9, f: bold, color: muted });
  rightText('Paid', colApplied + 60, y, { size: 9, f: bold, color: muted });
  rightText('Balance', colBal, y, { size: 9, f: bold, color: muted });
  y -= 6;
  hr(y);
  y -= 16;

  for (const p of data.periods) {
    const bal = Math.max(0, (p.expectedRent || 0) - (p.amountApplied || 0));
    text(`${MONTH_NAMES[p.month]} ${p.year}`, colMonth, y, { size: 10 });
    rightText(formatKwacha(p.expectedRent), colExpected + 60, y, { size: 10, color: muted });
    rightText(formatKwacha(p.amountApplied), colApplied + 60, y, { size: 10 });
    rightText(formatKwacha(bal), colBal, y, {
      size: 10,
      color: bal > 0 ? rgb(0.7, 0.2, 0.15) : muted,
    });
    y -= 16;
  }

  y -= 6;
  hr(y);
  y -= 20;

  // --- Totals ---------------------------------------------------------------
  rightText('Total paid:', colApplied + 60, y, { size: 10, f: bold });
  rightText(formatKwacha(data.amount), colBal, y, { size: 10, f: bold });
  y -= 16;
  const balanceColor = (data.totalBalance || 0) > 0 ? rgb(0.7, 0.2, 0.15) : accent;
  rightText('Outstanding balance:', colApplied + 60, y, { size: 10, f: bold, color: balanceColor });
  rightText(formatKwacha(data.totalBalance || 0), colBal, y, { size: 10, f: bold, color: balanceColor });

  // --- Signature ------------------------------------------------------------
  const sigY = MARGIN + 60;
  page.drawLine({
    start: { x: MARGIN, y: sigY },
    end: { x: MARGIN + 200, y: sigY },
    thickness: 1,
    color: ink,
  });
  text('Authorised signature', MARGIN, sigY - 14, { size: 9, color: muted });
  rightText('Thank you for your payment.', A4.width - MARGIN, sigY - 14, { size: 9, color: muted });

  // --- Return bytes (stored in the DB by the caller) ------------------------
  return await pdf.save(); // Uint8Array
}

function methodLabel(method) {
  return (
    {
      cash: 'Paid by: Cash',
      mobile_money: 'Paid by: Mobile Money',
      bank: 'Paid by: Bank',
    }[method] || `Paid by: ${method}`
  );
}

function wrapText(page, str, x, y, { font, size, color, maxWidth, lineHeight }) {
  const words = String(str).split(' ');
  let lineStr = '';
  let yy = y;
  for (const w of words) {
    const test = lineStr ? `${lineStr} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > maxWidth && lineStr) {
      page.drawText(lineStr, { x, y: yy, size, font, color });
      yy -= lineHeight;
      lineStr = w;
    } else {
      lineStr = test;
    }
  }
  if (lineStr) page.drawText(lineStr, { x, y: yy, size, font, color });
}
