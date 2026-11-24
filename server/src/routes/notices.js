// Notices to tenants (sent by email for now): general messages, and rent
// increases, which need at least 30 days' notice. Every notice is kept with
// the exact text each tenant was sent, and is never edited afterwards.

import { Router } from 'express';
import { prisma } from '../db.js';
import { assertPropertyAccess, resolvePropertyId } from '../access.js';
import { queueNoticeEmails, isSmtpConfigured } from '../email.js';
import { formatKwacha } from '../money.js';
import { roomLabel } from '../tenancyService.js';
import { today, addDays, toDbDate, dbDay, formatDayLong, formatDay } from '../dates.js';
import { audit } from '../audit.js';
import { parse, z, text, ngwee, day, id } from '../validate.js';
import { badRequest, httpError, notFound } from '../httpError.js';

const router = Router();

export const NOTICE_DAYS = 30;

const KIND = { MESSAGE: 'MESSAGE', RENT_INCREASE: 'RENT_INCREASE', RENT_INCREASE_CANCELLED: 'RENT_INCREASE_CANCELLED' };

const per = (property) => (property.billingCycle === 'TERM' ? 'per term' : 'per month');

const audience = {
  propertyId: id('Please choose a property.'),
  // Leave out (or empty) for the whole property.
  roomIds: z.array(id('Invalid room.')).max(1000).optional().default([]),
};

async function loadProperty(req, propertyId) {
  await assertPropertyAccess(req, propertyId);
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) throw notFound('Property not found.');
  return property;
}

/** Check chosen rooms belong to the property. [] = every room. */
async function checkRooms(property, roomIds) {
  if (!roomIds.length) return null;
  const n = await prisma.room.count({ where: { id: { in: roomIds }, propertyId: property.id } });
  if (n !== new Set(roomIds).size) throw badRequest('One of the chosen rooms is not in this property.');
  return [...new Set(roomIds)];
}

/** Current tenancies of the property (or chosen rooms), with tenant and room. */
async function currentTenancies(property, roomIds, include = {}) {
  return prisma.tenancy.findMany({
    where: {
      moveOutDate: null,
      tenant: { deletedAt: null },
      room: { propertyId: property.id, ...(roomIds ? { id: { in: roomIds } } : {}) },
    },
    include: { tenant: true, room: true, ...include },
    orderBy: [{ room: { number: 'asc' } }, { bed: 'asc' }],
  });
}

/**
 * Save a notice and the exact text for each tenant, then send the emails in
 * the background. Tenants without an email address are recorded as such.
 */
async function createNotice(db, { property, kind, subject, recipients, userId }) {
  const notice = await db.notice.create({
    data: {
      propertyId: property.id,
      kind,
      subject,
      message: recipients[0]?.message || '',
      createdById: userId,
      recipients: {
        create: recipients.map((r) => ({
          tenantId: r.tenantId,
          email: r.email || '',
          message: r.message,
          status: r.email ? 'pending' : 'no_email',
        })),
      },
    },
    include: { recipients: true },
  });
  return notice;
}

async function sendQueued(notice) {
  await queueNoticeEmails(notice.recipients.filter((r) => r.status === 'pending').map((r) => r.id));
}

const summary = (notice, recipients, tenants) => ({
  id: notice.id,
  kind: notice.kind,
  subject: notice.subject,
  recipientCount: recipients.length,
  emailed: recipients.filter((r) => r.email).length,
  noEmail: recipients.filter((r) => !r.email).map((r) => tenants.get(r.tenantId) || ''),
});

// --- General messages -----------------------------------------------------------

/** GET /api/notices?propertyId= — sent notices, newest first, with send counts. */
router.get('/', async (req, res) => {
  const propertyId = await resolvePropertyId(req);
  const notices = await prisma.notice.findMany({
    where: { propertyId },
    include: { recipients: { select: { status: true } } },
    orderBy: { id: 'desc' },
    take: 200,
  });
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(notices.map((n) => n.createdById))] } },
    select: { id: true, name: true, email: true },
  });
  const userBy = new Map(users.map((u) => [u.id, u.name || u.email]));
  res.json(
    notices.map((n) => {
      const count = (st) => n.recipients.filter((r) => r.status === st).length;
      return {
        id: n.id,
        kind: n.kind,
        subject: n.subject,
        createdAt: n.createdAt,
        sentBy: userBy.get(n.createdById) || '',
        recipients: n.recipients.length,
        sent: count('sent'),
        pending: count('pending'),
        failed: count('failed'),
        noEmail: count('no_email'),
      };
    })
  );
});

/**
 * POST /api/notices — send a message to every current tenant of a property, or
 * of chosen rooms. Body: { propertyId, roomIds?, subject, message }
 */
