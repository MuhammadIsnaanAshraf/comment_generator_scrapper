import { supabaseAdmin } from '../lib/supabase';

// Access pattern: last 10 rows for the user (indexed on user_id, created_at
// desc), threshold checked over the most recent 8 of those.
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
  postUrl: string | null;
  postId: string | null;
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
 * RECENT_WINDOW *used* generations — signals the prompt should suppress it.
 *
 * Only rows with a non-null used_comment count. Every panel open and every
 * "Regenerate" writes a row, so counting all of them would measure posts the
 * user merely glanced at rather than comments they actually posted, and would
 * trip suppression spuriously.
 */
export async function getBmcUsedRecently(userId: string): Promise<boolean> {
  warnOnceIfNotConfigured();
  if (!supabaseAdmin) return false;

  const { data, error } = await supabaseAdmin
    .from('generation_log')
    .select('bmc_used')
    .eq('user_id', userId)
    .not('used_comment', 'is', null)
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

// Only the columns a feedback PATCH is allowed to touch. Every field is
// optional so the caller can send just what changed (a thumbs click sends
// one liked flag; "Use this" sends usedComment/finalPostedText) instead of
// re-sending the whole row.
export interface GenerationFeedbackUpdate {
  comment1Liked?: boolean | null;
  comment2Liked?: boolean | null;
  comment1FeedbackText?: string | null;
  comment2FeedbackText?: string | null;
  usedComment?: '1' | '2' | 'edited' | null;
  finalPostedText?: string | null;
}

const FEEDBACK_FIELD_TO_COLUMN: Record<keyof GenerationFeedbackUpdate, string> = {
  comment1Liked: 'comment_1_liked',
  comment2Liked: 'comment_2_liked',
  comment1FeedbackText: 'comment_1_feedback_text',
  comment2FeedbackText: 'comment_2_feedback_text',
  usedComment: 'used_comment',
  finalPostedText: 'final_posted_text',
};

/**
 * Applies a partial feedback update to one generation_log row, scoped to the
 * owning user so one user can never patch another's row even though this
 * runs on the service-role client (which bypasses RLS).
 *
 * Returns 'ok', 'not_found' (bad id / not this user's row), or 'disabled'
 * (no service-role key configured) so the route can pick the right status
 * code without this function knowing about HTTP.
 */
export async function updateGenerationFeedback(
  userId: string,
  generationId: string,
  update: GenerationFeedbackUpdate
): Promise<'ok' | 'not_found' | 'disabled'> {
  warnOnceIfNotConfigured();
  if (!supabaseAdmin) return 'disabled';

  const columns: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(update)) {
    if (value !== undefined) columns[FEEDBACK_FIELD_TO_COLUMN[field as keyof GenerationFeedbackUpdate]] = value;
  }
  if (Object.keys(columns).length === 0) return 'ok';

  const { data, error } = await supabaseAdmin
    .from('generation_log')
    .update(columns)
    .eq('id', generationId)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle();

  if (error) {
    console.warn('[backend] failed to update generation_log feedback:', error.message);
    return 'not_found';
  }

  return data ? 'ok' : 'not_found';
}

export async function logGeneration(entry: GenerationLogEntry): Promise<string | null> {
  warnOnceIfNotConfigured();
  if (!supabaseAdmin) return null;

  const bmcUsed = containsBmcMention(`${entry.comment1}\n${entry.comment2}`);

  const { data, error } = await supabaseAdmin.from('generation_log').insert({
    user_id: entry.userId,
    post_url: entry.postUrl,
    post_id: entry.postId,
    post_text: entry.postText,
    category: entry.category,
    stance_1: entry.stance1,
    stance_2: entry.stance2,
    comment_1: entry.comment1,
    comment_2: entry.comment2,
    bmc_used: bmcUsed,
  }).select('id').single();

  if (error) {
    console.warn('[backend] failed to write generation_log:', error.message);
    return null;
  }

  return data?.id ?? null;
}
