-- Add free-text feedback alongside the existing like/dislike columns.
-- Created at: 2026-08-09T01:00:00.000Z

-- Per-comment free-text note the user can leave when reacting to a
-- suggestion (e.g. "too salesy", "great tone"). Mirrors the existing
-- comment_1_liked/comment_2_liked tri-state columns one-to-one.
alter table generation_log
  add column if not exists comment_1_feedback_text text,
  add column if not exists comment_2_feedback_text text;
