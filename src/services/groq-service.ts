import { NormalizedPost } from '../scrapers/types';
import { detectCategory } from './category';

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

const SYSTEM_PROMPT = `You are a LinkedIn engagement expert. Generate exactly 2 distinct, human-sounding comments for the LinkedIn post provided.

Rules:
- Each comment must be 1-3 sentences maximum
- Sound like a real professional wrote it, not AI
- Be specific to the post content, not generic
- No filler phrases like "Great post!", "Thanks for sharing!", "This is so insightful!"
- Match tone: professional posts → professional tone, casual → conversational
- For hiring posts: write from a job-seeker or supportive colleague perspective
- For achievements: congratulate specifically, mention what impressed you
- Never start both comments the same way
- Never use hashtags in comments

Return ONLY this JSON, no other text:
{
  "comment1": "first comment text here",
  "comment2": "second comment text here",
  "category": "professional|casual|hiring|achievement"
}`;

function buildUserPrompt(post: NormalizedPost): string {
  let prompt = `Post by ${post.authorName} (${post.authorHeadline}):\n\n${post.postText}`;
  if (post.hasImage) prompt += '\n\nContains an image.';
  if (post.hasVideo) prompt += '\n\nContains a video.';
  prompt += '\n\nGenerate 2 comments for this post.';
  return prompt;
}

async function callGroqAPI(
  apiKey: string,
  post: NormalizedPost
): Promise<{ comment1: string; comment2: string; category: string }> {
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
        { role: 'user', content: buildUserPrompt(post) },
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

  let parsed: { comment1: string; comment2: string; category: string };
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

  return parsed;
}

export async function generateComments(
  post: NormalizedPost
): Promise<{ comment1: string; comment2: string; category: string }> {
  if (ENV_KEYS.length === 0) {
    throw new Error('No Groq API keys configured. Add GROQ_KEY_1 (and optionally GROQ_KEY_2) to backend/.env');
  }

  if (Date.now() - lastReset > KEY_RESET_INTERVAL_MS) {
    currentKeyIndex = 0;
    lastReset = Date.now();
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < ENV_KEYS.length; attempt++) {
    const keyIndex = (currentKeyIndex + attempt) % ENV_KEYS.length;
    console.log("🚀 ~ generateComments ~ keyIndex:", keyIndex)
    try {
      const result = await callGroqAPI(ENV_KEYS[keyIndex], post);
      currentKeyIndex = keyIndex;
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
