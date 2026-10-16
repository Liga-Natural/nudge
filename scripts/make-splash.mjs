// Draws the iPhone launch images (apple-touch-startup-image) into public/splash, light and dark.
// Same background colours as the app, with the Nudge mark in the middle at the size the opening
// animation starts from, so the launch image hands over to the app without a flash. No dependencies.
// Run: node scripts/make-splash.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

// Keep in step with src/lib/splash-sizes.ts
const SIZES = [
  [440, 956, 3],
  [402, 874, 3],
  [430, 932, 3],
  [393, 852, 3],
  [428, 926, 3],
  [390, 844, 3],
  [375, 812, 3],
  [414, 896, 3],
  [414, 896, 2],
  [414, 736, 3],
  [375, 667, 2],
  [320, 568, 2],
];
const BG = { light: [0xfa, 0xf8, 0xf5], dark: [0x15, 0x12, 0x0f] };
const MARK_CSS_PX = 96; // .splash-mark in globals.css

function crc32(buf) {
  let c;
  let crc = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const smooth = (d) => Math.max(0, Math.min(1, 0.5 - d)); // 1 inside, 0 outside, 1px soft edge

function png(w, h, bg, markPx) {
  const stride = w * 3 + 1;
  const raw = Buffer.alloc(stride * h);
  const x0 = Math.round((w - markPx) / 2);
  const y0 = Math.round((h - markPx) / 2);
  const rad = markPx * 0.28;
  for (let y = 0; y < h; y++) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      let R = bg[0];
      let G = bg[1];
      let B = bg[2];
      const lx = x - x0;
      const ly = y - y0;
      if (lx >= -1 && ly >= -1 && lx <= markPx && ly <= markPx) {
        const half = markPx / 2;
        const qx = Math.abs(lx + 0.5 - half) - (half - rad);
        const qy = Math.abs(ly + 0.5 - half) - (half - rad);
        const sdf = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad;
        const cover = smooth(sdf);
        if (cover > 0) {
          const t = (lx + ly) / (2 * markPx);
          let mr = 255 - t * 5;
          let mg = 140 - t * 70;
          let mb = 40 + t * 80;
          // white ring (flat-cut at the bottom) and dot, as in the app icon
          const cx = lx + 0.5 - half;
          const cy = ly + 0.5 - half;
          const d = Math.hypot(cx, cy);
          const ring = Math.min(smooth(d - markPx * 0.26), smooth(markPx * 0.17 - d)) * smooth(cy - markPx * 0.08);
          const dot = smooth(Math.hypot(cx, cy - markPx * 0.2) - markPx * 0.088);
          const white = Math.max(ring, dot);
          mr += (255 - mr) * white;
          mg += (255 - mg) * white;
          mb += (255 - mb) * white;
          R = Math.round(R + (mr - R) * cover);
          G = Math.round(G + (mg - G) * cover);
          B = Math.round(B + (mb - B) * cover);
        }
      }
      const o = row + 1 + x * 3;
      raw[o] = R;
      raw[o + 1] = G;
      raw[o + 2] = B;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("public/splash", { recursive: true });
for (const [cw, ch, ratio] of SIZES) {
  for (const scheme of ["light", "dark"]) {
    const file = `public/splash/${cw}x${ch}@${ratio}x-${scheme}.png`;
    writeFileSync(file, png(cw * ratio, ch * ratio, BG[scheme], MARK_CSS_PX * ratio));
    console.log(file);
  }
}
