/**
 * Copies the offline OCR runtime into public/ocr so the scanner never needs a
 * CDN, an API key or any network call:
 *   - tesseract.js worker script
 *   - the WASM OCR core (SIMD + LSTM build, matches OEM 1 = LSTM_ONLY)
 *   - the English model used by tesseract.js
 * Run via `npm run prepare:ocr` (also wired into `npm run build`).
 * A missing source asset is a BUILD ERROR: a partial install must fail the
 * build instead of shipping a scanner with no worker or no model.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(root, 'public', 'ocr');
const tessdataDir = join(outDir, 'tessdata');

const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', join(outDir, 'worker.min.js')],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', join(outDir, 'tesseract-core-simd-lstm.wasm.js')],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm', join(outDir, 'tesseract-core-simd-lstm.wasm')],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', join(tessdataDir, 'eng.traineddata.gz')],
];

const missing = [];

for (const [from, to] of files) {
  const src = join(root, from);
  if (!existsSync(src)) {
    missing.push(from);
    continue;
  }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(src, to);
}

if (missing.length > 0) {
  console.error(
    `[prepare:ocr] FAILED — ${missing.length} OCR asset(s) missing:\n` +
      missing.map((m) => `  - ${m}`).join('\n') +
      '\nRun `npm install` before building. The offline scanner cannot ship without these.'
  );
  process.exit(1);
}

console.log(`[prepare:ocr] ${files.length} OCR asset(s) ready in public/ocr`);
