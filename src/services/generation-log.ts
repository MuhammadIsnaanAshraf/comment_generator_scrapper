import { supabaseAdmin } from '../lib/supabase';

// Access pattern: last 10 rows for the user (indexed on user_id, created_at
// desc — see migrations/0001_generation_log.sql), threshold checked over the
// most recent 8 of those.
const LOOKBACK_ROWS = 10;
const RECENT_WINDOW = 8;
const BMC_THRESHOLD = 3;

const BMC_MENTION_PATTERN = /\bBMC\b|Brands\s+Meet\s+Creators/i;

let warnedNotConfigured = false;
function warnOnceIfNotConfigured(): void {
  if (supabaseAdmin || warnedNotConfigured) return;
  warnedNotConfigured = true;
  console.warn(
    '[backend] SUPABASE_SERVICE_ROLE_KEY is not set — generation_log tracking (bmc_used_recently) is disabled.'
  );
}

export interface GenerationLogEntry {
  userId: string;
  postUrl: string;
  postText: string;
  category: string;
  stance1: string;
  stance2: string;
  comment1: string;
  comment2: string;
}

export function containsBmcMention(text: string): boolean {
  return BMC_MENTION_PATTERN.test(text);
}

/**
 * True if BMC background was used in >= BMC_THRESHOLD of the user's last
 * RECENT_WINDOW generations — signals the prompt should suppress it this call.
 */
export async function getBmcUsedRecently(userId: string): Promise<boolean> {
  warnOnceIfNotConfigured();
  if (!supabaseAdmin) return false;

  const { data, error } = await supabaseAdmin
    .from('generation_log')
    .select('bmc_used')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(LOOKBACK_ROWS);

  if (error) {
    console.warn('[backend] generation_log lookup failed, defaulting bmc_used_recently=false:', error.message);
    return false;
  }

  const recentWindow = (data ?? []).slice(0, RECENT_WINDOW);
  const bmcCount = recentWindow.reduce((count, row) => count + (row.bmc_used ? 1 : 0), 0);
  return bmcCount >= BMC_THRESHOLD;
}

export async function logGeneration(entry: GenerationLogEntry): Promise<void> {
  warnOnceIfNotConfigured();
  if (!supabaseAdmin) return;

  const bmcUsed = containsBmcMention(`${entry.comment1}\n${entry.comment2}`);

  const { error } = await supabaseAdmin.from('generation_log').insert({
    user_id: entry.userId,
    post_url: entry.postUrl,
    post_text: entry.postText,
    category: entry.category,
    stance_1: entry.stance1,
    stance_2: entry.stance2,
    comment_1: entry.comment1,
    comment_2: entry.comment2,
    bmc_used: bmcUsed,
  });

  if (error) {
    console.warn('[backend] failed to write generation_log:', error.message);
  }
}
