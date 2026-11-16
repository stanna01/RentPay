# SETUP — Local development

This guide takes you from a fresh clone to a running RentReceipt app on your own
computer.

## 1. Prerequisites

- **Node.js 20 or newer** (this project was built with Node 24). Check with:
  ```bash
  node --version
  ```
- **npm 10+** (ships with Node).
- A **MySQL 8 database**. You don't need to install one locally — use a free/managed
  cloud MySQL (e.g. **Railway** or **Aiven**) and copy its connection string. The
  same database can serve both local development and production.

## 2. Install

From the project root:

```bash
npm install
```

This installs both the `server` and `client` workspaces and automatically
generates the Prisma database client (`postinstall`).

## 3. Configure environment

Copy the example environment file and edit it:

```bash
cp .env.example server/.env
```

Open `server/.env` and set at least:

| Variable            | What it is                                                        |
| ------------------- | ----------------------------------------------------------------- |
| `DATABASE_URL`      | Your MySQL connection string: `mysql://user:pass@host:3306/db`.  |
| `JWT_SECRET`        | Any long random string. Generate one: `openssl rand -base64 48`. |
| `ADMIN_EMAIL`       | The super admin account the seed creates.                         |
| `ADMIN_PASSWORD`    | A temporary password (12+ chars); you must change it at first sign-in. |
| `ENCRYPTION_KEY`    | A separate secret that encrypts the stored SMTP password.         |

Email (`SMTP_*`) can be left blank for now — see
[EMAIL_SETUP.md](./EMAIL_SETUP.md) when you're ready to send receipts.

## 4. Create the database + seed data

```bash
npm run db:migrate     # creates the MySQL tables
npm run db:seed        # creates the super admin (clean start); add landlords in the app
```

`db:seed` creates:
- your landlord login (from `.env`),
- **24 rooms (48 beds, A/B per room)**,
- and nothing else — a clean database ready for real tenants.

> Want sample data for testing? Seed with demo tenants/payments/receipts:
> ```bash
> SEED_DEMO=1 npm run db:seed
> ```
> Never use `SEED_DEMO=1` against a production database.

> **Reset everything** (drops the DB, re-migrates, re-seeds):
> ```bash
> npm run db:reset
> ```

## 5. Run the dev servers

```bash
npm run dev
```

This starts:
- the **backend API** on <http://localhost:4000>
- the **frontend** (Vite) on <http://localhost:5173>

Open <http://localhost:5173> and log in with the email/password from your `.env`.

The frontend proxies all `/api` calls to the backend, so logins and cookies work
same-origin during development.

## 6. Run the tests

```bash
npm test
```

This runs the business-logic and security tests: month status, payment
allocation, ledger (voids, waivers), money / amount-in-words, password rules,
login-lockout timing and encryption. It never touches a database.

The **database tests** (receipt numbering under concurrency, plus the API suite:
roles, property isolation, lockout, sessions, password reset, void/correct,
arrears, CSRF) write data, so they only run when you opt in. Point
`DATABASE_URL` at a **throwaway** MySQL database — never production — then:

```bash
cd server
npx prisma migrate deploy
TEST_DATABASE=1 npm test
```

## Project layout

```
server/    Express API + Prisma + PDF + email  (see src/)
client/    React + Vite PWA                     (see src/pages/)
docs/      These guides
```

## Resetting a forgotten password

If a user is locked out, use the built-in **Forgot password?** link on the
login screen (needs email configured — see [EMAIL_SETUP.md](./EMAIL_SETUP.md)),
or have the super admin set a temporary password (Landlords → Reset password).

The guaranteed, email-free recovery is the command-line reset:

```bash
npm run set-password -- admin@example.com "a-new-password"
```

It also clears any sign-in lockout and signs out all sessions. In **development
only**, the reset link from "Forgot password?" is printed to the server log; in
production it never is (anyone with log access could take over the account).

## Common issues

- **"Please log in" loops** — make sure you ran `db:seed` so the super admin account
  exists, and that you're using the email/password from `server/.env`.
- **Port already in use** — change `PORT` in `server/.env` (backend) or the
  `server.port` in `client/vite.config.js` (frontend).
- **Prisma client errors after schema changes** — run
  `npm run prisma:generate --workspace server`.
