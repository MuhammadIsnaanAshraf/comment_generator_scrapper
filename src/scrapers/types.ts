export type PostCategory = 'professional' | 'casual' | 'hiring' | 'achievement' | 'unknown';

/**
 * Internal shape every scraper provider must normalize its raw response into.
 * Nothing downstream (comment generation, API routes) touches provider-specific
 * fields directly — only this type. Swapping providers means writing a new
 * class that implements ScraperProvider and returns this shape.
 */
export interface NormalizedPost {
  postId: string;
  postUrl: string;
  authorName: string;
  authorHeadline: string;
  postText: string;
  hasImage: boolean;
  hasVideo: boolean;
  imageUrls: string[];
  videoUrl?: string;
  likes: number;
  comments: number;
  shares: number;
}

export interface ScraperProvider {
  scrapePost(url: string): Promise<NormalizedPost>;
}
