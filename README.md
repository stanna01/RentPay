# RentReceipt 🧾

A mobile-first **PWA** for landlords in Zambia to manage their properties (rooms
with one or more beds each): track tenants, record rent payments in
**Zambian Kwacha (K)**, and issue sequential PDF receipts that are emailed to
tenants. **Many independent landlords** share one installation, and none of them
can see another's data.

Two roles: the **super admin** runs the platform (adds and suspends landlords,
email settings, the audit log across all landlords) and **landlords** each run
their own business (properties, rooms, tenants, payments, voids and corrections,
reports, their own audit log). Tenants never log in — they only receive
receipt emails. See [docs/SECURITY.md](docs/SECURITY.md) for how the app is
protected, and [docs/UPGRADE.md](docs/UPGRADE.md) before upgrading an existing
installation.

---

## Features

- 📱 **Installable PWA**, mobile-first, large touch targets, works offline for
  viewing.
- 🏘️ **Many landlords** — the super admin adds each landlord business; every
  landlord sees only their own properties, tenants and money.
- 🏢 **Multiple properties** — each with its own rooms, tenants and receipt numbers.
- 🛡️ **Safe records** — void/correct payments (never deleted), arrears
  waivers/charges, append-only audit log.
- 🏠 **Room board** — every room with its beds (A/B…), colour-coded status
  (paid / part-paid / due / vacant) and month navigation.
- 👤 **Tenants & tenancies** — assign a tenant to a specific bed, per-tenancy rent,
  move-out keeps full history, tenancy duration ("X years, Y months").
- 💵 **Payments** — one payment can cover **multiple months**; supports
  **advances and arrears**; live balance display for part payments.
- 🧾 **Receipts** — A4 PDF with amount in **figures and words**, atomic
  **sequential numbers** (`RCT-YYYY-NNNN`, never reused), stored once and reused on
  reprint/re-send.
- 📧 **Email** via SMTP (Gmail App Password or Resend) with an automatic
  **retry queue** when offline.
- 📊 **Reports** — income per month (table + bar chart) with **CSV export**.
- ⚙️ **Settings** — property/receipt header, email/SMTP config with a test button,
  change password.
- 💰 **Correct money handling** — all amounts stored as **integer ngwee** (no
  floating-point errors).

## Tech stack

React + Vite + Tailwind (PWA) · Node.js + Express · MySQL via Prisma ·
`pdf-lib` for PDFs (stored in the database) · Nodemailer for email ·
JWT-in-httpOnly-cookie auth.

In production the Express server serves both the API and the built React app as a
**single process** on one port.

---

## Quick start

```bash
npm install
cp .env.example server/.env      # then edit server/.env (set your MySQL DATABASE_URL)
npm run db:migrate               # create the MySQL tables
npm run db:seed                  # the super admin (SEED_DEMO=1 adds a demo landlord with sample data)
npm run dev                      # http://localhost:5173
npm test                         # business-logic + concurrency tests
```

Log in with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `server/.env` (the super admin);
you'll be asked to choose your own password straight away. Then add a landlord under
**Landlords** and sign in as that landlord to add properties and tenants.

Full details: **[docs/SETUP.md](docs/SETUP.md)**.

---

## Documentation

| Guide | What it covers |
| ----- | -------------- |
| [docs/PLATFORM_PLAN.md](docs/PLATFORM_PLAN.md) | **The roadmap:** turning this into a platform for landlords, students, sponsors and a super admin, with in-app payments. |
| [mobile/README.md](mobile/README.md) | The Android + iPhone app (Expo): running it on a phone, demo accounts. |
| [docs/SETUP.md](docs/SETUP.md) | Local development from a fresh clone. |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Production deploy: VPS (pm2 + Nginx + HTTPS) **and** PaaS (Railway/Render). |
| [docs/BACKUP.md](docs/BACKUP.md) | Automated daily backups of the database + PDFs, and a tested restore. |
| [docs/EMAIL_SETUP.md](docs/EMAIL_SETUP.md) | Gmail App Password / Resend setup, SPF, and testing. |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | Plain-language guide for the landlord. |

---

## Project structure

```
RentReceipt/
├─ server/                Express API + Prisma + PDF + email
│  ├─ prisma/             schema, migrations, seed
│  ├─ src/
│  │  ├─ routes/          auth, admin (landlords), properties, rooms, tenants, tenancies,
│  │  │                   payments, receipts, reports, settings, audit, v1 (phone app)
│  │  ├─ access.js        keeps each landlord to their own data
│  │  ├─ money.js         ngwee <-> Kwacha, amount-in-words
│  │  ├─ status.js        month status + payment allocation + duration
│  │  ├─ receiptNumber.js atomic sequential numbering
│  │  ├─ pdf.js           A4 receipt rendering (pdf-lib)
│  │  └─ email.js         Nodemailer + retry queue
│  └─ tests/              money / status / receipt-number (incl. concurrency)
├─ client/                React + Vite PWA
│  └─ src/pages/          Login, Dashboard, TenantProfile, AssignTenant,
│                         RecordPayment, ReceiptPreview, Reports, Settings
├─ mobile/                Android + iPhone app (Expo, TypeScript) — demo data; live for landlords
└─ docs/                  the guides above
```

## Testing

```bash
npm test
```

Covers month-status logic (paid / partial / due / vacant), multi-month payment
allocation, money conversion + amount-in-words, and **receipt-number sequencing
under concurrent requests** (no duplicates, no gaps, never reused).

## Money & correctness notes

- All money is stored as **integer ngwee** (1 K = 100 ngwee); Kwacha formatting
  happens only at display/PDF time.
- Receipt numbers are issued inside a database transaction via a per-year counter
  row, so they stay **sequential and unique even under concurrent requests**.
- Each receipt's expected rent is **snapshotted** at payment time, so changing a
  tenant's rent later never corrupts past receipts or reports.
- Receipt PDFs are generated **once** and stored **in the database**; reprint/re-send
  always serves the original stored bytes (never regenerated). This also keeps the app
  stateless on disk — no volume needed in production.

## License

Private project. All rights reserved.
