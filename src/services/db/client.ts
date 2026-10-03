import { transport } from '../transport';

interface Underlying {
  select<T = Record<string, unknown>>(sql: string, binds?: unknown[]): Promise<T[]>;
  execute(sql: string, binds?: unknown[]): Promise<{ rowsAffected: number }>;
}

export interface DbClient {
  select<T = Record<string, unknown>>(sql: string, binds?: unknown[]): Promise<T[]>;
  execute(sql: string, binds?: unknown[]): Promise<{ rowsAffected: number }>;
}

let cached: Promise<Underlying> | null = null;

/**
 * Entry to SQLite. Under Tauri this is the real plugin database (WAL,
 * migrations owned by the Rust core); in browser dev it is an in-memory
 * sql.js database running the same migration SQL, so the entire UI is
 * exercisable without the shell (e2e strategy, D-010).
 * Synchronous accessor: each method awaits the handle lazily.
 */
export function db(): DbClient {
  return {
    select: async (sql, binds = []) => (await handle()).select(sql, binds),
    execute: async (sql, binds = []) => (await handle()).execute(sql, binds),
  };
}

function handle(): Promise<Underlying> {
  cached ??=
    transport.name === 'tauri'
      ? openTauriDb()
      : transport.name === 'http'
        ? Promise.resolve(openCompanionDb())
        : openBrowserDb();
  return cached;
}

/** Companion web client: real SQLite on the desktop, reached over HTTP. */
function openCompanionDb(): Underlying {
  return {
    select: <T>(sql: string, binds: unknown[] = []) =>
      transport.invoke<T[]>('db_select', { query: sql, values: binds }),
    execute: (sql: string, binds: unknown[] = []) =>
      transport.invoke<{ rowsAffected: number }>('db_execute', { query: sql, values: binds }),
  };
}

async function openTauriDb(): Promise<Underlying> {
  const Database = (await import('@tauri-apps/plugin-sql')).default;
  const instance = await Database.load('sqlite:hearth.db');
  return {
    select: (sql, binds = []) => instance.select(sql, binds),
    execute: (sql, binds = []) => instance.execute(sql, binds),
  };
}

async function openBrowserDb(): Promise<Underlying> {
  const [{ default: initSqlJs }, wasmUrl, { runMigrations }] = await Promise.all([
    import('sql.js'),
    import('sql.js/dist/sql-wasm.wasm?url').then((m) => m.default),
    import('./migrations'),
  ]);
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const sqlDb = new SQL.Database();
  runMigrations({
    exec: (sql: string) => sqlDb.exec(sql),
    // FTS5 is unavailable in the sql.js build; the spike reports that honestly.
  });
  return {
    async select<T>(sql: string, binds: unknown[] = []): Promise<T[]> {
      const stmt = sqlDb.prepare(sql);
      try {
        stmt.bind(binds as (string | number | null)[]);
        const rows: T[] = [];
        while (stmt.step()) rows.push(stmt.getAsObject() as T);
        return rows;
      } finally {
        stmt.free();
      }
    },
    async execute(sql: string, binds: unknown[] = []) {
      sqlDb.run(sql, binds as (string | number | null)[]);
      return { rowsAffected: sqlDb.getRowsModified() };
    },
  };
}
