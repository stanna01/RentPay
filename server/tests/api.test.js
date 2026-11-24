// End-to-end API tests: roles, isolation between landlords (IDOR), lockout,
// sessions, password reset, billing (charges, terms, credit, waivers),
// voids/corrections, arrears, rent increases and notices, CSRF, CSV safety and
// the phone app's token sign-in.
//
// These WRITE to the database, so they only run with TEST_DATABASE=1 and a
// DATABASE_URL pointing at a throwaway, already-migrated database:
//
//   TEST_DATABASE=1 DATABASE_URL=mysql://root@127.0.0.1:3306/rr_test npm test
//
// NEVER point this at production.

import 'dotenv/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const enabled = process.env.TEST_DATABASE === '1' && !!process.env.DATABASE_URL;
const opts = { skip: !enabled };

let request, app, prisma, bcrypt;
const rnd = () => Math.random().toString(36).slice(2, 6).toUpperCase();
const RUN = rnd();
const ADMIN_PW = 'admin-strong-passphrase-1';
const LL_PW = 'landlord-pass-1';
const ctx = {};
const year = new Date().getFullYear();
const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n) => String(n).padStart(2, '0');
/** A local day N days from today, "YYYY-MM-DD". */
const dayFromToday = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Each scenario uses its own client IP so the per-IP limiter doesn't interfere.
let ipSeq = 1;
const nextIp = () => `10.9.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

async function signIn(email, password) {
  const agent = request.agent(app);
  const ip = nextIp();
  const res = await agent.post('/api/auth/login').set('X-Forwarded-For', ip).send({ email, password });
  assert.equal(res.status, 200, `login ${email}: ${res.body.error}`);
  return agent;
}

before(async () => {
  if (!enabled) return;
  process.env.NODE_ENV = 'test';
  ({ default: request } = await import('supertest'));
  ({ default: app } = await import('../src/app.js'));
  ({ prisma } = await import('../src/db.js'));
  ({ default: bcrypt } = await import('bcryptjs'));
  app.set('trust proxy', 'loopback'); // let tests choose the client IP

  // Two landlord businesses, each with one property of 3 rooms and one sign-in.
  const mk = async (letter) => {
    const org = await prisma.organization.create({ data: { name: `Landlord ${letter} ${RUN}` } });
    const prop = await prisma.property.create({
      data: {
        organizationId: org.id,
        name: `Test ${letter} ${RUN}`,
        code: `${letter}${RUN}`,
        rooms: { create: [1, 2, 3].map((n) => ({ number: n, bedCount: 2, defaultRent: 150000 })) },
      },
      include: { rooms: { orderBy: { number: 'asc' } } },
    });
    const email = `landlord-${letter}-${RUN}@test.local`.toLowerCase();
    await prisma.user.create({
      data: { email, role: 'LANDLORD', organizationId: org.id, passwordHash: await bcrypt.hash(LL_PW, 4) },
    });
    return { org, prop, email };
  };
  ({ org: ctx.orgA, prop: ctx.propA, email: ctx.llEmail } = await mk('A'));
  ({ org: ctx.orgB, prop: ctx.propB, email: ctx.llBEmail } = await mk('B'));
  ctx.adminEmail = `admin-${RUN}@test.local`.toLowerCase();
  await prisma.user.create({
    data: { email: ctx.adminEmail, role: 'SUPER_ADMIN', passwordHash: await bcrypt.hash(ADMIN_PW, 4) },
  });
  ctx.admin = await signIn(ctx.adminEmail, ADMIN_PW);
  ctx.ll = await signIn(ctx.llEmail, LL_PW);
  ctx.llB = await signIn(ctx.llBEmail, LL_PW);
});

after(async () => {
  if (prisma) await prisma.$disconnect();
});

// --- Roles & property isolation ----------------------------------------------

test('landlord is refused super-admin endpoints (403)', opts, async () => {
  assert.equal((await ctx.ll.get('/api/admin/landlords')).status, 403);
  assert.equal((await ctx.ll.get('/api/settings')).status, 403);
  assert.equal((await ctx.ll.get('/api/admin/audit')).status, 403);
  const make = await ctx.ll.post('/api/admin/landlords').send({ name: 'x', ownerEmail: 'x@test.local', tempPassword: 'temporary-pass-1' });
  assert.equal(make.status, 403);
});

test("super admin manages the platform, not a landlord's day-to-day data (403)", opts, async () => {
  assert.equal((await ctx.admin.get('/api/properties')).status, 403);
  assert.equal((await ctx.admin.get(`/api/rooms?propertyId=${ctx.propA.id}`)).status, 403);
  assert.equal((await ctx.admin.get('/api/reports/arrears')).status, 403);
  const list = await ctx.admin.get('/api/admin/landlords');
  assert.equal(list.status, 200);
  const orgA = list.body.find((o) => o.id === ctx.orgA.id);
  assert.equal(orgA.propertyCount, 1);
  assert.equal(orgA.bedCount, 6);
  assert.deepEqual(orgA.users.map((u) => u.email), [ctx.llEmail]);
  assert.ok(!JSON.stringify(list.body).includes('passwordHash'));
});

test("a landlord cannot see or change another landlord's data (404, not 403)", opts, async () => {
  const roomB = ctx.propB.rooms[0];
  assert.equal((await ctx.ll.get(`/api/rooms/${roomB.id}/A`)).status, 404);
  assert.equal((await ctx.ll.get(`/api/rooms?propertyId=${ctx.propB.id}`)).status, 404);
  assert.equal((await ctx.ll.get(`/api/properties/${ctx.propB.id}`)).status, 404);
  assert.equal((await ctx.ll.patch(`/api/properties/${ctx.propB.id}`).send({ name: 'Mine now' })).status, 404);
  assert.equal((await ctx.ll.post(`/api/properties/${ctx.propB.id}/rooms`).send({ number: 99 })).status, 404);
  assert.equal((await ctx.ll.patch(`/api/rooms/${roomB.id}`).send({ defaultRent: 1 })).status, 404);
  assert.equal((await ctx.ll.get(`/api/reports/income?propertyId=${ctx.propB.id}`)).status, 404);
  assert.equal((await ctx.ll.get(`/api/tenants?propertyId=${ctx.propB.id}`)).status, 404);
  const assign = await ctx.ll.post('/api/tenancies').send({
    roomId: roomB.id, bed: 'A', newTenant: { name: 'Sneaky' }, rent: 1000, moveInDate: '2026-01-01',
  });
  assert.equal(assign.status, 404);

  // B's tenant, payment and receipt are invisible to A, and to A's lists and reports.
  const tb = await ctx.llB.post('/api/tenancies').send({
    roomId: roomB.id, bed: 'A', newTenant: { name: `Secret B ${RUN}` }, rent: 150000, moveInDate: `${year}-01-01`,
  });
  assert.equal(tb.status, 201, tb.body.error);
  const pb = await ctx.llB.post('/api/payments').send({ tenancyId: tb.body.id, amount: 70000 });
  assert.equal(pb.status, 201, pb.body.error);
  assert.equal((await ctx.ll.get(`/api/tenancies/${tb.body.id}`)).status, 404);
  assert.equal((await ctx.ll.get(`/api/tenants/${tb.body.tenantId}`)).status, 404);
  assert.equal((await ctx.ll.post('/api/payments').send({ tenancyId: tb.body.id, amount: 100 })).status, 404);
  assert.equal((await ctx.ll.post(`/api/payments/${pb.body.paymentId}/void`).send({ reason: 'not mine' })).status, 404);
  assert.equal((await ctx.ll.get(`/api/receipts/${pb.body.receiptId}`)).status, 404);
  assert.equal((await ctx.ll.get(`/api/receipts/${pb.body.receiptId}/pdf`)).status, 404);
  assert.equal((await ctx.ll.post(`/api/tenancies/${tb.body.id}/charges`).send({ type: 'FEE', description: 'x', amount: 100, dueDate: `${year}-12-01` })).status, 404);
  const chargeB = await prisma.charge.findFirst({ where: { tenancyId: tb.body.id } });
  assert.ok(chargeB, 'B was billed from the move-in date');
  assert.equal((await ctx.ll.get(`/api/charges/${chargeB.id}`)).status, 404);
  assert.equal((await ctx.ll.post(`/api/charges/${chargeB.id}/waivers`).send({ amount: 100, reason: 'not mine' })).status, 404);
  assert.equal((await ctx.ll.post(`/api/charges/${chargeB.id}/cancel`).send({ reason: 'not mine' })).status, 404);
  assert.equal((await ctx.ll.post(`/api/properties/${ctx.propB.id}/terms`).send({ name: 'x', startDate: `${year}-01-01`, endDate: `${year}-02-01`, dueDate: `${year}-01-05` })).status, 404);
  assert.equal((await ctx.ll.get(`/api/notices?propertyId=${ctx.propB.id}`)).status, 404);
  assert.equal((await ctx.ll.post('/api/notices').send({ propertyId: ctx.propB.id, subject: 'x', message: 'y' })).status, 404);
  assert.equal((await ctx.ll.post('/api/notices/rent-increases/preview').send({ propertyId: ctx.propB.id, newRent: 999999, startsOn: dayFromToday(40) })).status, 404);
  const tenants = await ctx.ll.get('/api/tenants');
  assert.ok(!tenants.body.some((t) => t.name.startsWith('Secret B')));
  const income = await ctx.ll.get(`/api/reports/income?year=${year}`);
  assert.equal(income.body.totalNgwee, 0, 'the payment made to B is not in the income of A');
  const arrears = await ctx.ll.get('/api/reports/arrears');
  assert.ok(!arrears.body.rows.some((r) => r.tenantName.startsWith('Secret B')));
  const log = await ctx.ll.get('/api/audit');
  assert.equal(log.status, 200);
  assert.ok(log.body.rows.length > 0, 'A sees their own sign-in');
  assert.ok(log.body.rows.every((r) => r.organizationId === ctx.orgA.id), 'the audit log of A holds only entries of A');
  const peek = await ctx.ll.get(`/api/audit?organizationId=${ctx.orgB.id}`);
  assert.ok(peek.body.rows.every((r) => r.organizationId === ctx.orgA.id), 'asking for the log of B still returns only A');

  // ...while their own property works.
  const own = await ctx.ll.get(`/api/rooms?propertyId=${ctx.propA.id}`);
  assert.equal(own.status, 200);
  assert.equal(own.body.summary.totalBeds, 6);
  // /me lists only their business and property.
  const me = await ctx.ll.get('/api/auth/me');
  assert.equal(me.body.organization.id, ctx.orgA.id);
  assert.deepEqual(me.body.properties.map((p) => p.id), [ctx.propA.id]);
});

test('a landlord adds a property to their own business; codes are unique across landlords', opts, async () => {
  const made = await ctx.ll.post('/api/properties').send({ name: 'Second house', code: `N${RUN}`, roomCount: 2 });
  assert.equal(made.status, 201, made.body.error);
  assert.equal(made.body.organizationId, ctx.orgA.id);
  assert.equal((await ctx.llB.get(`/api/properties/${made.body.id}`)).status, 404);
  assert.equal((await ctx.llB.post('/api/properties').send({ name: 'Clash', code: `N${RUN}` })).status, 409);
  assert.equal((await ctx.ll.delete(`/api/properties/${made.body.id}`)).status, 200);
});

test('two simultaneous assignments to the same bed: exactly one wins', opts, async () => {
  const room = ctx.propA.rooms[0];
  const body = (name) => ({ roomId: room.id, bed: 'A', newTenant: { name }, rent: 150000, moveInDate: `${year}-01-01` });
  const [a, b] = await Promise.all([
    ctx.ll.post('/api/tenancies').send(body('Racer One')),
    ctx.ll.post('/api/tenancies').send(body('Racer Two')),
  ]);
  const codes = [a.status, b.status].sort();
  assert.deepEqual(codes, [201, 409]);
  ctx.tenancy = (a.status === 201 ? a : b).body;
  // The loser's tenant row must not have been left behind.
  const losers = await prisma.tenant.count({ where: { name: a.status === 201 ? 'Racer Two' : 'Racer One', propertyId: ctx.propA.id } });
  assert.equal(losers, 0);
});

// --- Payments, void, correct ----------------------------------------------------

test('payment → receipt numbered per property; void removes it from balances and reports', opts, async () => {
  const pay = await ctx.ll.post('/api/payments').send({
    tenancyId: ctx.tenancy.id, amount: 150000, method: 'cash',
  });
  assert.equal(pay.status, 201, pay.body.error);
  assert.equal(pay.body.receiptNumber, `RCT-A${RUN}-${year}-0001`);
  assert.equal(pay.body.lines[0].description, `Rent – January ${year}`, 'paid the oldest due rent first');
  ctx.pay1 = pay.body;

  const dash1 = await ctx.ll.get(`/api/rooms?propertyId=${ctx.propA.id}`);
  assert.equal(dash1.body.summary.collected, 150000);
  const inc1 = await ctx.ll.get(`/api/reports/income?year=${year}&propertyId=${ctx.propA.id}`);
  assert.equal(inc1.body.totalNgwee, 150000);

  // Reason is required.
  assert.equal((await ctx.ll.post(`/api/payments/${pay.body.paymentId}/void`).send({})).status, 400);

  const v = await ctx.ll.post(`/api/payments/${pay.body.paymentId}/void`).send({ reason: 'Entered on wrong tenant' });
  assert.equal(v.status, 200, v.body.error);
  assert.equal((await ctx.ll.post(`/api/payments/${pay.body.paymentId}/void`).send({ reason: 'again' })).status, 409);

  const dash2 = await ctx.ll.get(`/api/rooms?propertyId=${ctx.propA.id}`);
  assert.equal(dash2.body.summary.collected, 0);
  const inc2 = await ctx.ll.get(`/api/reports/income?year=${year}&propertyId=${ctx.propA.id}`);
  assert.equal(inc2.body.totalNgwee, 0);

  const r = await ctx.ll.get(`/api/receipts/${pay.body.receiptId}`);
  assert.equal(r.body.status, 'VOID');
  assert.equal(r.body.receiptNumber, `RCT-A${RUN}-${year}-0001`, 'number is kept');
  const pdf = await ctx.ll.get(`/api/receipts/${pay.body.receiptId}/pdf`);
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers['content-disposition'], /-VOID\.pdf/);
  assert.equal((await ctx.ll.post(`/api/receipts/${pay.body.receiptId}/resend`)).status, 400);
});

test('correct = void original + new receipt number, in one step', opts, async () => {
  const pay = await ctx.ll.post('/api/payments').send({
    tenancyId: ctx.tenancy.id, amount: 150000,
  });
  assert.equal(pay.status, 201);
  const fix = await ctx.ll.post(`/api/payments/${pay.body.paymentId}/correct`).send({
    amount: 100000, method: 'mobile_money', reason: 'Tenant actually paid K1,000',
  });
  assert.equal(fix.status, 201, fix.body.error);
  assert.equal(fix.body.receiptNumber, `RCT-A${RUN}-${year}-0003`, 'numbers continue, never reused');

  const orig = await prisma.payment.findUnique({ where: { id: pay.body.paymentId } });
  assert.equal(orig.status, 'VOID');
  const profile = await ctx.ll.get(`/api/tenancies/${ctx.tenancy.id}`);
  const jan = profile.body.charges.find((c) => c.description === `Rent – January ${year}`);
  assert.equal(jan.paid, 100000, 'only the replacement counts');
  assert.equal(jan.balance, 50000);
  // Correcting the already-voided original is refused.
  assert.equal(
    (await ctx.ll.post(`/api/payments/${pay.body.paymentId}/correct`).send({ amount: 1, reason: 'again' })).status,
    409
  );
});

test('arrears: a waiver lowers what is owed, reversing it restores it; no more than is owed can be waived', opts, async () => {
  const before = await ctx.ll.get(`/api/reports/arrears?propertyId=${ctx.propA.id}`);
  const row = before.body.rows.find((r) => r.tenancyId === ctx.tenancy.id);
  assert.ok(row, 'tenant owes money before the waiver');
  const owed = row.total;

  const jan = row.charges.find((c) => c.description === `Rent – January ${year}`);
  assert.equal(
    (await ctx.ll.post(`/api/charges/${jan.id}/waivers`).send({ amount: jan.balance + 1, reason: 'too much' })).status,
    400
  );
  const w = await ctx.ll.post(`/api/charges/${jan.id}/waivers`).send({ amount: jan.balance, reason: 'January waived — repairs' });
  assert.equal(w.status, 201, w.body.error);

  const mid = await ctx.ll.get(`/api/reports/arrears?propertyId=${ctx.propA.id}`);
  const midRow = mid.body.rows.find((r) => r.tenancyId === ctx.tenancy.id);
  assert.equal(midRow.total, owed - jan.balance);
  assert.ok(!midRow.charges.some((c) => c.id === jan.id), 'January is settled');

  assert.equal((await ctx.ll.post(`/api/charges/waivers/${w.body.id}/reverse`)).status, 200);
  assert.equal((await ctx.ll.post(`/api/charges/waivers/${w.body.id}/reverse`)).status, 409);
  const end = await ctx.ll.get(`/api/reports/arrears?propertyId=${ctx.propA.id}`);
  assert.equal(end.body.rows.find((r) => r.tenancyId === ctx.tenancy.id).total, owed);
});

// --- Billing: terms, credit, charges ------------------------------------------------

/** A fresh property of landlord A billed per term, with one term already running. */
async function termProperty(code, termStartOffset = -20) {
  const made = await ctx.ll.post('/api/properties').send({ name: `Hostel ${code}`, code, roomCount: 3, defaultRent: 600000, billingCycle: 'TERM' });
  assert.equal(made.status, 201, made.body.error);
  const term = await ctx.ll.post(`/api/properties/${made.body.id}/terms`).send({
    name: 'Semester 1', startDate: dayFromToday(termStartOffset), endDate: dayFromToday(termStartOffset + 150), dueDate: dayFromToday(termStartOffset + 10),
  });
  assert.equal(term.status, 201, term.body.error);
  const detail = await ctx.ll.get(`/api/properties/${made.body.id}`);
  return { property: made.body, term: term.body, rooms: detail.body.rooms };
}

async function moveIn(room, name, { rent = 600000, day = dayFromToday(-20), email = '' } = {}) {
  const t = await ctx.ll.post('/api/tenancies').send({ roomId: room.id, bed: 'A', newTenant: { name, email }, rent, moveInDate: day });
  assert.equal(t.status, 201, t.body.error);
  return t.body;
}

async function profileOf(tenancyId) {
  const res = await ctx.ll.get(`/api/tenancies/${tenancyId}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

