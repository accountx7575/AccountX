/**
 * Offline scanner smoke test — a STANDALONE script, deliberately outside the
 * vitest suite (the suite glob only picks up test files under src/, and a
 * browser-driven OCR run is far too slow and too environment-dependent to
 * gate every lane).
 *
 * It exercises the REAL modules through a REAL browser against the REAL dev
 * server:
 *   1. TEXT PDF   -> pdfjs text layer -> parseBillText
 *   2. SCANNED    -> canvas raster with scan noise -> tesseract.js (/ocr
 *                    assets) -> parseBillText
 * No API key, no network, no cloud.
 *
 * Usage:  npm run smoke:scanner
 * Chrome: override with CHROME_PATH if it is not in a standard location.
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const project = join(here, '..');
const publicDir = join(project, 'public');
const PAGE = join(publicDir, '__smoke.html');
const PORT = Number(process.env.SMOKE_PORT || 5173);
const ORIGIN = `http://localhost:${PORT}`;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

/** Bill A: sub total, a single summary tax row, then the payable total. */
const BILL = [
  'VERMA STEEL WORKS',
  '121, Khasra No-170 and Khata No-00186, Sector 9',
  'GSTIN: 09ABCDE1234F1Z5',
  '',
  'TAX INVOICE',
  'Bill No: PB/26-27/1',
  'Bill Date: 12-03-2026',
  'Due Date: 27-03-2026',
  '',
  'Description                 Qty       Rate       Amount',
  'TMT Bar 10mm                 20      550.00     11000.00',
  'Angle 50x50x6                 4     3375.00     13500.00',
  '',
  'Sub Total                           24500.00',
  'GST 18%                             4410.00',
  'Total                              28910.00',
];

/** Bill B: the common Indian layout — sub total, CGST + SGST, then total. */
const BILL_CGST_SGST = [
  'VERMA STEEL WORKS',
  'GSTIN: 09ABCDE1234F1Z5',
  '',
  'TAX INVOICE',
  'Bill No: PB/26-27/9',
  'Bill Date: 12-03-2026',
  '',
  'Description                 Qty       Rate       Amount',
  'TMT Bar 10mm                  1      100.00      100.00',
  '',
  'Sub Total            100.00',
  'CGST 9%                4.50',
  'SGST 9%                4.50',
  'Total                 109.00',
];

const BILLS = { A: BILL, B: BILL_CGST_SGST };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};

/* ------------------------------------------------------------------ assets */
console.log('1. offline OCR assets');
const assets = [
  'ocr/worker.min.js',
  'ocr/tesseract-core-simd-lstm.wasm',
  'ocr/tesseract-core-simd-lstm.wasm.js',
  'ocr/tessdata/eng.traineddata.gz',
];
for (const asset of assets) {
  const ok = existsSync(join(publicDir, asset));
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  public/${asset}`);
}
if (failures) {
  console.error('\nSmoke FAILED: run `npm run prepare:ocr` first.');
  process.exit(1);
}

/* ------------------------------------------------------------------- fixture */
const { jsPDF } = await import(join(project, 'node_modules/jspdf/dist/jspdf.node.min.js'));
for (const [name, lines] of Object.entries(BILLS)) {
  const pdf = new jsPDF();
  lines.forEach((line, i) => pdf.text(line, 10, 10 + i * 6));
  writeFileSync(join(publicDir, `__smoke-bill-${name}.pdf`), Buffer.from(pdf.output('arraybuffer')));
}

writeFileSync(
  PAGE,
  `<!doctype html><html><head><meta charset="utf-8"><title>pending</title></head><body>
<pre id="log"></pre>
<script type="module">
  import { extractBillText } from '/src/lib/billTextExtractor.ts';
  import { parseBillText } from '/src/lib/billParser.ts';
  const BILLS = ${JSON.stringify(BILLS)};
  const log = (m) => { document.getElementById('log').textContent += m + '\\n'; };

  // Seeded PRNG (mulberry32): the scan noise is FIXED across runs, so the OCR
  // results are reproducible instead of flaky from Math.random().
  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function stringSeed(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function scannedPng(lines, seed) {
    const c = document.createElement('canvas');
    c.width = 1000; c.height = 40 + lines.length * 28;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#111'; ctx.font = '17px "Courier New", monospace';
    lines.forEach((line, i) => ctx.fillText(line, 28, 40 + i * 28));
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const rnd = mulberry32(seed);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rnd() - 0.5) * 26;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
    return new Promise((r) => c.toBlob(r, 'image/png'));
  }

  (async () => {
    try {
      const results = {};
      for (const [name, lines] of Object.entries(BILLS)) {
        const pdfBlob = await (await fetch('/__smoke-bill-' + name + '.pdf')).blob();
        const pdfText = await extractBillText(new File([pdfBlob], 'bill.pdf', { type: 'application/pdf' }));
        const pdfParsed = parseBillText(pdfText);
        log('PDF TEXT ' + name + ': ' + JSON.stringify(pdfText));
        log('PDF ' + name + ': ' + JSON.stringify(pdfParsed));

        const pngBlob = await scannedPng(lines, stringSeed(name));
        const ocrText = await extractBillText(new File([pngBlob], 'bill.png', { type: 'image/png' }));
        const ocrParsed = parseBillText(ocrText);
        log('OCR TEXT ' + name + ': ' + JSON.stringify(ocrText));
        log('OCR ' + name + ': ' + JSON.stringify(ocrParsed));

        results[name] = { pdfParsed, ocrParsed };
      }
      document.title = 'DONE:' + JSON.stringify(results);
    } catch (err) {
      log('ERROR ' + (err && err.message));
      document.title = 'ERROR:' + (err && err.message);
    }
  })();
</script></body></html>`
);

/* ---------------------------------------------------------------- dev server */
let server = null;
const serverUp = async () => {
  try {
    const res = await fetch(ORIGIN, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
};

if (!(await serverUp())) {
  console.log(`2. starting the dev server on :${PORT}`);
  server = spawn('npm', ['run', 'dev', '--', '--port', String(PORT), '--strictPort'], {
    cwd: project,
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    if (await serverUp()) break;
  }
  if (!(await serverUp())) {
    console.error('Smoke FAILED: the dev server never came up.');
    server?.kill();
    process.exit(1);
  }
} else {
  console.log(`2. reusing the dev server on :${PORT}`);
}
for (const asset of assets) {
  const res = await fetch(`${ORIGIN}/${asset}`);
  if (!res.ok) {
    failures++;
    console.log(`  FAIL  GET /${asset} -> ${res.status}`);
  }
}

/* --------------------------------------------------------------------- chrome */
const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error('Smoke FAILED: no Chrome found. Set CHROME_PATH.');
  server?.kill();
  process.exit(1);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = () => rej(new Error(`cannot connect to ${url}`));
    });
    const cdp = new Cdp(ws);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      const entry = cdp.pending.get(msg.id);
      if (!entry) return;
      cdp.pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(JSON.stringify(msg.error)));
      else entry.resolve(msg.result);
    };
    return cdp;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout: ${method}`));
        }
      }, 300000);
    });
  }
}

