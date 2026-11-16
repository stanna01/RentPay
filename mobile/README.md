# RentReceipt mobile app (Android + iPhone)

One codebase for Android and iPhone, built with **Expo (React Native) + TypeScript**.
It is the app for **students** (see and pay their bills), **sponsors** (see their students
per boarding house and pay in bulk or one at a time) and **landlords** (quick tasks:
today's numbers, checking bank slips). The super admin uses the web portal.

How it fits the wider platform is described in
[docs/PLATFORM_PLAN.md](../docs/PLATFORM_PLAN.md) (§12).

## Status: demo mode by default; landlords can already use the real server

By default the app runs on **realistic sample data held inside the app** (no server, no real
money). That lets you try every screen on a real phone and show it to landlords and sponsors
while the server work in the roadmap is built.

**Live mode works for landlords today:** a landlord signs in with their real account and
sees their real dashboard (collected, outstanding, beds occupied this month). Student and
sponsor accounts, and bank slips, do not exist on the server yet, so those screens only
work in demo mode. A landlord with a temporary password must first sign in on the website
to choose their own.

The app talks to the server through one interface (`src/api/types.ts` → `Api`):

| Mode | File | What it does |
| --- | --- | --- |
| `demo` (default) | `src/api/demo.ts` | In-memory sample world; resets when the app restarts |
| `live` | `src/api/http.ts` | Calls the server's `/api/v1` with bearer tokens and refresh (landlord sign-in and dashboard are built; the rest is the planned contract) |

Switching to live is a config change (below), not a rewrite.

## Run it on your phone

1. Install **Expo Go** from the Play Store / App Store. It must support **Expo SDK 58**.
2. On your computer:
   ```bash
   cd mobile
   npm install
   npx expo start
   ```
3. Scan the QR code: Android with Expo Go, iPhone with the Camera app. The phone and
   computer must be on the same Wi-Fi, otherwise use `npx expo start --tunnel`.

### Demo accounts (password `demo1234` — or tap the role on the sign-in screen)

| Role | Email | Try this |
| --- | --- | --- |
| Student | `student@rentreceipt.example` | Pay the balance by mobile money. It "succeeds" after ~6 seconds. A number ending in **0000** is declined, to see the failure screen. |
| Sponsor | `sponsor@rentreceipt.example` | **Select all due** at Kabulonga Court → pay by **bank transfer** and attach any photo as the slip. |
| Landlord | `landlord@rentreceipt.example` | Open **Bank slips** and approve the sponsor's slip. Sign back in as the sponsor: those students are now paid. |

The three accounts share one world, so actions by one show up for the others. Restarting
the app resets everything.

## Configuration

Copy `.env.example` to `.env.local` (git-ignored):

```env
EXPO_PUBLIC_API_MODE=live                      # demo (default) or live
EXPO_PUBLIC_API_URL=https://rent.yourdomain.com
```

To test live mode against the server on your own computer, start the server (`npm run dev`
in the project root) and set `EXPO_PUBLIC_API_URL` to the computer's Wi-Fi address, e.g.
`http://192.168.1.20:4000`. Restart `npx expo start` after changing it.

## Project layout

```
src/app/              screens (expo-router: the file path is the route)
  _layout.tsx         providers + which roles may open which screens (Stack.Protected)
  sign-in.tsx
  student/            Home · Bills · Receipts · Account (tabs)
  sponsor/            My students · Payments · Account
  landlord/           Dashboard · Bank slips · Account
  pay.tsx             pay for chosen bills (mobile money / card / bank slip)
  payment/[id].tsx    live payment status → receipt
src/api/              types (the API contract), demo and live implementations
src/auth/             sign-in state; tokens in the phone's secure storage
src/components/       shared UI (buttons, cards, rows, badges)
src/format.ts         money (integer ngwee → "K 1,500") and dates
src/theme.ts          brand colours (same as the web portal)
```

## Rules the app follows (and the server will enforce)

- **Money is integer ngwee.** The app never computes what someone owes; the server does.
- **No double payments:**
  - Every "Pay" tap carries an idempotency key, so a retry on a bad connection returns
    the same payment.
  - Money already on its way (a mobile-money prompt, a bank slip waiting for the landlord)
    shows as **pending** and can't be paid again.
- **One boarding house per payment:** each landlord is paid straight into their own account.
- **Card numbers never touch the app.** The provider's hosted page opens instead.
- **The result of a payment comes only from the server,** never from the card page's redirect.
- **Signing out** removes the previous person's screens and cached data.

## Checks

```bash
npm run typecheck      # TypeScript
npm run check:bundle   # builds the Android + iOS JavaScript bundles
npx expo-doctor        # dependency versions match the Expo SDK
```

## Before the first store release

- **Identifiers:** `app.json` uses placeholders (`com.example.rentreceipt`). Choose the
  real bundle ID / package name **before the first upload**; it cannot change afterwards.
- **Artwork:** replace the template app icon and splash image in `assets/images/` with the
  RentReceipt artwork.
- **Store accounts:** a Google Play developer account and an Apple Developer Program
  membership, in the business's name.
- **Builds:** EAS Build/Submit (`npx eas build`) builds both apps in the cloud (no Mac needed).
- **Store forms:** a privacy policy URL, the stores' data-safety/privacy forms, and test
  accounts for the reviewers.
