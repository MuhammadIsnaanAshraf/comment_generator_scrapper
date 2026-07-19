import { Router } from 'express';
import { getScraper } from '../scrapers';
import { getTranscriber } from '../transcription';
import { generateComments } from '../services/groq-service';
import { detectCategory } from '../services/category';
import { requireAuth } from '../middleware/require-auth';

export const generateCommentsRouter = Router();

const LINKEDIN_POST_URL_PATTERN = /^https:\/\/(www\.)?linkedin\.com\/(posts|feed\/update)\//i;

generateCommentsRouter.post('/generate-comments', requireAuth, async (req, res) => {
  const { url } = req.body ?? {};
  console.log("🚀 ~ url:", url)

  if (typeof url !== 'string' || !LINKEDIN_POST_URL_PATTERN.test(url)) {
    res.status(400).json({ error: 'Provide a valid LinkedIn post URL (linkedin.com/posts/... or linkedin.com/feed/update/...).' });
    return;
  }

  try {
    const post = await getScraper().scrapePost(url);
    console.log("🚀 ~ post scrapped:", post)

    let videoTranscript: string | undefined;
    if (post.hasVideo && post.videoUrl) {
      try {
        videoTranscript = await getTranscriber().transcribeFromUrl(post.videoUrl);
        console.log("🚀 ~ videoTranscript:", videoTranscript)
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

    const result = await generateComments(post, req.user!.id, videoTranscript);
    console.log("🚀 ~ result:", result)
    const category = result.category || detectCategory(post.postText);

    res.json({
      post,
      videoTranscript,
      comment1: result.comment1,
      comment2: result.comment2,
      category,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(502).json({ error: message });
  }
});
