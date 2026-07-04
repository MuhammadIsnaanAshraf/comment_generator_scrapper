import { PostCategory } from '../scrapers/types';

const HIRING_KEYWORDS = [
  "we're hiring",
  'we are hiring',
  'job opening',
  'looking for',
  'join our team',
  'open role',
  'applying',
  'now hiring',
  'job opportunity',
  'career opportunity',
];

const ACHIEVEMENT_KEYWORDS = [
  'excited to announce',
  'thrilled',
  'proud to share',
  'just launched',
  'promoted',
  'happy to share',
  'delighted to announce',
  'just joined',
  'officially',
];

export function detectCategory(text: string): PostCategory {
  const lower = text.toLowerCase();

  if (HIRING_KEYWORDS.some((kw) => lower.includes(kw))) return 'hiring';
  if (ACHIEVEMENT_KEYWORDS.some((kw) => lower.includes(kw))) return 'achievement';
  if (text.length < 100 || text.includes('?')) return 'casual';

  return 'professional';
}
