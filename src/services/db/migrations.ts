import initSql0001 from '../../../migrations/0001_init.sql?raw';
import initSql0002 from '../../../migrations/0002_fts.sql?raw';

export interface RawDb {
  exec(sql: string): unknown;
}

const MIGRATIONS: readonly { version: number; file: string; sql: string }[] = [
  { version: 1, file: '0001_init.sql', sql: initSql0001 },
  { version: 2, file: '0002_fts.sql', sql: initSql0002 },
];

/**
 * Runs the versioned migration SQL (same files the Rust core embeds).
 * In the Tauri plugin these run automatically; the browser client invokes
 * this explicitly. 0002 (FTS5) is optional: builds without FTS5 skip it and
 * the spike reports that honestly rather than failing the schema.
 */
export function runMigrations(db: RawDb): { applied: number[]; skipped: string[] } {
  const applied: number[] = [];
  const skipped: string[] = [];
  for (const m of MIGRATIONS) {
    try {
      db.exec(m.sql);
      applied.push(m.version);
    } catch (e) {
      if (m.version === 2 && /fts5|no such module/i.test(String(e))) {
        skipped.push(m.file);
      } else {
        throw e;
      }
    }
  }
  return { applied, skipped };
}
