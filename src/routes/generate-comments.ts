import { Router, Response } from 'express';
import { getScraper } from '../scrapers';
import { getTranscriber } from '../transcription';
import { generateComments } from '../services/groq-service';
import { detectCategory } from '../services/category';
import { requireAuth } from '../middleware/require-auth';
import { getUserProfile } from '../services/user-profile';
import { NormalizedPost } from '../scrapers/types';
import { GenerationFeedbackUpdate, updateGenerationFeedback } from '../services/generation-log';

export const generateCommentsRouter = Router();

const LINKEDIN_POST_URL_PATTERN = /^https:\/\/(www\.)?linkedin\.com\/(posts|feed\/update)\//i;

// The DOM extractor frequently returns empty text on LinkedIn's current markup
// (it still matches legacy class names), and findNearestPost can latch onto the
// wrong sibling. Rejecting too-short text keeps unusable rows out of
// generation_log rather than logging a garbage generation.
const MIN_POST_TEXT_LENGTH = 30;

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Shared tail for both routes: fetch the user's profile, generate, respond.
 */
async function respondWithGeneratedComments(
  res: Response,
  post: NormalizedPost,
  userId: string,
  videoTranscript?: string
): Promise<void> {
  const profile = await getUserProfile(userId);
  const result = await generateComments(post, userId, profile, videoTranscript);

  res.json({
    generationId: result.generationId,
    post,
    videoTranscript,
    comment1: result.comment1,
    comment2: result.comment2,
    category: result.category || detectCategory(post.postText),
  });
}

// --- POST /api/generate-comments -------------------------------------------
// Scrapes a pasted LinkedIn post URL (used by the extension popup).
generateCommentsRouter.post('/generate-comments', requireAuth, async (req, res) => {
  const { url } = req.body ?? {};

  if (typeof url !== 'string' || !LINKEDIN_POST_URL_PATTERN.test(url)) {
    res.status(400).json({ error: 'Provide a valid LinkedIn post URL (linkedin.com/posts/... or linkedin.com/feed/update/...).' });
    return;
  }

  try {
    const post = await getScraper().scrapePost(url);

    let videoTranscript: string | undefined;
    if (post.hasVideo && post.videoUrl) {
      try {
        videoTranscript = await getTranscriber().transcribeFromUrl(post.videoUrl);
      } catch (err) {
        // Don't fail the whole request over a transcription hiccup — fall
        // back to whatever caption text the post has.
        console.warn('[backend] video transcription failed, continuing without it:', err);
      }
    }

    // A video-only post with no caption can still be processed once we have
    // its transcript; only reject if there's truly no text to work with.
    if (!post.postText.trim() && !videoTranscript) {
      res.status(422).json({ error: 'Could not find any text content on this post.', post });
      return;
    }

    await respondWithGeneratedComments(res, post, req.user!.id, videoTranscript);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(502).json({ error: message });
  }
});

// --- POST /api/generate-comments/from-content -------------------------------
// The on-feed content script already has the post scraped out of the DOM, so it
// skips the scraper entirely and posts the extracted fields directly.
generateCommentsRouter.post('/generate-comments/from-content', requireAuth, async (req, res) => {
  const body = req.body ?? {};
  const postText = readString(body.postText);

  if (postText.length < MIN_POST_TEXT_LENGTH) {
    // Distinct code so the extension can say "couldn't read this post" rather
    // than blaming the API key.
    res.status(422).json({
      error: 'Could not read enough text from this post to generate comments.',
      code: 'POST_TEXT_TOO_SHORT',
    });
    return;
  }

  const postId = readString(body.postId);

  const post: NormalizedPost = {
    postId,
    // The DOM gives us a URN, not a URL. Rebuild the canonical permalink when
    // the id is an activity URN; otherwise there's no meaningful URL to store.
    postUrl: postId.startsWith('urn:li:activity:')
      ? `https://www.linkedin.com/feed/update/${postId}/`
      : '',
    authorName: readString(body.authorName) || 'Unknown',
    authorHeadline: readString(body.authorHeadline),
    postText,
    hasImage: Boolean(body.hasImage),
    hasVideo: Boolean(body.hasVideo),
    imageUrls: [],
    likes: 0,
    comments: 0,
    shares: 0,
  };

  try {
    await respondWithGeneratedComments(res, post, req.user!.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(502).json({ error: message });
  }
});

const USED_COMMENT_VALUES = new Set(['1', '2', 'edited']);

// undefined -> "field omitted, leave column untouched"; null -> "clear it"
// (e.g. un-clicking a thumb). Rejects anything that isn't already one of
// those three shapes rather than silently coercing it.
function readOptionalTriState<T>(
  value: unknown,
  isValid: (v: unknown) => v is T
): { ok: true; value: T | null | undefined } | { ok: false } {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null) return { ok: true, value: null };
  if (isValid(value)) return { ok: true, value };
  return { ok: false };
}

// --- PATCH /api/generate-comments/:id/feedback ------------------------------
// Records the user's reaction to a generation: thumbs up/down (+ optional
// note) per suggestion, and/or which one they actually used. Sent
// incrementally — a thumbs click and a "Use this" click each PATCH only the
// fields that changed, never the whole row.
generateCommentsRouter.patch('/generate-comments/:id/feedback', requireAuth, async (req, res) => {
  const body = req.body ?? {};
  const update: GenerationFeedbackUpdate = {};

  const liked1 = readOptionalTriState<boolean>(body.comment1Liked, (v): v is boolean => typeof v === 'boolean');
  const liked2 = readOptionalTriState<boolean>(body.comment2Liked, (v): v is boolean => typeof v === 'boolean');
  const text1 = readOptionalTriState<string>(body.comment1FeedbackText, (v): v is string => typeof v === 'string');
  const text2 = readOptionalTriState<string>(body.comment2FeedbackText, (v): v is string => typeof v === 'string');
  const used = readOptionalTriState<string>(body.usedComment, (v): v is string => typeof v === 'string' && USED_COMMENT_VALUES.has(v));
  const finalText = readOptionalTriState<string>(body.finalPostedText, (v): v is string => typeof v === 'string');

  if (!liked1.ok || !liked2.ok || !text1.ok || !text2.ok || !used.ok || !finalText.ok) {
    res.status(400).json({ error: 'Invalid feedback payload.' });
    return;
  }

  update.comment1Liked = liked1.value;
  update.comment2Liked = liked2.value;
  update.comment1FeedbackText = text1.value;
  update.comment2FeedbackText = text2.value;
  update.usedComment = used.value as GenerationFeedbackUpdate['usedComment'];
  update.finalPostedText = finalText.value;

  const result = await updateGenerationFeedback(req.user!.id, req.params.id, update);

  if (result === 'disabled') {
    // Not a real failure — Supabase just isn't configured in this
    // environment. Say so without a 5xx so the extension doesn't retry.
    res.json({ ok: false, reason: 'feedback_storage_disabled' });
    return;
  }
  if (result === 'not_found') {
    res.status(404).json({ error: 'Generation not found.' });
    return;
  }
  res.json({ ok: true });
});
