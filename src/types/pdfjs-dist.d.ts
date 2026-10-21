/**
 * pdfjs-dist v4 ships no type declarations for its ESM build entry
 * (package "types" covers the legacy build only), so the scanner's dynamic
 * import of the ESM build is declared here.
 */
declare module 'pdfjs-dist/build/pdf.mjs' {
  export const GlobalWorkerOptions: { workerSrc?: string };

  export interface PdfViewport {
    width: number;
    height: number;
    scale?: number;
  }

  export interface PdfTextItem {
    str?: string;
  }

  export interface PdfPageProxy {
    getTextContent(): Promise<{ items: PdfTextItem[] }>;
    getViewport(params: { scale: number }): PdfViewport;
    render(params: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }): {
      promise: Promise<void>;
    };
  }

  export interface PdfDocumentProxy {
    numPages: number;
    getPage(pageNumber: number): Promise<PdfPageProxy>;
  }

  export function getDocument(src: { data: Uint8Array }): { promise: Promise<PdfDocumentProxy> };
}
