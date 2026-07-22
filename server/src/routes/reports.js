import { Router } from 'express';
import { prisma } from '../db.js';
import { ngweeToKwacha } from '../money.js';

const router = Router();

const MONTH_NAMES = [
  '', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * GET /api/reports/income?year=YYYY[&format=csv]
 * Income per month for a year, based on when payments were RECEIVED (datePaid).
 */
router.get('/income', async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);

  const payments = await prisma.payment.findMany({
    where: { datePaid: { gte: start, lt: end } },
    select: { amount: true, datePaid: true },
  });

  const totals = Array.from({ length: 12 }, () => 0);
  for (const p of payments) {
    totals[new Date(p.datePaid).getMonth()] += p.amount;
  }
  const rows = totals.map((ngwee, i) => ({
    month: i + 1,
    label: MONTH_NAMES[i + 1],
    ngwee,
    kwacha: ngweeToKwacha(ngwee),
  }));
  const totalNgwee = totals.reduce((a, b) => a + b, 0);

  if (req.query.format === 'csv') {
    const lines = ['Month,Income (K)'];
    for (const r of rows) lines.push(`${r.label} ${year},${ngweeToKwacha(r.ngwee).toFixed(2)}`);
    lines.push(`Total,${ngweeToKwacha(totalNgwee).toFixed(2)}`);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="income-${year}.csv"`);
    return res.send(lines.join('\r\n'));
  }

  res.json({ year, rows, totalNgwee, totalKwacha: ngweeToKwacha(totalNgwee) });
});

export default router;
