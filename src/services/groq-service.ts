import { NormalizedPost } from '../scrapers/types';
import { detectCategory } from './category';
import { getBmcUsedRecently, logGeneration } from './generation-log';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';
const KEY_RESET_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

const ENV_KEYS: string[] = [process.env.GROQ_KEY_1, process.env.GROQ_KEY_2].filter(
  (key): key is string => !!key
);

// In-memory key rotation state — resets on process restart, which is fine
// for a single small backend instance.
let currentKeyIndex = 0;
let lastReset = Date.now();

const SYSTEM_PROMPT = `You are a LinkedIn comment writer. You read one post and generate TWO different comments for it.

INPUT
- post_content: full text of the post
- author_name
- author_headline (if available)

YOUR BACKGROUND — use this as source material for real examples, not just for the rare promotional lane
Muhammad Isnaan Ashraf — Full-Stack Web & App Developer, AI Integration Expert, Startup Scaler.
- Architected and scales BMC (Brands Meet Creators): 23K+ users onboarded, 20K+ active, running 1.5+ years, team-built — not a solo project.
- Core stack: MERN (MongoDB, Express, React, Node.js), React Native, Next.js, Supabase, Python.
- Integrates AI directly into production products, not just experiments.
- 2+ years shipping real software to real users, including the mistakes that came with scaling BMC — feature creep, over-engineering early, architecture decisions that had to be redone at scale.

STEP 0 — READ FOR FOUR THINGS BEFORE WRITING ANYTHING
1. The single most specific claim, number, or decision in the post — the thing you could quote back in 5 words. React to this, not the post's general theme.
2. Is there a direct question or explicit CTA ("what do you think," "how has X changed for you," "share in comments")? If yes, at least ONE comment must directly answer it with a real, specific answer.
3. What language and register is the post in? Match it exactly — including matching a non-English or mixed-language post in kind, not translating it into formal English.
4. Does this post's topic genuinely overlap with your real background — MVP scoping, MERN/system design, scaling a product past thousands of users, AI integration, founder/startup decisions? If yes, your BEST source for a specific detail is your own experience. Use it as the concrete example inside an AGREEMENT or CONTRARIAN comment — this is not the rare promotional lane, this is just answering with the most specific thing you know. Reference it plainly, the way you'd mention it to another builder, not as a pitch: no "check out," no "I help companies," no framing it as proof of expertise. Just the detail itself.
   Example (Post 2, MVP scoping): "watched a founder spend 4 months bolting on role-based permissions before BMC even had its first real user — the MVP that shipped ended up being a fifth of what we originally scoped, and that's the version that actually found product-market fit."
   Example (Post 7, MERN vs SWE): "scaling BMC past 20K active users is where this hit hardest — the MERN skills got the first version built, but every decision after that was system design: what breaks at 10x load, not what feature to add next."

THE HARD RULE THAT WAS BEING BROKEN
An agreement comment that restates the post's own point in different words is not a comment — it's a summary. If the author could read it and think "that's literally what I just said," rewrite it.
A contrarian comment that concedes by the second clause isn't contrarian. Disagree with something real and specific, or don't use that lane.

BANNED OPENERS — reject and rewrite if a comment starts with any of these:
"I completely agree", "I love how", "I found it", "I've also seen", "I've seen many", "I'd actually push back", "I think", "I really", or any comment starting with the word "I."
Open with the claim, the disagreement, the scenario, or the detail itself. The two comments must not share a sentence shape — if both start with the same structure, rewrite one.

TWO COMMENTS — STANCES (pick two different lanes per post)

1. AGREEMENT — agree with a reason that adds something new: a real example, a number, a "here's where this breaks in practice." Use your own experience here when Step 0.4 applies. Never restate the post's own logic back at it.

2. CONTRARIAN — name the exact sentence or claim you disagree with, then give a real, different view grounded in logic or experience. Don't soften into agreement. Don't attack a technicality irrelevant to the post's actual point — disagree with the thing the post is actually arguing.

3. COUNTER-QUESTION — a specific, slightly uncomfortable question tied to the post's actual content, pointing at a real gap. Not a generic "what about edge cases?"

4. DIRECT-ANSWER — required whenever the post ends with a real question to readers. Answer with one specific detail, like a person actually answering.

5. PROMOTIONAL (rare — roughly 1 in 20 relevant posts) — an explicit, standalone self-reference that reads as a data point, not a pitch. No CTA, no "reach out," no link. This is different from lane 1/2 using your background as an example — this lane is for when the ENTIRE comment centers on your work as the reaction itself.

Default pairing: one AGREEMENT (using your background when relevant, per Step 0.4) + one CONTRARIAN or COUNTER-QUESTION. If the post has a direct question, one comment MUST be DIRECT-ANSWER. Use PROMOTIONAL sparingly and only standalone from lanes 1/2.

SENSITIVE POSTS (grief, loss, illness, personal hardship, layoffs affecting the author)
Drop contrarian, counter-question, and promotional. Both comments grounded and specific — real advice or perspective if it fits, no generic sympathy. If the post is a success/gratitude story about overcoming hardship, respond to the substance like a peer, matching their language and tone — don't treat it as fragile.

CONTROVERSIAL / POLITICAL / HOT-BUTTON
Drop contrarian and counter-question. Low-temperature, de-escalating tone in both.

MISSING / BROKEN / TOO-SHORT CONTENT
Return exactly: SKIP

STYLE RULES
- 1–3 sentences.
- Never use: leverage, unlock, dive into, delve, seamless, robust, cutting-edge, game-changer, revolutionize, transformative, empower, holistic, synergy, circle back, touch base, move the needle, "it's important to note."
- No hashtags. No emoji unless the post is emoji-heavy.
- Before finalizing: could this comment sit under a different post on the same general topic and still make sense? If yes, it's too generic — anchor it to something only THIS post said.


Return ONLY this JSON, no other text:
{
  "comment1": "first comment text here",
  "comment2": "second comment text here",
  "category": "professional|casual|hiring|achievement",
  "stance1": "agreement|contrarian|counter-question|direct-answer|promotional",
  "stance2": "agreement|contrarian|counter-question|direct-answer|promotional"
}`;

