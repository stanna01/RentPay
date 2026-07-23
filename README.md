# RentReceipt 🧾

A mobile-first **PWA** for a landlord to manage a single property with **24 rooms
(48 beds — two per room)** in Zambia: track tenants, record rent payments in
**Zambian Kwacha (K)**, and issue sequential PDF receipts that are emailed to
tenants.

The landlord is the only user. Tenants never log in — they only receive receipt
emails.

---

## Features

- 📱 **Installable PWA**, mobile-first, large touch targets, works offline for
  viewing.
- 🏠 **Room board** — 24 rooms, each with two beds (A/B), colour-coded status
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
npm run db:seed                  # landlord + 24 rooms (add SEED_DEMO=1 for sample data)
npm run dev                      # http://localhost:5173
npm test                         # business-logic + concurrency tests
```

Log in with the `LANDLORD_EMAIL` / `LANDLORD_PASSWORD` from `server/.env`.

Full details: **[docs/SETUP.md](docs/SETUP.md)**.

---

## Documentation

| Guide | What it covers |
| ----- | -------------- |
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
│  │  ├─ routes/          auth, rooms, tenants, tenancies, payments, receipts, reports, settings
│  │  ├─ money.js         ngwee <-> Kwacha, amount-in-words
│  │  ├─ status.js        month status + payment allocation + duration
│  │  ├─ receiptNumber.js atomic sequential numbering
│  │  ├─ pdf.js           A4 receipt rendering (pdf-lib)
│  │  └─ email.js         Nodemailer + retry queue
│  └─ tests/              money / status / receipt-number (incl. concurrency)
├─ client/                React + Vite PWA
│  └─ src/pages/          Login, Dashboard, TenantProfile, AssignTenant,
│                         RecordPayment, ReceiptPreview, Reports, Settings
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
