import { db } from './client';

export interface SpikeResult {
  fts5: boolean;
  recursiveCte: boolean;
  detail: string;
}

/**
 * M0.3 spike: prove the bundled SQLite supports FTS5 and recursive CTEs
 * (ARCHITECTURE §16). Runs against the real database under Tauri; in browser
 * dev mode the mock returns empty results and the probe reports inconclusive.
 */
export async function runDbSpike(): Promise<SpikeResult> {
  const d = await db();
  const notes: string[] = [];
  let fts5 = false;
  let recursiveCte = false;

  try {
    await d.execute('CREATE VIRTUAL TABLE IF NOT EXISTS _spike_fts USING fts5(text)');
    await d.execute('DELETE FROM _spike_fts');
    await d.execute('INSERT INTO _spike_fts (rowid, text) VALUES (1, ?)', [
      'Hearth is a local-first character chat app',
    ]);
    const rows = await d.select<{ text: string }>(
      'SELECT text FROM _spike_fts WHERE _spike_fts MATCH ?',
      ['hearth'],
    );
    fts5 = rows.length === 1;
    if (!fts5) notes.push('FTS5 MATCH returned no rows');
  } catch (e) {
    notes.push(`fts5: ${String(e)}`);
  }

  try {
    const rows = await d.select<{ s: number | null }>(
      'WITH RECURSIVE c(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM c WHERE n < 10) SELECT SUM(n) AS s FROM c',
    );
    recursiveCte = rows[0]?.s === 55;
    if (!recursiveCte) notes.push('recursive CTE sum != 55');
  } catch (e) {
    notes.push(`cte: ${String(e)}`);
  }

  const detail =
    notes.length === 0
      ? 'all probes passed'
      : transportModeNote(notes);
  return { fts5, recursiveCte, detail };
}

function transportModeNote(notes: string[]): string {
  if (notes.length === 2) {
    return 'inconclusive — browser dev mode has no real SQLite (run under `npm run tauri dev`)';
  }
  return notes.join('; ');
}
