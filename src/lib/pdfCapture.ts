/**
 * Shared A4 PDF capture used by both document print paths (invoices + QT/SO/PO).
 * High-DPI raster -> jsPDF portrait A4 with 8mm margins; tall sheets tile
 * vertically across pages (content never scales down).
 */
export async function captureElementToPdf(el: HTMLElement, filename: string): Promise<void> {
  const pdf = await buildTiledA4Pdf(el);
  pdf.save(filename);
}

/** Same A4 tiling as captureElementToPdf, but returns the PDF as a Blob (for comms attachments). */
export async function captureElementToPdfBlob(el: HTMLElement): Promise<Blob> {
  const pdf = await buildTiledA4Pdf(el);
  return pdf.output('blob');
}

async function buildTiledA4Pdf(el: HTMLElement) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);
  // High-DPI capture so text stays crisp at print zoom.
  const canvas = await html2canvas(el, { scale: 3, backgroundColor: '#ffffff' });
  const imgData = canvas.toDataURL('image/png');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();   // 210mm
  const pageH = pdf.internal.pageSize.getHeight();  // 297mm
  const MARGIN = 8; // mm - mirrors the neat print layout edge-to-edge
  const imgW = pageW - MARGIN * 2;
  const imgH = (canvas.height * imgW) / canvas.width;
  const contentH = pageH - MARGIN * 2;
  pdf.addImage(imgData, 'PNG', MARGIN, MARGIN, imgW, imgH);
  let covered = contentH;
  while (covered < imgH) {
    pdf.addPage();
    pdf.addImage(imgData, 'PNG', MARGIN, MARGIN - covered, imgW, imgH);
    covered += contentH;
  }
  return pdf;
}
