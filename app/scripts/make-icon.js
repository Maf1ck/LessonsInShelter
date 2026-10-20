// Малює іконку (бурштинова плитка з навушниками) у build/icon.png без зовнішніх залежностей.
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const N = 512;
const px = Buffer.alloc(N * N * 4);
const AMBER = [224, 179, 65];
const INK = [26, 21, 8];

function set(x, y, c, a = 255) {
  const i = (y * N + x) * 4;
  px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = a;
}

const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return x >= x0 && x <= x1 && y >= y0 && y <= y1 && (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    if (!inRoundRect(x, y, 0, 0, N - 1, N - 1, 110)) continue;
    let c = AMBER;
    const d = Math.hypot(x - 256, y - 270);
    const band = d >= 138 && d <= 168 && y <= 280;                       // дуга оголів'я
    const cupL = inRoundRect(x, y, 88, 270, 168, 396, 28);               // лівий амбушюр
    const cupR = inRoundRect(x, y, 344, 270, 424, 396, 28);              // правий амбушюр
    if (band || cupL || cupR) c = INK;
    set(x, y, c);
  }
}

const raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) {
  raw[y * (N * 4 + 1)] = 0;
  px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4);
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log('OK', out);
