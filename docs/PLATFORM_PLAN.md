# Platform plan — landlords, students, sponsors and a super admin

RentReceipt today is a tool for **one landlord** to record cash payments and print
receipts. This plan turns it into a **platform** where:

| Who | What they do |
| --- | --- |
| **Super admin** | Runs the platform. Creates landlords, decides what landlords, their staff, students and sponsors are allowed to do, and sees everything (audited). |
| **Landlord** | Manages their own boarding houses: rooms, beds, prices, students, bills, payments, sponsors, reports. Can add staff (caretaker, cashier). Sees only their own data. |
| **Student** | Has an account. Sees their bill, what they owe, what their sponsor covers, and their receipts. Pays in the app. |
| **Sponsor** | A parent, company, NGO or bursary. Sees the batch of students they sponsor at each boarding house, and pays for them in bulk or one at a time. |

It covers: what is wrong with the current design (§2), the target design (§3–§11), the
mobile app (§12), moving existing data (§14), the phased roadmap (§17), and the decisions
still needed from you (§18).

## 1. Decisions already made

| Topic | Decision |
| --- | --- |
| Platform scope | **Many independent landlords** on one platform; nobody sees another landlord's data. |
| Billing | **Set per property** (or room type): monthly, per semester/term, or per year, with due dates. |
| Where money lands | **Directly in each landlord's own account.** The platform never holds money. |
| Sponsorship | **An agreed share** per sponsorship (e.g. 100%, 60%, a fixed amount per term, or rent only). The student pays the rest. A student can have several sponsors. |
| Payment methods | **Mobile money, bank card, bank transfer with proof upload, and cash** recorded at the office. |
| Payment provider | **Not chosen yet.** Research and recommendation in §8.1. |
| Sign-in | **Email + password** for everyone. |
| Mobile app | **React Native + Expo** in [`mobile/`](../mobile/), one codebase for Android and iPhone. |
| Audience (decided 16 Nov 2026) | **Student boarding houses only.** |
| Build order (16 Nov 2026) | **Many landlords + super admin first** (built: see "Status" below), then billing, student accounts, online payments, sponsors. One piece at a time. |
| Roles for now (16 Nov 2026) | **Two fixed roles:** super admin and landlord (one sign-in per landlord business). Staff accounts and editable permissions (§4) come later. |
| Technology (16 Nov 2026) | **Keep it simple:** stay on the current JavaScript server and MySQL. TypeScript, Redis, a worker process and object storage (§3, §16) are added only when a feature truly needs them. |

| Billing scope (24 Nov 2026) | **Smallest version of Phase 2:** monthly or per-term rent per property, charges (rent, deposit, fee, other), waivers, credit, statements. Left for later: sponsor shares, room types and bed records, automatic part-period amounts, deposit refunds, late fees, reminders, statement PDF/CSV, converting old records (reset instead). |
| Rent increases and notices (24 Nov 2026) | Rent rises only with **at least 30 days' notice**, for a whole property or chosen rooms, emailed to tenants; landlords can also **email general messages** to tenants. Phone/in-app notices come with student accounts (Phase 3). |

### Status (24 Nov 2026)

Billing (Phase 2, smallest version) is built: `BillingTerm`, `Charge`, `Allocation`, `Waiver`,
`RentIncrease`/`RentChange`, `Notice`/`NoticeRecipient`; payments fill chosen charges then the
oldest due, surplus is credit; rent is billed on reads and by a timer in the web process (no
worker). Choices made along the way: a tenant's rent can be corrected either way in the first 7
days after move-in, later only lowered (raising needs the notice); a rent increase sets the same
new rent for everyone it covers and skips tenants already at or above it; a cancelled rent charge
is not billed again; the monthly/term choice is fixed once rent has been billed. All 64 tests pass
against a local MySQL 8.4.

### Status (16 Nov 2026)

Built: landlord businesses (`Organization`) with isolation between them, the super admin's
Landlords screen (add, rename, suspend, reset password), a landlord's own audit log, and the
phone app's first real endpoints (`/api/v1`: landlord sign-in with tokens and dashboard).
Kept simpler than this plan describes, on purpose: no `Session` table (phone tokens are not
stored on the server), no permission catalog, no TypeScript, and the super admin cannot open
a landlord's tenants or payments.

---

## 2. Review of the current design

### Keep (these are good and carry over)

- Money stored as **integer ngwee**. No floating-point errors.
- **Atomic, never-reused receipt numbers** and immutable receipt PDFs.
- **Void/correct instead of delete**, with reasons. The **append-only audit log**.
- The security hardening: account lockout, safe password reset, session revocation, CSP,
  CSRF origin check, validation, and CSV-injection protection. See [SECURITY.md](./SECURITY.md).
- The test suite. Unit tests, plus API tests against a throwaway MySQL database.

### Problems, and why they block the new stakeholders

