// Demo mode: realistic sample data held in memory, so the app can be tried on a
// phone before the /api/v1 server exists. Nothing here uses the network, and
// everything resets when the app restarts.
//
// The three demo accounts share one world: a bank slip uploaded by the student
// appears in the landlord's verification queue, and approving it updates the
// student's balance. Mobile-money payments "succeed" a few seconds after they
// start; a phone number ending in 0000 simulates a declined payment.

import { formatK, normaliseZambianMsisdn, todayISO } from '@/format';
import {
  ApiError,
  type Api,
  type ChargeShare,
  type ChargeType,
  type LandlordDashboard,
  type Me,
  type Payment,
  type Role,
  type ShareStatus,
  type SponsoredStudent,
} from './types';

const PASSWORD = 'demo1234';

interface DemoUser extends Me {
  password: string;
  residentId?: string;
  sponsorId?: string;
  orgCode?: string;
}

const USERS: DemoUser[] = [
  {
    id: 'u-student',
    email: 'student@rentreceipt.example',
    name: 'Mary Banda',
    role: 'STUDENT',
    organizationName: 'Kabulonga Court',
    residentId: 'r-mary',
    password: PASSWORD,
  },
  {
    id: 'u-sponsor',
    email: 'sponsor@rentreceipt.example',
    name: 'Ruth Lungu',
    role: 'SPONSOR',
    sponsorName: 'Kafue Bursary Trust',
    sponsorId: 's-kbt',
    password: PASSWORD,
  },
  {
    id: 'u-landlord',
    email: 'landlord@rentreceipt.example',
    name: 'Agnes Tembo',
    role: 'LANDLORD',
    organizationName: 'Kabulonga Court',
    orgCode: 'KC',
    password: PASSWORD,
  },
];

/** Shown on the sign-in screen in demo mode. */
export const DEMO_ACCOUNTS = USERS.map((u) => ({ role: u.role, email: u.email, password: u.password }));

// Two separate landlords, each paid into their own account (plan §8.2).
const LANDLORDS: Record<string, { name: string; bank: string; account: string; branch: string }> = {
  KC: { name: 'Kabulonga Court Ltd', bank: 'Zanaco', account: '0123 4567 8901', branch: 'Cairo Road, Lusaka' },
  RH: { name: 'Riverside Hostel', bank: 'FNB Zambia', account: '6260 1188 2045', branch: 'Great East Road, Lusaka' },
};

interface Resident {
  id: string;
  name: string;
  studentNumber: string;
  propertyName: string;
  orgCode: 'KC' | 'RH';
  roomLabel: string;
  cohort?: string;
  /** Set when Kafue Bursary Trust sponsors this student. */
  sponsorCoverage?: string;
}

const RESIDENTS: Resident[] = [
  { id: 'r-mary', name: 'Mary Banda', studentNumber: '2023104512', propertyName: 'Kabulonga Court', orgCode: 'KC', roomLabel: '12B', cohort: 'Engineering 2026', sponsorCoverage: '60% of rent' },
  { id: 'r-joseph', name: 'Joseph Phiri', studentNumber: '2024100877', propertyName: 'Kabulonga Court', orgCode: 'KC', roomLabel: '5A', cohort: 'Nursing 2026', sponsorCoverage: '100% of rent' },
  { id: 'r-grace', name: 'Grace Zulu', studentNumber: '2022109931', propertyName: 'Kabulonga Court', orgCode: 'KC', roomLabel: '7B', cohort: 'Engineering 2026', sponsorCoverage: '100% of rent' },
  { id: 'r-chanda', name: 'Chanda Mulenga', studentNumber: '2024102246', propertyName: 'Kabulonga Court', orgCode: 'KC', roomLabel: '9A', cohort: 'Nursing 2026', sponsorCoverage: '100% of rent' },
  { id: 'r-bwalya', name: 'Bwalya Sakala', studentNumber: '2023107790', propertyName: 'Riverside Hostel', orgCode: 'RH', roomLabel: '3', cohort: 'Engineering 2026', sponsorCoverage: '100% of rent' },
];

interface Share {
  id: string;
  residentId: string;
  type: ChargeType;
  description: string;
  period: string;
  dueDate: string;
  payer: 'STUDENT' | 'SPONSOR';
  sponsorId?: string;
  amount: number;
  paid: number;
}

