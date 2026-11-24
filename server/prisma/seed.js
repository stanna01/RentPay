// Seed: the super admin (who then creates landlords in the app). With
// SEED_DEMO=1 it also adds a demo landlord with two boarding houses:
//   * Kabulonga Court (KC) — billed monthly, 24 rooms × 2 beds, tenants with
//     months of payment history (some beds vacant, some part-paid, some due);
//   * Great East Hostel (GE) — billed per semester, 10 rooms × 2 beds, with
//     terms, deposits and students who have paid all, part or nothing.
// Payments go through the real payment service, so charges, receipts and
// PDFs are exactly what the app would make.

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { createPayment } from '../src/paymentService.js';
import { ensureBilling } from '../src/billingService.js';
import { today, toDbDate, localDay } from '../src/dates.js';

if (!process.env.TZ) process.env.TZ = 'Africa/Lusaka';
const prisma = new PrismaClient();

// Rent tiers by room (in ngwee): rooms 1-8 = K1,500, 9-16 = K1,800, 17-24 = K2,000.
const rentFor = (n) => (n <= 8 ? 150000 : n <= 16 ? 180000 : 200000);

const VACANT_BEDS = ['3A', '8B', '11A', '11B', '17B', '21A', '24B'];
const PARTIAL_BEDS = ['6A', '19B'];
const DUE_BEDS = ['4B', '10A', '15A', '23B'];

const FIRSTS = ['Mary', 'Joseph', 'Grace', 'Peter', 'Agnes', 'Chanda', 'Bwalya', 'Natasha', 'Kelvin', 'Ruth', 'Moses', 'Esther', 'Brian', 'Loveness', 'Gift', 'Precious', 'David', 'Beatrice', 'Mutale', 'Thandiwe', 'Mwila', 'Chileshe', 'Kunda', 'Misozi', 'Luyando', 'Nchimunya', 'Mapalo', 'Taonga', 'Chimwemwe', 'Dalitso'];
const LASTS = ['Banda', 'Mwansa', 'Phiri', 'Zulu', 'Tembo', 'Mulenga', 'Chisenga', 'Mumba', 'Sakala', 'Lungu', 'Daka', 'Ngoma', 'Musonda', 'Sichone', 'Kabwe', 'Malama', 'Simutowe', 'Chulu', 'Mwale', 'Sinkala'];

async function seedAdmin() {
  // ADMIN_* preferred; LANDLORD_* still accepted from older .env files.
  const email = (process.env.ADMIN_EMAIL || process.env.LANDLORD_EMAIL || 'admin@example.com').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || process.env.LANDLORD_PASSWORD;
  if (!password) {
    throw new Error('Set ADMIN_PASSWORD in server/.env before seeding (a temporary password, 12+ characters).');
  }
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    await prisma.user.create({
      data: {
        email,
        name: 'Platform administrator',
        role: 'SUPER_ADMIN',
        passwordHash: await bcrypt.hash(password, 12),
        mustChangePassword: true, // the seeded password must be replaced at first sign-in
      },
    });
    console.log(`  Super admin created: ${email} (temporary password from .env — must be changed at first sign-in)`);
  } else {
    console.log(`  User already exists: ${email}`);
  }
}

async function seedSettings() {
  const existing = await prisma.setting.findUnique({ where: { id: 1 } });
  if (!existing) {
    await prisma.setting.create({
      data: {
        id: 1,
        landlordEmail: (process.env.ADMIN_EMAIL || process.env.LANDLORD_EMAIL || '').toLowerCase(),
        smtpFromName: 'RentReceipt',
      },
    });
    console.log('  Settings created.');
  }
}

