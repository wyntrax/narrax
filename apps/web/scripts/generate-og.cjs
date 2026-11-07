/* eslint-disable @typescript-eslint/no-require-imports -- Deterministic OG image asset generation. */
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const publicDir = path.resolve(__dirname, '../public');

async function generateOgDefault() {
  const rawSymbol = fs.readFileSync(path.join(publicDir, 'narrax-symbol.svg'), 'utf8');
  // Extract the inner path from narrax-symbol.svg
  const pathMatch = rawSymbol.match(/<path d="([^"]+)" transform="translate\(-7\.98036 0\.2009\)"/);
  const symbolPath = pathMatch ? pathMatch[1] : '';

  const dots = [];
  for (let x = 24; x < 1200; x += 24) {
    for (let y = 24; y < 630; y += 24) {
      dots.push(`<circle cx="${x}" cy="${y}" r="0.9" fill="#ffffff" fill-opacity="0.11"/>`);
    }
  }

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="bgGlow" cx="50%" cy="22%" r="65%">
      <stop offset="0%" stop-color="#22222a" stop-opacity="0.75"/>
      <stop offset="55%" stop-color="#0d0d12" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#050507" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.16"/>
      <stop offset="65%" stop-color="#ffffff" stop-opacity="0.03"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="topBar" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.85"/>
      <stop offset="50%" stop-color="#9e9ea8" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="#23232b" stop-opacity="0.3"/>
    </linearGradient>
    <linearGradient id="cardFill" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#19191f"/>
      <stop offset="100%" stop-color="#0c0c10"/>
    </linearGradient>
    <linearGradient id="coreFill" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#25252e"/>
      <stop offset="100%" stop-color="#0e0e13"/>
    </linearGradient>
    <linearGradient id="ruleFill" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <!-- Base background -->
  <rect width="1200" height="630" fill="#050507"/>
  <rect width="1200" height="630" fill="url(#bgGlow)"/>
  <g>${dots.join('')}</g>
  <rect x="0" y="0" width="1200" height="3" fill="url(#topBar)"/>

  <!-- Header bar -->
  <g transform="translate(56, 36)">
    <rect x="0" y="0" width="44" height="44" rx="12" fill="url(#coreFill)" stroke="#3e3e4a" stroke-width="1"/>
    <g transform="translate(8, 8) scale(0.116)">
      <path d="${symbolPath}" transform="translate(-7.98036 0.2009)" fill="#ffffff" fill-rule="evenodd"/>
    </g>
    <text x="58" y="29" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" letter-spacing="4" fill="#f4f4f6">NARRAX</text>
    <rect x="192" y="8" width="168" height="28" rx="14" fill="#111116" stroke="#2c2c35" stroke-width="1"/>
    <text x="276" y="26" text-anchor="middle" font-family="Courier New, monospace" font-size="11" letter-spacing="1.5" fill="#b4b4c0">SOLANA RESEARCH</text>
  </g>

  <g transform="translate(910, 44)">
    <rect x="0" y="0" width="234" height="28" rx="14" fill="#111116" stroke="#2c2c35" stroke-width="1"/>
    <circle cx="16" cy="14" r="3.5" fill="#e8e8ee"/>
    <text x="30" y="18" font-family="Courier New, monospace" font-size="11" letter-spacing="1" fill="#b4b4c0">NARRATIVES · SMART MONEY</text>
  </g>

  <!-- Headline banner -->
  <text x="56" y="124" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700" letter-spacing="-0.8" fill="#ffffff">See the narrative before the crowd does.</text>
  <text x="56" y="152" font-family="Arial, Helvetica, sans-serif" font-size="16" fill="#a0a0ac">Connect crypto narratives, token evidence, and observed smart-money wallet flows on Solana.</text>

  <!-- Connecting bezier wires -->
  <g fill="none">
    <path d="M 336 238 C 435 238, 445 344, 542 344" stroke="#ffffff" stroke-opacity="0.24" stroke-width="1.5"/>
    <path d="M 336 348 C 435 348, 445 348, 542 348" stroke="#ffffff" stroke-opacity="0.24" stroke-width="1.5"/>
    <path d="M 336 458 C 435 458, 445 352, 542 352" stroke="#ffffff" stroke-opacity="0.24" stroke-width="1.5"/>
    <path d="M 658 344 C 755 344, 765 276, 844 276" stroke="#ffffff" stroke-opacity="0.26" stroke-width="1.5"/>
    <path d="M 658 352 C 755 352, 765 426, 844 426" stroke="#ffffff" stroke-opacity="0.26" stroke-width="1.5"/>

    <!-- Travelling signal nodes on wires -->
    <circle cx="385" cy="249" r="2.8" fill="#ffffff" fill-opacity="0.85"/>
    <circle cx="468" cy="312" r="2.8" fill="#ffffff" fill-opacity="0.7"/>
    <circle cx="422" cy="348" r="2.8" fill="#ffffff" fill-opacity="0.85"/>
    <circle cx="498" cy="348" r="2.5" fill="#ffffff" fill-opacity="0.65"/>
    <circle cx="395" cy="442" r="2.8" fill="#ffffff" fill-opacity="0.8"/>
    <circle cx="478" cy="378" r="2.5" fill="#ffffff" fill-opacity="0.65"/>

    <circle cx="718" cy="322" r="2.8" fill="#ffffff" fill-opacity="0.85"/>
    <circle cx="792" cy="285" r="2.8" fill="#ffffff" fill-opacity="0.75"/>
    <circle cx="728" cy="378" r="2.8" fill="#ffffff" fill-opacity="0.85"/>
    <circle cx="802" cy="418" r="2.8" fill="#ffffff" fill-opacity="0.75"/>
  </g>

  <!-- Left column: 3 Source Cards (01 X, 02 Reddit, 03 TikTok) -->
  <!-- Card 01: X -->
  <g transform="translate(56, 196)">
    <text x="2" y="-7" font-family="Courier New, monospace" font-size="11" fill="#8e8e9a">01</text>
    <rect x="-4" y="-4" width="288" height="92" rx="18" fill="none" stroke="#ffffff" stroke-opacity="0.07" stroke-width="1"/>
    <rect x="0" y="0" width="280" height="84" rx="14" fill="url(#cardFill)" stroke="#2e2e38" stroke-width="1"/>
    <rect x="18" y="21" width="42" height="42" rx="10" fill="#14141a" stroke="#2f2f3a" stroke-width="1"/>
    <!-- Scan frame icon -->
    <path d="M31 35 H35 V31 M43 31 H47 V35 M47 45 V49 H43 M35 49 H31 V45 M34 40 H44" fill="none" stroke="#e4e4ec" stroke-width="1.6" stroke-linecap="round"/>
    <text x="74" y="38" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="700" fill="#f4f4f6">X</text>
    <text x="74" y="58" font-family="Arial, Helvetica, sans-serif" font-size="13" fill="#9c9ca8">The conversation</text>
    <circle cx="280" cy="42" r="3.5" fill="#b4b4c0" stroke="#0c0c10" stroke-width="1.5"/>
  </g>

  <!-- Card 02: Reddit -->
  <g transform="translate(56, 306)">
    <text x="2" y="-7" font-family="Courier New, monospace" font-size="11" fill="#8e8e9a">02</text>
    <rect x="-4" y="-4" width="288" height="92" rx="18" fill="none" stroke="#ffffff" stroke-opacity="0.07" stroke-width="1"/>
    <rect x="0" y="0" width="280" height="84" rx="14" fill="url(#cardFill)" stroke="#2e2e38" stroke-width="1"/>
    <rect x="18" y="21" width="42" height="42" rx="10" fill="#14141a" stroke="#2f2f3a" stroke-width="1"/>
    <!-- Message bubble icon -->
    <path d="M39 33 C34.5 33 31 36.1 31 40 C31 41.8 31.8 43.4 33 44.6 L31.5 49 L36.2 47.2 C37.1 47.4 38 47.5 39 47.5 C43.5 47.5 47 44.4 47 40.5 C47 36.4 43.5 33 39 33 Z" fill="none" stroke="#e4e4ec" stroke-width="1.6" stroke-linejoin="round"/>
    <text x="74" y="38" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="700" fill="#f4f4f6">Reddit</text>
    <text x="74" y="58" font-family="Arial, Helvetica, sans-serif" font-size="13" fill="#9c9ca8">Community discussions</text>
    <circle cx="280" cy="42" r="3.5" fill="#b4b4c0" stroke="#0c0c10" stroke-width="1.5"/>
  </g>

  <!-- Card 03: TikTok -->
  <g transform="translate(56, 416)">
    <text x="2" y="-7" font-family="Courier New, monospace" font-size="11" fill="#8e8e9a">03</text>
    <rect x="-4" y="-4" width="288" height="92" rx="18" fill="none" stroke="#ffffff" stroke-opacity="0.07" stroke-width="1"/>
    <rect x="0" y="0" width="280" height="84" rx="14" fill="url(#cardFill)" stroke="#2e2e38" stroke-width="1"/>
    <rect x="18" y="21" width="42" height="42" rx="10" fill="#14141a" stroke="#2f2f3a" stroke-width="1"/>
    <!-- Audio lines icon -->
    <path d="M31 40 V44 M35 35 V49 M39 31 V53 M43 36 V48 M47 39 V45" fill="none" stroke="#e4e4ec" stroke-width="1.7" stroke-linecap="round"/>
    <text x="74" y="38" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="700" fill="#f4f4f6">TikTok</text>
    <text x="74" y="58" font-family="Arial, Helvetica, sans-serif" font-size="13" fill="#9c9ca8">Culture &amp; attention</text>
    <circle cx="280" cy="42" r="3.5" fill="#b4b4c0" stroke="#0c0c10" stroke-width="1.5"/>
  </g>

  <!-- Center: Core NARRAX hub -->
  <g transform="translate(600, 348)">
    <circle cx="0" cy="0" r="145" fill="url(#coreGlow)"/>
    <circle cx="0" cy="0" r="126" fill="none" stroke="#ffffff" stroke-opacity="0.08" stroke-width="1"/>
    <circle cx="0" cy="0" r="98" fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="1"/>
    <rect x="-56" y="-56" width="112" height="112" rx="28" fill="url(#coreFill)" stroke="#484856" stroke-width="1.2"/>
    <g transform="translate(-28, -28) scale(0.232)">
      <path d="${symbolPath}" transform="translate(-7.98036 0.2009)" fill="#ffffff" fill-rule="evenodd"/>
    </g>
    <circle cx="-56" cy="0" r="3.5" fill="#e4e4ec" stroke="#0c0c10" stroke-width="1.5"/>
    <circle cx="56" cy="0" r="3.5" fill="#e4e4ec" stroke="#0c0c10" stroke-width="1.5"/>
    <text x="0" y="92" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" letter-spacing="4.5" fill="#ffffff">NARRAX</text>
    <text x="0" y="116" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="14" fill="#a0a0ad">From activity to context</text>
  </g>

  <!-- Right column: 2 Output Cards -->
  <!-- Output 1: Narrative radar -->
  <g transform="translate(844, 198)">
    <rect x="0" y="0" width="300" height="136" rx="18" fill="url(#cardFill)" stroke="#383844" stroke-width="1.2"/>
    <!-- Radar icon -->
    <g transform="translate(24, 22)" fill="none" stroke="#b8b8c4" stroke-width="1.5">
      <circle cx="12" cy="12" r="10"/>
      <circle cx="12" cy="12" r="6"/>
      <circle cx="12" cy="12" r="2" fill="#e4e4ec"/>
      <path d="M12 12 L19 5"/>
    </g>
    <text x="24" y="70" font-family="Arial, Helvetica, sans-serif" font-size="17" font-weight="700" fill="#f4f4f6">Narrative radar</text>
    <text x="24" y="94" font-family="Arial, Helvetica, sans-serif" font-size="13" fill="#9c9ca8">Follow topics, sources and lifecycle stages.</text>
    <rect x="24" y="112" width="220" height="3" rx="1.5" fill="url(#ruleFill)"/>
    <circle cx="0" cy="78" r="3.5" fill="#b4b4c0" stroke="#0c0c10" stroke-width="1.5"/>
  </g>

  <!-- Output 2: Connected evidence -->
  <g transform="translate(844, 358)">
    <rect x="0" y="0" width="300" height="148" rx="18" fill="url(#cardFill)" stroke="#383844" stroke-width="1.2"/>
    <!-- Focus icon -->
    <g transform="translate(24, 22)" fill="none" stroke="#b8b8c4" stroke-width="1.6" stroke-linecap="round">
      <path d="M4 9 V4 H9 M15 4 H20 V9 M20 15 V20 H15 M9 20 H4 V15"/>
      <circle cx="12" cy="12" r="3"/>
    </g>
    <text x="24" y="70" font-family="Arial, Helvetica, sans-serif" font-size="17" font-weight="700" fill="#f4f4f6">Connected evidence</text>
    <text x="24" y="94" font-family="Arial, Helvetica, sans-serif" font-size="13" fill="#9c9ca8">Inspect observations, wallet flows &amp; risk</text>
    <text x="24" y="113" font-family="Arial, Helvetica, sans-serif" font-size="13" fill="#9c9ca8">gates. Keep uncertainty in view.</text>
    <rect x="24" y="128" width="220" height="3" rx="1.5" fill="url(#ruleFill)"/>
    <circle cx="0" cy="68" r="3.5" fill="#b4b4c0" stroke="#0c0c10" stroke-width="1.5"/>
  </g>

  <!-- Footer bar -->
  <line x1="0" y1="568" x2="1200" y2="568" stroke="#22222a" stroke-width="1"/>
  <text x="56" y="602" font-family="Courier New, monospace" font-size="13" letter-spacing="1.2" fill="#9c9ca8">X / Reddit / TikTok · selected watchlists · Solana on-chain evidence</text>
  <text x="1144" y="602" text-anchor="end" font-family="Courier New, monospace" font-size="13" letter-spacing="1.2" fill="#b8b8c4">Research, not prediction</text>
</svg>`;

  const pngBuffer = await sharp(Buffer.from(svg))
    .resize(1200, 630)
    .png({ quality: 92, compressionLevel: 9 })
    .toBuffer();

  const outPath = path.join(publicDir, 'og-default.png');
  fs.writeFileSync(outPath, pngBuffer);
  const metadata = await sharp(pngBuffer).metadata();
  console.log(`Generated ${outPath}: ${metadata.width}x${metadata.height} (${pngBuffer.length} bytes)`);
}

generateOgDefault().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
