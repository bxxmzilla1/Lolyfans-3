/** Local visual check of the PPV badge + wordmark composite. */
import sharp from "sharp";
import { readFileSync, writeFileSync } from "fs";

const src = readFileSync("src/lib/badgeAssets.ts", "utf8");
const glyphsJson = src.match(/GLYPHS: Record<string, Glyph> = ([\s\S]*?);\n\nexport const WORDMARK/)[1];
const wordmarkJson = src.match(/WORDMARK = ([\s\S]*?);\n$/)[1];
const GLYPHS = JSON.parse(glyphsJson);
const WORDMARK = JSON.parse(wordmarkJson);
const GLYPH_CANVAS_H = 220;

function dollarsLabel(cents) {
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}

async function priceStripPng(label, digitHeight) {
  const refDigitH = GLYPHS["0"].h;
  const s = digitHeight / refDigitH;
  const spacing = Math.max(1, Math.round(digitHeight * 0.08));
  const parts = [];
  for (const ch of label) {
    const g = GLYPHS[ch];
    if (!g) continue;
    const w = Math.max(1, Math.round(g.w * s));
    const h = Math.max(1, Math.round(g.h * s));
    const data = await sharp(Buffer.from(g.b64, "base64")).resize(w, h).png().toBuffer();
    parts.push({ data, w, h, top: Math.round(g.top * s) });
  }
  const stripH = Math.ceil(GLYPH_CANVAS_H * s);
  const stripW = parts.reduce((sum, p) => sum + p.w, 0) + spacing * (parts.length - 1);
  let x = 0;
  const composites = parts.map((p) => {
    const c = { input: p.data, left: x, top: p.top };
    x += p.w + spacing;
    return c;
  });
  const data = await sharp({
    create: { width: stripW, height: stripH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(composites).png().toBuffer();
  return { data, w: stripW, h: stripH };
}

async function ppvBadgePng(priceCents, size = 220) {
  const S = size;
  const k = S / 220;
  const cx = S / 2;
  const svg = `
<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4fc9ff"/>
      <stop offset="0.55" stop-color="#00aff0"/>
      <stop offset="1" stop-color="#0086c9"/>
    </linearGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="${5 * k}" stdDeviation="${9 * k}" flood-color="#003a52" flood-opacity="0.5"/>
    </filter>
  </defs>
  <rect x="${12 * k}" y="${12 * k}" width="${S - 24 * k}" height="${S - 24 * k}"
        rx="${52 * k}" fill="url(#g)" filter="url(#glow)"/>
  <path d="M ${cx - 21 * k} ${92 * k} v ${-16 * k} a ${21 * k} ${21 * k} 0 0 1 ${42 * k} 0 v ${16 * k}"
        fill="none" stroke="#ffffff" stroke-width="${12 * k}" stroke-linecap="round"/>
  <rect x="${cx - 33 * k}" y="${92 * k}" width="${66 * k}" height="${54 * k}" rx="${13 * k}" fill="#ffffff"/>
  <circle cx="${cx}" cy="${116 * k}" r="${7 * k}" fill="#0090cf"/>
</svg>`;
  const base = await sharp(Buffer.from(svg)).png().toBuffer();
  const strip = await priceStripPng(dollarsLabel(priceCents), Math.round(30 * k));
  let { data: stripData, w: stripW, h: stripH } = strip;
  const maxW = Math.round(S * 0.72);
  if (stripW > maxW) {
    const scale = maxW / stripW;
    stripW = maxW;
    stripH = Math.max(1, Math.round(stripH * scale));
    stripData = await sharp(stripData).resize(stripW, stripH).png().toBuffer();
  }
  return sharp(base)
    .composite([{ input: stripData, left: Math.round((S - stripW) / 2), top: Math.round(152 * k) }])
    .png()
    .toBuffer();
}

// Fake blurred background
const bg = await sharp({
  create: { width: 600, height: 750, channels: 3, background: { r: 148, g: 120, b: 110 } },
}).blur(30).jpeg().toBuffer();

const badgeSize = Math.min(280, Math.max(150, Math.round(600 * 0.42)));
const badge = await ppvBadgePng(499, badgeSize);
const markW = Math.min(380, Math.max(130, Math.round(600 * 0.32)));
const markH = Math.round((WORDMARK.h / WORDMARK.w) * markW);
const mark = await sharp(Buffer.from(WORDMARK.b64, "base64")).resize(markW, markH).png().toBuffer();
const pad = Math.round(600 * 0.045);

const out = await sharp(bg)
  .composite([
    { input: badge, left: Math.round((600 - badgeSize) / 2), top: Math.round((750 - badgeSize) / 2) },
    { input: mark, left: pad, top: pad },
  ])
  .jpeg({ quality: 80 })
  .toBuffer();
writeFileSync("scripts/preview-badge.jpg", out);
console.log("wrote scripts/preview-badge.jpg");