| # | Problem | Evidence in the code | Why it matters now |
| --- | --- | --- | --- |
| D1 | **Built for one landlord.** There is no "landlord business" (organisation) in the data. Settings are one global row. An `ADMIN` sees *all* properties. | `Setting` singleton `id=1` in [schema.prisma](../server/prisma/schema.prisma); `accessiblePropertyIds()` returns "everything" for admins in [access.js](../server/src/access.js) | With many landlords, one landlord's admin would see every other landlord's students and money. **Must be redesigned first.** |
| D2 | **Students are records, not users.** `Tenant` has no login. | `Tenant` model (name/phone/email/notes only) | Students can't sign in, see bills or pay. |
| D3 | **Bills are never actually issued.** What a tenant owes is *recomputed* from calendar months, the current `monthlyRent`, snapshots and adjustments. | `makeLedger()` / `unpaidMonthsFor()` in [tenancyService.js](../server/src/tenancyService.js); month grids in [RecordPayment.jsx](../client/src/pages/RecordPayment.jsx); `MONTH_NAMES` on the PDF | There are no due dates, semesters/terms, deposits, other fees or statements, and nothing to say who is responsible for what share. Sponsors and terms can't be modelled. |
| D4 | **Payments are only "recorded after the fact".** `Payment` is `ACTIVE`/`VOID`. It has no pending state, no provider reference, no idempotency key and no record of *who* paid. | `Payment` model; `createPayment()` in [paymentService.js](../server/src/paymentService.js) | Online payments are asynchronous (pending → succeeded/failed) and arrive by webhook. A double-tap or retry on a bad mobile connection would charge twice. |
| D5 | **Roles are two hard-coded strings.** `requireRole('ADMIN')` is scattered through route files. | `ROLES` in [auth.js](../server/src/auth.js); checks across `server/src/routes/*` | The super admin can't define privileges. There is no staff, student or sponsor role, and no per-user permissions. |
| D6 | **Browser-cookie sign-in only.** `tokenVersion` signs out *all* devices at once. | `issueCookie()`, `requireAuth()` in [auth.js](../server/src/auth.js) | Mobile apps need bearer tokens with refresh, and per-device sessions ("sign out my lost phone"). |
| D7 | **No API versioning or contract.** Routes change shape freely, and the web app is deployed alongside the API. | `server/src/routes/*` mounted under `/api` | Installed mobile apps lag behind releases by weeks. Without `/api/v1` and stable schemas, every server change can break phones in the field. |
| D8 | **Business logic lives inside route handlers.** Only payments have a service. | e.g. [routes/tenancies.js](../server/src/routes/tenancies.js) mixes validation, permissions, transactions and audit | The same rules are needed by webhooks, scheduled jobs and the mobile API. As written, they would be copy-pasted. |
| D9 | **Plain JavaScript with no shared code.** Money formatting and month names are duplicated. | `formatKwacha` in [money.js](../server/src/money.js) vs `formatK` in [api.js](../client/src/api.js); month arrays in 4+ files | With three clients (server, web, mobile) the copies will drift. Shared TypeScript types and schemas are needed. |
| D10 | **Statuses are free-text strings,** e.g. `'ACTIVE'`, `'VOID'`, `'none'`, `'pending'`. | schema.prisma | A typo still compiles. Prisma on MySQL supports enums. |
| D11 | **PDFs are stored as `LONGBLOB` in MySQL.** | `Receipt.pdf`, `Receipt.voidPdf` | Many landlords × students × receipts, plus uploaded bank slips, will bloat the database and its backups. These belong in object storage. |
| D12 | **Background work runs inside the web process.** | `startEmailWorker()` `setInterval`; `setImmediate` in [routes/auth.js](../server/src/routes/auth.js); in-memory rate limiter | It is lost on restart and duplicated if two servers run. Payment checks, reminders and push notifications need a durable job queue. |
| D13 | **Beds are implicit:** a `bedCount` number plus letters. | `Room.bedCount`, `bedLabels()`, `activeBedKey` | You can't price beds or room types differently, take a bed out of service, or keep clean bed history. |
| D14 | **Date-only facts are stored as timestamps,** with a process-wide timezone override. | `moveInDate DateTime`; `process.env.TZ` in [index.js](../server/src/index.js) | Due dates and term dates need real date-only fields and a timezone per landlord. |
| D15 | **Web pages fetch data by hand and are large.** | [TenantProfile.jsx](../client/src/pages/TenantProfile.jsx) is 362 lines; every page uses `useEffect` + `api.get`; `isAdmin` checks in JSX | Four roles × many more screens will become unmanageable without data-fetching, permission-driven routing and shared components. |
| D16 | **No CI, linting or formatting.** Database tests need a manual throwaway DB. | — | Payments code needs every change tested automatically. |
| D17 | **No observability:** only `console.log`, with no request IDs or error tracking. | — | You can't trace a failed payment end to end. |
| D18 | **Email is the only channel.** | [email.js](../server/src/email.js) | Students and sponsors expect push notifications ("payment received", "rent due Friday"). |

**Verdict:** the foundations (money handling, receipts, security, tests) are sound. The
**domain model** (single landlord, implicit bills, tenants without accounts, two roles) is
what needs redesigning. That is a rebuild of the core *data and service layer*, done in
phases while the current app keeps running. It is not a rewrite of everything.

---

## 3. Target architecture

```text
  Android / iPhone app (Expo)              Web portal (React)
  students · sponsors · landlords          super admin · landlords
  (landlords: quick tasks only)            (full management; student/sponsor web later)
              \                                   /
               \──────── HTTPS  /api/v1  ────────/
                               │
            API server (Node + Express, TypeScript, domain modules)
             │            │              │                  │
          MySQL        Redis         Object storage     Payment providers
         (Prisma)   (job queue,     (receipt PDFs,      (mobile money, cards)
                     rate limits)    bank-slip uploads)     │ webhooks ▲
                               │
            Worker process: generate bills · due/overdue reminders ·
            check pending payments · emails · push notifications · reports
```