/** Demo only: a landlord business, its sign-in account and one property. */
async function seedDemoLandlord() {
  const email = (process.env.DEMO_LANDLORD_EMAIL || 'landlord@example.com').toLowerCase();
  let org = await prisma.organization.findFirst({ where: { name: 'Kabulonga Court (demo)' } });
  if (!org) {
    org = await prisma.organization.create({ data: { name: 'Kabulonga Court (demo)' } });
    console.log('  Demo landlord created: Kabulonga Court (demo).');
  }
  const taken = await prisma.user.findUnique({ where: { email } });
  if (taken && taken.organizationId !== org.id) {
    throw new Error(
      `The demo landlord email ${email} is already used by another account (often the super admin from ADMIN_EMAIL). ` +
        'Set DEMO_LANDLORD_EMAIL in server/.env to a different email and seed again.'
    );
  }
  if (!taken) {
    await prisma.user.create({
      data: {
        email,
        name: 'Demo Landlord',
        role: 'LANDLORD',
        organizationId: org.id,
        passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD || process.env.LANDLORD_PASSWORD, 12),
        mustChangePassword: true,
      },
    });
    console.log(`  Demo landlord sign-in: ${email} (same temporary password as the super admin — must be changed at first sign-in)`);
  }

  let property = await prisma.property.findFirst({ where: { organizationId: org.id }, orderBy: { id: 'asc' } });
  if (!property) {
    property = await prisma.property.create({
      data: { organizationId: org.id, name: 'Kabulonga Court', address: 'Plot 14, Kabulonga Road, Lusaka', code: 'KC' },
    });
    console.log('  Property created: Kabulonga Court (code KC).');
  }
  for (let n = 1; n <= 24; n++) {
    await prisma.room.upsert({
      where: { propertyId_number: { propertyId: property.id, number: n } },
      create: { propertyId: property.id, number: n, bedCount: 2, defaultRent: rentFor(n) },
      update: {},
    });
  }
  console.log('  24 rooms ensured (48 beds).');
  return property;
}

