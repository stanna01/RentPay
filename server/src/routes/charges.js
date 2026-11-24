// Charges on a tenant's bill: cancel a wrong charge, waive part of one, and
// reverse a waiver. Nothing here deletes anything. Adding a charge is
// POST /api/tenancies/:id/charges.

import { Router } from 'express';
import { prisma } from '../db.js';
import { loadCharge } from '../access.js';
import { loadAccount, lockTenancy, applyCredit, chargeView } from '../billingService.js';
import { formatKwacha } from '../money.js';
import { audit } from '../audit.js';
import { parse, z, ngwee, reason } from '../validate.js';
import { badRequest, httpError, notFound } from '../httpError.js';

const router = Router();

/** The charge with its current balances (inside a transaction when `db` is one). */
async function chargeWithState(db, charge) {
  const account = await loadAccount(charge.tenancyId, db);
  return account.charges.find((c) => c.id === charge.id);
}

/**
 * POST /api/charges/:id/cancel — the charge was a mistake. Money already paid
 * on it becomes credit and is used on the tenant's other charges.
 * A cancelled rent charge is not billed again for that month or term.
 */
router.post('/:id/cancel', async (req, res) => {
  const charge = await loadCharge(req, req.params.id);
  const body = parse(z.object({ reason: reason() }), req.body);
  if (charge.cancelledAt) throw httpError(409, 'That charge has already been cancelled.');
  const updated = await prisma.charge.update({
    where: { id: charge.id },
    data: { cancelledAt: new Date(), cancelledById: req.user.id, cancelReason: body.reason },
  });
  await audit(req, 'charge.cancel', { type: 'tenancy', id: charge.tenancyId, before: { ...charge, tenancy: undefined }, after: updated });
  await applyCredit(charge.tenancyId);
  res.json({ ok: true, id: charge.id });
});

/**
 * POST /api/charges/:id/waivers — let the tenant off part (or all) of what is
 * still owed on a charge, with a reason. Body: { amount, reason }
 */
router.post('/:id/waivers', async (req, res) => {
  const charge = await loadCharge(req, req.params.id);
  const body = parse(
    z.object({
      amount: ngwee('Please enter a valid amount.').refine((n) => n > 0, 'Please enter an amount greater than zero.'),
      reason: reason(),
    }),
    req.body
  );
  const waiver = await prisma.$transaction(async (tx) => {
    await lockTenancy(tx, charge.tenancyId);
    const current = await chargeWithState(tx, charge);
    if (current.cancelledAt) throw httpError(409, 'That charge has been cancelled.');
    if (body.amount > current.state.balance) {
      throw badRequest(
        current.state.balance > 0
          ? `You can waive at most ${formatKwacha(current.state.balance)} (what is still owed on it).`
          : 'Nothing is owed on this charge.'
      );
    }
    return tx.waiver.create({ data: { chargeId: charge.id, amount: body.amount, reason: body.reason, createdById: req.user.id } });
  });
  await audit(req, 'charge.waive', { type: 'tenancy', id: charge.tenancyId, after: { ...waiver, description: charge.description } });
  res.status(201).json(waiver);
});

/** POST /api/charges/waivers/:waiverId/reverse — undo a waiver. */
router.post('/waivers/:waiverId/reverse', async (req, res) => {
  const wid = Number(req.params.waiverId);
  const waiver = Number.isInteger(wid) ? await prisma.waiver.findUnique({ where: { id: wid } }) : null;
  if (!waiver) throw notFound('Waiver not found.');
  const charge = await loadCharge(req, waiver.chargeId); // access check
  if (waiver.reversedAt) throw httpError(409, 'That waiver has already been reversed.');
  const updated = await prisma.waiver.update({
    where: { id: waiver.id },
    data: { reversedAt: new Date(), reversedById: req.user.id },
  });
  await audit(req, 'charge.waive_reverse', { type: 'tenancy', id: charge.tenancyId, before: waiver, after: updated });
  await applyCredit(charge.tenancyId);
  res.json(updated);
});

/** GET /api/charges/:id — one charge with its balances and waivers. */
router.get('/:id', async (req, res) => {
  const charge = await loadCharge(req, req.params.id);
  res.json(chargeView(await chargeWithState(prisma, charge)));
});

export default router;