test('term billing: one charge per term, oldest first, overpayment becomes credit and is used next', opts, async () => {
  const { property, term, rooms } = await termProperty(`T${RUN}`);
  const t = await moveIn(rooms[0], 'Mary Term');

  // Opening the profile many times at once never bills the term twice.
  await Promise.all([1, 2, 3, 4].map(() => ctx.ll.get(`/api/tenancies/${t.id}`)));
  let p = await profileOf(t.id);
  const rent = p.charges.filter((c) => c.type === 'RENT');
  assert.equal(rent.length, 1);
  assert.equal(rent[0].description, 'Semester 1 rent');
  assert.equal(rent[0].amount, 600000);
  assert.equal(p.owed, 600000);

  // The worked example: K6,000 term, pay K4,000 → owes K2,000; pay K3,000 → paid, K1,000 credit.
  const p1 = await ctx.ll.post('/api/payments').send({ tenancyId: t.id, amount: 400000 });
  assert.equal(p1.status, 201, p1.body.error);
  assert.equal(p1.body.totalBalance, 200000);
  const p2 = await ctx.ll.post('/api/payments').send({ tenancyId: t.id, amount: 300000 });
  assert.equal(p2.body.totalBalance, 0);
  assert.equal(p2.body.credit, 100000);
  const receipt = await ctx.ll.get(`/api/receipts/${p2.body.receiptId}`);
  assert.deepEqual(receipt.body.lines.map((l) => [l.description, l.paid, l.balanceAfter]), [['Semester 1 rent', 200000, 0]]);
  assert.equal(receipt.body.credit, 100000);

  // A deposit added later is paid from the credit automatically.
  const dep = await ctx.ll.post(`/api/tenancies/${t.id}/charges`).send({ type: 'DEPOSIT', description: 'Deposit', amount: 150000, dueDate: dayFromToday(5) });
  assert.equal(dep.status, 201, dep.body.error);
  p = await profileOf(t.id);
  assert.equal(p.credit, 0);
  assert.equal(p.owed, 50000, 'K1,000 credit went on the K1,500 deposit');
  assert.equal(p.statement.at(-1).balance, 50000);
  assert.equal((await ctx.ll.post(`/api/tenancies/${t.id}/charges`).send({ type: 'RENT', description: 'x', amount: 1, dueDate: dayFromToday(1) })).status, 400, 'rent is never added by hand');

  // Voiding the K3,000 payment puts that money back on the charges.
  assert.equal((await ctx.ll.post(`/api/payments/${p2.body.paymentId}/void`).send({ reason: 'Bounced' })).status, 200);
  p = await profileOf(t.id);
  assert.equal(p.owed, 200000 + 150000);
  assert.equal(p.credit, 0);

  // Cancelling a charge that was paid turns its money into credit for the others.
  const depCharge = p.charges.find((c) => c.type === 'DEPOSIT');
  assert.equal((await ctx.ll.post(`/api/charges/${depCharge.id}/cancel`).send({})).status, 400, 'a reason is required');
  const rentCharge = p.charges.find((c) => c.type === 'RENT');
  assert.equal((await ctx.ll.post(`/api/charges/${rentCharge.id}/cancel`).send({ reason: 'Billed in error' })).status, 200);
  assert.equal((await ctx.ll.post(`/api/charges/${rentCharge.id}/cancel`).send({ reason: 'again' })).status, 409);
  p = await profileOf(t.id);
  assert.equal(p.owed, 0, 'the K4,000 paid on the rent now pays the deposit');
  assert.equal(p.credit, 400000 - 150000);
  assert.equal(p.charges.filter((c) => c.type === 'RENT' && c.status !== 'CANCELLED').length, 0, 'a cancelled term is not billed again');

  // Terms: no overlaps; a billed term can't change; the cycle is fixed once rent is billed.
  const overlap = await ctx.ll.post(`/api/properties/${property.id}/terms`).send({ name: 'Clash', startDate: dayFromToday(0), endDate: dayFromToday(10), dueDate: dayFromToday(1) });
  assert.equal(overlap.status, 409);
  assert.equal((await ctx.ll.patch(`/api/properties/${property.id}/terms/${term.id}`).send({ name: 'Renamed' })).status, 409);
  assert.equal((await ctx.ll.delete(`/api/properties/${property.id}/terms/${term.id}`)).status, 409);
  assert.equal((await ctx.ll.patch(`/api/properties/${property.id}`).send({ billingCycle: 'MONTHLY' })).status, 409);
  assert.equal((await ctx.llB.get(`/api/properties/${property.id}`)).status, 404);
});

