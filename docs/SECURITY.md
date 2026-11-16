# SECURITY — How RentReceipt is protected

This page explains how RentReceipt guards against common attacks, measured against
current industry guidance:

- [OWASP Top 10](https://owasp.org/Top10/)
- [OWASP ASVS 4.0](https://owasp.org/www-project-application-security-verification-standard/): the Authentication, Session Management and Access Control chapters
- the OWASP Cheat Sheets on Authentication, Forgot Password, Session Management, CSRF and CSV Injection
- [NIST SP 800-63B](https://pages.nist.gov/800-63-3/sp800-63b.html), for passwords and lockout

It also lists what is still left to do.

## Summary

| Threat (OWASP) | Protection in RentReceipt | Where |
| --- | --- | --- |
| **A01 Broken access control** | Every request is checked on the server for both **role** (super admin / landlord) and **ownership**: a landlord reaches only the properties of their own business, and the super admin manages landlords but not their tenants or payments. Anything belonging to another landlord returns *404 Not found*, so the app never confirms it exists. Suspending a landlord ends their sessions at once. Hiding buttons in the app is only cosmetic. | `server/src/access.js`, `requireRole` in `auth.js` |
| **A02 Cryptographic failures** | Passwords hashed with bcrypt (cost 12; old hashes upgrade at the next sign-in). The SMTP password is encrypted with AES-256-GCM under its own `ENCRYPTION_KEY`. HTTPS is enforced with HSTS and `upgrade-insecure-requests`. Cookies are `Secure` in production. | `auth.js`, `crypto.js`, `app.js` |
| **A03 Injection** | Prisma parameterises every query. All input is checked against a schema (zod) before use. CSV exports neutralise spreadsheet formulas (`=`, `+`, `-`, `@`). | `validate.js`, `routes/reports.js` |
| **A04 Insecure design** | Payments are **never deleted**: they are voided or corrected, with a required reason. A database constraint makes double-booking a bed impossible. There must always be one active admin. Admins can't demote or remove themselves. | `paymentService.js`, `routes/tenancies.js`, `routes/admin.js` |
| **A05 Misconfiguration** | Content-Security-Policy, `frame-ancestors 'none'`, `nosniff` and `Referrer-Policy` are set, and `X-Powered-By` is off. The server **refuses to start** in production with a weak or missing `JWT_SECRET`, `ENCRYPTION_KEY` or `APP_URL`. JSON bodies are capped at 100 KB. | `app.js`, `config.js` |
| **A06 Vulnerable components** | `npm run audit`, plus weekly Dependabot pull requests. | `.github/dependabot.yml` |
| **A07 Authentication failures** | Account lockout and per-IP rate limits, NIST password rules, no account enumeration, single-use 30-minute reset links, and sessions revoked on password change (see below). | `routes/auth.js`, `loginThrottle.js`, `passwordPolicy.js` |
| **A08 Integrity failures** | Receipt numbers come from an atomic counter and are never reused. Receipt PDFs are stored once and never regenerated or altered; a void creates a separate stamped copy. | `receiptNumber.js`, `paymentService.js` |
| **A09 Logging & monitoring** | An **append-only audit log** records every change to money, people, properties and accounts, plus every sign-in, failed sign-in, lockout and password change. It stores who, when, IP, before and after, with secrets redacted. There is no API to edit or delete entries. Users get an email when their account is locked or their password changes. | `audit.js`, Admin → Audit log |
| **A10 SSRF** | The server makes no outbound requests based on user input, apart from SMTP to the configured host. | — |
| **CSRF** | `SameSite=Lax` cookies, **plus** an Origin/Referer check that rejects any state-changing request from another site. | `app.js` |

## Sign-in, lockout and password reset

**Login attempts:**
- After **5 failed attempts** for an email address, it is locked for **15 minutes**.
- Each further lockout doubles the time (30 minutes, 1 hour, and so on), up to **24 hours**.
- The level drops back to normal after 24 hours with no failures.
- While locked, even the correct password is refused.
- The super admin can unlock an account, and a password reset also clears the lock.

Before this release, the only limit was 20 attempts per 15 minutes per IP address. An attacker using several IP addresses could keep guessing indefinitely.

**Per IP address:** 10 failed attempts per 15 minutes, then **429 Too Many Requests**. Successful sign-ins don't count toward this limit.

**No account enumeration:**
- Lockout is tracked even for emails with no account, so it behaves the same either way.
- Unknown emails still go through a bcrypt comparison, so response time gives nothing away.
- *Forgot password* returns the same answer immediately and does its work in the background.

**Reset links:**
- Built **only** from `APP_URL`. Before this release they were built from the request's `Origin`/`Host` headers, which an attacker controls ("host-header poisoning"). That let an attacker send the real user a reset link pointing at the attacker's own site, capture the token, and take over the account.
- Valid for **30 minutes** and usable **once**: the token is tied to the current password hash.
- No longer written to the server log in production.

**Passwords:**
- At least **8 characters**, or **12** for admins.
- At most 72 bytes, which is bcrypt's limit.
- Common passwords and the user's own email are rejected.
- No forced symbol or number rules, as NIST recommends.

**Sessions:**
- End after **12 hours without activity**, and always after **7 days**.
- Every session is revoked when a user changes or resets their password, is deactivated, has their role changed, or chooses **"Sign out of all devices"**. This works through a `tokenVersion` counter on the user.
- The token algorithm is fixed to HS256.

**Temporary passwords:** new landlords, resets issued by the super admin and the seeded super admin all must choose their own password before the API lets them do anything else.

**Phone app:** the app signs in with a 15-minute access token and a 60-day refresh token (sent as `Authorization: Bearer`, kept in the phone's secure storage). They are not stored on the server; changing the password or "sign out everywhere" ends them. Signing out one lost phone on its own is not possible yet.

## Review of the original requirements against best practice

| # | Finding in the original code | Severity | Status |
| --- | --- | --- | --- |
| R1 | Reset link built from attacker-controlled `Origin`/`Host` headers, allowing account takeover | 🔴 | **Fixed** |
| R2 | Reset link written to the server log in production | 🔴 | **Fixed** (development only now) |
| R3 | Password change/reset did not end other sessions; a stolen cookie stayed valid for 30 days | 🔴 | **Fixed** |
| R4 | No per-account lockout; 20 tries per IP was easy to get around | 🔴 | **Fixed** |
| R5 | Response timing revealed which emails had accounts | 🟠 | **Fixed** |
| R6 | Payments could not be corrected, and there was no audit trail | 🟠 | **Fixed** (void/correct, audit log) |
| R7 | Two people could be assigned to the same bed at the same moment (race condition) | 🟠 | **Fixed** (unique `activeBedKey`) |
| R8 | Receipt year came from today's date, not the payment date; `datePaid` was not validated | 🟡 | **Fixed** |
| R9 | If the PDF build failed, the receipt was left without a PDF for good | 🟠 | **Fixed** (built on demand) |
| R10 | Inconsistent input validation | 🟡 | **Fixed** (zod schemas) |
| R11 | No arrears report; arrears could not be waived | 🟠 | **Fixed** |
| R12 | Month boundaries followed the server's timezone | 🟡 | **Fixed** (`TZ=Africa/Lusaka` default) |
| R13 | Dashboard ran one query per bed | 🟡 | **Fixed** (batched) |
| R14 | SMTP encryption key derived from `JWT_SECRET` | 🟡 | **Fixed** (`ENCRYPTION_KEY`, automatic re-encryption) |
| R15 | Content-Security-Policy disabled | 🟠 | **Fixed** |
| R16 | Default seed password never had to be changed | 🟠 | **Fixed** |
| R17 | Receipt preview showed the wrong balance when a month had several payments | 🟡 | **Fixed** (balance "as at" the receipt) |
| R18 | CSV exports could carry spreadsheet formulas from tenant names | 🟡 | **Fixed** |
| R19 | Tests ran against whatever `DATABASE_URL` pointed at, including production | 🟠 | **Fixed** (database tests need `TEST_DATABASE=1`) |

## Still to do

- **Upgrade `nodemailer` to v10.** `npm audit` reports high-severity advisories for v6, including possible email header injection and DoS through crafted addresses. It is a major-version change, so test sending receipts after upgrading.
- **Upgrade `react-router-dom` to v7.** There is a moderate open-redirect advisory. It is not exploitable here, because the app only navigates to fixed internal paths.
- **Two-factor sign-in (TOTP) for the super admin.** This is recommended for privileged accounts.
- **Shared rate-limit store** (for example Redis), but only if you ever run more than one server process. The limiter currently keeps counts in memory.
- **Encrypted, tested backups.** See [BACKUP.md](./BACKUP.md), and run a restore test regularly.

## Reporting a problem

If you find a security issue, tell the administrator privately. Don't post it publicly.
