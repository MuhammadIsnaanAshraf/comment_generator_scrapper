import { ApifyLinkedInPostScraper } from './apify-linkedin-post-scraper';
import { ScraperProvider } from './types';

export type { NormalizedPost, ScraperProvider, PostCategory } from './types';

/**
 * Single swap point: to move off Apify, implement ScraperProvider in a new
 * file and return an instance of it here instead. Every caller only depends
 * on ScraperProvider/NormalizedPost, never on Apify-specific details.
 */
export function getScraper(): ScraperProvider {
  const apiToken = process.env.APIFY_API_TOKEN;
  console.log("🚀 ~ getScraper ~ apiToken:", apiToken)
  if (!apiToken) {
    throw new Error('APIFY_API_TOKEN is not set. Add it to backend/.env');
  }
  return new ApifyLinkedInPostScraper(apiToken);
}
