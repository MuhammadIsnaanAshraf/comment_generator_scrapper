import { Router } from 'express';
import { supabaseAuth, supabaseAdmin, isSupabaseConfigured } from '../lib/supabase';
import { requireAuth } from '../middleware/require-auth';

export const authRouter = Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

interface Credentials {
  email: string;
  password: string;
}

/**
 * Validates and normalizes { email, password } from a request body.
 * Returns an error string (client-safe) or the cleaned credentials.
 */
function parseCredentials(body: any): { error: string } | { creds: Credentials } {
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!EMAIL_PATTERN.test(email)) {
    return { error: 'Please provide a valid email address.' };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  return { creds: { email, password } };
}

/**
 * Shapes the Supabase session into exactly what the extension needs — never
 * leak internal fields. `expires_at` is a unix timestamp (seconds).
 */
function serializeSession(session: any) {
  if (!session) return null;
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
  };
}

function serializeUser(user: any) {
  if (!user) return null;
  return { id: user.id, email: user.email };
}

function guardConfigured(res: any): boolean {
  if (!isSupabaseConfigured) {
    res.status(503).json({ error: 'Authentication is not configured on the server.' });
    return false;
  }
  return true;
}

// --- POST /api/auth/signup -------------------------------------------------
authRouter.post('/signup', async (req, res) => {
  if (!guardConfigured(res)) return;

  const parsed = parseCredentials(req.body);
  if ('error' in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  try {
    const { data, error } = await supabaseAuth.auth.signUp({
      email: parsed.creds.email,
      password: parsed.creds.password,
    });

    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    // Email confirmation is disabled in Supabase, so signUp always returns a
    // session immediately. If it doesn't (e.g. confirmation got re-enabled),
    // surface that clearly instead of pretending signup succeeded.
    const session = serializeSession(data.session);
    if (!session) {
      res.status(500).json({ error: 'Signup succeeded but no session was returned. Check Supabase email confirmation settings.' });
      return;
    }

    res.status(201).json({
      user: serializeUser(data.user),
      session,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Signup failed.';
    res.status(500).json({ error: message });
  }
});

// --- POST /api/auth/login --------------------------------------------------
authRouter.post('/login', async (req, res) => {
  if (!guardConfigured(res)) return;

  const parsed = parseCredentials(req.body);
  if ('error' in parsed) {
    // Deliberately generic so we don't reveal which field was wrong.
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }

  try {
    const { data, error } = await supabaseAuth.auth.signInWithPassword({
      email: parsed.creds.email,
      password: parsed.creds.password,
    });

    if (error || !data.session) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    res.json({
      user: serializeUser(data.user),
      session: serializeSession(data.session),
    });
  } catch {
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// --- POST /api/auth/refresh ------------------------------------------------
authRouter.post('/refresh', async (req, res) => {
  if (!guardConfigured(res)) return;

  const refreshToken = typeof req.body?.refresh_token === 'string' ? req.body.refresh_token : '';
  if (!refreshToken) {
    res.status(400).json({ error: 'Missing refresh_token.' });
    return;
  }

  try {
    const { data, error } = await supabaseAuth.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) {
      res.status(401).json({ error: 'Session expired. Please log in again.' });
      return;
    }
    res.json({
      user: serializeUser(data.user),
      session: serializeSession(data.session),
    });
  } catch {
    res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
});

// --- POST /api/auth/logout -------------------------------------------------
// Token invalidation is best-effort: JWTs are stateless, so the client also
// discards them. With a service-role key we can additionally revoke the
// refresh token server-side.
authRouter.post('/logout', requireAuth, async (req, res) => {
  try {
    const token = (req.headers.authorization ?? '').split(' ')[1]?.trim();
    // admin.signOut revokes the session tied to this access token (and its
    // refresh token) so it can't be replayed after logout.
    if (supabaseAdmin && token) {
      await supabaseAdmin.auth.admin.signOut(token, 'global').catch(() => {});
    }
  } catch {
    // Non-fatal — the client clears its own tokens regardless.
  }
  res.json({ success: true });
});

// --- GET /api/auth/me ------------------------------------------------------
authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});
