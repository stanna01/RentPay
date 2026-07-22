# EMAIL_SETUP — Sending receipts to tenants

RentReceipt emails receipt PDFs to tenants using **SMTP**. You can configure it
two ways (settings in the app override the `.env` defaults):

- In the app: **Settings → Email settings** (easiest; stored in the database).
- In `server/.env`: the `SMTP_*` variables (good for server defaults).

Two common providers are covered below.

---

## Option 1 — Gmail (with an App Password)

Gmail no longer allows your normal password for apps. You need an **App
Password**, which requires 2-Step Verification.

1. Turn on **2-Step Verification**: <https://myaccount.google.com/security>.
2. Create an App Password: <https://myaccount.google.com/apppasswords>
   - Choose "Mail" / "Other", name it "RentReceipt".
   - Google shows a **16-character password** — copy it (spaces don't matter).
3. Enter these settings (Settings screen or `.env`):

   | Setting     | Value                          |
   | ----------- | ------------------------------ |
   | SMTP host   | `smtp.gmail.com`               |
   | Port        | `465`                          |
   | Secure (SSL)| on (`true`)                    |
   | Username    | your full Gmail address        |
   | Password    | the 16-character App Password  |
   | From email  | your Gmail address             |

Gmail sends up to ~500 emails/day on a free account — far more than a 24-room
property needs.

---

## Option 2 — Resend

[Resend](https://resend.com) is a simple email API with a free tier. It's a good
choice if you have your own domain and want the best deliverability.

1. Create a Resend account and **verify a domain** (or use their test sender for
   trials).
2. Create an **API key** in the Resend dashboard.
3. Enter these settings:

   | Setting     | Value                      |
   | ----------- | -------------------------- |
   | SMTP host   | `smtp.resend.com`          |
   | Port        | `465`                      |
   | Secure (SSL)| on (`true`)                |
   | Username    | `resend`                   |
   | Password    | your Resend **API key**    |
   | From email  | an address on your verified domain, e.g. `receipts@yourdomain.com` |

---

## A note on SPF (deliverability)

To stop your receipts landing in tenants' spam:

- **Gmail:** sending from your own `@gmail.com` address is already aligned — no
  DNS changes needed.
- **Resend / your own domain:** add the DNS records Resend gives you. At minimum
  an **SPF** record authorises the provider to send for your domain, e.g. a TXT
  record on your domain like:
  ```
  v=spf1 include:resend.com ~all
  ```
  (Resend also provides DKIM records — add all of them for best results.)

Whatever the provider, the **"From email" should be an address you actually
control** on the sending domain. Mismatched from-addresses are the #1 cause of
spam filtering.

---

## Testing

1. Fill in the email settings in **Settings → Email settings**.
2. Click **Send test email**. The app first checks it can connect/authenticate to
   the SMTP server, then sends a test message to your landlord email.
3. If it fails, the error message tells you what's wrong (bad password, wrong
   port, etc.). Common fixes:
   - **"Invalid login" (Gmail):** you used your normal password — use an App
     Password.
   - **Connection timeout:** wrong host/port, or your host blocks outbound port
     465 — try port `587` with Secure **off** (STARTTLS).
   - **Test sends but tenants get nothing:** check the tenant actually has an
     email address on their profile, and look in their spam folder (fix SPF).

## How retries work

When you record a payment with "Email the receipt" ticked, the app tries to send
immediately. If it fails (e.g. the server is briefly offline), the receipt is
**queued** and a background worker retries automatically with increasing delays.
You'll see the status on the receipt and in the payment history:

- ⏳ **pending** — queued, will retry
- ✅ **sent** — delivered to the SMTP server
- ⚠️ **failed** — gave up after several attempts; use **Re-send** to try again

The stored PDF is always reused on re-send — receipt numbers and content never
change.