router.post('/', async (req, res) => {
  const body = parse(
    z.object({
      ...audience,
      subject: text(150).min(1, 'Please enter a subject.'),
      message: z.string().trim().min(1, 'Please write the message.').max(5000, 'Please keep the message under 5,000 characters.'),
    }),
    req.body
  );
  const property = await loadProperty(req, body.propertyId);
  const rooms = await checkRooms(property, body.roomIds);
  const tenancies = await currentTenancies(property, rooms);
  if (!tenancies.length) throw badRequest('There are no current tenants in the chosen rooms.');

  const recipients = tenancies.map((t) => ({
    tenantId: t.tenantId,
    email: t.tenant.email,
    message: `Dear ${t.tenant.name},\n\n${body.message}\n\nRegards,\n${property.name}`,
  }));
  const notice = await createNotice(prisma, { property, kind: KIND.MESSAGE, subject: body.subject, recipients, userId: req.user.id });
  await audit(req, 'notice.send', {
    type: 'property',
    id: property.id,
    after: { noticeId: notice.id, subject: body.subject, rooms: rooms || 'all', recipients: recipients.length },
  });
  await sendQueued(notice);
  const names = new Map(tenancies.map((t) => [t.tenantId, t.tenant.name]));
  res.status(201).json({ ...summary(notice, recipients, names), emailConfigured: await isSmtpConfigured() });
});

// --- Rent increases ----------------------------------------------------------------

const increaseBody = z.object({
  ...audience,
  newRent: ngwee('Please enter the new rent.').refine((n) => n > 0, 'Please enter the new rent.'),
  startsOn: day('Please choose the date the new rent starts.'),
});

/** Who a rent increase would reach, and who is left out and why. */
async function planIncrease(property, rooms, newRent, startsOn) {
  const earliest = addDays(today(), NOTICE_DAYS);
  if (startsOn < earliest) {
    throw badRequest(`Tenants must get at least ${NOTICE_DAYS} days' notice: the new rent can start on ${formatDayLong(earliest)} at the earliest.`);
  }
  const tenancies = await currentTenancies(property, rooms, {
    rentChanges: { where: { cancelledAt: null, appliedAt: null } },
  });
  const included = [];
  const excluded = [];
  for (const t of tenancies) {
    const row = { tenancyId: t.id, tenantId: t.tenantId, tenantName: t.tenant.name, email: t.tenant.email, roomLabel: roomLabel(t.room.number, t.bed), oldRent: t.rent, newRent };
    const pending = t.rentChanges[0];
    if (pending) excluded.push({ ...row, reason: `A rent change on ${formatDay(pending.startsOn)} is already planned.` });
    else if (t.rent >= newRent) excluded.push({ ...row, reason: `Rent is already ${formatKwacha(t.rent)}, not lower than the new rent.` });
    else included.push(row);
  }
  return { included, excluded };
}

/** POST /api/notices/rent-increases/preview — who it reaches, before sending. */
router.post('/rent-increases/preview', async (req, res) => {
  const body = parse(increaseBody, req.body);
  const property = await loadProperty(req, body.propertyId);
  const rooms = await checkRooms(property, body.roomIds);
  const plan = await planIncrease(property, rooms, body.newRent, body.startsOn);
  res.json({ ...plan, per: per(property), startsOn: body.startsOn, earliestStart: addDays(today(), NOTICE_DAYS) });
});

/**
 * POST /api/notices/rent-increases — announce a rent increase. Every affected
 * tenant is emailed now; rent billed for periods starting on or after
 * startsOn uses the new rent. Body: { propertyId, roomIds?, newRent, startsOn }
 */
router.post('/rent-increases', async (req, res) => {
  const body = parse(increaseBody, req.body);
  const property = await loadProperty(req, body.propertyId);
  const rooms = await checkRooms(property, body.roomIds);
  const { included, excluded } = await planIncrease(property, rooms, body.newRent, body.startsOn);
  if (!included.length) throw badRequest('No current tenant would get this rent increase.');

  const when = formatDayLong(body.startsOn);
  const subject = `Rent change at ${property.name} from ${when}`;
  const recipients = included.map((t) => ({
    tenantId: t.tenantId,
    email: t.email,
    message:
      `Dear ${t.tenantName},\n\n` +
      `This is notice that the rent for room ${t.roomLabel} at ${property.name} will change ` +
      `from ${formatKwacha(t.oldRent)} to ${formatKwacha(body.newRent)} ${per(property)}, starting ${when}.\n\n` +
      `Rent billed for periods before that date stays the same.\n\n` +
      `Regards,\n${property.name}`,
  }));

  const { notice, increase } = await prisma.$transaction(async (tx) => {
    const notice = await createNotice(tx, { property, kind: KIND.RENT_INCREASE, subject, recipients, userId: req.user.id });
    const increase = await tx.rentIncrease.create({
      data: {
        propertyId: property.id,
        roomIds: rooms ?? undefined,
        newRent: body.newRent,
        startsOn: toDbDate(body.startsOn),
        noticeId: notice.id,
        createdById: req.user.id,
        changes: {
          create: included.map((t) => ({
            tenancyId: t.tenancyId,
            oldRent: t.oldRent,
            newRent: body.newRent,
            startsOn: toDbDate(body.startsOn),
            createdById: req.user.id,
          })),
        },
      },
    });
    return { notice, increase };
  });
  await audit(req, 'rent_increase.create', {
    type: 'property',
    id: property.id,
    after: { rentIncreaseId: increase.id, newRent: body.newRent, startsOn: body.startsOn, rooms: rooms || 'all', tenants: included.length },
  });
  await sendQueued(notice);
  const names = new Map(included.map((t) => [t.tenantId, t.tenantName]));
  res.status(201).json({
    id: increase.id,
    notice: summary(notice, recipients, names),
    included,
    excluded,
    emailConfigured: await isSmtpConfigured(),
  });
});

