import { Request, Response, NextFunction } from 'express';
import { supabaseAuth, isSupabaseConfigured } from '../lib/supabase';

/**
 * The authenticated user, attached to the request by `requireAuth`.
 */
export interface AuthedUser {
  id: string;
  email: string | undefined;
}

// Augment Express's Request so downstream handlers get `req.user` typed.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

/**
 * Protects a route by requiring a valid Supabase access token.
 *
 * The token is verified against Supabase on every request (`auth.getUser`),
 * so a revoked/expired token is rejected — we never trust the token blindly.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!isSupabaseConfigured) {
    res.status(503).json({ error: 'Authentication is not configured on the server.' });
    return;
  }

  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Missing or malformed Authorization header.' });
    return;
  }

  try {
    const { data, error } = await supabaseAuth.auth.getUser(token);
    if (error || !data?.user) {
      res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
      return;
    }
    req.user = { id: data.user.id, email: data.user.email };
    next();
  } catch {
    res.status(401).json({ error: 'Could not verify session.' });
  }
}
