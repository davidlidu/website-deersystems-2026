import { addDays, dayLabel, daysBetween, formatDate, isOverdue, STATUS, today, type ProjectDetail, type Task } from '../../lib';

/**
 * Cronograma en PDF (A4 horizontal), dibujado con jsPDF: texto y barras en vector, nítido al imprimir y liviano.
 * Una fila por tarea, agrupadas por fase, con su inicio, entrega y la barra en la línea de tiempo de todo el proyecto.
 * Si no cabe en una hoja, sigue en las siguientes repitiendo el encabezado de la línea de tiempo.
 */

type RGB = [number, number, number];
const INK: RGB = [17, 24, 39];
const MUTE: RGB = [107, 114, 128];
const LINE: RGB = [229, 231, 235];
const SOFT: RGB = [243, 244, 246];
const WEEKEND: RGB = [249, 250, 251];
const VERDE: RGB = [126, 217, 87];
const CIAN: RGB = [0, 180, 216];
const ORO: RGB = [255, 183, 3];
const CORAL: RGB = [239, 71, 111];
const NARANJA: RGB = [251, 133, 0];

const W = 297;
const H = 210;
const M = 10; // margen
const NAME_W = 82;
const DATE_W = 17;
const TL_X = M + NAME_W + DATE_W * 2 + 3; // inicio de la línea de tiempo
const TL_W = W - M - TL_X;
const ROW = 6.2;
const HEAD_ROWS = 10; // alto del encabezado de la escala (meses + días)

/** Inicio y fin de la barra: si falta una fecha, la tarea dura un día. */
function span(t: Task): [string, string] | null {
  const start = t.startDate ?? t.dueDate;
  const end = t.dueDate ?? t.startDate;
  return start && end ? [start, end < start ? start : end] : null;
}