/** GET /api/notices/rent-increases?propertyId= — planned, applied and cancelled increases. */
router.get('/rent-increases', async (req, res) => {
  const propertyId = await resolvePropertyId(req);
  const list = await prisma.rentIncrease.findMany({
    where: { propertyId },
    include: { changes: { include: { tenancy: { include: { tenant: true, room: true } } } } },
    orderBy: { id: 'desc' },
  });
  res.json(
    list.map((r) => ({
      id: r.id,
      newRent: r.newRent,
      startsOn: dbDay(r.startsOn),
      roomIds: r.roomIds,
      noticeId: r.noticeId,
      createdAt: r.createdAt,
      status: r.cancelledAt ? 'CANCELLED' : r.appliedAt ? 'STARTED' : 'PLANNED',
      cancelledAt: r.cancelledAt,
      tenants: r.changes.map((c) => ({
        tenancyId: c.tenancyId,
        tenantName: c.tenancy.tenant.name,
        roomLabel: roomLabel(c.tenancy.room.number, c.tenancy.bed),
        oldRent: c.oldRent,
        newRent: c.newRent,
      })),
    }))
  );
});

/** POST /api/notices/rent-increases/:id/cancel — call off an increase before it starts. */
router.post('/rent-increases/:id/cancel', async (req, res) => {
  const incId = Number(req.params.id);
  const inc = Number.isInteger(incId)
    ? await prisma.rentIncrease.findUnique({
        where: { id: incId },
        include: { changes: { include: { tenancy: { include: { tenant: true, room: true } } } } },
      })
    : null;
  if (!inc) throw notFound('Rent increase not found.');
  const property = await loadProperty(req, inc.propertyId);
  if (inc.cancelledAt) throw httpError(409, 'That rent increase has already been cancelled.');
  if (inc.appliedAt || dbDay(inc.startsOn) <= today()) throw httpError(409, 'That rent increase has already started.');

  const when = formatDayLong(inc.startsOn);
  const live = inc.changes.filter((c) => !c.cancelledAt && !c.tenancy.moveOutDate);
  const recipients = live.map((c) => ({
    tenantId: c.tenancy.tenantId,
    email: c.tenancy.tenant.email,
    message:
      `Dear ${c.tenancy.tenant.name},\n\n` +
      `The rent change we told you about for room ${roomLabel(c.tenancy.room.number, c.tenancy.bed)} at ${property.name} ` +
      `(to ${formatKwacha(c.newRent)} from ${when}) has been cancelled. Your rent stays at ${formatKwacha(c.oldRent)} ${per(property)}.\n\n` +
      `Regards,\n${property.name}`,
  }));

  const notice = await prisma.$transaction(async (tx) => {
    const now = new Date();
    await tx.rentIncrease.update({ where: { id: inc.id }, data: { cancelledAt: now } });
    await tx.rentChange.updateMany({ where: { rentIncreaseId: inc.id, cancelledAt: null }, data: { cancelledAt: now } });
    if (!recipients.length) return null;
    return createNotice(tx, {
      property,
      kind: KIND.RENT_INCREASE_CANCELLED,
      subject: `Rent change at ${property.name} cancelled`,
      recipients,
      userId: req.user.id,
    });
  });
  await audit(req, 'rent_increase.cancel', { type: 'property', id: property.id, before: { rentIncreaseId: inc.id, newRent: inc.newRent, startsOn: dbDay(inc.startsOn) } });
  if (notice) await sendQueued(notice);
  res.json({ ok: true, id: inc.id, notified: recipients.length });
});

/** GET /api/notices/:id — one notice: who it went to, what they were sent, and whether it was emailed. */
router.get('/:id', async (req, res) => {
  const nid = Number(req.params.id);
  const notice = Number.isInteger(nid)
    ? await prisma.notice.findUnique({ where: { id: nid }, include: { recipients: { include: { tenant: true }, orderBy: { id: 'asc' } } } })
    : null;
  if (!notice) throw notFound('Notice not found.');
  await assertPropertyAccess(req, notice.propertyId, 'Notice');
  res.json({
    id: notice.id,
    kind: notice.kind,
    subject: notice.subject,
    createdAt: notice.createdAt,
    recipients: notice.recipients.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      tenantName: r.tenant.name,
      email: r.email,
      status: r.status,
      sentAt: r.sentAt,
      lastError: r.lastError,
      message: r.message,
    })),
  });
});

export default router;