test('two payments at the same moment never pay the same charge twice', opts, async () => {
  const { rooms } = await termProperty(`U${RUN}`);
  const t = await moveIn(rooms[0], 'Peter Race');
  const [a, b] = await Promise.all([
    ctx.ll.post('/api/payments').send({ tenancyId: t.id, amount: 400000 }),
    ctx.ll.post('/api/payments').send({ tenancyId: t.id, amount: 400000 }),
  ]);
  assert.equal(a.status, 201, a.body.error);
  assert.equal(b.status, 201, b.body.error);
  const p = await profileOf(t.id);
  assert.equal(p.owed, 0);
  assert.equal(p.credit, 200000);
  const allocated = await prisma.allocation.aggregate({ _sum: { amount: true }, where: { charge: { tenancyId: t.id } } });
  assert.equal(allocated._sum.amount, 600000, 'exactly the charge, no more');
});

test('move-out date earlier than billed months cancels those months; a payment can pick charges first', opts, async () => {
  const room = ctx.propA.rooms[2];
  const made = await ctx.ll.post('/api/tenancies').send({ roomId: room.id, bed: 'B', newTenant: { name: 'Grace Months' }, rent: 100000, moveInDate: dayFromToday(-70) });
  assert.equal(made.status, 201, made.body.error);
  const t = made.body;
  let p = await profileOf(t.id);
  const months = p.charges.filter((c) => c.type === 'RENT');
  assert.ok(months.length >= 3, 'about three months billed');
  const fee = await ctx.ll.post(`/api/tenancies/${t.id}/charges`).send({ type: 'FEE', description: 'Key replacement', amount: 5000, dueDate: dayFromToday(0) });
  const pay = await ctx.ll.post('/api/payments').send({ tenancyId: t.id, amount: 5000, chargeIds: [fee.body.id] });
  assert.equal(pay.status, 201, pay.body.error);
  assert.deepEqual(pay.body.lines.map((l) => l.description), ['Key replacement'], 'the chosen charge first, not the oldest rent');

  const out = await ctx.ll.post(`/api/tenancies/${t.id}/moveout`).send({ moveOutDate: dayFromToday(-65) });
  assert.equal(out.status, 200, out.body.error);
  p = await profileOf(t.id);
  const live = p.charges.filter((c) => c.type === 'RENT' && c.status !== 'CANCELLED');
  assert.equal(live.length, 1, 'only the move-in month is still billed');
  assert.ok(p.charges.some((c) => c.cancelReason.startsWith('Outside the stay')));
  assert.equal((await ctx.ll.post(`/api/tenancies/${t.id}/undo-moveout`)).status, 200);
  p = await profileOf(t.id);
  assert.equal(p.charges.filter((c) => c.type === 'RENT' && c.status !== 'CANCELLED').length, months.length, 'billed again after undoing');
});

