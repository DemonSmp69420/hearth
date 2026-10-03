import { transport } from './transport';
import { parsePngCard, type ParsedCard } from './cards';

const UUID_RE = /[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}/i;

/** Extract the character UUID from a janitorai.com or jannyai.com link. */
export function uuidFromLink(link: string): string | null {
  const m = link.match(UUID_RE);
  return m ? m[0] : null;
}

export function isCharacterLink(link: string): boolean {
  return /janitorai\.com|jannyai\.com/i.test(link) && UUID_RE.test(link);
}

export type LinkImportError =
  | { kind: 'bad-link' }
  | { kind: 'unsupported' }
  | { kind: 'fetch'; detail: string };

/**
 * Fetch a character card from the JannyAI mirror by JanitorAI link.
 * Throws LinkImportFailure with a user-friendly kind on any problem —
 * the UI turns that into the "Sorry! We couldn't fetch the bot details."
 * panel with self-help steps.
 */
export async function fetchCharacterFromLink(link: string): Promise<ParsedCard> {
  if (!isCharacterLink(link)) {
    throw { kind: 'bad-link' } satisfies LinkImportError;
  }
  const uuid = uuidFromLink(link)!;
  let dataUrl: string;
  try {
    dataUrl = await transport.invoke<string>('janny_fetch_character', { uuid });
  } catch (e) {
    // Browser dev (mock transport) has no such command — treat as unsupported.
    if (typeof e === 'object' && e !== null && 'kind' in e) throw e;
    const detail = String(e instanceof Error ? e.message : e);
    if (/not found|no character/i.test(detail)) {
      throw { kind: 'fetch', detail: 'not in dataset' } satisfies LinkImportError;
    }
    throw { kind: 'fetch', detail } satisfies LinkImportError;
  }
  const res = await fetch(dataUrl);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return parsePngCard(bytes);
}
