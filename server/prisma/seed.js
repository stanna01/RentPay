// Seed: single landlord + 24 rooms (2 beds each = 48 beds) + a realistic set of
// tenants with payment history, receipts and PDFs, mirroring the mobile design's
// demo (some beds vacant, some partial, some due).

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

async function seedLandlord() {
  const email = (process.env.LANDLORD_EMAIL || 'landlord@example.com').toLowerCase();
  const password = process.env.LANDLORD_PASSWORD || 'changeme123';
  const existing = await prisma.landlord.findUnique({ where: { email } });
  if (!existing) {
    await prisma.landlord.create({
      data: { email, passwordHash: await bcrypt.hash(password, 10) },
    });
    console.log(`  Landlord created: ${email} (password from .env)`);
  } else {
    console.log(`  Landlord already exists: ${email}`);
  }
}

async function seedSettings() {
  const existing = await prisma.setting.findUnique({ where: { id: 1 } });
  if (!existing) {
    await prisma.setting.create({
      data: {
        id: 1,
        propertyName: 'Kabulonga Court',
        propertyAddress: 'Plot 14, Kabulonga Road, Lusaka',
        landlordEmail: (process.env.LANDLORD_EMAIL || '').toLowerCase(),
        smtpFromName: 'Kabulonga Court',
      },
    });
    console.log('  Settings created (Kabulonga Court).');
  }
}

async function seedRooms() {
  for (let n = 1; n <= 24; n++) {
    await prisma.room.upsert({
      where: { number: n },
      create: { number: n, defaultRent: rentFor(n) },
      update: { defaultRent: rentFor(n) },
    });
  }
  console.log('  24 rooms ensured (48 beds).');
}

function ym(d) {
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}

async function makePayment(tenancy, tenant, settings, { amount, month, year, datePaid }) {
  const periodRows = [
    { month, year, amountApplied: amount, expectedRent: tenancy.monthlyRent },
  ];
  await ensureReceiptCounter(prisma, year);
  const result = await prisma.$transaction(
    async (tx) => {
      const { receiptNumber } = await nextReceiptNumber(tx, year);
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
    propertyName: settings.propertyName,
    propertyAddress: settings.propertyAddress,
    tenantName: tenant.name,
    roomLabel: `${tenancy.roomNumber}${tenancy.bed}`,
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

async function seedTenants() {
  const marker = await prisma.tenant.findFirst({ where: { notes: 'seed-demo' } });
  if (marker) {
    console.log('  Demo tenants already present — skipping.');
    return;
  }

  const now = new Date();
  const settings = await prisma.setting.findUnique({ where: { id: 1 } });
  let ti = 0;
  let occupied = 0;

  for (let roomNo = 1; roomNo <= 24; roomNo++) {
    for (const bed of ['A', 'B']) {
      const slot = `${roomNo}${bed}`;
      if (VACANT_BEDS.includes(slot)) continue;

      const name = `${FIRSTS[ti % FIRSTS.length]} ${LASTS[(ti * 7 + Math.floor(ti / 30)) % LASTS.length]}`;
      const monthsBack = (ti % 5) + 1; // 1..5 months of history
      const moveIn = new Date(now.getFullYear(), now.getMonth() - monthsBack, ((ti * 11) % 27) + 1);
      const rent = rentFor(roomNo);

      const tenant = await prisma.tenant.create({
        data: {
          name,
          phone: `+260 9${6 + (ti % 2)} ${String(200 + (ti * 37) % 700).padStart(3, '0')} ${String(1000 + (ti * 613) % 9000)}`,
          email: `${name.toLowerCase().replace(/\s+/g, '.')}@gmail.com`,
          notes: 'seed-demo',
        },
      });
      const tenancy = await prisma.tenancy.create({
        data: { roomNumber: roomNo, bed, tenantId: tenant.id, moveInDate: moveIn, monthlyRent: rent },
      });
      occupied += 1;

      // Pay each full month from move-in up to (but not including) the current month.
      let d = new Date(moveIn.getFullYear(), moveIn.getMonth(), 1);
      const curStart = new Date(now.getFullYear(), now.getMonth(), 1);
      while (d < curStart) {
        const { month, year } = ym(d);
        await makePayment(tenancy, tenant, settings, {
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
        await makePayment(tenancy, tenant, settings, {
          amount: rent - 50000, // K500 short
          month: cur.month,
          year: cur.year,
          datePaid: new Date(now.getFullYear(), now.getMonth(), 3),
        });
      } else if (!DUE_BEDS.includes(slot)) {
        await makePayment(tenancy, tenant, settings, {
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
  console.log('Seeding RentReceipt (landlord + 24 rooms / 48 beds)...');
  await seedLandlord();
  await seedSettings();
  await seedRooms();
  // Demo tenants are for local testing only — never seed fake tenants into a
  // real/production database. Opt in with SEED_DEMO=1.
  if (process.env.SEED_DEMO === '1') {
    await seedTenants();
  } else {
    console.log('  (skipping demo tenants — set SEED_DEMO=1 to add sample data)');
  }
  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
