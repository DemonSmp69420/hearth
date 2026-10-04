// Generates the Tauri bundle icons (solid-color PNGs + a PNG-compressed .ico)
// so the project builds before real artwork exists. Run: npm run icons
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'src-tauri', 'icons');
mkdirSync(outDir, { recursive: true });

// Hearth ember: warm orange
const RGB = [0xff, 0x6d, 0x3d];

let CRC_TABLE;
function crc32(buf) {
  CRC_TABLE ??= Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let crc = 0xffffffff;
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function png(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA — Tauri's macOS/Linux codegen rejects RGB-only icons
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      raw[o++] = RGB[0];
      raw[o++] = RGB[1];
      raw[o++] = RGB[2];
      raw[o++] = 0xff; // opaque alpha
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function ico(entries) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2); // type: icon
  head.writeUInt16LE(entries.length, 4);
  let offset = 6 + 16 * entries.length;
  const dir = [];
  const blobs = [];
  for (const { size, buf } of entries) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += buf.length;
    dir.push(e);
    blobs.push(buf);
  }
  return Buffer.concat([head, ...dir, ...blobs]);
}

const sizes = [32, 128, 256, 512];
const pngs = new Map(sizes.map((s) => [s, png(s)]));

writeFileSync(join(outDir, '32x32.png'), pngs.get(32));
writeFileSync(join(outDir, '128x128.png'), pngs.get(128));
writeFileSync(join(outDir, '128x128@2x.png'), pngs.get(256));
writeFileSync(join(outDir, 'icon.png'), pngs.get(512));
writeFileSync(
  join(outDir, 'icon.ico'),
  ico([32, 128, 256].map((s) => ({ size: s, buf: pngs.get(s) }))),
);
console.log(`icons written to ${outDir}`);
