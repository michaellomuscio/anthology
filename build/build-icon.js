#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const SVG = path.join(__dirname, 'icon.svg');
const PNG_SOURCE = path.join(__dirname, 'icon-source.png');
const ICONSET = path.join(__dirname, 'icon.iconset');
const ICNS = path.join(__dirname, 'icon.icns');
const PNG_512 = path.join(__dirname, 'icon.png');

// macOS .icns wants this exact set of sizes (filename → pixel dimensions)
const SLICES = [
  { name: 'icon_16x16.png',      size: 16 },
  { name: 'icon_16x16@2x.png',   size: 32 },
  { name: 'icon_32x32.png',      size: 32 },
  { name: 'icon_32x32@2x.png',   size: 64 },
  { name: 'icon_128x128.png',    size: 128 },
  { name: 'icon_128x128@2x.png', size: 256 },
  { name: 'icon_256x256.png',    size: 256 },
  { name: 'icon_256x256@2x.png', size: 512 },
  { name: 'icon_512x512.png',    size: 512 },
  { name: 'icon_512x512@2x.png', size: 1024 },
];

// Apple's stock squircle path, rendered as an SVG mask sized to whatever the
// caller asks for. dest-in compositing keeps only pixels under this shape, so
// the icon picks up macOS's expected rounded corners regardless of source.
function squircleMask(size) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
       <path d="M 232 0 H 792 C 921.6 0 1024 102.4 1024 232 V 792 C 1024 921.6 921.6 1024 792 1024 H 232 C 102.4 1024 0 921.6 0 792 V 232 C 0 102.4 102.4 0 232 0 Z" fill="#fff"/>
     </svg>`
  );
}

function pickSource() {
  if (fs.existsSync(PNG_SOURCE)) return { kind: 'png', path: PNG_SOURCE };
  if (fs.existsSync(SVG)) return { kind: 'svg', path: SVG };
  console.error(`Need a source: ${path.relative(ROOT, PNG_SOURCE)} or ${path.relative(ROOT, SVG)}`);
  process.exit(1);
}

function makePipeline(source, size) {
  if (source.kind === 'svg') {
    // SVG already bakes in the squircle clip — just rasterize.
    return sharp(fs.readFileSync(source.path), { density: 384 })
      .resize(size, size, { kernel: 'lanczos3' });
  }
  // Raster source: resize, then mask to the squircle so macOS's rounded
  // corners aren't a black square poking out of the dock.
  return sharp(source.path)
    .resize(size, size, { kernel: 'lanczos3', fit: 'cover' })
    .composite([{ input: squircleMask(size), blend: 'dest-in' }]);
}

async function main() {
  const source = pickSource();
  console.log(`Source: ${path.relative(ROOT, source.path)} (${source.kind})`);

  fs.rmSync(ICONSET, { recursive: true, force: true });
  fs.mkdirSync(ICONSET, { recursive: true });

  console.log('Rendering PNG slices…');
  await Promise.all(
    SLICES.map(({ name, size }) =>
      makePipeline(source, size)
        .png({ compressionLevel: 9 })
        .toFile(path.join(ICONSET, name))
    )
  );
  console.log(`  wrote ${SLICES.length} PNGs to ${path.relative(ROOT, ICONSET)}`);

  await makePipeline(source, 512)
    .png({ compressionLevel: 9 })
    .toFile(PNG_512);
  console.log(`  wrote ${path.relative(ROOT, PNG_512)}`);

  console.log('Building .icns via iconutil…');
  fs.rmSync(ICNS, { force: true });
  execFileSync('iconutil', ['-c', 'icns', ICONSET, '-o', ICNS], { stdio: 'inherit' });
  const stat = fs.statSync(ICNS);
  console.log(`  wrote ${path.relative(ROOT, ICNS)} (${(stat.size / 1024).toFixed(1)} KB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
