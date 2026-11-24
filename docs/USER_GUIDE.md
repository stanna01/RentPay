# USER GUIDE — Using RentReceipt

A plain-language guide to running your property day to day. No technical
knowledge needed.

## Signing in

Open the app and enter your email and password. You'll stay signed in on that
device while you use it; after **12 hours without using the app** (and always after
**7 days**) you'll be asked to sign in again.

**First sign-in:** your account is created by the super admin (the person who
runs RentReceipt). When they create it or reset your password, you'll be asked
to choose your own password before you can continue.
Passwords must be at least **8 characters** (**12** for the super admin) and can't
be a very common one like `password123`. A short phrase of a few words works well.

**Too many wrong passwords:** after **5 wrong passwords** in a row, sign-in for that
email is paused for **15 minutes** (longer if it keeps happening, up to 24 hours).
Wait, use **Forgot password?**, or ask the super admin to unlock you. You'll get
an email when this happens, in case it wasn't you. You can install it like an app: in your phone's browser
menu choose **"Add to Home screen"**.

### Forgot your password?

On the sign-in screen, tap **Forgot password?**, enter your account email, and tap
**Send reset link**. If your email is set up (see the Email setup guide), you'll
get a message with a link — open it and choose a new password. The link works once
and expires after **30 minutes**. Changing your password signs you out on every
other phone or computer.

**If you haven't set up email** on your server, the reset link can't be sent. In
that case the **super admin** can set a temporary password for you (Landlords →
Reset password), or whoever runs the server can reset it from the command line:

```bash
npm run set-password -- you@example.com "your-new-password"
```

Once you're signed in, you can also change your password anytime from
**Settings → Change password**, and **Settings → Sign out of all devices** signs
you out everywhere (useful if you lose your phone).

### Who can do what

RentReceipt is shared by many landlords. **Each landlord sees only their own
properties, tenants and money** — never another landlord's.

| | Landlord (your own business) | Super admin (the platform) |
| --- | :---: | :---: |
| See rooms, tenants, receipts, reports, arrears | ✅ | — |
| Assign tenants, record payments, move tenants out, edit contact details | ✅ | — |
| **Void** or **correct** a recorded payment | ✅ | — |
| Add deposits and fees, waive or cancel a charge | ✅ | — |
| Set up monthly or per-term billing and term dates | ✅ | — |
| Send notices and rent increases to tenants | ✅ | — |
| Change tenancy dates, undo a move-out, delete a tenant | ✅ | — |
| Add / edit / archive properties and rooms | ✅ | — |
| Audit log | ✅ (your own) | ✅ (all landlords) |
| Add, rename, suspend or reactivate landlords | — | ✅ |
| Reset a landlord's password, unlock them, sign them out everywhere | — | ✅ |
| Email settings | — | ✅ |

If you have more than one property, choose which one you're looking at from the
name under **RentReceipt** at the top of the screen.

---

## How billing works