test('rent: corrected freely in the first week; later only lowered, raised only with notice', opts, async () => {
  const { rooms } = await termProperty(`R${RUN}`);
  const t = await moveIn(rooms[0], 'Ruth Rent');
  assert.equal((await ctx.ll.patch(`/api/tenancies/${t.id}`).send({ rent: 650000 })).status, 200, 'typo fixed');
  let p = await profileOf(t.id);
  assert.deepEqual(p.charges.filter((c) => c.type === 'RENT' && c.status !== 'CANCELLED').map((c) => c.amount), [650000], 're-billed at the corrected rent');

  await prisma.tenancy.update({ where: { id: t.id }, data: { createdAt: new Date(Date.now() - 10 * 86_400_000) } });
  const up = await ctx.ll.patch(`/api/tenancies/${t.id}`).send({ rent: 700000 });
  assert.equal(up.status, 400);
  assert.match(up.body.error, /30 days/);
  assert.equal((await ctx.ll.patch(`/api/tenancies/${t.id}`).send({ rent: 550000 })).status, 200, 'lowering is fine');
  p = await profileOf(t.id);
  assert.equal(p.tenancy.rent, 550000);
  assert.equal(p.charges.find((c) => c.type === 'RENT' && c.status !== 'CANCELLED').amount, 650000, 'rent already billed never changes');
  assert.equal(p.rentChanges[0].newRent, 550000);
});

