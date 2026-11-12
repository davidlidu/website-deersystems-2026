import { addDays, dayLabel, daysBetween, formatDate, isOverdue, STATUS, today, type ProjectDetail, type Task } from '../../lib';

/**
 * Plan de trabajo en PDF (A4 horizontal), dibujado con jsPDF: texto y barras en vector, nítido al imprimir y liviano.
 * 1. Encabezado con la marca de DeerSystems y los datos del proyecto.
 * 2. Las tareas agrupadas por fase: responsable, estado, inicio y entrega (también las que no tienen fechas).
 * 3. El cronograma: una fila por tarea con su barra en la línea de tiempo de todo el proyecto.
 * Cada hoja lleva la franja de la marca arriba y el pie con la página; las tablas repiten su encabezado al cambiar de hoja.
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
const AZUL: RGB = [5, 25, 35];
const BAND = 30; // alto de la franja con la marca en la primera hoja
const TOP = M + 11; // dónde empieza el contenido en las demás hojas (debajo de la franja delgada)
const BOTTOM = H - M - 6; // hasta dónde llega el contenido (encima del pie)
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

/** El logo (el mismo del portal) en PNG, para ponerlo en el PDF. Sin él, el PDF sale igual con el nombre. */
async function logoPng(): Promise<string | null> {
  try {
    const svg = await (await fetch('/favicon.svg')).text();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const img = new Image();
      await new Promise((ok, ko) => {
        img.onload = ok;
        img.onerror = ko;
        img.src = url;
      });
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      c.getContext('2d')!.drawImage(img, 0, 0, 256, 256);
      return c.toDataURL('image/png');
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

export async function downloadPlanPdf(project: ProjectDetail, tasks: Task[], opts: { filtered: boolean }): Promise<void> {
  const [{ jsPDF }, logo] = await Promise.all([import('jspdf'), logoPng()]);
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

  const done = tasks.filter((t) => t.status === 'completada').length;
  const who = (t: Task) => (t.side === 'cliente' ? (t.assigneeName ? `Cliente · ${t.assigneeName}` : 'Cliente') : t.assigneeName || 'DeerSystems');

  /** «DeerSystems» con «Deer» en verde, como en el portal. */
  const wordmark = (x0: number, y0: number, size: number, rest: RGB) => {
    font(size, 'bold');
    ink(VERDE);
    pdf.text('Deer', x0, y0);
    ink(rest);
    pdf.text('Systems', x0 + pdf.getTextWidth('Deer'), y0);
    return x0 + pdf.getTextWidth('DeerSystems');
  };

  // ── Primera hoja: franja con la marca y, debajo, el proyecto.
  const cover = () => {
    fill(AZUL);
    pdf.rect(0, 0, W, BAND, 'F');
    fill(VERDE);
    pdf.rect(0, BAND, W * 0.55, 0.9, 'F');
    fill(CIAN);
    pdf.rect(W * 0.55, BAND, W * 0.45, 0.9, 'F');
    let tx = M;
    if (logo) {
      pdf.addImage(logo, 'PNG', M, 7, 16, 16);
      tx = M + 20;
    }
    wordmark(tx, 15.5, 16, [242, 246, 248]);
    font(7.5, 'bold');
    ink(CIAN);
    pdf.text('PLAN DE TRABAJO', tx, 21.5);
    font(8);
    ink([185, 198, 210]);
    pdf.text(`Generado el ${formatDate(now)}`, W - M, 13, { align: 'right' });
    if (opts.filtered) pdf.text('Con los filtros aplicados', W - M, 18, { align: 'right' });

    font(17, 'bold');
    ink(INK);
    pdf.text(fit(project.name, W - 2 * M - 80), M, BAND + 11);
    font(9);
    ink(MUTE);
    const facts = [
      project.clientName,
      project.startDate || project.endDate ? `${project.startDate ? formatDate(project.startDate) : '¿?'} – ${project.endDate ? formatDate(project.endDate) : '¿?'}` : null,
      `${done}/${tasks.length} tareas completadas`,
    ].filter(Boolean);
    pdf.text(facts.join('   ·   '), M, BAND + 17);
    // Avance general
    const pct = tasks.length ? done / tasks.length : 0;
    const bw = 70;
    font(8, 'bold');
    ink(INK);
    pdf.text(`${Math.round(pct * 100)}%`, W - M, BAND + 10, { align: 'right' });
    fill(SOFT);
    pdf.roundedRect(W - M - bw, BAND + 13.5, bw, 2.6, 1.3, 1.3, 'F');
    if (pct > 0) {
      fill(VERDE);
      pdf.roundedRect(W - M - bw, BAND + 13.5, Math.max(bw * pct, 2.6), 2.6, 1.3, 1.3, 'F');
    }
    font(7);
    ink(MUTE);
    pdf.text('Avance', W - M - bw, BAND + 10);
    return BAND + 24;
  };

  // ── Las demás hojas: franja delgada con el logo, la marca y el proyecto.
  const bar = () => {
    if (logo) pdf.addImage(logo, 'PNG', M, M - 4.2, 6, 6);
    const after = wordmark(M + (logo ? 7.5 : 0), M, 9, INK);
    font(7, 'bold');
    ink(MUTE);
    pdf.text('PLAN DE TRABAJO', after + 3, M);
    font(7.5);
    pdf.text(fit(`${project.name} · ${project.clientName}`, 150), W - M, M, { align: 'right' });
    draw(LINE);
    pdf.setLineWidth(0.3);
    pdf.line(M, M + 3, W - M, M + 3);
  };
  const newPage = () => {
    pdf.addPage();
    bar();
    return TOP;
  };

  /** Título de sección: número, nombre y una línea de texto suave a la derecha. */
  const section = (y: number, n: number, title: string, note: string) => {
    fill(VERDE);
    pdf.roundedRect(M, y - 3.6, 5, 5, 1, 1, 'F');
    font(8, 'bold');
    ink(AZUL);
    pdf.text(String(n), M + 2.5, y + 0.1, { align: 'center' });
    font(12, 'bold');
    ink(INK);
    pdf.text(title, M + 7.5, y + 0.6);
    const tw = pdf.getTextWidth(title);
    if (note) {
      font(7.5);
      ink(MUTE);
      pdf.text(note, M + 10 + tw, y + 0.4);
    }
    return y + 6;
  };

  // ── 1. Tareas por fase
  const C = { title: M + 5, who: M + 143, status: M + 191, start: M + 228, end: M + 253 };
  const tableHead = (y: number) => {
    font(6.5, 'bold');
    ink(MUTE);
    pdf.text('TAREA', M + 1, y + 3.6);
    pdf.text('RESPONSABLE', C.who, y + 3.6);
    pdf.text('ESTADO', C.status, y + 3.6);
    pdf.text('INICIO', C.start, y + 3.6);
    pdf.text('ENTREGA', C.end, y + 3.6);
    draw([209, 213, 219]);
    pdf.setLineWidth(0.25);
    pdf.line(M, y + 5.4, W - M, y + 5.4);
    return y + 6;
  };
  const byStart = (a: Task, b: Task) => {
    const sa = span(a)?.[0];
    const sb = span(b)?.[0];
    return sa && sb ? sa.localeCompare(sb) : sa ? -1 : sb ? 1 : 0;
  };
  const listGroups = [
    ...project.phases.map((ph) => ({ name: ph.name, tasks: tasks.filter((t) => t.phaseId === ph.id) })),
    { name: 'Sin fase', tasks: tasks.filter((t) => !t.phaseId || !project.phases.some((ph) => ph.id === t.phaseId)) },
  ]
    .filter((g) => g.tasks.length)
    .map((g) => ({ ...g, tasks: [...g.tasks].sort(byStart) }));

  const taskList = () => {
    let y = section(cover() + 4, 1, 'Tareas por fase', `${tasks.length} tareas · ${listGroups.length} ${listGroups.length === 1 ? 'fase' : 'fases'}`);
    y = tableHead(y);
    const room = (rows: number) => y + rows * ROW <= BOTTOM;
    for (const g of listGroups) {
      // La fase no queda sola al final de una hoja: con ella baja al menos su primera tarea.
      if (!room(2)) y = tableHead(newPage());
      const spans = g.tasks.map(span).filter((x): x is [string, string] => !!x);
      const gDone = g.tasks.filter((t) => t.status === 'completada').length;
      fill(SOFT);
      pdf.rect(M, y + 0.3, W - 2 * M, ROW - 0.6, 'F');
      fill(gDone === g.tasks.length ? VERDE : CIAN);
      pdf.rect(M, y + 0.3, 0.9, ROW - 0.6, 'F');
      font(8, 'bold');
      ink(INK);
      pdf.text(fit(g.name, 120), M + 2.5, y + ROW / 2 + 1.1);
      font(7);
      ink(MUTE);
      pdf.text(`${gDone}/${g.tasks.length} completadas`, C.who, y + ROW / 2 + 1.1);
      if (spans.length) {
        pdf.text(short(spans.reduce((a, b) => (a < b[0] ? a : b[0]), spans[0][0])), C.start, y + ROW / 2 + 1.1);
        pdf.text(short(spans.reduce((a, b) => (a > b[1] ? a : b[1]), spans[0][1])), C.end, y + ROW / 2 + 1.1);
      }
      y += ROW;
      for (const t of g.tasks) {
        if (!room(1)) y = tableHead(newPage());
        const mid = y + ROW / 2;
        const sp = span(t);
        const late = isOverdue(t);
        fill(barColor(t));
        pdf.circle(M + 2.6, mid, 0.9, 'F');
        font(7.5);
        ink(t.status === 'completada' ? MUTE : INK);
        pdf.text(fit(t.title, C.who - C.title - 4), C.title, mid + 1.1);
        if (t.isMeeting) {
          const tw = Math.min(pdf.getTextWidth(t.title), C.who - C.title - 4);
          if (tw < C.who - C.title - 18) {
            font(6, 'bold');
            ink(NARANJA);
            pdf.text('REUNIÓN', C.title + tw + 2, mid + 1);
          }
        }
        font(7);
        ink(INK);
        pdf.text(fit(who(t), C.status - C.who - 3), C.who, mid + 1.1);
        ink(late ? CORAL : t.status === 'completada' ? [63, 140, 40] : t.status === 'bloqueada' ? CORAL : INK);
        pdf.text(late ? `${STATUS[t.status]} · vencida` : STATUS[t.status], C.status, mid + 1.1);
        ink(sp ? INK : MUTE);
        pdf.text(t.startDate ? short(t.startDate) : '—', C.start, mid + 1.1);
        ink(late ? CORAL : t.dueDate ? INK : MUTE);
        pdf.text(t.dueDate ? short(t.dueDate) : '—', C.end, mid + 1.1);
        draw(LINE);
        pdf.setLineWidth(0.1);
        pdf.line(M, y + ROW, W - M, y + ROW);
        y += ROW;
      }
      y += 1.5;
    }
    if (!tasks.length) {
      font(9);
      ink(MUTE);
      pdf.text('No hay tareas.', M, y + 6);
    }
  };

  // ── 2. Cronograma: encabezado de la sección con la leyenda.
  const ganttTitle = (y: number) => {
    const next = section(y, 2, 'Cronograma', unscheduled.length ? `${unscheduled.length} sin fechas: están en la lista de tareas` : '');
    const legend: [RGB, string][] = [
      [CIAN, 'DeerSystems'],
      [ORO, 'Cliente'],
      [VERDE, 'Completada'],
      [CORAL, 'Bloqueada'],
      [NARANJA, 'Reunión'],
    ];
    font(7.5);
    let lx = W - M;
    for (const [c, label] of [...legend].reverse()) {
      lx -= pdf.getTextWidth(label);
      ink(MUTE);
      pdf.text(label, lx, y + 0.4);
      lx -= 4.5;
      fill(c);
      pdf.roundedRect(lx, y - 2, 3.2, 3.2, 0.6, 0.6, 'F');
      lx -= 4;
    }
    return next;
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
  taskList();
  const pages: { top: number; rows: Row[] }[] = [];
  // El título de la sección va en la primera hoja del cronograma (se dibuja al crearla); deja 10 mm.
  let top = TOP + 10;
  let room = Math.floor((BOTTOM - (top + HEAD_ROWS)) / ROW);
  for (let i = 0; i < rows.length; ) {
    // Una fase no queda sola al final de una hoja.
    let take = Math.min(room, rows.length - i);
    if (take < rows.length - i && rows[i + take - 1].kind === 'phase') take--;
    pages.push({ top, rows: rows.slice(i, i + take) });
    i += take;
    top = TOP;
    room = Math.floor((BOTTOM - (top + HEAD_ROWS)) / ROW);
  }
  if (!pages.length) pages.push({ top, rows: [] });

  pages.forEach((page, p) => {
    newPage();
    if (p === 0) ganttTitle(TOP + 4);
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
        const meta = isOverdue(t) ? `Vencida · ${who || STATUS[t.status]}` : `${STATUS[t.status]}${who ? ` · ${who}` : ''}`;
        font(6);
        const metaW = Math.min(pdf.getTextWidth(meta), 28);
        font(7.5);
        pdf.text(fit(t.title, NAME_W - 9 - metaW), M + 5, mid + 1.1);
        font(6);
        ink(isOverdue(t) ? CORAL : MUTE);
        pdf.text(fit(meta, 28), M + NAME_W - 3, mid + 1.1, { align: 'right' });
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

  // ── Pie en todas las hojas
  const count = pdf.getNumberOfPages();
  for (let i = 1; i <= count; i++) {
    pdf.setPage(i);
    font(7);
    ink(MUTE);
    pdf.text('DeerSystems · deersystems.net', M, H - 6);
    pdf.text(`Página ${i} de ${count}`, W - M, H - 6, { align: 'right' });
  }

  pdf.save(`Plan de trabajo ${project.name}.pdf`.replace(/[\\/:*?"<>|]+/g, '-'));
}
