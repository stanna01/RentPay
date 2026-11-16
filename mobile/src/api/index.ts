// Picks the API the app talks to:
//   EXPO_PUBLIC_API_MODE=demo (default) → in-memory sample data (demo.ts)
//   EXPO_PUBLIC_API_MODE=live           → the server at EXPO_PUBLIC_API_URL (http.ts)

import { demoApi } from './demo';
import { httpApi } from './http';
import type { Api } from './types';

export const API_MODE: 'demo' | 'live' = process.env.EXPO_PUBLIC_API_MODE === 'live' ? 'live' : 'demo';

export const api: Api = API_MODE === 'live' ? httpApi : demoApi;

export * from './types';
