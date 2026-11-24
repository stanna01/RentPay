# UPGRADE — Billing release (charges, terms, notices)

This release replaces "rent recalculated from calendar months" with real
**charges**: monthly or per-term rent billed automatically, deposits and fees,
waivers, credit, rent increases with 30 days' notice, and notices to tenants.

**A fresh database is required.** The migration `20261124000000_billing` drops
the old month-by-month payment records (`PaymentPeriod`, `ArrearsAdjustment`)
instead of converting them, because nothing had been deployed with real
records when it was written:

```bash
npm install
npm run db:reset        # ⚠️ deletes everything in the database, then re-creates and seeds it
```

(`SEED_DEMO=1 npm run db:seed` afterwards adds a demo landlord with a monthly
boarding house and a per-semester hostel.)

**Do not run this release against a database with real payments** — they would
lose their link to the months they paid. Converting old records into charges
(plan §14) would have to be written first.

Windows note: MySQL on Windows stores table names in lower case, so
`prisma migrate diff` there reports every table as different. Write or check
migrations against a Linux MySQL (e.g. the hosted one), not with a diff on Windows.

---

# Earlier: Many landlords (super admin) release

This release adds landlord businesses. Roles are now **super admin** (runs the
platform) and **landlord** (runs one business); the old per-user list of
allowed properties is gone.

**Nothing was deployed with real records when this was written, so the simple
path is a fresh database:**

```bash
npm install
npm run db:reset        # ⚠️ deletes everything in the database, then re-creates and seeds it
```

(`SEED_DEMO=1 npm run db:seed` afterwards adds a demo landlord with sample data.)

If you do have data to keep, back up first ([BACKUP.md](./BACKUP.md)) and run
`npm run db:migrate` instead. The migration `20261116000000_multi_landlord`
then puts every existing property under one landlord business called "First
landlord", turns old administrators into super admins, and attaches old
landlord accounts to that business. Everyone is signed out. **This path has not
been run against a real database yet — rehearse it on a copy first.**

---

# Earlier: Admin, multi-property & security release

This release changes the database structure. **Your existing data is kept**: the
upgrade was rehearsed against a copy of the old schema, with tenants, payments,
receipts and a double-booked bed, and nothing was lost. But treat it like any
other change to financial records: back up first.

> ⚠️ **Railway / Render:** the start command runs `db:migrate` on every boot, so
> **deploying this version applies the migration immediately**. Do steps 1–2
> *before* you deploy.

## 1. Back up the database

Follow [BACKUP.md](./BACKUP.md) and confirm the dump file is not empty. Ideally
restore it into a scratch database and run the migration there first (step 4).

## 2. Add the new environment variables

| Variable | Value |
| --- | --- |
| `ENCRYPTION_KEY` | A new random secret, **different from** `JWT_SECRET`: `openssl rand -base64 48` |
| `APP_URL` | Your public address, e.g. `https://rent.yourdomain.com` (**required** in production) |
| `TZ` | `Africa/Lusaka` (optional — it is the default) |

The server **refuses to start** in production if `JWT_SECRET`, `ENCRYPTION_KEY`
or `APP_URL` is missing or weak, so set them before deploying.

`LANDLORD_EMAIL` / `LANDLORD_PASSWORD` are no longer used after the first setup
(new installs use `ADMIN_EMAIL` / `ADMIN_PASSWORD`). You can remove them.

## 3. Deploy

```bash
npm install
npm run build
npm run db:migrate      # applies 20261101000000_admin_multiproperty_security
npm start
```

## 4. What the migration does

- Your landlord account becomes a user with the **Administrator** role (same
  email, same password).
- Your property (name and address from Settings) becomes **Property #1** with the
  code **`MAIN`**. All rooms, tenants and receipt counters are attached to it.
  Rename it in **Admin → Properties**. The code can be changed until the first
  new receipt is issued.
- Existing receipts keep their numbers (`RCT-2026-0001`…). New receipts are
  numbered per property, e.g. `RCT-MAIN-2026-0004`. The sequence continues, so no
  number is ever reused.
- Every existing payment is marked **ACTIVE**.
- If the old version ever assigned two current tenants to the same bed, the
  newest one keeps the bed. The other appears on the dashboard under **"Tenants
  in removed rooms or beds"** so you can move them out or correct it.
- The stored SMTP password is re-encrypted with `ENCRYPTION_KEY` at the first
  start-up.

## 5. After upgrading

1. Sign in. Everyone is signed out by the upgrade, because sessions now work
   differently.
2. Check the dashboard totals and a few tenants against your backup.
3. In **Admin → Users**, add a separate **Landlord** account for anyone who
   records payments day to day. Keep administrator accounts to a minimum.
4. In **Settings**, send a test email.

## Rolling back

Stop the app, restore the backup from step 1, and deploy the previous version.
The migration cannot be reversed in place.