// --- Rent increases and notices -----------------------------------------------------

test('rent increase: 30 days notice, chosen rooms only, old rent until it starts, new rent after', opts, async () => {
  const { property, rooms } = await termProperty(`I${RUN}`, -60);
  const a = await moveIn(rooms[0], 'Esther Increase', { rent: 500000, day: dayFromToday(-60), email: `esther-${RUN}@test.local` });
  const b = await moveIn(rooms[1], 'Moses Other Room', { rent: 500000, day: dayFromToday(-60) });
  await profileOf(a.id); // term 1 billed at K5,000

  const base = { propertyId: property.id, roomIds: [rooms[0].id], newRent: 600000 };
  const soon = await ctx.ll.post('/api/notices/rent-increases/preview').send({ ...base, startsOn: dayFromToday(29) });
  assert.equal(soon.status, 400);
  assert.match(soon.body.error, /30 days/);
  const preview = await ctx.ll.post('/api/notices/rent-increases/preview').send({ ...base, startsOn: dayFromToday(30) });
  assert.equal(preview.status, 200, preview.body.error);
  assert.deepEqual(preview.body.included.map((x) => x.tenancyId), [a.id], 'only the chosen room');

  const made = await ctx.ll.post('/api/notices/rent-increases').send({ ...base, startsOn: dayFromToday(30) });
  assert.equal(made.status, 201, made.body.error);
  assert.equal(made.body.notice.emailed, 1);
  const queued = await prisma.emailQueue.count({ where: { noticeRecipient: { noticeId: made.body.notice.id } } });
  assert.equal(queued, 1, 'one email queued for the tenant');
  let pa = await profileOf(a.id);
  assert.equal(pa.upcomingRentChange.newRent, 600000);
  assert.equal(pa.tenancy.rent, 500000, 'nothing changes before the start date');
  const again = await ctx.ll.post('/api/notices/rent-increases/preview').send({ ...base, startsOn: dayFromToday(45) });
  assert.equal(again.body.included.length, 0, 'one planned change at a time');

  // Time passes: the start date is reached, then the next term starts.
  await prisma.rentIncrease.update({ where: { id: made.body.id }, data: { startsOn: new Date(`${dayFromToday(-1)}T00:00:00Z`) } });
  await prisma.rentChange.updateMany({ where: { rentIncreaseId: made.body.id }, data: { startsOn: new Date(`${dayFromToday(-1)}T00:00:00Z`) } });
  const t2 = await ctx.ll.post(`/api/properties/${property.id}/terms`).send({ name: 'Semester 2', startDate: dayFromToday(100), endDate: dayFromToday(200), dueDate: dayFromToday(110) });
  assert.equal(t2.status, 201, t2.body.error);
  await prisma.billingTerm.update({ where: { id: t2.body.id }, data: { startDate: new Date(`${dayFromToday(0)}T00:00:00Z`) } }); // it has started
  pa = await profileOf(a.id);
  const pb = await profileOf(b.id);
  const amounts = (p) => p.charges.filter((c) => c.type === 'RENT').map((c) => [c.description, c.amount]);
  assert.deepEqual(amounts(pa), [['Semester 1 rent', 500000], ['Semester 2 rent', 600000]]);
  assert.deepEqual(amounts(pb), [['Semester 1 rent', 500000], ['Semester 2 rent', 500000]], 'the other room is unchanged');
  assert.equal(pa.tenancy.rent, 600000);
  const room0 = await prisma.room.findUnique({ where: { id: rooms[0].id } });
  assert.equal(room0.defaultRent, 600000, "the room's default rent changes on the start date");
  assert.equal((await ctx.ll.post(`/api/notices/rent-increases/${made.body.id}/cancel`)).status, 409, 'too late to cancel');

  // A planned increase can be called off before it starts; tenants are told.
  const other = await ctx.ll.post('/api/notices/rent-increases').send({ propertyId: property.id, roomIds: [rooms[1].id], newRent: 550000, startsOn: dayFromToday(40) });
  assert.equal(other.status, 201, other.body.error);
  assert.deepEqual(other.body.notice.noEmail, ['Moses Other Room'], 'tenants without email are listed');
  const cancel = await ctx.ll.post(`/api/notices/rent-increases/${other.body.id}/cancel`);
  assert.equal(cancel.status, 200, cancel.body.error);
  assert.equal((await profileOf(b.id)).upcomingRentChange, null);
  const list = await ctx.ll.get(`/api/notices/rent-increases?propertyId=${property.id}`);
  assert.deepEqual(list.body.map((r) => r.status), ['CANCELLED', 'STARTED']);
  assert.equal((await ctx.llB.post(`/api/notices/rent-increases/${other.body.id}/cancel`)).status, 404);
});

