import { NormalizedPost, ScraperProvider } from './types';

const APIFY_API_BASE = 'https://api.apify.com/v2';

// Shape of one item as returned by the Apify LinkedIn post actor. Only the
// fields we actually read are declared — this is intentionally loose since
// it's the one place allowed to know about the provider's raw format.
interface ApifyPostItem {
  id?: string;
  entityId?: string;
  linkedinUrl?: string;
  content?: string;
  author?: {
    name?: string;
    info?: string;
  };
  postImages?: Array<{ url?: string }>;
  postVideo?: {
    videoUrl?: string;
    thumbnailUrl?: string;
  };
  engagement?: {
    likes?: number;
    comments?: number;
    shares?: number;
  };
}

function normalize(raw: ApifyPostItem, requestedUrl: string): NormalizedPost {
  const images = (raw.postImages ?? []).map((img) => img.url).filter((u): u is string => !!u);

  return {
    postId: raw.id ?? raw.entityId ?? requestedUrl,
    postUrl: raw.linkedinUrl ?? requestedUrl,
    authorName: raw.author?.name ?? 'Unknown',
    authorHeadline: raw.author?.info ?? '',
    postText: raw.content ?? '',
    hasImage: images.length > 0,
    hasVideo: !!raw.postVideo,
    imageUrls: images,
    videoUrl: raw.postVideo?.videoUrl,
    likes: raw.engagement?.likes ?? 0,
    comments: raw.engagement?.comments ?? 0,
    shares: raw.engagement?.shares ?? 0,
  };
}

/**
 * Scrapes a single LinkedIn post via the Apify actor
 * `harvestapi/linkedin-profile-posts`. Despite the "profile posts" name, its
 * `targetUrls` input accepts a direct post permalink and returns just that
 * post when `maxPosts` is 1.
 *
 * To switch providers later: write a new class implementing ScraperProvider
 * and swap the instance returned by scrapers/index.ts. Nothing else changes.
 */
export class ApifyLinkedInPostScraper implements ScraperProvider {
  constructor(
    private readonly apiToken: string,
    private readonly actorId: string = 'harvestapi~linkedin-profile-posts'
  ) {}

  async scrapePost(url: string): Promise<NormalizedPost> {
    const endpoint = `${APIFY_API_BASE}/acts/${this.actorId}/run-sync-get-dataset-items?token=${this.apiToken}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetUrls: [url],
        maxPosts: 1,
      }),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw new Error(`Apify API error: ${response.status} ${bodyText}`);
    }

    const items = (await response.json()) as ApifyPostItem[];
    const raw = items[0];
    if (!raw) {
      throw new Error('Apify returned no results for this URL. It may be private, deleted, or an unsupported URL format.');
    }

    return normalize(raw, url);
  }
}