const shares: Share[] = [
  // Mary: semester rent K6,000, the sponsor covers 60% (K3,600), Mary pays 40% (K2,400).
  { id: 'sh-mary-s1', residentId: 'r-mary', type: 'RENT', description: 'Rent (your 40% share)', period: 'Semester 1 2026', dueDate: '2026-01-20', payer: 'STUDENT', amount: 240000, paid: 240000 },
  { id: 'sh-mary-s2', residentId: 'r-mary', type: 'RENT', description: 'Rent (your 40% share)', period: 'Semester 2 2026', dueDate: '2026-11-30', payer: 'STUDENT', amount: 240000, paid: 100000 },
  { id: 'sh-mary-util', residentId: 'r-mary', type: 'UTILITY', description: 'Water & electricity', period: 'October 2026', dueDate: '2026-10-31', payer: 'STUDENT', amount: 15000, paid: 0 },
  { id: 'sh-mary-s2-sp', residentId: 'r-mary', type: 'RENT', description: 'Rent (sponsor 60% share)', period: 'Semester 2 2026', dueDate: '2026-11-30', payer: 'SPONSOR', sponsorId: 's-kbt', amount: 360000, paid: 0 },
  { id: 'sh-joseph-s2-sp', residentId: 'r-joseph', type: 'RENT', description: 'Rent (sponsor 100% share)', period: 'Semester 2 2026', dueDate: '2026-11-30', payer: 'SPONSOR', sponsorId: 's-kbt', amount: 600000, paid: 600000 },
  { id: 'sh-grace-s2-sp', residentId: 'r-grace', type: 'RENT', description: 'Rent (sponsor 100% share)', period: 'Semester 2 2026', dueDate: '2026-11-30', payer: 'SPONSOR', sponsorId: 's-kbt', amount: 600000, paid: 0 },
  { id: 'sh-chanda-s2-sp', residentId: 'r-chanda', type: 'RENT', description: 'Rent (sponsor 100% share)', period: 'Semester 2 2026', dueDate: '2026-11-30', payer: 'SPONSOR', sponsorId: 's-kbt', amount: 540000, paid: 0 },
  { id: 'sh-bwalya-s2-sp', residentId: 'r-bwalya', type: 'RENT', description: 'Rent (sponsor 100% share)', period: 'Semester 2 2026', dueDate: '2026-10-15', payer: 'SPONSOR', sponsorId: 's-kbt', amount: 480000, paid: 0 },
];

interface DemoPayment extends Payment {
  orgCode: string;
  payerUserId?: string;
  payerSponsorId?: string;
  allocations: { shareId: string; amount: number }[];
  idempotencyKey?: string;
  settleAt?: number;
  failOnSettle?: string;
  transferReference?: string;
  proofName?: string;
}

const payments: DemoPayment[] = [
  { id: 'p-mary-1', orgCode: 'KC', amount: 240000, method: 'CASH', status: 'SUCCEEDED', createdAt: '2026-01-18T10:05:00Z', payerName: 'Mary Banda', description: 'Rent (your 40% share) · Semester 1 2026', receiptNumber: 'RCT-KC-2026-0031', payerUserId: 'u-student', allocations: [] },
  { id: 'p-mary-2', orgCode: 'KC', amount: 100000, method: 'MOBILE_MONEY', status: 'SUCCEEDED', createdAt: '2026-10-02T15:41:00Z', payerName: 'Mary Banda', description: 'Rent (your 40% share) · Semester 2 2026', receiptNumber: 'RCT-KC-2026-0398', payerUserId: 'u-student', allocations: [] },
  { id: 'p-kbt-1', orgCode: 'KC', amount: 600000, method: 'BANK_TRANSFER', status: 'SUCCEEDED', createdAt: '2026-09-01T08:30:00Z', payerName: 'Kafue Bursary Trust', description: 'Joseph Phiri · Semester 2 2026', receiptNumber: 'RCT-KC-2026-0390', payerSponsorId: 's-kbt', allocations: [] },
  { id: 'p-moses-1', orgCode: 'KC', amount: 240000, method: 'BANK_TRANSFER', status: 'AWAITING_VERIFICATION', createdAt: '2026-11-14T09:12:00Z', payerName: 'Moses Ngoma', description: 'Rent · Semester 2 2026', transferReference: 'KC-MN-11052', proofName: 'deposit-slip.jpg', allocations: [] },
];

const receiptSeq: Record<string, number> = { KC: 412, RH: 57 };
let collectedThisSession = 0;
let currentUser: DemoUser | null = null;

const delay = (ms = 350) => new Promise((resolve) => setTimeout(resolve, ms));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const residentOf = (id: string) => RESIDENTS.find((r) => r.id === id)!;

function toMe({ password, residentId, sponsorId, orgCode, ...me }: DemoUser): Me {
  return me;
}