test('notices: a message goes to every current tenant; the history shows who got it', opts, async () => {
  const { property, rooms } = await termProperty(`M${RUN}`);
  await moveIn(rooms[0], 'Agnes Email', { email: `agnes-${RUN}@test.local` });
  await moveIn(rooms[1], 'Kelvin NoEmail');
  assert.equal((await ctx.ll.post('/api/notices').send({ propertyId: property.id, subject: '', message: 'x' })).status, 400);
  const sent = await ctx.ll.post('/api/notices').send({ propertyId: property.id, subject: 'Water off on Friday', message: 'From 9 to 12.' });
  assert.equal(sent.status, 201, sent.body.error);
  assert.equal(sent.body.recipientCount, 2);
  assert.deepEqual(sent.body.noEmail, ['Kelvin NoEmail']);
  const one = await ctx.ll.get(`/api/notices/${sent.body.id}`);
  assert.equal(one.status, 200);
  const agnes = one.body.recipients.find((r) => r.tenantName === 'Agnes Email');
  assert.match(agnes.message, /^Dear Agnes Email,\n\nFrom 9 to 12\./);
  assert.equal(one.body.recipients.find((r) => r.tenantName === 'Kelvin NoEmail').status, 'no_email');
  const list = await ctx.ll.get(`/api/notices?propertyId=${property.id}`);
  assert.equal(list.body[0].subject, 'Water off on Friday');
  assert.equal(list.body[0].noEmail, 1);
  assert.equal((await ctx.llB.get(`/api/notices/${sent.body.id}`)).status, 404);
  const onlyRoom = await ctx.ll.post('/api/notices').send({ propertyId: property.id, roomIds: [rooms[2].id], subject: 's', message: 'm' });
  assert.equal(onlyRoom.status, 400, 'nobody lives in that room');
});

test('CSV export neutralises spreadsheet formulas in tenant names', opts, async () => {
  const room = ctx.propA.rooms[1];
  const t = await ctx.ll.post('/api/tenancies').send({
    roomId: room.id, bed: 'A', newTenant: { name: '=HYPERLINK("http://evil","x")' }, rent: 150000, moveInDate: `${year}-01-01`,
  });
  assert.equal(t.status, 201, t.body.error);
  const csv = await ctx.ll.get(`/api/reports/arrears?propertyId=${ctx.propA.id}&format=csv`);
  assert.equal(csv.status, 200);
  assert.ok(csv.text.includes(`"'=HYPERLINK(""http://evil"",""x"")"`), csv.text);
});

test('property code is editable until a receipt carries it, and must start with a letter', opts, async () => {
  const fresh = `C${RUN}`;
  // A new property has no receipts yet, so its code can still change.
  const made = await ctx.llB.post('/api/properties').send({ name: 'No receipts yet', code: `E${RUN}`, roomCount: 1 });
  assert.equal(made.status, 201, made.body.error);
  assert.equal((await ctx.llB.patch(`/api/properties/${made.body.id}`).send({ code: '2026' })).status, 400);
  assert.equal((await ctx.llB.patch(`/api/properties/${made.body.id}`).send({ code: fresh })).status, 200);
  await ctx.llB.patch(`/api/properties/${made.body.id}`).send({ code: `E${RUN}` });
  // Property A has issued RCT-A…-receipts, so its code is locked.
  const locked = await ctx.ll.patch(`/api/properties/${ctx.propA.id}`).send({ code: fresh });
  assert.equal(locked.status, 409);
});

// --- Login lockout & rate limiting --------------------------------------------

test('lockout: 5 wrong passwords lock the account, even the right password is refused', opts, async () => {
  const email = `lock-${RUN}@test.local`.toLowerCase();
  await prisma.user.create({ data: { email, role: 'LANDLORD', organizationId: ctx.orgA.id, passwordHash: await bcrypt.hash('right-password-1', 4) } });
  const ip = nextIp();
  const attempt = (pw) => request(app).post('/api/auth/login').set('X-Forwarded-For', ip).send({ email, password: pw });
  for (let i = 1; i <= 4; i++) assert.equal((await attempt('wrong')).status, 401, `attempt ${i}`);
  const fifth = await attempt('wrong');
  assert.equal(fifth.status, 423);
  assert.match(fifth.body.error, /15 minutes/);
  const right = await request(app).post('/api/auth/login').set('X-Forwarded-For', nextIp()).send({ email, password: 'right-password-1' });
  assert.equal(right.status, 423, 'locked even with the correct password');

  // Admin unlock works.
  const u = await prisma.user.findUnique({ where: { email } });
  assert.equal((await ctx.admin.post(`/api/admin/users/${u.id}/unlock`)).status, 200);
  const ok = await request(app).post('/api/auth/login').set('X-Forwarded-For', nextIp()).send({ email, password: 'right-password-1' });
  assert.equal(ok.status, 200);
});

