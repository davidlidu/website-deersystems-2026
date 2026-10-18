/**
 * PDF de la cuenta de cobro, generado en el navegador (html2canvas + jsPDF, A4). Las librerías se cargan solo al usarlas.
 *
 * Nunca se reduce el contenido (quedaría angosto y centrado). Si no cabe en una página:
 * - lo de la forma de pago en adelante (forma de pago, firma y pie) pasa junto a la página siguiente;
 * - con muchos ítems, se corta entre filas, nunca a la mitad de una.
 * Los puntos de corte posibles son los elementos marcados con data-pdf-break en el documento.
 */
const PAGE_W = 210;
const PAGE_H = 297;
const TOP_MARGIN = 12; // mm, en las páginas 2 en adelante

async function render(el: HTMLElement) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas-pro'), import('jspdf')]);
  const canvas = await html2canvas(el, { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff' });
  const pxPerMm = canvas.width / PAGE_W;
  const ratio = canvas.height / el.offsetHeight; // de px del DOM a px del lienzo
  const top = el.getBoundingClientRect().top;
  // Puntos de corte: filas, totales, notas, forma de pago, firma… y, dentro de una descripción larga,
  // sus párrafos y las filas de sus tablas (así un ítem muy alto no deja la página anterior vacía).
  const marks = [...el.querySelectorAll<HTMLElement>('[data-pdf-break], .cc-doc__desc > p, .cc-doc__desc li, .cc-doc__desc tr')].map((n) => ({
    y: Math.round((n.getBoundingClientRect().top - top) * ratio),
    pay: n.dataset.pdfBreak === 'pay',
  }));
  const end = canvas.height;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });

  // Cortes: se llena cada página hasta el último punto de corte que quepa.
  const pages: [number, number][] = [];
  let start = 0;
  while (start < end) {
    const room = (PAGE_H - (pages.length ? TOP_MARGIN : 0)) * pxPerMm;
    if (end - start <= room) {
      pages.push([start, end]);
      break;
    }
    const pay = marks.find((m) => m.pay && m.y > start);
    // Si todo desde la forma de pago no cabe en lo que queda de esta página, se corta justo antes de ella.
    let cut = pay && pay.y - start <= room ? pay.y : 0;
    if (!cut) cut = Math.max(0, ...marks.filter((m) => m.y > start && m.y - start <= room).map((m) => m.y));
    if (cut <= start) cut = start + Math.floor(room); // sin punto de corte posible (una fila gigante): se corta a la altura de la hoja
    pages.push([start, cut]);
    start = cut;
  }

  pages.forEach(([from, to], i) => {
    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = to - from;
    const ctx = slice.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(canvas, 0, from, canvas.width, to - from, 0, 0, canvas.width, to - from);
    if (i > 0) pdf.addPage();
    pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, i > 0 ? TOP_MARGIN : 0, PAGE_W, (to - from) / pxPerMm);
  });
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
