// End-to-end API tests: roles, property isolation (IDOR), lockout, sessions,
// password reset, voids/corrections, arrears, CSRF and CSV safety.
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
const thisMonth = new Date().getMonth() + 1;

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

  const mk = (code, name) =>
    prisma.property.create({
      data: { name, code, rooms: { create: [1, 2, 3].map((n) => ({ number: n, bedCount: 2, defaultRent: 150000 })) } },
      include: { rooms: { orderBy: { number: 'asc' } } },
    });
  ctx.propA = await mk(`A${RUN}`, `Test A ${RUN}`);
  ctx.propB = await mk(`B${RUN}`, `Test B ${RUN}`);
  ctx.adminEmail = `admin-${RUN}@test.local`.toLowerCase();
  ctx.llEmail = `landlord-${RUN}@test.local`.toLowerCase();
  await prisma.user.create({
    data: { email: ctx.adminEmail, role: 'ADMIN', passwordHash: await bcrypt.hash(ADMIN_PW, 4) },
  });
  await prisma.user.create({
    data: {
      email: ctx.llEmail,
      role: 'LANDLORD',
      passwordHash: await bcrypt.hash(LL_PW, 4),
      propertyAccess: { create: [{ propertyId: ctx.propA.id }] },
    },
  });
  ctx.admin = await signIn(ctx.adminEmail, ADMIN_PW);
  ctx.ll = await signIn(ctx.llEmail, LL_PW);
});

after(async () => {
  if (prisma) await prisma.$disconnect();
});

// --- Roles & property isolation ----------------------------------------------

test('landlord is refused admin-only endpoints (403)', opts, async () => {
  assert.equal((await ctx.ll.get('/api/admin/users')).status, 403);
  assert.equal((await ctx.ll.get('/api/settings')).status, 403);
  assert.equal((await ctx.ll.get('/api/admin/audit')).status, 403);
  assert.equal((await ctx.ll.post('/api/properties').send({ name: 'x', code: 'XX' })).status, 403);
  assert.equal((await ctx.ll.get('/api/reports/voids')).status, 403);
});

test("landlord cannot see another property's data (404, not 403)", opts, async () => {
  const roomB = ctx.propB.rooms[0];
  assert.equal((await ctx.ll.get(`/api/rooms/${roomB.id}/A`)).status, 404);
  assert.equal((await ctx.ll.get(`/api/rooms?propertyId=${ctx.propB.id}`)).status, 404);
  assert.equal((await ctx.ll.get(`/api/properties/${ctx.propB.id}`)).status, 404);
  const assign = await ctx.ll.post('/api/tenancies').send({
    roomId: roomB.id, bed: 'A', newTenant: { name: 'Sneaky' }, monthlyRent: 1000, moveInDate: '2026-01-01',
  });
  assert.equal(assign.status, 404);
  // …while their own property works.
  const own = await ctx.ll.get(`/api/rooms?propertyId=${ctx.propA.id}`);
  assert.equal(own.status, 200);
  assert.equal(own.body.summary.totalBeds, 6);
  // /me lists only their property.
  const me = await ctx.ll.get('/api/auth/me');
  assert.deepEqual(me.body.properties.map((p) => p.id), [ctx.propA.id]);
});

test('two simultaneous assignments to the same bed: exactly one wins', opts, async () => {
  const room = ctx.propA.rooms[0];
  const body = (name) => ({ roomId: room.id, bed: 'A', newTenant: { name }, monthlyRent: 150000, moveInDate: `${year}-01-01` });
  const [a, b] = await Promise.all([
    ctx.admin.post('/api/tenancies').send(body('Racer One')),
    ctx.admin.post('/api/tenancies').send(body('Racer Two')),
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
    tenancyId: ctx.tenancy.id, amount: 150000, months: [{ month: thisMonth, year }], method: 'cash',
  });
  assert.equal(pay.status, 201, pay.body.error);
  assert.equal(pay.body.receiptNumber, `RCT-A${RUN}-${year}-0001`);
  ctx.pay1 = pay.body;

  const dash1 = await ctx.admin.get(`/api/rooms?propertyId=${ctx.propA.id}`);
  assert.equal(dash1.body.summary.collected, 150000);
  const inc1 = await ctx.admin.get(`/api/reports/income?year=${year}&propertyId=${ctx.propA.id}`);
  assert.equal(inc1.body.totalNgwee, 150000);

  // Landlord may not void.
  assert.equal((await ctx.ll.post(`/api/payments/${pay.body.paymentId}/void`).send({ reason: 'oops' })).status, 403);
  // Reason is required.
  assert.equal((await ctx.admin.post(`/api/payments/${pay.body.paymentId}/void`).send({})).status, 400);

  const v = await ctx.admin.post(`/api/payments/${pay.body.paymentId}/void`).send({ reason: 'Entered on wrong tenant' });
  assert.equal(v.status, 200, v.body.error);
  assert.equal((await ctx.admin.post(`/api/payments/${pay.body.paymentId}/void`).send({ reason: 'again' })).status, 409);

  const dash2 = await ctx.admin.get(`/api/rooms?propertyId=${ctx.propA.id}`);
  assert.equal(dash2.body.summary.collected, 0);
  const inc2 = await ctx.admin.get(`/api/reports/income?year=${year}&propertyId=${ctx.propA.id}`);
  assert.equal(inc2.body.totalNgwee, 0);

  const r = await ctx.admin.get(`/api/receipts/${pay.body.receiptId}`);
  assert.equal(r.body.status, 'VOID');
  assert.equal(r.body.receiptNumber, `RCT-A${RUN}-${year}-0001`, 'number is kept');
  const pdf = await ctx.admin.get(`/api/receipts/${pay.body.receiptId}/pdf`);
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers['content-disposition'], /-VOID\.pdf/);
  assert.equal((await ctx.admin.post(`/api/receipts/${pay.body.receiptId}/resend`)).status, 400);
});