test('lockout behaves identically for unknown emails (no account enumeration)', opts, async () => {
  const email = `nobody-${RUN}@test.local`;
  const ip = nextIp();
  const statuses = [];
  for (let i = 0; i < 5; i++) {
    statuses.push((await request(app).post('/api/auth/login').set('X-Forwarded-For', ip).send({ email, password: 'x' })).status);
  }
  assert.deepEqual(statuses, [401, 401, 401, 401, 423]);
});

test('per-IP limit: the 11th failed attempt from one address is refused (429)', opts, async () => {
  const ip = nextIp();
  let last;
  for (let i = 0; i < 11; i++) {
    last = await request(app).post('/api/auth/login').set('X-Forwarded-For', ip).send({ email: `ip-${i}-${RUN}@test.local`, password: 'x' });
  }
  assert.equal(last.status, 429);
});

// --- Sessions & passwords ----------------------------------------------------------

test('changing password signs out other sessions; this device stays signed in', opts, async () => {
  const email = `sess-${RUN}@test.local`.toLowerCase();
  await prisma.user.create({
    data: { email, role: 'LANDLORD', organizationId: ctx.orgA.id, passwordHash: await bcrypt.hash('first-password-1', 4) },
  });
  const phone = await signIn(email, 'first-password-1');
  const laptop = await signIn(email, 'first-password-1');
  const ch = await laptop.post('/api/auth/change-password').send({ currentPassword: 'first-password-1', newPassword: 'second-password-2' });
  assert.equal(ch.status, 200, ch.body.error);
  assert.equal((await phone.get('/api/auth/me')).status, 401, 'old session revoked');
  assert.equal((await laptop.get('/api/auth/me')).status, 200, 'current device keeps a fresh session');
});

test('weak and common passwords are rejected', opts, async () => {
  const res = await ctx.ll.post('/api/auth/change-password').send({ currentPassword: LL_PW, newPassword: 'password123' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /too common/);
});

test('reset link is built from APP_URL even if the request claims another origin', opts, async () => {
  const logs = [];
  const orig = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .set('X-Forwarded-For', nextIp())
      .set('Origin', 'https://evil.example')
      .set('Host', 'evil.example')
      .send({ email: ctx.adminEmail });
    // Origin check blocks foreign-origin POSTs outright…
    assert.equal(res.status, 403);
    // …and even without an Origin header, a spoofed Host never reaches the link.
    const res2 = await request(app).post('/api/auth/forgot-password').set('X-Forwarded-For', nextIp()).set('Host', 'evil.example').send({ email: ctx.adminEmail });
    assert.equal(res2.status, 200);
    await new Promise((r) => setTimeout(r, 500));
  } finally {
    console.log = orig;
  }
  const line = logs.find((l) => l.includes('/reset?token='));
  assert.ok(line, 'reset link logged in dev');
  assert.ok(!line.includes('evil.example'));
  assert.ok(line.includes('http://localhost:5173/reset?token='));
});

test('a reset token works once and then stops working', opts, async () => {
  const { makeResetToken } = await import('../src/auth.js');
  const user = await prisma.user.findUnique({ where: { email: ctx.llEmail } });
  const token = makeResetToken(user);
  const first = await request(app).post('/api/auth/reset-password').set('X-Forwarded-For', nextIp()).send({ token, newPassword: 'brand-new-pass-9' });
  assert.equal(first.status, 200, first.body.error);
  const again = await request(app).post('/api/auth/reset-password').set('X-Forwarded-For', nextIp()).send({ token, newPassword: 'another-pass-99' });
  assert.equal(again.status, 400);
  assert.equal((await ctx.ll.get('/api/auth/me')).status, 401, 'reset signs out existing sessions');
  ctx.ll = await signIn(ctx.llEmail, 'brand-new-pass-9');
});

test('super admin creates a landlord; they must change the temporary password, then start empty', opts, async () => {
  const email = `new-${RUN}@test.local`.toLowerCase();
  const weak = await ctx.admin.post('/api/admin/landlords').send({ name: `New LL ${RUN}`, ownerEmail: email, tempPassword: 'short' });
  assert.equal(weak.status, 400);
  const created = await ctx.admin.post('/api/admin/landlords').send({
    name: `New LL ${RUN}`, ownerName: 'New Owner', ownerEmail: email, tempPassword: 'temporary-pass-1',
  });
  assert.equal(created.status, 201, created.body.error);
  ctx.newOrgId = created.body.id;
  ctx.newEmail = email;
  const dup = await ctx.admin.post('/api/admin/landlords').send({ name: 'Dup', ownerEmail: email, tempPassword: 'temporary-pass-1' });
  assert.equal(dup.status, 409);

  const agent = await signIn(email, 'temporary-pass-1');
  const blocked = await agent.get('/api/properties');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'PASSWORD_CHANGE_REQUIRED');
  const ch = await agent.post('/api/auth/change-password').send({ currentPassword: 'temporary-pass-1', newPassword: 'my-own-pass-77' });
  assert.equal(ch.status, 200);
  const props = await agent.get('/api/properties');
  assert.equal(props.status, 200);
  assert.deepEqual(props.body, [], 'a new landlord sees nothing from other landlords');
  assert.equal((await agent.get(`/api/properties/${ctx.propA.id}`)).status, 404);
  ctx.newLl = agent;
});

test('suspending a landlord signs them out at once; reactivating lets them back in', opts, async () => {
  assert.equal((await ctx.admin.patch(`/api/admin/landlords/${ctx.newOrgId}`).send({ isActive: false })).status, 200);
  assert.equal((await ctx.newLl.get('/api/auth/me')).status, 401);
  const relogin = await request(app).post('/api/auth/login').set('X-Forwarded-For', nextIp()).send({ email: ctx.newEmail, password: 'my-own-pass-77' });
  assert.equal(relogin.status, 403);
  assert.equal((await ctx.ll.get('/api/auth/me')).status, 200, 'other landlords are unaffected');
  assert.equal((await ctx.admin.patch(`/api/admin/landlords/${ctx.newOrgId}`).send({ isActive: true })).status, 200);
  await signIn(ctx.newEmail, 'my-own-pass-77');
});

