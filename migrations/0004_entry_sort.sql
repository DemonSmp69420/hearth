-- M4.10: manual ordering for advanced prompt entries (drag-reorder).
ALTER TABLE prompt_entries ADD COLUMN sort INTEGER NOT NULL DEFAULT 0;