### Repository layout

```text
RentPay/
  server/            API + worker (TypeScript, modules below)
  client/            Web portal (rename to web/ later; optional)
  mobile/            Expo app (Android + iPhone)       ← created in this change
  packages/shared/   API schemas (zod), types, money/date helpers, permission names
  docs/
```

### Server modules (replacing today's flat `routes/` folder)

```text
server/src/
  app.ts · index.ts (web) · worker.ts (jobs)
  lib/        db, logger, errors, money, dates, crypto, storage, queue
  modules/
    auth/           sign-in, sessions (web cookie + mobile tokens), password reset, invites
    access/         permission catalog, role templates, can(user, permission, scope)
    organizations/  landlords, staff, settings, merchant accounts
    properties/     properties, room types, rooms, beds
    residents/      students (resident records), tenancies / move-in / move-out
    billing/        billing plans, terms/periods, charges, shares, adjustments, statements
    payments/       payments, allocation, receipts, gateways/*, webhooks, reconciliation
    sponsors/       sponsors, members, sponsorships, consent, bulk payments
    notifications/  email, push, in-app, templates
    files/          object-storage uploads/downloads with signed URLs
    reports/ · audit/
  legacy/           today's /api routes, kept until the web portal has moved to /api/v1
```

Each module has **routes** (HTTP only), a **service** (business rules, transactions,
audit) and **queries**. Webhooks, jobs and both apps call the same services.

---

## 4. People, roles and privileges

### Scopes

| Scope | Who | Can act on |
| --- | --- | --- |
| Platform | Super admin | Everything; landlords, users, role templates, platform settings |
| Organisation (a landlord business) | Landlord owner, manager, staff | Their own properties, students, bills, payments, sponsors |
| Self | Student | Their own bills, payments, receipts, sponsor approvals |
| Sponsorship | Sponsor members | Only the students they sponsor, and only the sponsor's share |

### Role templates (defaults the super admin can edit)