test("super admin resets a landlord's password: old sessions end, a new password must be chosen", opts, async () => {
  const u = await prisma.user.findUnique({ where: { email: ctx.llBEmail } });
  const res = await ctx.admin.post(`/api/admin/users/${u.id}/reset-password`).send({ tempPassword: 'temporary-pass-2' });
  assert.equal(res.status, 200, res.body.error);
  assert.equal((await ctx.llB.get('/api/auth/me')).status, 401);
  const agent = await signIn(ctx.llBEmail, 'temporary-pass-2');
  assert.equal((await agent.get('/api/properties')).body.code, 'PASSWORD_CHANGE_REQUIRED');
  // The account endpoints never act on a super admin.
  const me = (await ctx.admin.get('/api/auth/me')).body;
  assert.equal((await ctx.admin.post(`/api/admin/users/${me.id}/reset-password`).send({ tempPassword: 'temporary-pass-3' })).status, 404);
});

// --- Phone app (/api/v1): token sign-in --------------------------------------------

test('phone app: sign in with tokens, dashboard for own business only, refresh, revoke', opts, async () => {
  const login = () => request(app).post('/api/v1/auth/login').set('X-Forwarded-For', nextIp());
  const bad = await login().send({ email: ctx.llEmail, password: 'wrong' });
  assert.equal(bad.status, 401);
  assert.equal(typeof bad.body.error.message, 'string', 'v1 errors are { error: { message } }');
  assert.equal((await login().send({ email: ctx.adminEmail, password: ADMIN_PW })).status, 403, 'super admin uses the website');

  const pw = 'brand-new-pass-9'; // set by the reset-token test above
  const ok = await login().send({ email: ctx.llEmail, password: pw });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.me.role, 'LANDLORD');
  assert.equal(ok.body.me.organizationName, ctx.orgA.name);
  const { accessToken, refreshToken } = ok.body.tokens;
  const get = (path, token) => request(app).get(path).set('Authorization', `Bearer ${token}`);

  assert.equal((await request(app).get('/api/v1/landlord/dashboard')).status, 401);
  const dash = await get('/api/v1/landlord/dashboard', accessToken);
  assert.equal(dash.status, 200, JSON.stringify(dash.body));
  // The phone's totals are the sum of landlord A's own properties on the website.
  const props = (await ctx.ll.get('/api/properties')).body;
  const sums = { totalBeds: 0, occupied: 0, collected: 0, outstanding: 0 };
  for (const p of props) {
    const web = (await ctx.ll.get(`/api/rooms?propertyId=${p.id}`)).body.summary;
    sums.totalBeds += web.totalBeds;
    sums.occupied += web.occupied;
    sums.collected += web.collected;
    sums.outstanding += web.outstanding;
  }
  const bedsOfA = await prisma.room.aggregate({ _sum: { bedCount: true }, where: { archivedAt: null, property: { organizationId: ctx.orgA.id, archivedAt: null } } });
  assert.equal(dash.body.totalBeds, bedsOfA._sum.bedCount, 'only the beds of landlord A');
  assert.equal(dash.body.totalBeds, sums.totalBeds);
  assert.equal(dash.body.occupiedBeds, sums.occupied);
  assert.equal(dash.body.collected, sums.collected);
  assert.equal(dash.body.outstanding, sums.outstanding);
  assert.deepEqual((await get('/api/v1/landlord/transfers', accessToken)).body, []);
  assert.equal((await get('/api/v1/me', accessToken)).body.email, ctx.llEmail);

  // A refresh token is not an access token, and vice versa.
  assert.equal((await get('/api/v1/me', refreshToken)).status, 401);
  assert.equal((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: accessToken })).status, 401);
  const fresh = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
  assert.equal(fresh.status, 200);
  assert.equal((await get('/api/v1/me', fresh.body.accessToken)).status, 200);

  // "Sign out everywhere" ends the phone's tokens too.
  const u = await prisma.user.findUnique({ where: { email: ctx.llEmail } });
  assert.equal((await ctx.admin.post(`/api/admin/users/${u.id}/revoke-sessions`)).status, 200);
  assert.equal((await get('/api/v1/me', fresh.body.accessToken)).status, 401);
  assert.equal((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: fresh.body.refreshToken })).status, 401);
  ctx.ll = await signIn(ctx.llEmail, pw);
});

// --- CSRF & audit ---------------------------------------------------------------------

test('state-changing requests from a foreign origin are blocked', opts, async () => {
  const res = await ctx.ll.post('/api/tenancies').set('Origin', 'https://evil.example').send({});
  assert.equal(res.status, 403);
  const ok = await ctx.ll.post('/api/tenancies').set('Origin', 'http://localhost:5173').send({});
  assert.equal(ok.status, 400, 'same-origin passes the check (then fails validation)');
});

test('audit log records voids, corrections, lockouts, logins and landlord changes', opts, async () => {
  const mine = await ctx.ll.get('/api/audit?action=payment');
  assert.ok(mine.body.rows.some((r) => r.action === 'payment.void'), 'a landlord sees their own voids');
  const ll = await ctx.admin.get('/api/admin/audit?action=landlord');
  const lla = new Set(ll.body.rows.map((r) => r.action));
  for (const act of ['landlord.create', 'landlord.suspend', 'landlord.reactivate']) assert.ok(lla.has(act), act);
  const res = await ctx.admin.get('/api/admin/audit?action=payment');
  const actions = new Set(res.body.rows.map((r) => r.action));
  for (const a of ['payment.create', 'payment.void', 'payment.correct']) assert.ok(actions.has(a), a);
  const billing = await ctx.ll.get('/api/audit?action=charge');
  const ba = new Set(billing.body.rows.map((r) => r.action));
  for (const a of ['charge.create', 'charge.cancel', 'charge.waive', 'charge.waive_reverse']) assert.ok(ba.has(a), a);
  const rent = await ctx.ll.get('/api/audit?action=rent_increase');
  assert.ok(rent.body.rows.some((r) => r.action === 'rent_increase.cancel'));
  const logins = await ctx.admin.get('/api/admin/audit?action=login');
  const la = new Set(logins.body.rows.map((r) => r.action));
  for (const a of ['login.success', 'login.failed', 'login.locked']) assert.ok(la.has(a), a);
  // Secrets are never written to the log.
  assert.ok(!JSON.stringify(res.body).includes('passwordHash'));
});
