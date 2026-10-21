/* ============================================================================
 * Offline bill text extraction — no API key, no external service.
 *
 *  - PDF: the text layer is read with pdfjs-dist. A scanned PDF (no text
 *    layer) falls back to rendering page 1 and running it through the OCR
 *    engine.
 *  - Image: the OCR engine (tesseract.js + its WASM core) runs in the browser.
 *
 * The worker script, the WASM core and the English model are served from this
 * app's own /ocr assets (copied by scripts/copy-ocr-assets.mjs), so the whole
 * pipeline works offline.
 * ========================================================================== */

export interface ExtractProgress {
  /** 0-100 */
  percent: number;
  /** Human readable step, e.g. "Extracting text... 40%" */
  message: string;
}

const OCR_BASE = '/ocr';
const TESSDATA_DIR = `${OCR_BASE}/tessdata`;
const WORKER_URL = `${OCR_BASE}/worker.min.js`;
const CORE_URL = `${OCR_BASE}/tesseract-core-simd-lstm.wasm.js`;

/** Minimal shape of the tesseract worker we use (typed loosely on purpose —
 *  tesseract.js ships its own types but we lazy-load it to keep it out of the
 *  main bundle). */
type OcrWorker = {
  recognize: (image: unknown) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<unknown>;
};

type PdfTextItem = {
  str?: string;
  hasEOL?: boolean;
  transform?: number[];
};

/**
 * pdfjs returns text RUNS, not lines: "Grand Total" and "8791.00" can arrive
 * as two separate items. Joining everything with spaces would collapse a page
 * into one long line and break every line-oriented rule in the parser
 * (totals, item rows, header labels). So the runs are regrouped into lines
 * using the EOL marker pdfjs sets and, as a fallback, the baseline Y of each
 * run.
 */
function joinTextItems(items: unknown[]): string {
  const lines: string[] = [];
  let line = '';
  let currentY: number | null = null;

  for (const raw of items as PdfTextItem[]) {
    const str = raw?.str;
    if (typeof str !== 'string' || !str.trim()) {
      if (raw?.hasEOL && line.trim()) {
        lines.push(line.trim());
        line = '';
        currentY = null;
      }
      continue;
    }
    const y = Array.isArray(raw.transform) && typeof raw.transform[5] === 'number' ? raw.transform[5] : null;
    if (currentY !== null && y !== null && Math.abs(y - currentY) > 0.5) {
      if (line.trim()) lines.push(line.trim());
      line = '';
    }
    if (line && !line.endsWith(' ')) line += ' ';
    line += str;
    if (y !== null) currentY = y;
    if (raw.hasEOL) {
      if (line.trim()) lines.push(line.trim());
      line = '';
      currentY = null;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines.join('\n');
}

let workerPromise: Promise<OcrWorker> | null = null;

const isPdf = (file: File): boolean =>
  file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');

async function getOcrWorker(onProgress?: (p: ExtractProgress) => void): Promise<OcrWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('eng', 1, {
        workerPath: WORKER_URL,
        corePath: CORE_URL,
        langPath: TESSDATA_DIR,
        logger: (m: { status?: string; progress?: number }) => {
          if (m.status === 'recognizing text' && typeof m.progress === 'number') {
            onProgress?.({
              percent: 60 + Math.round(m.progress * 35),
              message: `Extracting text... ${Math.round(m.progress * 100)}%`,
            });
          }
        },
      });
      return worker as unknown as OcrWorker;
    })().catch((err) => {
      // A failed worker must not poison the next attempt.
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

/** Release the OCR worker (page unload / memory pressure). */
export async function disposeOcrWorker(): Promise<void> {
  if (!workerPromise) return;
  const pending = workerPromise;
  workerPromise = null;
  try {
    const worker = await pending;
    await worker.terminate();
  } catch {
    /* the worker was never up — nothing to release */
  }
}

async function extractImageText(file: File, onProgress?: (p: ExtractProgress) => void): Promise<string> {
  onProgress?.({ percent: 10, message: 'Loading OCR engine...' });
  const worker = await getOcrWorker(onProgress);
  const { data } = await worker.recognize(file);
  onProgress?.({ percent: 97, message: 'Extracting text... 100%' });
  return data?.text || '';
}

async function extractPdfText(file: File, onProgress?: (p: ExtractProgress) => void): Promise<string> {
  onProgress?.({ percent: 5, message: 'Opening PDF...' });
  const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(joinTextItems(content.items));
    const percent = 5 + Math.round((55 * i) / doc.numPages);
    onProgress?.({ percent, message: `Extracting text... ${percent}%` });
  }

  const extracted = pages.join('\n').trim();
  if (extracted.replace(/\s/g, '').length >= 20) {
    onProgress?.({ percent: 97, message: 'Extracting text... 100%' });
    return extracted;
  }

  // Scanned PDF: no text layer. Render the first page and OCR that image.
  onProgress?.({ percent: 60, message: 'No text layer found — running OCR...' });
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) return extracted;
    await page.render({ canvasContext: context, viewport }).promise;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return extracted;
    const text = await extractImageText(
      new File([blob], 'bill-page-1.png', { type: 'image/png' }),
      onProgress
    );
    return text || extracted;
  } catch {
    return extracted;
  }
}

/**
 * Extract the raw text of a bill image or PDF, entirely on the client.
 * Throws a readable error when nothing could be extracted.
 */
export async function extractBillText(
  file: File,
  onProgress?: (p: ExtractProgress) => void
): Promise<string> {
  const text = isPdf(file)
    ? await extractPdfText(file, onProgress)
    : await extractImageText(file, onProgress);

  const cleaned = (text || '').replace(/\u0000/g, '').trim();
  if (cleaned.replace(/\s/g, '').length < 3) {
    throw new Error('No readable text found in the file — try a clearer photo or a text-based PDF');
  }
  return cleaned;
}
