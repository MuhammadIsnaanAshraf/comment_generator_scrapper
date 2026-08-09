import { supabaseAdmin } from '../lib/supabase';

export interface UserBackground {
  stack: string[];
  keyStats: string[];
  lessons: string[];
}

export interface UserProfile {
  userId: string;
  name: string;
  headline: string;
  background: UserBackground;
  tonePreferences: Record<string, unknown> | null;
}

// Preserves current behavior for users who don't have a user_profiles row
// yet (e.g. before they've filled in a profile, or if Supabase admin access
// isn't configured).
const DEFAULT_PROFILE: Omit<UserProfile, 'userId'> = {
  name: 'Muhammad Isnaan Ashraf',
  headline: 'Full-Stack Web & App Developer, AI Integration Expert, Startup Scaler',
  background: {
    stack: ['MERN (MongoDB, Express, React, Node.js)', 'React Native', 'Next.js', 'Supabase', 'Python'],
    keyStats: [
      'Architected and scales BMC (Brands Meet Creators): 23K+ users onboarded, 20K+ active, running 1.5+ years, team-built — not a solo project.',
      'Integrates AI directly into production products, not just experiments.',
    ],
    lessons: [
      '2+ years shipping real software to real users, including the mistakes that came with scaling BMC — feature creep, over-engineering early, architecture decisions that had to be redone at scale.',
    ],
  },
  tonePreferences: null,
};

let warnedNotConfigured = false;
function warnOnceIfNotConfigured(): void {
  if (supabaseAdmin || warnedNotConfigured) return;
  warnedNotConfigured = true;
  console.warn(
    '[backend] SUPABASE_SERVICE_ROLE_KEY is not set — user_profiles lookup is disabled, falling back to the default profile.'
  );
}

interface UserProfileRow {
  name: string | null;
  headline: string | null;
  background_json: Partial<Record<'stack' | 'keyStats' | 'lessons', string[]>> | null;
  tone_preferences: Record<string, unknown> | null;
}

export async function getUserProfile(userId: string): Promise<UserProfile> {
  warnOnceIfNotConfigured();
  if (!supabaseAdmin) return { userId, ...DEFAULT_PROFILE };

  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .select('name, headline, background_json, tone_preferences')
    .eq('user_id', userId)
    .maybeSingle<UserProfileRow>();

  if (error) {
    console.warn('[backend] user_profiles lookup failed, falling back to default profile:', error.message);
    return { userId, ...DEFAULT_PROFILE };
  }

  if (!data) {
    return { userId, ...DEFAULT_PROFILE };
  }

  const background = data.background_json ?? {};

  return {
    userId,
    name: data.name ?? DEFAULT_PROFILE.name,
    headline: data.headline ?? DEFAULT_PROFILE.headline,
    background: {
      stack: background.stack ?? DEFAULT_PROFILE.background.stack,
      keyStats: background.keyStats ?? DEFAULT_PROFILE.background.keyStats,
      lessons: background.lessons ?? DEFAULT_PROFILE.background.lessons,
    },
    tonePreferences: data.tone_preferences ?? null,
  };
}