const pad = (n) => String(n).padStart(2, '0');
const dayOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`; // m is 1-12
const fixDay = (y, m, d) => localDay(new Date(y, m - 1, d)); // months outside 1-12 roll over

/** A demo tenant + current tenancy, billed from the move-in date. */
async function addTenant(property, room, bed, ti, { moveIn, rent }) {
  const name = `${FIRSTS[ti % FIRSTS.length]} ${LASTS[(ti * 7 + Math.floor(ti / 30)) % LASTS.length]}`;
  const tenant = await prisma.tenant.create({
    data: {
      propertyId: property.id,
      name,
      phone: `+260 9${6 + (ti % 2)} ${String(200 + ((ti * 37) % 700)).padStart(3, '0')} ${String(1000 + ((ti * 613) % 9000))}`,
      email: `${name.toLowerCase().replace(/\s+/g, '.')}@gmail.com`,
      notes: 'seed-demo',
    },
  });
  const tenancy = await prisma.tenancy.create({
    data: { roomId: room.id, bed, tenantId: tenant.id, moveInDate: toDbDate(moveIn), rent, activeBedKey: `${room.id}-${bed}` },
    include: { tenant: true, room: { include: { property: true } } },
  });
  await ensureBilling([property.id], { tenancyIds: [tenancy.id] });
  return tenancy;
}

/** Record a cash payment on a day (never in the future). */
async function pay(tenancy, amount, day) {
  const on = day > today() ? today() : day;
  await createPayment({ tenancy, amount, datePaid: toDbDate(on), method: 'cash', createdById: null });
}

async function seedTenants(property) {
  if (await prisma.tenant.findFirst({ where: { notes: 'seed-demo', propertyId: property.id } })) {
    console.log(`  Demo tenants of ${property.name} already present — skipping.`);
    return;
  }
  const now = new Date();
  const rooms = await prisma.room.findMany({ where: { propertyId: property.id } });
  const roomByNumber = new Map(rooms.map((r) => [r.number, r]));
  let ti = 0;
  let occupied = 0;

  for (let roomNo = 1; roomNo <= 24; roomNo++) {
    const room = roomByNumber.get(roomNo);
    for (const bed of ['A', 'B']) {
      const slot = `${roomNo}${bed}`;
      if (VACANT_BEDS.includes(slot)) continue;
      const monthsBack = (ti % 5) + 1; // 1..5 months of history
      const moveIn = fixDay(now.getFullYear(), now.getMonth() + 1 - monthsBack, ((ti * 11) % 27) + 1);
      const rent = rentFor(roomNo);
      const tenancy = await addTenant(property, room, bed, ti, { moveIn, rent });
      occupied += 1;

      // Pay each month from move-in up to (but not including) the current month, on the 5th.
      for (let back = monthsBack; back >= 1; back--) {
        await pay(tenancy, rent, fixDay(now.getFullYear(), now.getMonth() + 1 - back, 5));
      }
      // This month, per demo status.
      const thisMonth = fixDay(now.getFullYear(), now.getMonth() + 1, 3);
      if (PARTIAL_BEDS.includes(slot)) await pay(tenancy, rent - 50000, thisMonth); // K500 short
      else if (!DUE_BEDS.includes(slot)) await pay(tenancy, rent, thisMonth);
      ti += 1;
    }
  }
  console.log(`  ${property.name}: ${occupied} beds occupied · ${VACANT_BEDS.length} vacant · ${PARTIAL_BEDS.length} part-paid · ${DUE_BEDS.length} due.`);
}

/** Demo only: a boarding house billed per semester, with terms and deposits. */
async function seedTermProperty(org) {
  let property = await prisma.property.findFirst({ where: { organizationId: org.id, code: 'GE' } });
  if (!property) {
    property = await prisma.property.create({
      data: {
        organizationId: org.id,
        name: 'Great East Hostel',
        address: 'Great East Road, near UNZA, Lusaka',
        code: 'GE',
        billingCycle: 'TERM',
        rooms: { create: Array.from({ length: 10 }, (_, i) => ({ number: i + 1, bedCount: 2, defaultRent: 650000 })) },
      },
    });
    console.log('  Property created: Great East Hostel (code GE, billed per semester).');
  }
  if (await prisma.tenant.findFirst({ where: { notes: 'seed-demo', propertyId: property.id } })) {
    console.log('  Demo students of Great East Hostel already present — skipping.');
    return;
  }
  // Two semesters a year around today: Jan–Jun and Jul–Dec.
  const y = new Date().getFullYear();
  const terms = [
    { name: `Semester 1 ${y}`, startDate: dayOf(y, 1, 12), endDate: dayOf(y, 6, 26), dueDate: dayOf(y, 1, 31) },
    { name: `Semester 2 ${y}`, startDate: dayOf(y, 7, 27), endDate: dayOf(y, 12, 18), dueDate: dayOf(y, 8, 14) },
    { name: `Semester 1 ${y + 1}`, startDate: dayOf(y + 1, 1, 11), endDate: dayOf(y + 1, 6, 25), dueDate: dayOf(y + 1, 1, 29) },
  ];
  for (const t of terms) {
    await prisma.billingTerm.create({
      data: { propertyId: property.id, name: t.name, startDate: toDbDate(t.startDate), endDate: toDbDate(t.endDate), dueDate: toDbDate(t.dueDate) },
    });
  }
  const current = terms.filter((t) => t.startDate <= today()).pop() || terms[0];

  const rooms = await prisma.room.findMany({ where: { propertyId: property.id }, orderBy: { number: 'asc' } });
  let ti = 200; // different names from Kabulonga Court
  let n = 0;
  for (const room of rooms) {
    for (const bed of ['A', 'B']) {
      if (room.number === 10) continue; // room 10 empty
      const rent = 650000;
      const tenancy = await addTenant(property, room, bed, ti, { moveIn: current.startDate, rent });
      await prisma.charge.create({
        data: { tenancyId: tenancy.id, type: 'DEPOSIT', description: 'Deposit', amount: 100000, dueDate: toDbDate(current.startDate) },
      });
      const paidOn = current.startDate;
      if (n % 4 === 0) await pay(tenancy, rent + 100000, paidOn); // all paid
      else if (n % 4 === 1) await pay(tenancy, 400000, paidOn); // part-paid
      else if (n % 4 === 2) await pay(tenancy, rent + 100000 + 50000, paidOn); // K500 extra → credit
      // n % 4 === 3: nothing paid (overdue once the due date passes)
      ti += 1;
      n += 1;
    }
  }
  console.log(`  Great East Hostel: ${n} students in ${current.name}; paid in full, part-paid, in credit and unpaid.`);
}

async function main() {
  console.log('Seeding RentReceipt...');
  await seedAdmin();
  await seedSettings();
  // Demo data is for local testing only — never seed it into a real/production
  // database. Opt in with SEED_DEMO=1.
  if (process.env.SEED_DEMO === '1') {
    const property = await seedDemoLandlord();
    await seedTenants(property);
    await seedTermProperty({ id: property.organizationId });
  } else {
    console.log('  (no demo landlord — set SEED_DEMO=1 to add one with sample data)');
  }
  console.log('Seed complete. Sign in as the super admin and add landlords under "Landlords".');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