test('correct = void original + new receipt number, in one step', opts, async () => {
  const pay = await ctx.ll.post('/api/payments').send({
    tenancyId: ctx.tenancy.id, amount: 150000, months: [{ month: thisMonth, year }],
  });
  assert.equal(pay.status, 201);
  const fix = await ctx.admin.post(`/api/payments/${pay.body.paymentId}/correct`).send({
    amount: 100000, months: [{ month: thisMonth, year }], method: 'mobile_money', reason: 'Tenant actually paid K1,000',
  });
  assert.equal(fix.status, 201, fix.body.error);
  assert.equal(fix.body.receiptNumber, `RCT-A${RUN}-${year}-0003`, 'numbers continue, never reused');

  const orig = await prisma.payment.findUnique({ where: { id: pay.body.paymentId } });
  assert.equal(orig.status, 'VOID');
  const profile = await ctx.admin.get(`/api/tenancies/${ctx.tenancy.id}`);
  const m = profile.body.months.find((x) => x.year === year && x.month === thisMonth);
  assert.equal(m.applied, 100000);
  assert.equal(m.balance, 50000);
  // Correcting the already-voided original is refused.
  assert.equal(
    (await ctx.admin.post(`/api/payments/${pay.body.paymentId}/correct`).send({ amount: 1, months: [{ month: thisMonth, year }], reason: 'again' })).status,
    409
  );
});

test('arrears: waiver clears a month, reversing restores it', opts, async () => {
  const before = await ctx.admin.get(`/api/reports/arrears?propertyId=${ctx.propA.id}`);
  const row = before.body.rows.find((r) => r.tenancyId === ctx.tenancy.id);
  assert.ok(row, 'tenant owes money before the waiver');
  const owed = row.total;

  assert.equal((await ctx.ll.post(`/api/tenancies/${ctx.tenancy.id}/adjustments`).send({ month: 1, year, amount: -150000, reason: 'x y z' })).status, 403);
  const jan = row.months.find((mm) => mm.month === 1 && mm.year === year);
  const adj = await ctx.admin.post(`/api/tenancies/${ctx.tenancy.id}/adjustments`).send({
    month: 1, year, amount: -jan.balance, reason: 'January waived — repairs',
  });
  assert.equal(adj.status, 201, adj.body.error);

  const mid = await ctx.admin.get(`/api/reports/arrears?propertyId=${ctx.propA.id}`);
  const midRow = mid.body.rows.find((r) => r.tenancyId === ctx.tenancy.id);
  assert.equal(midRow.total, owed - jan.balance);

  assert.equal((await ctx.admin.post(`/api/tenancies/adjustments/${adj.body.id}/reverse`)).status, 200);
  const end = await ctx.admin.get(`/api/reports/arrears?propertyId=${ctx.propA.id}`);
  assert.equal(end.body.rows.find((r) => r.tenancyId === ctx.tenancy.id).total, owed);
});

test('CSV export neutralises spreadsheet formulas in tenant names', opts, async () => {
  const room = ctx.propA.rooms[1];
  const t = await ctx.admin.post('/api/tenancies').send({
    roomId: room.id, bed: 'A', newTenant: { name: '=HYPERLINK("http://evil","x")' }, monthlyRent: 150000, moveInDate: `${year}-01-01`,
  });
  assert.equal(t.status, 201, t.body.error);
  const csv = await ctx.admin.get(`/api/reports/arrears?propertyId=${ctx.propA.id}&format=csv`);
  assert.equal(csv.status, 200);
  assert.ok(csv.text.includes(`"'=HYPERLINK(""http://evil"",""x"")"`), csv.text);
});

