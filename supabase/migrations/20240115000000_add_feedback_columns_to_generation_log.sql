-- Add feedback tracking columns to generation_log
-- Created at: 2024-01-15T00:00:00.000Z

-- Track explicit like/dislike for each generated comment
alter table generation_log
  add column if not exists comment_1_liked boolean,
  add column if not exists comment_2_liked boolean;

-- Track which comment was used: 1, 2, null (none), or 'edited'
alter table generation_log
  add column if not exists used_comment text check (used_comment in ('1', '2', 'edited'));

-- Store the final text actually posted (may differ from generated if user edited)
alter table generation_log
  add column if not exists final_posted_text text;

-- Index for analytics queries on used_comment
create index if not exists generation_log_used_comment_idx
  on generation_log (used_comment);