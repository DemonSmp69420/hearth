-- M0.3 spike target: FTS5 external-content index over message content.
-- Migrated as its own version so a SQLite build without FTS5 fails here, loudly,
-- instead of corrupting 0001. Soft-deleted messages stay indexed (they are UPDATEd,
-- not DELETEd) — queries must join messages.deleted_at IS NULL.

CREATE VIRTUAL TABLE messages_fts USING fts5(content, content='messages', content_rowid='rowid');

CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts (rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts (messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;

CREATE TRIGGER messages_fts_update AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts (messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO messages_fts (rowid, content) VALUES (new.rowid, new.content);
END;