const profile = join(project, 'node_modules', '.cache', 'smoke-chrome');
mkdirSync(profile, { recursive: true });
const chrome = spawn(
  chromePath,
  [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--remote-debugging-port=9222', `--user-data-dir=${profile}`, 'about:blank',
  ],
  { stdio: 'ignore' }
);

const cleanup = () => {
  try {
    rmSync(PAGE, { force: true });
    for (const name of Object.keys(BILLS)) {
      rmSync(join(publicDir, `__smoke-bill-${name}.pdf`), { force: true });
    }
  } catch { /* ignore */ }
  try { chrome.kill(); } catch { /* ignore */ }
  if (server) server.kill();
};
process.on('exit', cleanup);

try {
  console.log('3. driving headless Chrome');
  let targets = null;
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch('http://localhost:9222/json/list');
      if (res.ok) { targets = await res.json(); break; }
    } catch { /* not up yet */ }
    await sleep(500);
  }
  if (!targets) throw new Error('Chrome DevTools endpoint never came up');

  const page = await Cdp.connect(targets[0].webSocketDebuggerUrl);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Page.navigate', { url: `${ORIGIN}/__smoke.html?t=${Date.now()}` });

  let title = '';
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    await sleep(2000);
    const res = await page.send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
    title = res.result?.value || '';
    if (title.startsWith('DONE:') || title.startsWith('ERROR:')) break;
  }

  const logRes = await page.send('Runtime.evaluate', {
    expression: 'document.getElementById("log").textContent',
    returnByValue: true,
  });
  console.log(logRes.result?.value || '(no page output)');

  if (!title.startsWith('DONE:')) {
    console.error(`\nSmoke FAILED: ${title || 'the page never finished'}`);
    process.exit(1);
  }

  const result = JSON.parse(title.slice('DONE:'.length));
  console.log('\n4. assertions');

  // Bill A: sub total 24500, a single summary GST row, total 28910.
  for (const [label, parsed] of [['PDF', result.A?.pdfParsed], ['OCR', result.A?.ocrParsed]]) {
    check(`${label} A billNumber`, parsed?.billNumber, 'PB/26-27/1');
    check(`${label} A billDate`, parsed?.billDate, '2026-03-12');
    check(`${label} A dueDate`, parsed?.dueDate, '2026-03-27');
    check(`${label} A totalAmount (not the sub total)`, parsed?.totalAmount, 28910);
    check(`${label} A itemCount`, parsed?.items.length, 2);
    check(`${label} A summaryTax.rate`, parsed?.summaryTax?.rate, 18);
    check(`${label} A no address item`, parsed?.items.every((i) => !/khasra|khata|sector/i.test(i.name)), true);
    check(`${label} A item tax rate`, parsed?.items.every((i) => i.taxRate === 18), true);
  }

  // Bill B: sub total 100, CGST 9% + SGST 9%, total 109.
  for (const [label, parsed] of [['PDF', result.B?.pdfParsed], ['OCR', result.B?.ocrParsed]]) {
    check(`${label} B billNumber`, parsed?.billNumber, 'PB/26-27/9');
    check(`${label} B totalAmount (not the sub total)`, parsed?.totalAmount, 109);
    check(`${label} B summaryTax.amount (CGST + SGST)`, parsed?.summaryTax?.amount, 9);
    check(`${label} B item tax rate (9% effective)`, parsed?.items?.[0]?.taxRate, 9);
  }
} catch (err) {
  console.error(`\nSmoke FAILED: ${err.message}`);
  process.exit(1);
}

console.log(failures === 0 ? '\nSMOKE: ALL GREEN' : `\nSMOKE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