| Role | Default privileges |
| --- | --- |
| `SUPER_ADMIN` | All platform permissions. **Two-factor sign-in required.** |
| `LANDLORD_OWNER` | Everything in their organisation, including payment-provider setup and staff |
| `LANDLORD_MANAGER` | Day-to-day management incl. voids and waivers; no provider setup or staff management |
| `LANDLORD_STAFF` | View residents, record cash, verify bank slips; no voids, waivers or reports export |
| `STUDENT` | View own statement and receipts, pay online, approve sponsor links |
| `SPONSOR_ADMIN` | View sponsored students' shares, pay (bulk/individual), manage sponsor members |
| `SPONSOR_VIEWER` | View only (e.g. a parent who doesn't pay, an NGO auditor) |

**How the super admin "defines privileges":** edit a template (applies to everyone with
that role), switch features on/off per landlord (e.g. "online payments", "sponsors"),
and grant or revoke individual permissions for one user. All of it is audited.

### Permission catalog (first draft)

- **Platform:** `platform.orgs.manage` · `platform.users.manage` · `platform.roles.manage` · `platform.settings.manage` · `platform.audit.view` · `platform.support.view` (read-only access to a landlord's data for support; always logged and visible to that landlord)
- **Organisation:** `org.settings.manage` · `org.staff.manage` · `org.payments_setup.manage` · `property.manage` · `billing.plans.manage` · `residents.view` · `residents.manage` · `charges.create` · `charges.adjust` · `payments.record` · `payments.verify_transfer` · `payments.void` · `payments.refund` · `sponsorships.manage` · `reports.view` · `reports.export` · `audit.view`
- **Student:** `self.statement.view` · `self.receipts.view` · `self.pay` · `self.sponsors.approve`
- **Sponsor:** `sponsor.students.view` · `sponsor.pay` · `sponsor.statements.view` · `sponsor.members.manage`

**One rule enforced everywhere:** each request goes through `can(user, permission, scope)`
in `modules/access`. Every query is filtered by organisation. Data from another landlord
answers **404**. Automated tests check every endpoint against every role (see §16).

---

## 5. Data model

### Identity and access

- **User**: email (unique), passwordHash, name, phone, status (`INVITED | ACTIVE | SUSPENDED`), emailVerifiedAt, mfaSecret (encrypted), platformRole (`SUPER_ADMIN` or none).
- **Session**: one row per signed-in device. Holds userId, kind (`WEB | MOBILE`), refreshTokenHash, deviceName, appVersion, ip, lastUsedAt, expiresAt and revokedAt. It replaces `tokenVersion`.
- **Role** + **RolePermission**: templates and their permissions.
- **Membership**: userId + organizationId + roleId, plus per-user grants/revokes. Covers landlord owners, managers and staff.
- **Invitation**: email, kind (`STAFF | STUDENT | SPONSOR_MEMBER`), target (organisation / resident / sponsor), tokenHash, expiresAt, acceptedAt.
- **LoginThrottle** and **AuditLog** (existing). AuditLog gains organizationId so each landlord can view their own.

### Landlords and properties

- **Organization** (a landlord business): name, legal name, code (used in receipt numbers), status, timezone (default `Africa/Lusaka`), currency `ZMW`, logo, receipt footer, feature switches.
- **MerchantAccount** (how this landlord gets paid online): provider, mode (`OWN_ACCOUNT` = the landlord's own provider keys, stored encrypted; or `SUBACCOUNT`), allowed methods, status, webhook secret.
- **TransferAccount**: the bank details shown to payers who pay by bank transfer.
- **Property** → **RoomType** (e.g. "Double en-suite") → **Room** → **Bed** (label, `AVAILABLE | OUT_OF_SERVICE`).

### Students and stays

- **Resident**: the landlord's record of a student. It has an optional `userId`, set when the student accepts their invite. It also holds student number, institution, programme, year of study, and guardian contact. Today's `Tenant` becomes this, so students without the app still work.
- **Tenancy**: resident + bed + billing plan + rent override + start/end dates (date-only) + status. The unique active bed key stays.

### Billing ledger (replaces the recomputed months)

- **BillingPlan**: per property or room type. Holds the cycle (`MONTHLY | TERM | YEARLY`), amount, deposit and due rule.
- **BillingPeriod**: a landlord's calendar, e.g. "Semester 1 2026: 12 Jan–30 Jun, due 20 Jan". Monthly periods are created automatically.
- **Charge**: one line on a bill. Holds tenancy, type (`RENT | DEPOSIT | UTILITY | FEE | PENALTY | OTHER`), period, description, amount, dueDate and status.
- **ChargeShare**: who is responsible for how much of a charge (`STUDENT`, or `SPONSOR` + sponsorshipId). The shares always add up to the charge.
- **Adjustment**: a waiver (negative) or extra charge (positive) on a share, with a required reason. It can be reversed; nothing is deleted.
- **Payment**: organisation, payer (student user / sponsor / recorded by landlord), method (`CASH | MOBILE_MONEY | CARD | BANK_TRANSFER`), amount, status (§8.3), provider + merchant account + provider reference, **idempotency key (unique)**, proof file, verification details, and void/correction details as today.
- **PaymentEvent**: every webhook received, stored once by provider event id. Gives exactly-once processing and an audit trail.
- **Allocation**: how much of a payment went to which charge share.
- **Credit**: money paid beyond what was owed. It is applied automatically to the next bill, or refunded.
- **Refund**: for deposits or mistakes, with method and status.
- **Receipt** + **ReceiptCounter**: one receipt per successful payment, numbered per organisation and year. The PDF is stored in object storage.

**Balances are always sums, never recomputed months.** A payer's balance = their charge
shares + adjustments − allocations.

### Sponsors

- **Sponsor**: individual or organisation (NGO, company, bursary scheme).
- **SponsorMember**: which users act for a sponsor (`SPONSOR_ADMIN | SPONSOR_VIEWER`).
- **Sponsorship**: sponsor + resident + landlord. Holds the coverage terms (`PERCENT`, `FIXED_PER_PERIOD` or `FULL`), the charge types covered (e.g. rent only), an optional cap, start/end dates, a cohort label (e.g. "Engineering bursary 2026"), status (`REQUESTED | ACTIVE | PAUSED | ENDED | REJECTED`), studentConsentAt and landlordApprovedAt.

### Notifications and files

- **Notification** (in-app inbox) and **PushToken** (one per device).
- **File**: kind (`RECEIPT_PDF | TRANSFER_PROOF | LOGO`), storage key, type, size, sha256, uploader. Files themselves live in object storage and are served by short-lived signed links.

### Worked example (semester billing with a 60% sponsor)

1. The property's plan is "Semester, K6,000, due 20 Jan". On 12 Jan the worker creates a
   **Charge** of K6,000 for Mary.
2. Mary's sponsorship covers 60% of rent, so two **ChargeShares** are created:
   **Sponsor K3,600** and **Student K2,400**.
3. The sponsor pays for 10 students in one go. That is one **Payment** of K36,000 with ten
   **Allocations**, one of them K3,600 to Mary's sponsor share. The sponsor gets one
   receipt listing all ten.
4. Mary pays K1,000 by mobile money, allocated to her share. Her statement shows: rent
   K6,000; sponsor paid K3,600; she paid K1,000; **she owes K1,400**.

---

## 6. Billing rules

- **Charges are generated by the worker** at each period start (monthly, or the term start)
  for every active tenancy. Landlords can add one-off charges: deposit, damage, utilities.
- **Due dates and overdue status** come from the period's due rule. Reminders go out before
  the due date and when a charge becomes overdue (§10.2).
- **Moving in or out mid-period:** the first and last charges are prorated. Whether to
  prorate is a landlord setting (default on for monthly plans, off for terms).
- **Paying without choosing charges** pays the oldest due share first. Any surplus becomes a **Credit**.
- **Unpaid sponsor share:** after a landlord-set number of days overdue, the landlord can
  **move an unpaid sponsor share to the student**. This is audited, and the student is notified.
- **Late fees:** off by default. If switched on, they are created as a `PENALTY` charge by
  the worker, never silently added to rent.
- **Statements:** per student, and per sponsor (per student or per cohort), as PDF/CSV for
  any date range.

---

## 7. Accounts and sign-in (email + password)

- **The super admin creates landlords.** That creates the organisation and invites its
  owner by email. Landlords invite their staff.
- **Students:** the landlord adds a resident with an email address, and the student gets an
  **invite link** to set a password. Accepting it links the account to the resident record.
  A student who moves to another landlord keeps one account, with a resident record per landlord.
- **Sponsors:** sign up themselves, or are invited by a landlord. Linking to a student
  needs **the student's consent and the landlord's approval** (§9.2).
- **Email verification** is required before paying online or approving sponsors.
- **Sessions:**
  - **Web** keeps the httpOnly cookie, which now points at a `Session` row so one device can be revoked.
  - **Mobile** gets a 15-minute access token plus a rotating 60-day refresh token, stored in
    the phone's secure storage. Reusing an old refresh token revokes that device's
    session family (theft detection).
  - Users see their devices and can sign out any of them.
- **Two-factor sign-in (authenticator app):** required for super admins and landlord
  owners, optional for others.
- The current protections carry over unchanged: lockout, reset links built from `APP_URL`,
  password rules, and audit.

---

## 8. Payments

### 8.1 Choosing a provider (research summary)

| Provider | What I could confirm | Unknown — ask them |
| --- | --- | --- |
| **Flutterwave** | Holds a Payment System Licence in Zambia. Zambian mobile money collections are on by default for Zambian merchants. Bank transfer in ZMW is listed. Payouts to MTN, Airtel and Zamtel. Split payments/subaccounts exist as products. | The charge API lists **MTN** as the network value while support pages list MTN, Airtel and Zamtel. Whether split payments/subaccounts work in **ZMW**. One support page shows a **K100 minimum** for mobile money collections. |
| **Lenco** (Linknet Zambia Ltd, Lusaka) | API for **mobile money and card collections**. The direct card API requires a **PCI DSS certificate**. Pricing is custom. | A hosted card page (to avoid PCI)? Subaccounts? Settlement times? |
| **pawaPay** | Mobile money only. MTN and Airtel Zambia listed in the docs. Several Zamtel incidents in 2026 on its status pages. | Zamtel support status. **No cards.** |
| **DPO Pay** | Marketing says Airtel, MTN, Zamtel and cards in Zambia. | Little public developer documentation found. |

**Recommendation:**

- Talk to **Flutterwave and Lenco** first (both do mobile money + cards in Zambia), and
  pick one for launch.
- Keep **pawaPay** as a mobile-money backup.
- The code talks to providers through one `PaymentGateway` interface, so switching or
  adding one later is a contained change.

**Questions to ask each provider:**

1. Can **each landlord have their own merchant account or subaccount**, settled straight to their bank or wallet? What KYC is required, and how long does onboarding take?
2. Which networks do you support in ZMW (MTN, Airtel, Zamtel), and what are the per-transaction minimum and maximum amounts?
3. Do you have a **hosted card checkout** (so card numbers never touch our app or servers)? 3-D Secure?
4. Webhooks: how are they signed, how often retried, and do events have ids? Is there a status-query API and a sandbox?
5. Fees per method, who can bear them, settlement timing, and payout fees?
6. Refunds/reversals for mobile money and cards? A settlement report API for reconciliation?

### 8.2 Money goes straight to the landlord

- Each landlord connects a **MerchantAccount**: either their **own** provider account
  (their API keys, encrypted with `ENCRYPTION_KEY`), or a **subaccount** if the provider
  supports ZMW splits.
- Payments for that landlord's students are always created on that account, so the money
  settles to the landlord.
- The platform holds no funds. That keeps it out of the business of holding customer money
  (confirm with a lawyer, §15).
- A landlord without a connected account can still take cash and bank-transfer payments.

### 8.3 Payment lifecycle

```text
online (mobile money / card):
  PENDING ──provider says paid──▶ SUCCEEDED ──void/refund──▶ REVERSED
     ├──provider says failed / 30 min timeout──▶ FAILED
     └──payer cancels──▶ CANCELLED
bank transfer:
  AWAITING_VERIFICATION ──landlord approves──▶ SUCCEEDED
                        └─landlord rejects (reason)──▶ FAILED
cash (recorded by landlord): ──▶ SUCCEEDED
```

**Allocations, receipts and notifications happen only on `SUCCEEDED`, in one database
transaction.**

### 8.4 How each method works

- **Mobile money:**
  1. The payer picks the charges (default: everything due) and enters a phone number.
  2. The server works out the amount (it never trusts an amount from the app) and creates
     a `PENDING` payment.
  3. The provider sends an approval prompt to the payer's phone.
  4. The app shows "Approve K2,400 on your phone" and updates itself when the result arrives.
- **Card:** the app opens the provider's **hosted checkout page** in an in-app browser, then
  returns to the app through a deep link. The result is only trusted from the provider's
  webhook or status API, never from the redirect. Card numbers never touch our code
  (lowest PCI burden).
- **Bank transfer + proof:**
  1. The app shows the landlord's bank details and a payment reference.
  2. The payer uploads the slip as a photo or PDF (type- and size-checked, stored in object storage).
  3. The landlord approves or rejects it in a verification queue. A reference that has already been used is flagged.
- **Cash:** recorded by the landlord or staff, as today.

### 8.5 Safety rules

- **Idempotency:** each "Pay" tap sends a unique `Idempotency-Key`. Retries return the same
  payment instead of charging twice.
- **Money on its way can't be paid twice:**
  - A payment's allocations are planned when it is created.
  - While it is `PENDING` or `AWAITING_VERIFICATION`, they count as **pending** on each
    charge share, and the share's payable amount is its balance minus pending.
  - The apps show it ("K 3,600 on its way") and only offer what is still payable; the
    server refuses anything more.
  - On success the pending amount becomes paid; on failure it becomes payable again.
  - (Found while testing the mobile app: without this, a sponsor whose bank slip was still
    being checked was offered the same bulk payment again.)
- **Webhooks:**
  - Signatures are verified.
  - Each event is processed exactly once, by provider event id.
  - The amount and currency are checked against our record.
  - Webhooks are handled by the worker, so a slow job never times out the provider's retry.
- **Reconciliation:**
  - Every few minutes, the worker asks the provider about payments that have been pending too long.
  - A late success is still applied, with an alert.
  - A daily settlement check per merchant account flags any mismatch to the landlord and super admin.
- **Bulk sponsor payments:**
  - One payment, many allocations, one sponsor receipt listing every student.
  - **One landlord per payment.** Money settles into each landlord's own account, so a
    sponsor with students at two landlords makes two payments. The app keeps each
    selection to one boarding house.
  - Each student's statement shows "Paid by [sponsor]: K…".
  - (Per-student receipt numbers are an open question, §18.)
- **App store rules:** rent is a real-world service, so Apple and Google expect it to be paid
  with outside methods like these, not in-app purchase.

---

## 9. Sponsors

### 9.1 What a sponsor sees

- **My students:** grouped by boarding house and cohort. Each shows the **sponsor's share**
  due/overdue, the next due date, and a status badge. Totals per group.
- **A student:** only the charges and payments relating to the sponsor's share. No private
  notes or contact details beyond what the student agrees to share.
- **Pay:**
  - **Select all due**, a cohort, or individual students and periods.
  - The total is worked out by the server.
  - Pay by mobile money, card or bank transfer.
  - One consolidated receipt.
- **Statements:** per student or per cohort, for any date range (PDF/CSV), for the
  sponsor's own records or auditors.
- **Members:** organisational sponsors can add colleagues as payers or viewers.

### 9.2 Linking a sponsor to a student (consent)

1. The **sponsor requests** a link, with the student's email or student number and the
   boarding house, plus the coverage terms. Alternatively, the **landlord creates** it.
2. The **student approves** it in the app. This is their consent to share billing information.
3. The **landlord approves** the terms.
4. From the next charge onward, the sponsor's share is created automatically. Changing terms
   affects future charges only, unless the landlord re-splits open charges (audited).

---

## 10. Notifications

### 10.1 Channels

- **Push** (Expo push service, which uses Firebase for Android and Apple's service for iPhone).
- **In-app inbox.**
- **Email** (existing).
- SMS is not planned for now. It can be added later for reminders.

### 10.2 Events

| Event | Student | Sponsor | Landlord |
| --- | :---: | :---: | :---: |
| New bill / charge | ✅ | ✅ (their share) | — |
| Due in 3 days / overdue | ✅ | ✅ | daily summary |
| Payment succeeded / failed | ✅ | ✅ | ✅ |
| Bank slip approved / rejected | ✅ | ✅ | — (they act on it) |
| Sponsor link requested / approved | ✅ | ✅ | ✅ |

---

## 11. API (`/api/v1`)

- **REST + JSON.** Every request and response is defined once as a zod schema in
  `packages/shared` and used by the server, web and mobile. The OpenAPI document is
  generated from the same schemas.
- **Errors:** `{ "error": { "code": "PAYMENT_ALREADY_VOID", "message": "…", "fields": {…} } }`.
- **Pagination:** cursor-based. **Money:** integer ngwee. **Dates:** `YYYY-MM-DD`; timestamps ISO-8601.
- **Versioning:** `/api/v1` stays backwards-compatible. Breaking changes go to `/api/v2`,
  and v1 keeps running until old app versions are gone. The app sends `X-App-Version`, and
  `GET /api/v1/meta` returns the minimum supported version to force an upgrade.
- **Headers:** `Idempotency-Key` on every payment-creating request. `Authorization: Bearer`
  for mobile; the cookie for web.
- **Rate limits:** stored in Redis (shared across servers), per route and per user.

---

## 12. Mobile app ([`mobile/`](../mobile/))

**Stack:**

- Expo (React Native) + TypeScript, with expo-router (file-based screens).
- TanStack Query for data, cached so the last statement and receipts can be read offline.
- expo-secure-store for tokens; expo-web-browser for card checkout; expo-document-picker for bank slips.
- expo-notifications for push.
- EAS Build/Submit for store builds (no Mac needed for iPhone builds). EAS Update for urgent JavaScript-only fixes.

| Role | Screens |
| --- | --- |
| Student | Home (what I owe, next due date, sponsor cover, **Pay**) · Bills/statement · Pay (mobile money / card / bank slip, live status) · Receipts (view, share PDF) · Sponsors (approve requests) · Inbox · Account (password, devices, sign out) |
| Sponsor | My students (by boarding house/cohort, with select boxes) · **Pay for selected** (bulk) or one student · Payments & receipts · Statements · Members · Account |
| Landlord | Dashboard (collected/outstanding for the period) · Residents search · Record cash · **Verify bank slips** · Inbox · Account. Full management stays on the web portal. |
| Super admin | Web portal only. |

**Built in this change:**

- The app runs the student, sponsor and landlord journeys on **demo data**, including:
  - mobile-money approval and a declined payment;
  - a sponsor's bulk bank-transfer payment with a slip upload;
  - the landlord approving that slip.
- Its API layer has the same shape as the planned `/api/v1`.
- It passes type-checking, Android and iOS release bundling, and Expo Doctor.
- The three journeys were also driven end to end in a browser build.
- The switch to the real server happens as each phase ships (§17).
- How to run it: [mobile/README.md](../mobile/README.md).

**Before the first store release:**

- A Google Play developer account (one-off fee) and an Apple Developer Program membership
  (yearly fee), both in the **business's name**.
- A privacy policy URL, the store data-safety/privacy forms, and test accounts for the
  app reviewers.

---

## 13. Web portal

- **New super admin console:**
  - Landlords: create, suspend, set feature switches.
  - Users, and role templates & permissions.
  - Platform settings and allowed payment providers.
  - The audit log across all landlords.
  - Support view: read-only, logged, and visible to the landlord.
- **Landlord portal changes:**
  - Billing plans and the term calendar; charges and adjustments; statements.
  - Resident invites; the sponsorship approval queue; the **bank-slip verification queue**.
  - Merchant-account setup wizard; staff management; reports by month or term.
- **Code changes:**
  - TypeScript.
  - TanStack Query for data fetching.
  - Screens and buttons shown according to permissions (not `isAdmin`).
  - Large pages split into components.
  - Shared schemas from `packages/shared`.
- **Student/sponsor web access** is an open question (§18). It could reuse the same portal.

---

## 14. Moving your existing data

Rehearsed on a restored backup in a throwaway MySQL database first, exactly like the last upgrade.

| From (today) | To (new) |
| --- | --- |
| The installation | **Organization #1** (name chosen by you) |
| Current admin user(s) | Super admin and/or owner of Organization #1 (your choice, §18) |
| Properties, rooms, `bedCount` | Properties, rooms, **Bed** rows (A, B, …) |
| Tenants | **Residents** (no accounts until invited) |
| Each tenancy's months from move-in to now | Monthly **Charges** with a student share, using the rent snapshot recorded at the time |
| Active payments + payment periods | `SUCCEEDED` **Payments** + **Allocations**; overpayments become **Credits** |
| Void payments | `REVERSED` payments (reasons kept) |
| Arrears adjustments | **Adjustments** (reversals kept) |
| Receipts (numbers unchanged) and PDFs in the database | Receipts with PDFs moved to object storage |

**Done when:**

- Every tenancy's balance for every month is identical before and after.
- The yearly income report totals match.
- Every receipt number still exists.

---

## 15. Security, privacy and compliance

- **Landlord isolation:**
  - Every organisation-owned row carries `organizationId`, and queries go through scoped helpers.
  - The test suite tries every endpoint as a user from *another* landlord and expects 404.
- **Super admin:**
  - Two-factor sign-in.
  - Every support view of a landlord's data is logged and shown to that landlord.
- **Stored provider keys:** encrypted per landlord (`ENCRYPTION_KEY`, with a rotation
  procedure); never shown again after saving; webhook secrets per merchant account.
- **Cards:** hosted checkout only. **Uploads:** type/size checks, private storage, signed links.
- **Data protection:**
  - Zambia's **Data Protection Act No. 3 of 2021** applies to student and sponsor personal data.
  - Expect: registration with the Data Protection Commissioner as a controller/processor;
    a lawful basis (consent for sharing data with sponsors); data minimisation (sponsors see
    only billing for their share); retention rules; access/deletion requests; breach
    notification. **Confirm with a lawyer.**
- **Payments regulation:** settling straight to landlords through a licensed provider is
  designed to avoid the platform *holding* customer money. **Confirm with a lawyer / the
  Bank of Zambia** before launch.
- **Tax:** ask an accountant what receipts must contain for landlords (e.g. ZRA
  requirements for VAT-registered landlords).

---

## 16. Engineering foundations

| Area | Change |
| --- | --- |
| Language | TypeScript for new server modules, `packages/shared`, the web portal (gradually) and mobile (from day one). |
| Quality | ESLint + Prettier; type-check in CI. |
| CI (GitHub Actions) | Every push runs: lint, type-check, unit tests, API tests (MySQL service container), web build, mobile type-check + bundle. |
| Tests | Unit: ledger, allocation, sponsor share splitting, permissions. API: **role × endpoint permission matrix** and **cross-landlord isolation** for every route; payments with a fake gateway (duplicates, late webhooks, timeouts, idempotency). Provider sandbox tests. Mobile: component tests (jest-expo) and end-to-end sign-in/pay flows (Maestro). |
| Jobs | BullMQ + Redis worker process (bill generation, reminders, reconciliation, emails, push). |
| Files | S3-compatible object storage (e.g. Cloudflare R2) with signed URLs. |
| Observability | Structured logs (pino) with request ids, error tracking (Sentry) on server, web and mobile, uptime checks, payment success-rate dashboard per provider/network. |
| Environments | Local → **staging** (provider sandboxes, test app builds) → production. |

---

## 17. Roadmap

Durations assume **one experienced full-time developer**; double them for part-time work.
Two things have long lead times and should start in Phase 0: **provider onboarding/KYC**
and **app-store accounts**.

| Phase | What ships | Done when |
| --- | --- | --- |
| **0 · Groundwork** (1–2 wks) | Commit + deploy the current admin/security branch (with backup). CI, lint, TypeScript set-up, `packages/shared`. Start provider conversations (§8.1) and store accounts. | CI is green on every push; the provider shortlist has answered the §8.1 questions. |
| **1 · Platform core** (4–5 wks) | Organisations, users/memberships/roles/permissions, `Session` table (web + mobile tokens), `/api/v1` base + OpenAPI, super admin console (landlords, users, roles), object storage. Data moves into Organization #1. | Two landlords on staging can't see each other's data (automated isolation tests); the super admin can create a landlord and edit its privileges. |
| **2 · Billing ledger** (4–5 wks) | Room types, beds, billing plans, terms/periods, charges, shares, adjustments, credits, statements; bill-generation worker; dashboard, arrears and reports rebuilt on the ledger; existing payments migrated. | The §14 migration check passes on a copy of production; landlords can bill per month or per term. |
| **3 · Student accounts + app v0** (3–4 wks) | Invites, email verification, student statement and receipts in the app (real API), push + in-app notifications, landlord cash recording in the app. | A pilot landlord's students sign in on Android and iPhone test builds and see correct balances. |
| **4 · Online payments** (4–6 wks) | `PaymentGateway` + chosen provider, merchant-account setup, mobile money, hosted card checkout, bank-slip upload + verification queue, webhooks, reconciliation, receipts. Pilot with one landlord. | 50+ real payments in the pilot reconcile with the provider's settlement report with zero mismatches. |
| **5 · Sponsors** (3–4 wks) | Sponsor sign-up/members, link requests + consent + approval, agreed-share splitting, batch view by boarding house/cohort, bulk and individual payments, sponsor receipts and statements. | A sponsor pays for a cohort in one payment; every student's balance and the sponsor's receipt are correct. |
| **6 · Launch** (2–3 wks) | Security review, load test, backup/restore drill, data-protection paperwork, store listings, TestFlight / Play testing tracks, release. | Apps are approved in both stores; the restore drill succeeds. |

---

## 18. Decisions still needed from you

My default is shown for each; tell me if you want something different.

1. **How the platform earns money:** a landlord subscription, a fee per bed, a % per
   payment, or free for now? *Default: free for now, and design so a subscription can be added later.*
2. **Who pays provider fees:** the landlord (absorbed), or the payer (a convenience fee shown before paying)? *Default: the landlord.*
3. **Student sign-up:** by landlord invite only, or also self sign-up with a boarding-house
   join code that the landlord approves? *Default: both.*
4. **Students and sponsors without smartphones:** add a web version of their screens later? *Default: yes, after launch.*
5. **Bulk sponsor payments:** one consolidated receipt (plus a per-student line on each
   statement), or also a separate receipt number per student? *Default: consolidated receipt only.*
6. **Super admin support access** to a landlord's data: allowed (read-only, logged, visible to the landlord) or never? *Default: allowed as described.*
7. **Your current admin account:** becomes the super admin, the owner of Organization #1, or both? *Default: super admin; create a separate owner account for the existing boarding house.*
8. **App name and identifiers:** store name, bundle ID (e.g. `com.yourcompany.rentreceipt`),
   and whose name the store accounts are in. *The scaffold uses placeholders.*
9. **Deposits:** track refunds in the app at move-out? *Default: yes (Phase 2).*
10. **Late fees:** needed at all? *Default: off, with the option per landlord.*

---

## 19. Main risks

| Risk | Mitigation |
| --- | --- |
| Provider can't pay out per landlord in ZMW, or KYC is slow | Start conversations in Phase 0; the `OWN_ACCOUNT` mode works with any provider; keep a backup provider. |
| Mobile-money outages (e.g. the Zamtel incidents in 2026) | Show the network status; offer other networks/methods; reconciliation catches late results. |
| A payment is recorded wrongly | Server-side amounts, idempotency, exactly-once webhooks, daily reconciliation, receipts only on success. |
| One landlord sees another's data | Organisation scoping in one place + automated isolation tests on every endpoint. |
| Migration errors | Rehearse on a restored backup; automated before/after balance comparison. |
| App-store review delays | Store accounts early; review-ready test accounts; staged rollout. |
| Scope creep | Ship phase by phase with the pilot landlord; each phase has a "done when". |

---

## Sources (provider research, November 2026)

- Flutterwave: [Zambia mobile money docs](https://developer.flutterwave.com/docs/zambia-mobile-money) · [charge via Zambia mobile money (v3)](https://developer.flutterwave.com/v3.0/reference/charge-via-zambia-mobile-money) · [payment licence in Zambia](https://techpoint.africa/news/flutterwave-payment-licence-zambia/) · [payment methods](https://developer.flutterwave.com/v3.0/docs/payment-methods) · [transaction limits](https://flutterwave.com/za/support/payments/flutterwave-limits) · [currencies accepted](https://flutterwave.com/tz/support/general/what-are-the-currencies-accepted-on-flutterwave) · [MTN + Flutterwave deal](https://www.mobileworldlive.com/featured-content/top-three/mtn-inks-expanded-flutterwave-mobile-money-deal)
- Lenco: [mobile money collection API](https://lenco-api.readme.io/v2.0/reference/initiate-collection-from-mobile-money) · [card collection API](https://lenco-api.readme.io/v2.0/reference/initiate-collection-from-card) · [Lenco in Zambia](https://www.thisdaylive.com/2023/10/13/yc-backed-neobank-lenco-expands-to-zambia-strengthening-pan-african-reach) · [provider profile](https://lendsqr.com/providers/lenco)
- pawaPay: [providers](https://docs.pawapay.io/v2/docs/providers) · [what to know](https://docs.pawapay.io/v2/docs/what_to_know) · [Zamtel status history](https://statusgator.com/services/pawapay/nfs--zamtel--payout)
- DPO Pay and market overview: [TechPoint Africa](https://techpoint.africa/insight/best-online-payment-processing-platforms-zambia/) · [Zambia payment providers directory](https://paymentproviders.io/country/zm)
