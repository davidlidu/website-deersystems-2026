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
  // Siempre una sola página: si el contenido es más alto que A4, se reduce proporcionalmente y se centra.
  if (height <= pageHeight) {
    pdf.addImage(img, 'JPEG', 0, 0, width, height);
  } else {
    const w = (width * pageHeight) / height;
    pdf.addImage(img, 'JPEG', (width - w) / 2, 0, w, pageHeight);
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
