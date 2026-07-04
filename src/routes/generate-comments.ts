import { Router } from 'express';
import { getScraper } from '../scrapers';
import { generateComments } from '../services/groq-service';
import { detectCategory } from '../services/category';

export const generateCommentsRouter = Router();

const LINKEDIN_POST_URL_PATTERN = /^https:\/\/(www\.)?linkedin\.com\/(posts|feed\/update)\//i;

generateCommentsRouter.post('/generate-comments', async (req, res) => {
  const { url } = req.body ?? {};
  console.log("🚀 ~ url:", url)

  if (typeof url !== 'string' || !LINKEDIN_POST_URL_PATTERN.test(url)) {
    res.status(400).json({ error: 'Provide a valid LinkedIn post URL (linkedin.com/posts/... or linkedin.com/feed/update/...).' });
    return;
  }

  try {
    const post = await getScraper().scrapePost(url);
    console.log("🚀 ~ post scrapped:", post)

    // Only textual posts are supported for now — image/video posts are a
    // follow-up. Revisit this guard when that support is added.
    // if (post.hasImage || post.hasVideo) {
    //   res.status(422).json({
    //     error: 'This post contains an image or video. Only text posts are supported right now.',
    //     post,
    //   });
    //   return;
    // }

    if (!post.postText.trim()) {
      res.status(422).json({ error: 'Could not find any text content on this post.', post });
      return;
    }

    const result = await generateComments(post);
    console.log("🚀 ~ result:", result)
    const category = result.category || detectCategory(post.postText);

    res.json({
      post,
      comment1: result.comment1,
      comment2: result.comment2,
      category,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(502).json({ error: message });
  }
});
