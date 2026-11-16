// Live mode: talks to the RentReceipt server's /api/v1 (docs/PLATFORM_PLAN.md §11).
//
// NOTE: these endpoints are the PLANNED contract. The server builds them in
// phases 1–5 of the roadmap; until then run the app in demo mode (the default).
//
// Auth: a short-lived access token is sent as a Bearer header. When it expires
// the client swaps the refresh token for new ones once (shared by concurrent
// requests) and retries. New tokens are reported via onTokensChanged so the
// app can store them securely.

import Constants from 'expo-constants';

import {
  ApiError,
  type Api,
  type AuthTokens,
  type ChargeShare,
  type LandlordDashboard,
  type Me,
  type Payment,
  type SponsoredStudent,
  type StudentHome,
  type TransferDetails,
  type TransferToVerify,
} from './types';

const BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, '');
const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';

let tokens: AuthTokens | null = null;
let tokenListener: (t: AuthTokens | null) => void = () => {};
let refreshing: Promise<boolean> | null = null;

interface RequestOptions {
  body?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
  auth?: boolean;
}

async function send(method: string, path: string, opts: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-App-Version': APP_VERSION,
    ...opts.headers,
  };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.auth !== false && tokens) headers.Authorization = `Bearer ${tokens.accessToken}`;
  try {
    return await fetch(`${BASE_URL}/api/v1${path}`, {
      method,
      headers,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Please check your internet connection and try again.");
  }
}

async function refreshTokens(): Promise<boolean> {
  if (!tokens) return false;
  refreshing ??= (async () => {
    try {
      const res = await send('POST', '/auth/refresh', { body: { refreshToken: tokens!.refreshToken }, auth: false });
      if (!res.ok) return false;
      tokens = (await res.json()) as AuthTokens;
      tokenListener(tokens);
      return true;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  let res = await send(method, path, opts);
  if (res.status === 401 && opts.auth !== false && (await refreshTokens())) {
    res = await send(method, path, opts);
  }
  if (res.status === 401 && opts.auth !== false) {
    tokens = null;
    tokenListener(null);
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as { error?: { message?: string; code?: string } } | null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.message ?? 'Something went wrong. Please try again.', data?.error?.code);
  }
  return data as T;
}

export const httpApi: Api = {
  async signIn(email, password) {
    const result = await request<{ tokens: AuthTokens; me: Me }>('POST', '/auth/login', {
      body: { email, password, client: 'mobile', deviceName: Constants.deviceName ?? 'Phone' },
      auth: false,
    });
    tokens = result.tokens;
    return result;
  },

  async signOut() {
    if (!tokens) return;
    await request('POST', '/auth/logout', { body: { refreshToken: tokens.refreshToken } }).catch(() => {});
    tokens = null;
  },

  setSession(next) {
    tokens = next;
  },

  onTokensChanged(listener) {
    tokenListener = listener;
  },

  me: () => request<Me>('GET', '/me'),

  studentHome: () => request<StudentHome>('GET', '/student/home'),
  myCharges: () => request<ChargeShare[]>('GET', '/student/charges'),
  payments: () => request<Payment[]>('GET', '/payments?mine=1'),
  receiptUrl: async (paymentId) =>
    (await request<{ url: string | null }>('GET', `/payments/${encodeURIComponent(paymentId)}/receipt-link`)).url,

  sponsoredStudents: () => request<SponsoredStudent[]>('GET', '/sponsor/students'),
  sponsorDueShares: (residentIds) =>
    request<ChargeShare[]>('GET', `/sponsor/charges?due=1&residentIds=${residentIds.map(encodeURIComponent).join(',')}`),

  transferDetails: (shareIds) =>
    request<TransferDetails>('GET', `/payments/transfer-details?shareIds=${shareIds.map(encodeURIComponent).join(',')}`),

  async startPayment(input, idempotencyKey) {
    const headers = { 'Idempotency-Key': idempotencyKey };
    if (!input.proof) return request<Payment>('POST', '/payments', { body: input, headers });
    // Bank slips go up as multipart form data alongside the payment details.
    const { proof, ...fields } = input;
    const form = new FormData();
    form.append('payment', JSON.stringify(fields));
    form.append('proof', { uri: proof.uri, name: proof.name, type: proof.mimeType ?? 'application/octet-stream' } as unknown as Blob);
    return request<Payment>('POST', '/payments', { form, headers });
  },

  getPayment: (id) => request<Payment>('GET', `/payments/${encodeURIComponent(id)}`),

  landlordDashboard: () => request<LandlordDashboard>('GET', '/landlord/dashboard'),
  transfersToVerify: () => request<TransferToVerify[]>('GET', '/landlord/transfers?status=AWAITING_VERIFICATION'),
  async reviewTransfer(paymentId, approve, reason) {
    const action = approve ? 'approve' : 'reject';
    await request('POST', `/landlord/transfers/${encodeURIComponent(paymentId)}/${action}`, { body: { reason } });
  },
};
