import { uuidv7 } from '../domain/util/id';
import type { CharacterInput } from './db/queries';

/**
 * Character card import/export. JSON in/out now (V2/V3-shaped); PNG reading
 * is pure TS over the chunk structure (tEXt `chara`/`ccv3`), no Rust, no
 * dialog plugin. PNG *export* waits for the M4 import/export suite (F9).
 */

interface StCardData {
  name?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  mes_example?: string;
  system_prompt?: string;
  post_history_instructions?: string;
  creator_notes?: string;
  tags?: string[];
  alternate_greetings?: string[];
}

export interface ParsedCard {
  input: CharacterInput;
  name: string;
}

export function parseCardJson(text: string): ParsedCard {
  const value = JSON.parse(text) as StCardData & { data?: StCardData; spec?: string };
  const data = value.data ?? value;
  const name = (data.name ?? '').trim();
  if (!name) throw new Error('Card has no name field');
  return {
    name,
    input: {
      name,
      description: data.description ?? '',
      personality: data.personality ?? '',
      scenario: data.scenario ?? '',
      first_message: data.first_mes ?? '',
      alt_greetings: data.alternate_greetings ?? [],
      example_dialogue: data.mes_example ?? '',
      system_prompt_override: data.system_prompt || null,
      post_history_instructions: data.post_history_instructions || null,
      tags: data.tags ?? [],
      creator_notes: data.creator_notes || null,
    },
  };
}

export function exportCardJson(card: {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_message: string;
  alt_greetings: string[];
  example_dialogue: string;
  system_prompt_override: string | null;
  post_history_instructions: string | null;
  tags: string[];
  creator_notes: string | null;
}): string {
  const payload = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: card.name,
      description: card.description,
      personality: card.personality,
      scenario: card.scenario,
      first_mes: card.first_message,
      mes_example: card.example_dialogue,
      system_prompt: card.system_prompt_override ?? '',
      post_history_instructions: card.post_history_instructions ?? '',
      creator_notes: card.creator_notes ?? '',
      tags: card.tags,
      alternate_greetings: card.alt_greetings,
      character_version: '',
      creator: 'hearth-local',
    },
  };
  return JSON.stringify(payload, null, 2);
}

/** Extracts the embedded card JSON from a PNG's tEXt chunks (V2 `chara`, V3 `ccv3`). */
export function parsePngCard(bytes: Uint8Array): ParsedCard {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== sig[i]) throw new Error('Not a PNG file');
  }
  let pos = 8;
  let found: string | null = null;
  while (pos + 12 <= bytes.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4]!, bytes[pos + 5]!, bytes[pos + 6]!, bytes[pos + 7]!);
    const dataStart = pos + 8;
    if (type === 'tEXt') {
      const chunk = bytes.subarray(dataStart, dataStart + len);
      const nul = chunk.indexOf(0);
      if (nul > 0) {
        const keyword = new TextDecoder().decode(chunk.subarray(0, nul));
        const text = new TextDecoder().decode(chunk.subarray(nul + 1));
        if (keyword === 'ccv3' || keyword === 'chara') {
          found = text; // ccv3 wins if both present (later chunk)
          if (keyword === 'ccv3') break;
        }
      }
    }
    if (type === 'IEND') break;
    pos = dataStart + len + 4; // skip CRC
  }
  if (!found) throw new Error('No embedded character card found in PNG');
  const json = new TextDecoder().decode(base64ToBytes(found.trim()));
  return parseCardJson(json);
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function downloadJson(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  triggerDownload(filename, blob);
}

function triggerDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function newCardId(): string {
  return uuidv7();
}

// ---- PNG export (card embedded as a tEXt chunk, same shape we import) ----

let CRC_TABLE: number[] | undefined;
function crc32(bytes: Uint8Array): number {
  CRC_TABLE ??= Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crcInput = out.subarray(4, 8 + data.length);
  view.setUint32(8 + data.length, crc32(crcInput));
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

async function pngBytesForExport(avatarDataUrl: string | null): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas is unavailable');
  if (avatarDataUrl) {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('avatar image failed to load'));
      img.src = avatarDataUrl;
    });
    // cover-fit the avatar into the square
    const scale = Math.max(512 / img.width, 512 / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (512 - w) / 2, (512 - h) / 2, w, h);
  } else {
    const grad = ctx.createLinearGradient(0, 0, 512, 512);
    grad.addColorStop(0, '#6750A4');
    grad.addColorStop(1, '#FF6D3D');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);
  }
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

/** Inserts a tEXt chunk into a PNG's chunk stream (before IEND). */
export function insertPngTextChunk(png: Uint8Array, keyword: string, text: string): Uint8Array {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) {
    if (png[i] !== sig[i]) throw new Error('Not a PNG file');
  }
  // latin-1 encode keyword\0text
  const latin1: number[] = [];
  for (const ch of `${keyword}\0${text}`) {
    const code = ch.charCodeAt(0);
    if (code > 0xff) latin1.push(0x3f); // '?'
    else latin1.push(code);
  }
  const textChunk = pngChunk('tEXt', new Uint8Array(latin1));

  // find IEND offset
  let pos = 8;
  let iendStart = -1;
  while (pos + 12 <= png.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(png[pos + 4]!, png[pos + 5]!, png[pos + 6]!, png[pos + 7]!);
    if (type === 'IEND') {
      iendStart = pos;
      break;
    }
    pos += 12 + len;
  }
  if (iendStart < 0) throw new Error('PNG has no IEND chunk');

  const out = new Uint8Array(png.length + textChunk.length);
  out.set(png.subarray(0, iendStart), 0);
  out.set(textChunk, iendStart);
  out.set(png.subarray(iendStart), iendStart + textChunk.length);
  return out;
}

/**
 * Exports the card as a V2-shaped PNG with the metadata embedded (readable by
 * our own importer and most community tools). Uses the character's avatar as
 * the base image when available, else a generated placeholder.
 */
export async function exportCardPng(
  card: {
    name: string;
    description: string;
    personality: string;
    scenario: string;
    first_message: string;
    alt_greetings: string[];
    example_dialogue: string;
    system_prompt_override: string | null;
    post_history_instructions: string | null;
    tags: string[];
    creator_notes: string | null;
  },
  avatarDataUrl: string | null,
): Promise<void> {
  const json = exportCardJson(card);
  const png = await pngBytesForExport(avatarDataUrl);
  const embedded = insertPngTextChunk(png, 'chara', bytesToBase64(new TextEncoder().encode(json)));
  const blob = new Blob([embedded.buffer as ArrayBuffer], { type: 'image/png' });
  triggerDownload(`${card.name || 'character'}.png`, blob);
}