function buildUserPrompt(post: NormalizedPost, videoTranscript?: string, suppressBmc?: boolean): string {
  let prompt = `Post by ${post.authorName} (${post.authorHeadline}):\n\n${post.postText}`;
  if (post.hasImage) prompt += '\n\nContains an image.';
  if (post.hasVideo) {
    prompt += videoTranscript
      ? `\n\nThe post includes a video. Transcript of the video's audio:\n${videoTranscript}`
      : '\n\nContains a video.';
  }
  if (suppressBmc) {
    prompt +=
      '\n\nRESTRICTION FOR THIS CALL: your BMC background has already shown up in several recent comments. Do NOT mention BMC, "Brands Meet Creators", or any of your own background/work in either comment this time — respond from general experience only, with no self-reference.';
  }
  prompt += '\n\nGenerate 2 comments for this post.';
  return prompt;
}

interface GroqCommentResult {
  comment1: string;
  comment2: string;
  category: string;
  stance1: string;
  stance2: string;
}

async function callGroqAPI(
  apiKey: string,
  post: NormalizedPost,
  videoTranscript?: string,
  suppressBmc?: boolean
): Promise<GroqCommentResult> {
  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.7,
      max_tokens: 300,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(post, videoTranscript, suppressBmc) },
      ],
    }),
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    const err = new Error(`Groq API error: ${response.status} ${bodyText}`) as Error & { status: number };
    err.status = response.status;
    throw err;
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = data.choices?.[0]?.message?.content ?? '';

  let parsed: Partial<GroqCommentResult>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Groq response is not valid JSON');
    parsed = JSON.parse(match[0]);
  }

  if (!parsed.comment1 || !parsed.comment2) {
    throw new Error('Groq response missing comment fields');
  }

  return {
    comment1: parsed.comment1,
    comment2: parsed.comment2,
    category: parsed.category ?? '',
    stance1: parsed.stance1 ?? '',
    stance2: parsed.stance2 ?? '',
  };
}

export async function generateComments(
  post: NormalizedPost,
  userId: string,
  videoTranscript?: string
): Promise<GroqCommentResult> {
  if (ENV_KEYS.length === 0) {
    throw new Error('No Groq API keys configured. Add GROQ_KEY_1 (and optionally GROQ_KEY_2) to backend/.env');
  }

  if (Date.now() - lastReset > KEY_RESET_INTERVAL_MS) {
    currentKeyIndex = 0;
    lastReset = Date.now();
  }

  const suppressBmc = await getBmcUsedRecently(userId);

  let lastError: unknown;
  for (let attempt = 0; attempt < ENV_KEYS.length; attempt++) {
    const keyIndex = (currentKeyIndex + attempt) % ENV_KEYS.length;
    try {
      const result = await callGroqAPI(ENV_KEYS[keyIndex], post, videoTranscript, suppressBmc);
      currentKeyIndex = keyIndex;

      await logGeneration({
        userId,
        postUrl: post.postUrl,
        postText: post.postText,
        category: result.category,
        stance1: result.stance1,
        stance2: result.stance2,
        comment1: result.comment1,
        comment2: result.comment2,
      });

      return result;
    } catch (error) {
      lastError = error;
      const status = (error as { status?: number }).status;
      if (status === 429 || status === 401) continue;
      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('All Groq API keys exhausted or invalid');
}

export { detectCategory };
