// Seed: the super admin (who then creates landlords in the app). With
// SEED_DEMO=1 it also adds a demo landlord with one property of 24 rooms
// (2 beds each = 48 beds) and a realistic set of tenants with payment history,
// receipts and PDFs (some beds vacant, some partial, some due).

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { nextReceiptNumber, ensureReceiptCounter } from '../src/receiptNumber.js';
import { buildReceiptPdf } from '../src/pdf.js';

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
  if (!(await prisma.user.findUnique({ where: { email } }))) {
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

function ym(d) {
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}

async function makePayment(property, room, tenancy, tenant, { amount, month, year, datePaid }) {
  const periodRows = [
    { month, year, amountApplied: amount, expectedRent: tenancy.monthlyRent },
  ];
  const receiptYear = datePaid.getFullYear();
  await ensureReceiptCounter(prisma, property.id, receiptYear);
  const result = await prisma.$transaction(
    async (tx) => {
      const { receiptNumber } = await nextReceiptNumber(tx, {
        propertyId: property.id,
        code: property.code,
        year: receiptYear,
      });
      const payment = await tx.payment.create({
        data: {
          tenancyId: tenancy.id,
          amount,
          datePaid,
          method: 'cash',
          periods: { create: periodRows },
        },
      });
      const receipt = await tx.receipt.create({
        data: { paymentId: payment.id, receiptNumber, emailStatus: 'none' },
      });
      return { payment, receipt, receiptNumber };
    },
    { timeout: 20000, maxWait: 20000 }
  );

  const totalBalance = Math.max(0, tenancy.monthlyRent - amount);
  const pdfBytes = await buildReceiptPdf({
    receiptNumber: result.receiptNumber,
    datePaid,
    propertyName: property.name,
    propertyAddress: property.address,
    tenantName: tenant.name,
    roomLabel: `${room.number}${tenancy.bed}`,
    method: 'cash',
    amount,
    periods: periodRows,
    totalBalance,
  });
  await prisma.receipt.update({
    where: { id: result.receipt.id },
    data: { pdf: Buffer.from(pdfBytes) },
  });
}

async function seedTenants(property) {
  const marker = await prisma.tenant.findFirst({ where: { notes: 'seed-demo' } });
  if (marker) {
    console.log('  Demo tenants already present — skipping.');
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

      const name = `${FIRSTS[ti % FIRSTS.length]} ${LASTS[(ti * 7 + Math.floor(ti / 30)) % LASTS.length]}`;
      const monthsBack = (ti % 5) + 1; // 1..5 months of history
      const moveIn = new Date(now.getFullYear(), now.getMonth() - monthsBack, ((ti * 11) % 27) + 1);
      const rent = rentFor(roomNo);

      const tenant = await prisma.tenant.create({
        data: {
          propertyId: property.id,
          name,
          phone: `+260 9${6 + (ti % 2)} ${String(200 + (ti * 37) % 700).padStart(3, '0')} ${String(1000 + (ti * 613) % 9000)}`,
          email: `${name.toLowerCase().replace(/\s+/g, '.')}@gmail.com`,
          notes: 'seed-demo',
        },
      });
      const tenancy = await prisma.tenancy.create({
        data: {
          roomId: room.id,
          bed,
          tenantId: tenant.id,
          moveInDate: moveIn,
          monthlyRent: rent,
          activeBedKey: `${room.id}-${bed}`,
        },
      });
      occupied += 1;

      // Pay each full month from move-in up to (but not including) the current month.
      let d = new Date(moveIn.getFullYear(), moveIn.getMonth(), 1);
      const curStart = new Date(now.getFullYear(), now.getMonth(), 1);
      while (d < curStart) {
        const { month, year } = ym(d);
        await makePayment(property, room, tenancy, tenant, {
          amount: rent,
          month,
          year,
          datePaid: new Date(d.getFullYear(), d.getMonth(), 5),
        });
        d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      }

      // Current month per demo status.
      const cur = ym(curStart);
      if (PARTIAL_BEDS.includes(slot)) {
        await makePayment(property, room, tenancy, tenant, {
          amount: rent - 50000, // K500 short
          month: cur.month,
          year: cur.year,
          datePaid: new Date(now.getFullYear(), now.getMonth(), 3),
        });
      } else if (!DUE_BEDS.includes(slot)) {
        await makePayment(property, room, tenancy, tenant, {
          amount: rent,
          month: cur.month,
          year: cur.year,
          datePaid: new Date(now.getFullYear(), now.getMonth(), 3),
        });
      }
      ti += 1;
    }
  }
  console.log(`  ${occupied} beds occupied · ${VACANT_BEDS.length} vacant · ${PARTIAL_BEDS.length} partial · ${DUE_BEDS.length} due.`);
}

async function main() {
  console.log('Seeding RentReceipt...');
  await seedAdmin();
  await seedSettings();
  // Demo data is for local testing only — never seed it into a real/production
  // database. Opt in with SEED_DEMO=1.
  if (process.env.SEED_DEMO === '1') {
    await seedTenants(await seedDemoLandlord());
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