Each property is billed one of two ways (set it when you add the property, or
in **Manage → Properties**; it can't change once rent has been billed):

- **Every month** — each month's rent is billed on the 1st and is **due** on the
  day you choose (e.g. the 5th). After that day it is **overdue**.
- **Per term / semester** — you enter your terms (e.g. "Semester 1 2027 ·
  11 Jan – 25 Jun · due 29 Jan"). Each tenant is billed the term's rent once the
  term starts. Terms can't overlap. A yearly plan is just one long term.

Rent is billed **automatically**, from each tenant's move-in date. Everything
else on a tenant's bill — a **deposit**, a **fee** (key replacement, damage),
utilities — you add yourself from the tenant's page. Each of these lines is a
**charge**.

- A tenant moving in **part-way** through a month or term is billed the full
  amount; waive the part they shouldn't pay.
- What a tenant owes is simply **their charges − anything waived − what they paid**.
- Money paid beyond what is owed is kept as **credit** and used automatically on
  the next charge.

---

## The dashboard (Rooms)

The home screen shows every room of the selected property, and each room's
beds (usually two — **A and B**). Every bed is a coloured button showing how its
tenant stands **today**:

| Colour                        | Meaning                                              |
| ----------------------------- | ---------------------------------------------------- |
| 🟩 **Green** — Paid up        | Owes nothing.                                        |
| 🟨 **Amber** — Owes (not late)| Owes something, but nothing is past its due date.   |
| 🟥 **Red** — Overdue          | Something is past its due date.                      |
| ⬜ **Grey** — Vacant          | No tenant in this bed.                               |

At the top you also see four cards:
- **Beds occupied** and **Vacant beds**.
- **Received in [this month]** — payments recorded this calendar month.
- **Owed now** — what current tenants still owe, and how much of it is overdue.
  Tap it for the arrears list.

**Tap a bed:**
- A **grey (vacant)** bed → the screen to **assign a tenant** to that bed.
- Any **occupied** bed → that tenant's **page**.

The big green **Record payment** button is always there when money comes in.

---

## Adding a tenant to a bed

1. On the dashboard, tap a **grey (vacant)** bed (for example Room 3, bed A).
2. Enter the tenant's **name**, and optionally **phone** and **email**.
3. The **rent** (per month or per term) is filled in from the room's default —
   change it if this tenant pays a different amount.
4. Optionally enter a **deposit**; it is added to their bill, due on the move-in day.
5. Pick the **move-in date**. A date in the past bills the months or terms since then.
6. Tap **Assign tenant**.

> Add the tenant's **email** if you want to send them receipts and notices by email.
> A bed's previous occupants stay in your history even after they move out.

---

## Recording a payment

1. Tap **Record payment** (on the dashboard) — or **Record payment** on a
   tenant's page.
2. **Choose the tenant.** You see their rent, what they owe and any credit, and
   the amount is filled in with what they owe.
3. **What it pays for:** money goes to the **oldest due** charges first. To pay
   something else first (e.g. the deposit), tap it — tap several to set the order.
4. **Enter the amount** received. The app shows exactly where the money goes,
   what is still owed afterwards, and any amount **kept as credit**.
5. Choose how they paid (**Cash / Mobile money / Bank**) and the date.
6. Tick **"Email the receipt"** if they have an email.
7. Tap **Generate receipt**.

**Part payments:** record what they gave. The charge shows what is left, and
their next payment goes to it first. **Paying ahead:** record the money; it is
kept as credit and used on the next bill automatically.

---

## The receipt

After generating, you'll see the **receipt** with the property name, receipt
number (e.g. `RCT-KC-2026-0001`), the amount in figures **and words**, what it
**paid for** (e.g. "Semester 1 2027 rent — K4,000 · K2,000 left"), anything kept
as credit, and what is still owed.

- **Email to tenant** — sends the PDF to their email.
- **Print** — opens the printable PDF (print it or save it).
- **Save & done** — returns to the dashboard.

Every receipt has a **unique number that is never reused**, and its contents are
fixed when it is issued, so your records stay clean and auditable.

---

## Reprinting or re-sending a receipt

1. Open the tenant's **profile** (tap their room).
2. Scroll to **Payment history**.
3. On any payment, tap **Reprint** (opens the exact original PDF) or **Re-send**
   (emails it again).

The app always uses the **original** receipt — reprints are never re-generated,
so the number and details never change.

---

## Moving a tenant out

1. Open the tenant's **profile**.
2. Tap **Move tenant out** and confirm.

The room becomes **vacant (grey)** and free for a new tenant. **All the past
payments and receipts are kept** — you can still view and reprint them, and they
still count in your reports. Billing stops: no rent is billed for months or terms
that start after the move-out date (any already billed after it are cancelled
automatically). Anything still owed stays on their page and in the arrears list.

---

## A tenant's page

- **Owes / overdue / credit** at the top.
- **Unpaid charges** — each with its due date, what was paid and waived, and its
  status. **Show all** includes paid and cancelled ones. **+ Add charge** adds a
  deposit, fee or other charge.
- **Statement** — every charge, waiver and payment in date order with a running
  balance (a balance shown as "cr" is credit).
- **Payments & receipts** — view, reprint, re-send, correct or void.
- **Rent changes** — past and planned changes to their rent.

## Editing a tenant

On the tenant's page, tap **Edit tenant** to change their name, phone, email or
rent.

- In the **first week** after moving a tenant in you can fix a mistyped rent
  either way; rent not yet paid is billed again at the corrected amount.
- After that you can **lower** the rent (from today). To **raise** it you must
  give notice — see **Notices** below.
- Rent that has already been billed never changes.

---

## Fixing mistakes

Receipts are financial records, so a payment is **never deleted**. Instead:

- **Correct** (tenant page → the payment → **Correct**): change the amount,
  method or date. The old receipt is stamped **VOID** and a **new receipt
  with a new number** is issued. Both stay in the records, linked to each other.
- **Void** (tenant page → the payment → **Void**): cancel a payment that should
  never have been recorded. The charges it paid are owed again; the receipt
  keeps its number and its PDF is stamped **VOID**. You can choose to email the
  tenant that the receipt is cancelled.

Charges are never deleted either:

- **Waive** (on a charge): let the tenant off part or all of what is still owed
  on it, e.g. a repair period. It can be **reversed** later.
- **Cancel charge**: the charge was a mistake. Anything already paid on it
  becomes credit for their other charges. A cancelled month's or term's rent is
  not billed again.

All of these need a **reason**, which is kept in the audit log.

## Arrears

**Manage → Arrears** (or tap **Owed now** on the dashboard) lists every tenant
who owes money: how much, how much is overdue, how many unpaid items and the
oldest due date. Export it as CSV.

## Notices

**Manage → Notices to tenants**:

- **Send a message** — to the whole property or chosen rooms (e.g. "Water off on
  Friday 9–12"). Each tenant gets it by email.
- **Rent increase** — choose the whole property or rooms, the new rent and the
  date it starts. It must be **at least 30 days away**. Tap **See who it
  affects** to check the list first: tenants already paying that much or more,
  or with another change already planned, are left out. Then **Send notice**:
  every affected tenant is emailed now; rent billed for months or terms starting
  on or after that date uses the new rent, and the rooms' default rent changes on
  that date too. You can **cancel** a planned increase before it starts; the
  tenants are emailed that it is off.
- **Sent** — every notice, who got it, and whether the email went out. Tap one to
  see exactly what each tenant was sent. Notices can't be edited after sending.

Tenants **without an email address** are listed when you send, so you can tell
them in person. Emails need the platform's email settings to be set up.

## Manage

The **Manage** tab has:
- **Properties & rooms** — add properties (each has a short code used in its
  receipt numbers, e.g. `RCT-KC-2026-0001`), choose monthly or per-term billing
  and enter terms, edit names/addresses, add or remove rooms and beds.
  Properties and rooms with history are **archived**, not deleted.
- **Arrears** — who owes what.
- **Notices to tenants** — messages and rent increases (see above).
- **Audit log** — every change and sign-in in your business, who did it and when.

## Super admin

The super admin signs in to the same website and sees different screens:
- **Landlords** — add a landlord (business name, sign-in email and a temporary
  password), rename, **suspend** (they are signed out at once and can't sign in;
  their records are kept) or reactivate. For each landlord's account: reset the
  password, unlock it, or sign it out everywhere.
- **Audit log** — every change and sign-in across all landlords.
- **Settings** — the email (SMTP) settings used to send receipts for everyone.

The super admin does not see or change a landlord's tenants and payments.

## Reports

The **Reports** tab shows how much you collected each month, as a table and a bar
chart. Use the ‹ › arrows to change the year, and **Export CSV** to download the
figures (open in Excel or Google Sheets).

---

## Settings

- **Property** — the name and address printed on receipts, and your landlord
  email.
- **Email settings** — connect your Gmail or Resend account so receipts can be
  emailed. Use **Send test email** to check it works. (See the Email setup guide.)
- **Change password** — update your login password.
- **Log out**.

---

## Quick tips

- Bed colours show how each tenant stands **today**; the tenant's page has the
  full history.
- To record an **advance**, just record the money — it is kept as credit.
- If email is down, receipts are **queued and sent automatically** later — you'll
  see ⏳ until they send.