function requireUser(role?: Role): DemoUser {
  if (!currentUser) throw new ApiError(401, 'Please sign in.');
  if (role && currentUser.role !== role) throw new ApiError(403, "You don't have access to that.");
  return currentUser;
}

function statusOf(s: Share): ShareStatus {
  const balance = s.amount - s.paid;
  if (balance <= 0) return 'PAID';
  if (s.dueDate < todayISO()) return 'OVERDUE';
  return s.paid > 0 ? 'PARTIAL' : 'DUE';
}

const IN_FLIGHT = new Set(['PENDING', 'AWAITING_VERIFICATION']);

/** Money already on its way for a share (mobile money awaiting the PIN, slips awaiting the landlord). */
function pendingFor(shareId: string): number {
  return sum(
    payments
      .filter((p) => IN_FLIGHT.has(p.status))
      .flatMap((p) => p.allocations.filter((a) => a.shareId === shareId).map((a) => a.amount))
  );
}

/** What can still be paid on a share without paying twice. */
const payableNow = (s: Share) => Math.max(0, s.amount - s.paid - pendingFor(s.id));

function view(s: Share): ChargeShare {
  return {
    id: s.id,
    residentId: s.residentId,
    studentName: residentOf(s.residentId).name,
    type: s.type,
    description: s.description,
    period: s.period,
    dueDate: s.dueDate,
    payer: s.payer,
    amount: s.amount,
    paid: s.paid,
    balance: Math.max(0, s.amount - s.paid),
    pending: pendingFor(s.id),
    status: statusOf(s),
  };
}

const SEVERITY: ShareStatus[] = ['PAID', 'PARTIAL', 'DUE', 'OVERDUE'];
const worst = (list: ShareStatus[]) =>
  list.reduce<ShareStatus>((a, b) => (SEVERITY.indexOf(b) > SEVERITY.indexOf(a) ? b : a), 'PAID');

/** The shares this user is responsible for paying. */
function payableBy(user: DemoUser): Share[] {
  if (user.role === 'STUDENT') return shares.filter((s) => s.payer === 'STUDENT' && s.residentId === user.residentId);
  if (user.role === 'SPONSOR') return shares.filter((s) => s.payer === 'SPONSOR' && s.sponsorId === user.sponsorId);
  return [];
}

/** Oldest due first, like the server will do (plan §6), never beyond what is still payable. */
function allocate(amount: number, picked: Share[]) {
  let left = amount;
  const out: { shareId: string; amount: number }[] = [];
  for (const s of [...picked].sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
    const take = Math.min(left, payableNow(s));
    if (take > 0) out.push({ shareId: s.id, amount: take });
    left -= take;
  }
  return out;
}

function settle(p: DemoPayment) {
  for (const a of p.allocations) {
    const s = shares.find((x) => x.id === a.shareId);
    if (s) s.paid = Math.min(s.amount, s.paid + a.amount);
  }
  p.status = 'SUCCEEDED';
  p.nextAction = undefined;
  p.receiptNumber = `RCT-${p.orgCode}-2026-${String(receiptSeq[p.orgCode]++).padStart(4, '0')}`;
  if (p.orgCode === 'KC') collectedThisSession += p.amount;
}

function maybeSettle(p: DemoPayment) {
  if (p.status !== 'PENDING' || !p.settleAt || Date.now() < p.settleAt) return;
  if (p.failOnSettle) {
    p.status = 'FAILED';
    p.failureReason = p.failOnSettle;
    p.nextAction = undefined;
  } else {
    settle(p);
  }
}

/** Let every simulated payment that is due to finish, finish, before reading balances. */
const settleDue = () => payments.forEach(maybeSettle);

function publicView(p: DemoPayment): Payment {
  const { orgCode, payerUserId, payerSponsorId, allocations, idempotencyKey, settleAt, failOnSettle, transferReference, proofName, ...rest } = p;
  return clone(rest);
}