test('property code is editable until a receipt carries it, and must start with a letter', opts, async () => {
  const fresh = `C${RUN}`;
  assert.equal((await ctx.admin.patch(`/api/properties/${ctx.propB.id}`).send({ code: '2026' })).status, 400);
  assert.equal((await ctx.admin.patch(`/api/properties/${ctx.propB.id}`).send({ code: fresh })).status, 200);
  await ctx.admin.patch(`/api/properties/${ctx.propB.id}`).send({ code: `B${RUN}` });
  // Property A has issued RCT-A…-receipts, so its code is locked.
  const locked = await ctx.admin.patch(`/api/properties/${ctx.propA.id}`).send({ code: fresh });
  assert.equal(locked.status, 409);
});

// --- Login lockout & rate limiting --------------------------------------------

test('lockout: 5 wrong passwords lock the account, even the right password is refused', opts, async () => {
  const email = `lock-${RUN}@test.local`.toLowerCase();
  await prisma.user.create({ data: { email, role: 'LANDLORD', passwordHash: await bcrypt.hash('right-password-1', 4) } });
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
    data: { email, role: 'LANDLORD', passwordHash: await bcrypt.hash('first-password-1', 4), propertyAccess: { create: [{ propertyId: ctx.propA.id }] } },
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

test('new users must change their temporary password before using the app', opts, async () => {
  const email = `new-${RUN}@test.local`.toLowerCase();
  const created = await ctx.admin.post('/api/admin/users').send({
    email, role: 'LANDLORD', tempPassword: 'temporary-pass-1', propertyIds: [ctx.propA.id],
  });
  assert.equal(created.status, 201, created.body.error);
  const agent = await signIn(email, 'temporary-pass-1');
  const blocked = await agent.get(`/api/rooms?propertyId=${ctx.propA.id}`);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'PASSWORD_CHANGE_REQUIRED');
  const ch = await agent.post('/api/auth/change-password').send({ currentPassword: 'temporary-pass-1', newPassword: 'my-own-pass-77' });
  assert.equal(ch.status, 200);
  assert.equal((await agent.get(`/api/rooms?propertyId=${ctx.propA.id}`)).status, 200);
});

test('admin safeguards: cannot deactivate, demote or delete yourself', opts, async () => {
  const me = (await ctx.admin.get('/api/auth/me')).body;
  assert.equal((await ctx.admin.patch(`/api/admin/users/${me.id}`).send({ isActive: false })).status, 400);
  assert.equal((await ctx.admin.patch(`/api/admin/users/${me.id}`).send({ role: 'LANDLORD' })).status, 400);
  assert.equal((await ctx.admin.delete(`/api/admin/users/${me.id}`)).status, 400);
});

test('deactivating a user ends their session immediately', opts, async () => {
  const u = await prisma.user.findUnique({ where: { email: ctx.llEmail } });
  assert.equal((await ctx.admin.patch(`/api/admin/users/${u.id}`).send({ isActive: false })).status, 200);
  assert.equal((await ctx.ll.get('/api/auth/me')).status, 401);
  const relogin = await request(app).post('/api/auth/login').set('X-Forwarded-For', nextIp()).send({ email: ctx.llEmail, password: 'brand-new-pass-9' });
  assert.equal(relogin.status, 403);
  await ctx.admin.patch(`/api/admin/users/${u.id}`).send({ isActive: true });
});

// --- CSRF & audit ---------------------------------------------------------------------

test('state-changing requests from a foreign origin are blocked', opts, async () => {
  const res = await ctx.admin.post('/api/tenancies').set('Origin', 'https://evil.example').send({});
  assert.equal(res.status, 403);
  const ok = await ctx.admin.post('/api/tenancies').set('Origin', 'http://localhost:5173').send({});
  assert.equal(ok.status, 400, 'same-origin passes the check (then fails validation)');
});

test('audit log records voids, corrections, lockouts and logins', opts, async () => {
  const res = await ctx.admin.get('/api/admin/audit?action=payment');
  const actions = new Set(res.body.rows.map((r) => r.action));
  for (const a of ['payment.create', 'payment.void', 'payment.correct']) assert.ok(actions.has(a), a);
  const logins = await ctx.admin.get('/api/admin/audit?action=login');
  const la = new Set(logins.body.rows.map((r) => r.action));
  for (const a of ['login.success', 'login.failed', 'login.locked']) assert.ok(la.has(a), a);
  // Secrets are never written to the log.
  assert.ok(!JSON.stringify(res.body).includes('passwordHash'));
});
