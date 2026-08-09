-- The on-feed extension flow extracts posts from the DOM, where no post URL is
-- available — only a LinkedIn URN / data-id / content hash (see extractPostId in
-- extension/src/content/post-extractor.ts). Store that as post_id, and allow
-- post_url to be null for generations that didn't come from a pasted URL.
-- Created at: 2024-02-02T00:00:00.000Z

alter table generation_log
  add column if not exists post_id text;

alter table generation_log
  alter column post_url drop not null;