const barColor = (t: Task): RGB => (t.status === 'completada' ? VERDE : t.status === 'bloqueada' ? CORAL : t.side === 'cliente' ? ORO : CIAN);
const short = (iso: string) => dayLabel(iso, { day: 'numeric', month: 'short' }).replace('.', '');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export async function downloadGanttPdf(project: ProjectDetail, tasks: Task[], opts: { filtered: boolean }): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  const now = today();
  const fill = (c: RGB) => pdf.setFillColor(c[0], c[1], c[2]);
  const draw = (c: RGB) => pdf.setDrawColor(c[0], c[1], c[2]);
  const ink = (c: RGB) => pdf.setTextColor(c[0], c[1], c[2]);
  const font = (size: number, style: 'normal' | 'bold' = 'normal') => {
    pdf.setFont('helvetica', style);
    pdf.setFontSize(size);
  };
  /** Recorta el texto con «…» para que quepa en el ancho dado. */
  const fit = (text: string, width: number) => {
    if (pdf.getTextWidth(text) <= width) return text;
    let t = text;
    while (t.length > 1 && pdf.getTextWidth(`${t}…`) > width) t = t.slice(0, -1);
    return `${t.trimEnd()}…`;
  };

  // ── Rango de la línea de tiempo: todo el proyecto y sus tareas, de lunes a domingo.
  const dated = tasks.filter((t) => span(t));
  const dates = [project.startDate, project.endDate, ...dated.flatMap((t) => span(t)!)].filter(Boolean) as string[];
  if (!dates.length) dates.push(now);
  const min = dates.reduce((a, b) => (a < b ? a : b));
  const max = dates.reduce((a, b) => (a > b ? a : b));
  const first = addDays(min, -((new Date(`${min}T12:00:00`).getDay() + 6) % 7));
  const lastDay = addDays(max, 6 - ((new Date(`${max}T12:00:00`).getDay() + 6) % 7));
  const total = daysBetween(first, lastDay) + 1;
  const day = TL_W / total;
  const x = (iso: string) => TL_X + daysBetween(first, iso) * day;

  // ── Filas: fase (con su barra de inicio a fin) y sus tareas.
  type Row = { kind: 'phase'; name: string; done: number; count: number; s: string | null; e: string | null } | { kind: 'task'; t: Task };
  const groups = [
    ...project.phases.map((ph) => ({ name: ph.name, tasks: dated.filter((t) => t.phaseId === ph.id) })),
    { name: 'Sin fase', tasks: dated.filter((t) => !t.phaseId || !project.phases.some((ph) => ph.id === t.phaseId)) },
  ].filter((g) => g.tasks.length);
  const rows: Row[] = [];
  for (const g of groups) {
    const spans = g.tasks.map((t) => span(t)!);
    const sorted = [...g.tasks].sort((a, b) => span(a)![0].localeCompare(span(b)![0]) || a.id - b.id);
    rows.push({
      kind: 'phase',
      name: g.name,
      done: g.tasks.filter((t) => t.status === 'completada').length,
      count: g.tasks.length,
      s: spans.reduce((a, b) => (a < b[0] ? a : b[0]), spans[0][0]),
      e: spans.reduce((a, b) => (a > b[1] ? a : b[1]), spans[0][1]),
    });
    for (const t of sorted) rows.push({ kind: 'task', t });
  }
  const unscheduled = tasks.filter((t) => !span(t));

  // ── Encabezado de la primera hoja
  const header = () => {
    font(8, 'bold');
    ink(VERDE);
    pdf.text('DEERSYSTEMS · CRONOGRAMA', M, M + 3);
    font(17, 'bold');
    ink(INK);
    pdf.text(fit(project.name, W - 2 * M - 70), M, M + 11);
    font(9);
    ink(MUTE);
    const done = tasks.filter((t) => t.status === 'completada').length;
    const facts = [
      project.clientName,
      project.startDate || project.endDate ? `${project.startDate ? formatDate(project.startDate) : '¿?'} – ${project.endDate ? formatDate(project.endDate) : '¿?'}` : null,
      `${done}/${tasks.length} tareas completadas`,
    ].filter(Boolean);
    pdf.text(facts.join('   ·   '), M, M + 17);
    font(8);
    pdf.text(`Generado el ${formatDate(now)}${opts.filtered ? ' · con los filtros aplicados' : ''}`, W - M, M + 3, { align: 'right' });
    // Leyenda
    const legend: [RGB, string][] = [
      [CIAN, 'DeerSystems'],
      [ORO, 'Cliente'],
      [VERDE, 'Completada'],
      [CORAL, 'Bloqueada'],
      [NARANJA, 'Reunión'],
    ];
    let lx = W - M;
    for (const [c, label] of [...legend].reverse()) {
      const tw = pdf.getTextWidth(label);
      lx -= tw;
      ink(MUTE);
      pdf.text(label, lx, M + 17);
      lx -= 4.5;
      fill(c);
      pdf.roundedRect(lx, M + 14.6, 3.2, 3.2, 0.6, 0.6, 'F');
      lx -= 4;
    }
    return M + 23;
  };

  // ── Escala: meses arriba, semanas (o días) abajo, con los fines de semana sombreados.
  const scale = (top: number, bottom: number) => {
    // Fondo: fines de semana (si los días tienen ancho para verse) y líneas de semana.
    for (let i = 0; i < total; i++) {
      const d = addDays(first, i);
      const wd = (new Date(`${d}T12:00:00`).getDay() + 6) % 7;
      if (wd >= 5 && day >= 0.9) {
        fill(WEEKEND);
        pdf.rect(TL_X + i * day, top, day, bottom - top, 'F');
      }
    }
    draw(LINE);
    pdf.setLineWidth(0.15);
    for (let i = 0; i <= total; i += 7) pdf.line(TL_X + i * day, top + 5, TL_X + i * day, bottom);
    // Meses
    font(7, 'bold');
    ink(INK);
    for (let i = 0; i < total; i++) {
      const d = addDays(first, i);
      if (i === 0 || d.endsWith('-01')) {
        const next = (() => {
          for (let j = i + 1; j < total; j++) if (addDays(first, j).endsWith('-01')) return j;
          return total;
        })();
        const w = (next - i) * day;
        const label = cap(dayLabel(d, { month: w > 22 ? 'long' : 'short', year: w > 30 ? 'numeric' : undefined }).replace('.', ''));
        if (w > 8) pdf.text(fit(label, w - 1.5), TL_X + i * day + 1, top + 3.4);
        if (i > 0) {
          draw([209, 213, 219]);
          pdf.line(TL_X + i * day, top, TL_X + i * day, bottom);
          draw(LINE);
        }
      }
    }
    // Semanas: el lunes de cada una (o cada 2 o 4 si son muchas).
    font(6);
    ink(MUTE);
    const weekW = 7 * day;
    const every = weekW >= 9 ? 1 : weekW >= 4.5 ? 2 : 4;
    for (let i = 0, n = 0; i < total; i += 7, n++) {
      if (n % every) continue;
      pdf.text(weekW >= 9 ? short(addDays(first, i)) : String(Number(addDays(first, i).slice(8))), TL_X + i * day + 0.8, top + 8.2);
    }
    draw(LINE);
    pdf.line(M, top + HEAD_ROWS - 0.5, W - M, top + HEAD_ROWS - 0.5);
    // Columnas de la izquierda
    font(6.5, 'bold');
    ink(MUTE);
    pdf.text('TAREA', M + 1, top + 8.2);
    pdf.text('INICIO', M + NAME_W, top + 8.2);
    pdf.text('ENTREGA', M + NAME_W + DATE_W, top + 8.2);
  };

  const today_ = (top: number, bottom: number) => {
    if (now < first || now > lastDay) return;
    const tx = x(now) + day / 2;
    pdf.setDrawColor(239, 71, 111);
    pdf.setLineWidth(0.35);
    pdf.setLineDashPattern([1, 0.8], 0);
    pdf.line(tx, top, tx, bottom);
    pdf.setLineDashPattern([], 0);
    font(6, 'bold');
    pdf.setTextColor(239, 71, 111);
    pdf.text('Hoy', tx, bottom + 3, { align: 'center' });
  };

  // ── Páginas
  const pages: { top: number; rows: Row[] }[] = [];
  let top = header();
  let room = Math.floor((H - M - 8 - (top + HEAD_ROWS)) / ROW);
  for (let i = 0; i < rows.length; ) {
    // Una fase no queda sola al final de una hoja.
    let take = Math.min(room, rows.length - i);
    if (take < rows.length - i && rows[i + take - 1].kind === 'phase') take--;
    pages.push({ top, rows: rows.slice(i, i + take) });
    i += take;
    top = M + 4;
    room = Math.floor((H - M - 8 - (top + HEAD_ROWS)) / ROW);
  }
  if (!pages.length) pages.push({ top, rows: [] });

  pages.forEach((page, p) => {
    if (p > 0) pdf.addPage();
    const bodyTop = page.top + HEAD_ROWS;
    const bottom = bodyTop + page.rows.length * ROW;
    scale(page.top, Math.max(bottom, bodyTop + ROW));
    page.rows.forEach((r, i) => {
      const y = bodyTop + i * ROW;
      const mid = y + ROW / 2;
      if (r.kind === 'phase') {
        fill(SOFT);
        pdf.rect(M, y + 0.3, TL_X - M - 1, ROW - 0.6, 'F');
        font(7.5, 'bold');
        ink(INK);
        pdf.text(fit(r.name, NAME_W - 14), M + 1.5, mid + 1.1);
        font(6.5);
        ink(MUTE);
        pdf.text(`${r.done}/${r.count}`, M + NAME_W - 3, mid + 1.1, { align: 'right' });
        if (r.s && r.e) {
          pdf.text(short(r.s), M + NAME_W, mid + 1.1);
          pdf.text(short(r.e), M + NAME_W + DATE_W, mid + 1.1);
          const bx = x(r.s);
          const bw = Math.max((daysBetween(r.s, r.e) + 1) * day, 0.8);
          fill([209, 213, 219]);
          pdf.roundedRect(bx, mid - 0.9, bw, 1.8, 0.6, 0.6, 'F');
          if (r.done) {
            fill([107, 114, 128]);
            pdf.roundedRect(bx, mid - 0.9, Math.max(bw * (r.done / r.count), 0.8), 1.8, 0.6, 0.6, 'F');
          }
        }
      } else {
        const t = r.t;
        const [s, e] = span(t)!;
        draw(LINE);
        pdf.setLineWidth(0.1);
        pdf.line(M, y + ROW, W - M, y + ROW);
        // Estado: punto de color y el título.
        fill(barColor(t));
        pdf.circle(M + 2.6, mid, 0.9, 'F');
        font(7.5);
        ink(t.status === 'completada' ? MUTE : INK);
        const who = t.side === 'cliente' ? 'Cliente' : t.assigneeName || '';
        const meta = `${STATUS[t.status]}${who ? ` · ${who}` : ''}`;
        font(6);
        const metaW = Math.min(pdf.getTextWidth(meta), 28);
        font(7.5);
        pdf.text(fit(t.title, NAME_W - 9 - metaW), M + 5, mid + 1.1);
        font(6);
        ink(isOverdue(t) ? CORAL : MUTE);
        pdf.text(fit(isOverdue(t) ? `Vencida · ${who || STATUS[t.status]}` : meta, 28), M + NAME_W - 3, mid + 1.1, { align: 'right' });
        font(7);
        ink(INK);
        pdf.text(short(s), M + NAME_W, mid + 1.1);
        ink(isOverdue(t) ? CORAL : INK);
        pdf.text(short(e), M + NAME_W + DATE_W, mid + 1.1);
        // Barra
        const bx = x(s);
        const bw = Math.max((daysBetween(s, e) + 1) * day, 1);
        fill(barColor(t));
        pdf.roundedRect(bx, y + 1.3, bw, ROW - 2.6, 0.8, 0.8, 'F');
        if (t.isMeeting) {
          fill(NARANJA);
          pdf.rect(bx + bw - Math.min(0.9, bw / 2), y + 1.3, Math.min(0.9, bw / 2), ROW - 2.6, 'F');
        }
        if (isOverdue(t)) {
          pdf.setDrawColor(239, 71, 111);
          pdf.setLineWidth(0.35);
          pdf.roundedRect(bx, y + 1.3, bw, ROW - 2.6, 0.8, 0.8, 'S');
        }
        // Título junto a la barra, si hay espacio a la derecha.
        font(6);
        ink(MUTE);
        const after = W - M - (bx + bw) - 1.5;
        if (bw < 30 && after > 14) pdf.text(fit(t.title, Math.min(after, 60)), bx + bw + 1.2, mid + 1);
      }
    });
    today_(page.top + HEAD_ROWS, Math.max(bottom, bodyTop + ROW));
    if (!page.rows.length) {
      font(9);
      ink(MUTE);
      pdf.text('No hay tareas con fechas.', M, bodyTop + 8);
    }
  });

  // ── Tareas sin fechas, al final.
  if (unscheduled.length) {
    const last = pages[pages.length - 1];
    let y = last.top + HEAD_ROWS + last.rows.length * ROW + 9;
    const line = (text: string, size: number, style: 'normal' | 'bold', color: RGB) => {
      if (y > H - M - 8) {
        pdf.addPage();
        y = M + 6;
      }
      font(size, style);
      ink(color);
      pdf.text(fit(text, W - 2 * M), M, y);
      y += size * 0.5;
    };
    line(`Sin fechas (${unscheduled.length})`, 8.5, 'bold', INK);
    y += 1;
    for (const t of unscheduled) line(`•  ${t.title}  —  ${STATUS[t.status]}${t.side === 'cliente' ? ' · Cliente' : t.assigneeName ? ` · ${t.assigneeName}` : ''}`, 7.5, 'normal', MUTE);
  }

  // ── Pie en todas las hojas
  const count = pdf.getNumberOfPages();
  for (let i = 1; i <= count; i++) {
    pdf.setPage(i);
    font(7);
    ink(MUTE);
    pdf.text(fit(`${project.name} · ${project.clientName}`, 200), M, H - 6);
    pdf.text(`Página ${i} de ${count}`, W - M, H - 6, { align: 'right' });
  }

  pdf.save(`Cronograma ${project.name}.pdf`.replace(/[\\/:*?"<>|]+/g, '-'));
}
