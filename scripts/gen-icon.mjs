// Regenerates src-tauri/app-icon.png (a simple page-on-slate mark) with zero
// dependencies, so `tauri icon` can derive all platform icon sets offline.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const W = 512;
const H = 512;

const rows = [];
for (let y = 0; y < H; y++) {
  const row = Buffer.alloc(1 + W * 4);
  row[0] = 0; // filter: none
  for (let x = 0; x < W; x++) {
    const o = 1 + x * 4;
    const onPage = x >= 128 && x < 384 && y >= 96 && y < 416;
    const onLine = onPage && y >= 120 && (y - 120) % 40 < 8 && x >= 152 && x < 360;
    if (onLine) row.set([59, 130, 246, 255], o);
    else if (onPage) row.set([245, 245, 240, 255], o);
    else row.set([24, 28, 38, 255], o);
  }
  rows.push(row);
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

writeFileSync(new URL("../src-tauri/app-icon.png", import.meta.url), png);
console.log(`wrote src-tauri/app-icon.png (${png.length} bytes)`);
