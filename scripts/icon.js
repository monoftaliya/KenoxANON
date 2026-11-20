// Иконка KenoxANON: пиксельный знак 3×3 из шапки сайта на тёмной плашке со ступенчатыми углами.
// Для каждого размера знак рисуется заново по целым пикселям (без размытия), PNG собирается вручную,
// ICO хранит PNG-кадры. Запуск: node scripts/icon.js → build/icon.ico, build/icon.png, renderer/icon.png
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const COL = { plate: [16, 19, 26, 255], edge: [46, 51, 63, 255], snow: [243, 244, 247, 255], shade: [58, 63, 74, 255], pink: [255, 143, 163, 255], pinkShade: [110, 52, 64, 255], hollow: [255, 255, 255, 96] };

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function render(S) {
  const px = new Uint8Array(S * S * 4);
  const put = (x, y, c) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4, a = c[3] / 255, under = px[i + 3] / 255;
    for (let k = 0; k < 3; k++) px[i + k] = Math.round(c[k] * a + px[i + k] * (1 - a));
    px[i + 3] = Math.round(255 * Math.min(1, a + under * (1 - a)));
  };
  const rect = (x0, y0, w, h, c) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(x, y, c); };
  // плашка: ступенчатые углы, как у .plate на сайте, и светлая кромка сверху
  const n = Math.max(2, Math.round(S / 9)), s = Math.max(1, Math.round(n / 2)), edge = Math.max(1, Math.round(S / 64));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = Math.min(x, S - 1 - x), dy = Math.min(y, S - 1 - y);
    if ((dx < s && dy < n) || (dx < n && dy < s)) continue;
    put(x, y, y < edge + (dx < n ? s : 0) ? COL.edge : COL.plate);
  }
  // знак 3×3: клетки 6 и зазоры 2 (как .brand__mark), вторая и пятая — контур, восьмая — розовая
  const G = S * 0.58, c = Math.max(2, Math.round(G * 6 / 22)), g = Math.max(1, Math.round(G * 2 / 22));
  const total = 3 * c + 2 * g, o = Math.floor((S - total) / 2), sh = S >= 32 ? Math.max(1, Math.round(S / 42)) : 0, line = Math.max(1, Math.round(c / 7));
  for (let i = 0; i < 9; i++) {
    const x = o + (i % 3) * (c + g), y = o + Math.floor(i / 3) * (c + g);
    if (i === 1 || i === 4) { rect(x, y, c, line, COL.hollow); rect(x, y + c - line, c, line, COL.hollow); rect(x, y + line, line, c - 2 * line, COL.hollow); rect(x + c - line, y + line, line, c - 2 * line, COL.hollow); continue; }
    const pink = i === 7;
    if (sh) rect(x + sh, y + sh, c, c, pink ? COL.pinkShade : COL.shade);
    rect(x, y, c, c, pink ? COL.pink : COL.snow);
  }
  return px;
}
function png(S, px) {
  const raw = Buffer.alloc((S * 4 + 1) * S);
  for (let y = 0; y < S; y++) Buffer.from(px.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function ico(frames) {
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(frames.length, 4);
  const dir = Buffer.alloc(16 * frames.length); let off = 6 + dir.length;
  frames.forEach((f, i) => {
    const o = i * 16; dir[o] = f.size >= 256 ? 0 : f.size; dir[o + 1] = f.size >= 256 ? 0 : f.size;
    dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6); dir.writeUInt32LE(f.data.length, o + 8); dir.writeUInt32LE(off, o + 12); off += f.data.length;
  });
  return Buffer.concat([head, dir, ...frames.map((f) => f.data)]);
}

const root = path.join(__dirname, '..');
const frames = [16, 20, 24, 32, 40, 48, 64, 128, 256].map((size) => ({ size, data: png(size, render(size)) }));
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico(frames));
fs.writeFileSync(path.join(root, 'build', 'icon.png'), png(512, render(512)));
fs.writeFileSync(path.join(root, 'renderer', 'icon.png'), frames.find((f) => f.size === 256).data);
console.log('icon: build/icon.ico, build/icon.png, renderer/icon.png');
