/**
 * PDF de la cuenta de cobro, generado en el navegador igual que en SmartBilling (html2canvas + jsPDF, A4).
 * Las librerías se cargan solo al usarlas.
 */
async function render(el: HTMLElement) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas-pro'), import('jspdf')]);
  const canvas = await html2canvas(el, { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff' });
  const img = canvas.toDataURL('image/jpeg', 0.92);
  const width = 210;
  const pageHeight = 297;
  const height = (canvas.height * width) / canvas.width;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  // Varias páginas si no cabe en una: la misma imagen corrida hacia arriba.
  let offset = 0;
  pdf.addImage(img, 'JPEG', 0, offset, width, height);
  for (let left = height - pageHeight; left > 0; left -= pageHeight) {
    offset -= pageHeight;
    pdf.addPage();
    pdf.addImage(img, 'JPEG', 0, offset, width, height);
  }
  return pdf;
}

export async function downloadPdf(el: HTMLElement, fileName: string): Promise<void> {
  (await render(el)).save(fileName);
}

/** PDF en base64 (sin el prefijo data:), para adjuntarlo al correo. */
export async function pdfBase64(el: HTMLElement): Promise<string> {
  return (await render(el)).output('datauristring').split(',')[1];
}

export const pdfName = (number: string, client: string) => `Cuenta de Cobro-${number} ${client}.pdf`.replace(/[\\/:*?"<>|]+/g, '-');
