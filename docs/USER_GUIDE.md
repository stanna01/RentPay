# USER GUIDE — Using RentReceipt

A plain-language guide to running your property day to day. No technical
knowledge needed.

## Signing in

Open the app and enter your email and password. Tick nothing else — you'll stay
signed in on that device. You can install it like an app: in your phone's browser
menu choose **"Add to Home screen"**.

### Forgot your password?

On the sign-in screen, tap **Forgot password?**, enter your account email, and tap
**Send reset link**. If your email is set up (see the Email setup guide), you'll
get a message with a link — open it and choose a new password. The link works once
and expires after an hour.

**If you haven't set up email** on your server, the reset link can't be sent. In
that case, whoever runs the server can reset the password from the command line:

```bash
npm run set-password -- you@example.com "your-new-password"
```

(The reset link is also printed to the server's log, so a server operator can
recover the account without email.)

Once you're signed in, you can also change your password anytime from
**Settings → Change password**.

---

## The dashboard (Rooms)

The home screen shows all **24 rooms**, and each room has **two beds — A and B**
(48 beds in total). Every bed is a coloured button whose colour tells you its
status **for the month shown at the top** (use the ‹ › arrows to change the
month):

| Colour                     | Meaning                                            |
| -------------------------- | -------------------------------------------------- |
| 🟩 **Green** — Paid        | Rent for this month is fully paid.                 |
| 🟨 **Amber** — Partial     | Some rent paid, but a balance is still owed.       |
| 🟥 **Red** — Due           | Nothing paid yet for this month.                   |
| ⬜ **Grey** — Vacant       | No tenant in this bed.                             |

At the top you also see four cards:
- **Beds occupied** — how many of the 48 beds are occupied.
- **Vacant beds** — how many are free.
- **Collected** / **Outstanding** — money in and still owed this month.

**Tap a bed:**
- A **grey (vacant)** bed → the screen to **assign a tenant** to that bed.
- Any **occupied** bed → that tenant's **profile**.

The big green **Record payment** button is always there when money comes in.

---

## Adding a tenant to a bed

1. On the dashboard, tap a **grey (vacant)** bed (for example Room 3, bed A).
2. Enter the tenant's **name**, and optionally **phone** and **email**.
3. The **rent for this bed** is filled in from the room's default — change it if
   this tenant pays a different amount.
4. Pick the **move-in date**.
5. Tap **Assign tenant**. The bed turns from grey to red/green and you're taken to
   the tenant's profile.

> Add the tenant's **email** if you want to send them receipts by email.
> A bed's previous occupants stay in your history even after they move out.

---

## Recording a payment

1. Tap **Record payment** (on the dashboard) — or the **+ Record payment** link on
   a tenant's profile.
2. **Choose the tenant** (search by name or room number). Their room and rent fill
   in automatically.
3. **Pick the month(s)** this payment is for. The app pre-selects any unpaid or
   partly-paid months for you. You can:
   - tap extra months to **pay several at once**,
   - pick a **future month** to record an **advance** payment,
   - pick a **past month** to clear **arrears**.
4. **Enter the amount** received. As you type, the app shows exactly how the money
   will be split across the months and any **balance left over**.
5. Choose how they paid (**Cash / Mobile / Bank**) and the date.
6. Leave **"Email the receipt to the tenant"** ticked if they have an email.
7. Tap **Generate receipt**.

### Part payments

If a tenant pays less than a full month, record what they gave. That month turns
**amber** and shows the balance still owed. Next time they pay, select the same
month again and the app fills the remaining balance.

---

## The receipt

After generating, you'll see the **receipt** with the property name, receipt
number (e.g. `RCT-2026-0001`), the amount in figures **and words**, the months
covered, and any balance.

- **Email to tenant** — sends the PDF to their email.
- **Print / PDF** — opens the printable PDF (print it or save it).
- **Save & done** — returns to the dashboard.

Every receipt has a **unique number that is never reused**, so your records stay
clean and auditable.

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
still count in your reports.

---

## Editing a tenant

On the tenant's profile, tap **Edit** (top right) to change their name, phone,
email, notes, or monthly rent.

> Changing the rent only affects **future** months. Past receipts keep the rent
> that applied at the time, so your history is never altered.

---

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

- The tile colour always reflects the **month shown at the top** — change the
  month to check past or future rent.
- Record an **advance** by selecting next month(s) before they're due.
- If email is down, receipts are **queued and sent automatically** later — you'll
  see ⏳ until they send.