function describe(picked: Share[], user: DemoUser): string {
  if (user.role === 'SPONSOR') {
    const names = [...new Set(picked.map((s) => residentOf(s.residentId).name))];
    return names.length === 1 ? `${names[0]} · ${picked[0].period}` : `${names.length} students · ${picked[0].period}`;
  }
  return picked.length === 1 ? `${picked[0].description} · ${picked[0].period}` : `${picked.length} items`;
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

export const demoApi: Api = {
  async signIn(email, password) {
    await delay(500);
    const user = USERS.find((u) => u.email === email.trim().toLowerCase());
    if (!user || user.password !== password) throw new ApiError(401, 'Incorrect email or password.');
    currentUser = user;
    return { tokens: { accessToken: `demo.${user.id}`, refreshToken: `demo-refresh.${user.id}` }, me: toMe(user) };
  },

  async signOut() {
    currentUser = null;
  },

  setSession(tokens) {
    currentUser = tokens ? (USERS.find((u) => tokens.accessToken === `demo.${u.id}`) ?? null) : null;
  },

  onTokensChanged() {
    // Demo tokens never change.
  },

  async me() {
    await delay(150);
    return toMe(requireUser());
  },

  async studentHome() {
    await delay();
    settleDue();
    const user = requireUser('STUDENT');
    const resident = residentOf(user.residentId!);
    const unpaid = payableBy(user)
      .map(view)
      .filter((s) => s.balance > 0)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return {
      propertyName: resident.propertyName,
      roomLabel: resident.roomLabel,
      balance: sum(unpaid.map((s) => s.balance)),
      pending: sum(unpaid.map((s) => s.pending)),
      nextDue: unpaid[0] ?? null,
      sponsors: resident.sponsorCoverage ? [{ name: 'Kafue Bursary Trust', coverage: resident.sponsorCoverage }] : [],
    };
  },

  async myCharges() {
    await delay();
    settleDue();
    const user = requireUser('STUDENT');
    return payableBy(user)
      .map(view)
      .sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  },

  async payments() {
    await delay();
    settleDue();
    const user = requireUser();
    return payments
      .filter((p) => (user.role === 'STUDENT' ? p.payerUserId === user.id : p.payerSponsorId === user.sponsorId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(publicView);
  },

  async receiptUrl() {
    await delay(150);
    return null; // Receipt PDFs come from the server in live mode.
  },

  async sponsoredStudents() {
    await delay();
    settleDue();
    const user = requireUser('SPONSOR');
    const mine = payableBy(user);
    return RESIDENTS.filter((r) => r.sponsorCoverage).map<SponsoredStudent>((r) => {
      const theirs = mine.filter((s) => s.residentId === r.id).map(view);
      return {
        residentId: r.id,
        name: r.name,
        studentNumber: r.studentNumber,
        propertyName: r.propertyName,
        roomLabel: r.roomLabel,
        cohort: r.cohort,
        coverage: r.sponsorCoverage!,
        due: sum(theirs.map((s) => s.balance)),
        overdue: sum(theirs.filter((s) => s.status === 'OVERDUE').map((s) => s.balance)),
        pending: sum(theirs.map((s) => s.pending)),
        status: worst(theirs.map((s) => s.status)),
      };
    });
  },

  async sponsorDueShares(residentIds) {
    await delay();
    settleDue();
    const user = requireUser('SPONSOR');
    return payableBy(user)
      .filter((s) => residentIds.includes(s.residentId))
      .map(view)
      .filter((s) => s.balance > 0);
  },

  async transferDetails(shareIds) {
    await delay(200);
    const user = requireUser();
    const first = shares.find((s) => s.id === shareIds[0]);
    const landlord = LANDLORDS[first ? residentOf(first.residentId).orgCode : 'KC'];
    const who = user.role === 'SPONSOR' ? 'KBT' : 'MB';
    return {
      bankName: landlord.bank,
      accountName: landlord.name,
      accountNumber: landlord.account,
      branch: landlord.branch,
      reference: `${first ? residentOf(first.residentId).orgCode : 'KC'}-${who}-${String(Date.now()).slice(-5)}`,
    };
  },

  async startPayment(input, idempotencyKey) {
    await delay(600);
    const user = requireUser();
    if (user.role === 'LANDLORD') throw new ApiError(403, 'Landlords record payments on the web portal.');

    // The same "Pay" tap retried (bad connection) returns the same payment.
    const existing = payments.find((p) => p.idempotencyKey === idempotencyKey);
    if (existing) return publicView(existing);

    const allowed = payableBy(user);
    const picked = input.shareIds.map((id) => allowed.find((s) => s.id === id)).filter((s): s is Share => !!s);
    if (!picked.length || picked.length !== input.shareIds.length) throw new ApiError(400, 'Please choose what to pay for.');
    const orgs = new Set(picked.map((s) => residentOf(s.residentId).orgCode));
    if (orgs.size > 1) throw new ApiError(400, 'Pay one boarding house at a time — each landlord is paid into their own account.');

    settleDue();
    // Never accept money for something already paid or already on its way.
    const due = sum(picked.map(payableNow));
    if (due <= 0) {
      const inFlight = picked.some((s) => pendingFor(s.id) > 0);
      throw new ApiError(409, inFlight ? 'A payment for these items is already being processed.' : 'These items are already paid.');
    }
    const amount = input.amount ?? due;
    if (!Number.isInteger(amount) || amount < 100) throw new ApiError(400, 'The smallest payment is K 1.');
    if (amount > due) throw new ApiError(400, `You can pay at most ${formatK(due)} for these items.`);

    const payment: DemoPayment = {
      id: `p-${Date.now()}`,
      orgCode: [...orgs][0],
      amount,
      method: input.method,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      payerName: user.role === 'SPONSOR' ? user.sponsorName! : user.name,
      description: describe(picked, user),
      payerUserId: user.role === 'STUDENT' ? user.id : undefined,
      payerSponsorId: user.sponsorId,
      allocations: allocate(amount, picked),
      idempotencyKey,
    };

    if (input.method === 'MOBILE_MONEY') {
      const msisdn = normaliseZambianMsisdn(input.msisdn ?? '');
      if (!msisdn || !input.network) throw new ApiError(400, 'Please enter a valid Zambian mobile number and choose the network.');
      payment.nextAction = {
        type: 'APPROVE_ON_PHONE',
        message: `We sent a prompt to 0${msisdn.slice(3)}. Enter your ${input.network} PIN to approve ${formatK(amount)}.`,
      };
      payment.settleAt = Date.now() + 6000;
      if (msisdn.endsWith('0000')) payment.failOnSettle = 'The payment was declined on the phone.';
    } else if (input.method === 'CARD') {
      payment.nextAction = { type: 'REDIRECT', url: 'https://example.com/demo-card-checkout' };
      payment.settleAt = Date.now() + 4000;
    } else {
      if (!input.proof) throw new ApiError(400, 'Please attach a photo or PDF of your bank slip.');
      if (!input.transferReference?.trim()) throw new ApiError(400, 'Please enter the reference you used on the transfer.');
      payment.status = 'AWAITING_VERIFICATION';
      payment.transferReference = input.transferReference.trim();
      payment.proofName = input.proof.name;
      payment.nextAction = {
        type: 'WAIT_FOR_VERIFICATION',
        message: `${LANDLORDS[payment.orgCode].name} will check your slip against their bank statement, usually within one working day.`,
      };
    }

    payments.push(payment);
    return publicView(payment);
  },

  async getPayment(id) {
    await delay(250);
    const user = requireUser();
    const p = payments.find((x) => x.id === id);
    const mine =
      p &&
      ((user.role === 'STUDENT' && p.payerUserId === user.id) ||
        (user.role === 'SPONSOR' && p.payerSponsorId === user.sponsorId) ||
        (user.role === 'LANDLORD' && p.orgCode === user.orgCode));
    if (!p || !mine) throw new ApiError(404, 'Payment not found.');
    maybeSettle(p);
    return publicView(p);
  },

  async landlordDashboard(): Promise<LandlordDashboard> {
    await delay();
    settleDue();
    const user = requireUser('LANDLORD');
    const ours = shares.filter((s) => residentOf(s.residentId).orgCode === user.orgCode);
    return {
      periodLabel: 'Semester 2 2026',
      collected: 18_450_000 + collectedThisSession,
      outstanding: 4_380_000 + sum(ours.map((s) => Math.max(0, s.amount - s.paid))),
      occupiedBeds: 41,
      totalBeds: 48,
      pendingTransfers: payments.filter((p) => p.orgCode === user.orgCode && p.status === 'AWAITING_VERIFICATION').length,
    };
  },

  async transfersToVerify() {
    await delay();
    settleDue();
    const user = requireUser('LANDLORD');
    return payments
      .filter((p) => p.orgCode === user.orgCode && p.status === 'AWAITING_VERIFICATION')
      .map((p) => ({
        paymentId: p.id,
        payerName: p.payerName,
        amount: p.amount,
        reference: p.transferReference ?? '',
        submittedAt: p.createdAt,
        proofName: p.proofName ?? 'slip',
      }));
  },

  async reviewTransfer(paymentId, approve, reason) {
    await delay();
    const user = requireUser('LANDLORD');
    const p = payments.find((x) => x.id === paymentId && x.orgCode === user.orgCode);
    if (!p) throw new ApiError(404, 'Payment not found.');
    if (p.status !== 'AWAITING_VERIFICATION') throw new ApiError(409, 'This slip has already been reviewed.');
    if (approve) {
      settle(p);
    } else {
      if (!reason?.trim()) throw new ApiError(400, 'Please give a reason.');
      p.status = 'FAILED';
      p.nextAction = undefined;
      p.failureReason = `Not accepted by the landlord: ${reason.trim()}`;
    }
  },
};
