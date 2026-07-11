import { createClient, SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

/**
 * Supabase clients live ONLY on the backend so the browser/extension never
 * sees any Supabase key.
 *
 *  - `supabaseAuth` uses the *anon* key and performs user-facing auth flows
 *    (signup, password login, token refresh). The anon key is safe to use
 *    server-side and is what Supabase's auth endpoints expect.
 *  - `supabaseAdmin` uses the *service-role* key. It is optional and only used
 *    for privileged operations (e.g. server-side logout / user lookup). It must
 *    NEVER be shipped to the client.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

if (!isSupabaseConfigured) {
  console.warn(
    '[backend] Supabase is not configured — set SUPABASE_URL and SUPABASE_ANON_KEY in .env. Auth endpoints will return 503 until you do.'
  );
}

// The backend is stateless per request: we pass tokens explicitly and never
// want the client to persist or auto-refresh a session of its own.
const authClientOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
  // supabase-js constructs a Realtime client eagerly, which needs a WebSocket.
  // Node < 22 has no native WebSocket, so provide `ws`. We never actually open
  // a realtime connection (auth-only), this just satisfies construction.
  realtime: { transport: WebSocket as unknown as any },
} as const;

export const supabaseAuth: SupabaseClient = createClient(
  SUPABASE_URL || 'http://localhost:54321',
  SUPABASE_ANON_KEY || 'anon-key-not-set',
  authClientOptions
);

export const supabaseAdmin: SupabaseClient | null = SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL || 'http://localhost:54321', SUPABASE_SERVICE_ROLE_KEY, authClientOptions)
  : null;
