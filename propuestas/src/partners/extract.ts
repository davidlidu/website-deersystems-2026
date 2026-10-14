import { readFile } from 'node:fs/promises';
import { AiError, completeJson, type Completion } from '../ai.ts';
import type { Proposal } from '../db.ts';
import { listVersionFiles, resolveFile } from '../storage.ts';
import type { Side } from './db.ts';

export interface DraftTask {
  title: string;
  description: string;
  side: Side;
  startDate: string | null;
  dueDate: string | null;
}

/** Reunión de avance con el cliente que propone el plan (inicio, cierre de fase, entrega). */
export interface DraftMeeting {
  title: string;
  /** Índice de la fase en `phases` donde queda como tarea. */
  phaseIndex: number;
  date: string | null;
  time: string;
  durationMinutes: number;
  purpose: string;
}

export interface Draft {
  projectName: string;
  clientName: string;
  contactName: string;
  clientEmail: string;
  clientPhone: string;
  /** Alcance sin valores: lo ve el equipo. */
  scope: string;
  /** Valores, forma de pago, vigencia: solo tú y el cliente. */
  pricing: string;
  startDate: string | null;
  endDate: string | null;
  /** Opción elegida si la propuesta traía alternativas, p. ej. "Opción B". */
  approvedOption: string;
  /** Ajustes acordados al aprobar ("sin app móvil", "pago en 3 cuotas"…). */
  approvalNotes: string;
  phases: { name: string; tasks: DraftTask[] }[];
  meetings: DraftMeeting[];
  warnings: string[];
}

/** Texto legible del HTML de la propuesta, sin scripts, estilos ni etiquetas. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|svg|noscript|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article|\/header|\/footer|\/table)\b[^>]*>/gi, '\n')
    .replace(/<(li)\b[^>]*>/gi, '\n• ')
    .replace(/<(td|th)\b[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Montos, monedas o formas de pago: no deberían aparecer en el alcance que ve el equipo. */
const PRICE_RE = /(\$\s?\d)|(\b(COP|USD|US\$|EUR|pesos|d[oó]lares)\b)|(\b\d{1,3}(?:[.,]\d{3}){2,}\b)|(\b(anticipo|abono|cuota|IVA|precio|valor total|inversi[oó]n)\b)/i;

export const mentionsPrice = (text: string) => PRICE_RE.test(text);

const SYSTEM = `Eres el asistente de operaciones de DeerSystems, una empresa colombiana de desarrollo de software, automatización e IA.
Recibes el texto de una propuesta comercial que el cliente ya aprobó y la conviertes en el plan de trabajo del proyecto.
Responde SOLO con un objeto JSON válido, en español, sin comentarios ni texto adicional.`;

/** Lo que eligió el cliente cuando la propuesta trae alternativas (Opción A / B, planes, paquetes). */
export interface Approval {
  option: { name: string; summary: string } | null;
  notes: string;
}

function approvalBlock(a: Approval): string {
  const lines: string[] = [];
  if (a.option) {
    lines.push(
      `- Opción aprobada: "${a.option.name}"${a.option.summary ? ` (${a.option.summary})` : ''}. Usa SOLO esta opción para el alcance, los valores, las fases y las tareas. Ignora por completo las demás opciones, como si no existieran.`,
    );
  }
  if (a.notes) lines.push(`- Ajustes acordados con el cliente: ${a.notes}. Aplícalos sobre la propuesta (agregan, quitan o cambian alcance o condiciones).`);
  return lines.length ? `\nLO QUE APROBÓ EL CLIENTE (obligatorio respetarlo):\n${lines.join('\n')}\n` : '';
}

function prompt(text: string, today: string, approval: Approval): string {
  return `Fecha de aprobación (hoy): ${today}.
${approvalBlock(approval)}

Devuelve este JSON:
{
  "projectName": "nombre corto del proyecto (máx. 80 caracteres)",
  "clientName": "empresa o persona cliente",
  "contactName": "persona de contacto si aparece, si no \\"\\"",
  "clientEmail": "correo del cliente si aparece, si no \\"\\"",
  "clientPhone": "teléfono si aparece, si no \\"\\"",
  "scope": "alcance aprobado en Markdown: objetivo, entregables, módulos/funcionalidades, supuestos y exclusiones. PROHIBIDO incluir precios, montos, monedas, IVA, descuentos, formas de pago o cualquier valor económico.",
  "pricing": "en Markdown: todos los valores, forma de pago, anticipos, vigencia y condiciones comerciales. \\"\\" si no hay.",
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "phases": [
    {
      "name": "nombre de la fase (p. ej. Descubrimiento, Diseño, Desarrollo, Pruebas, Entrega)",
      "tasks": [
        {
          "title": "tarea accionable que empiece con verbo (máx. 120 caracteres)",
          "description": "qué incluye y criterio de terminado, 1-3 frases",
          "side": "deersystems | cliente",
          "startDate": "YYYY-MM-DD",
          "dueDate": "YYYY-MM-DD"
        }
      ]
    }
  ],
  "meetings": [
    {
      "title": "Reunión de avance con el cliente: <qué se muestra>",
      "phase": "nombre exacto de la fase a la que pertenece",
      "date": "YYYY-MM-DD",
      "purpose": "qué se revisa o se presenta al cliente, 1 frase"
    }
  ]
}

Reglas:
- Usa el cronograma de la propuesta si lo tiene (semanas, fases, hitos). Si no, estima un plan realista. Fechas a partir de ${today}, solo días hábiles (lunes a viernes).
- "side" es "cliente" cuando la tarea depende del cliente: entregar accesos, contenidos, logos, información, aprobar diseños, validar entregables, hacer pagos. Todo lo demás es "deersystems".
- Incluye las tareas del cliente necesarias para que el proyecto avance (accesos, insumos, aprobaciones).
- Entre 3 y 7 fases y entre 2 y 8 tareas por fase. Nada genérico: cada tarea debe salir de la propuesta.
- Si un dato no aparece, usa "" (texto) y no lo inventes.
- "meetings": reuniones con el cliente para mostrar avances. Incluye un arranque (kickoff) en los primeros 3 días hábiles, una al cierre de cada fase principal para presentar lo avanzado y validar, y una de entrega final. Entre 3 y 6 en total, en días hábiles, con fecha coherente con el cronograma.

PROPUESTA:
"""
${text}
"""`;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);

/** Valida y recorta lo que devuelve el modelo (o lo que llega del panel al confirmar). */
export function normalizeDraft(raw: Record<string, unknown>): Draft {
  const phases = (Array.isArray(raw.phases) ? raw.phases : []).slice(0, 20).map((ph: Record<string, unknown>, i) => ({
    name: str(ph?.name, 120) || `Fase ${i + 1}`,
    tasks: (Array.isArray(ph?.tasks) ? ph.tasks : [])
      .slice(0, 60)
      .map((t: Record<string, unknown>) => ({
        title: str(t?.title, 200),
        description: str(t?.description, 2000),
        side: (t?.side === 'cliente' ? 'cliente' : 'deersystems') as Side,
        startDate: date(t?.startDate),
        dueDate: date(t?.dueDate),
      }))
      .filter((t) => t.title),
  }));
  const meetings: DraftMeeting[] = (Array.isArray(raw.meetings) ? raw.meetings : [])
    .slice(0, 12)
    .map((m: Record<string, unknown>) => {
      const phaseName = str(m?.phase, 120).toLowerCase();
      const byName = phases.findIndex((p) => p.name.toLowerCase() === phaseName);
      const idx = Number.isInteger(m?.phaseIndex) ? Number(m.phaseIndex) : byName;
      return {
        title: str(m?.title, 200),
        phaseIndex: idx >= 0 && idx < phases.length ? idx : 0,
        date: date(m?.date),
        time: typeof m?.time === 'string' && /^\d{2}:\d{2}$/.test(m.time) ? m.time : '10:00',
        durationMinutes: Math.min(240, Math.max(15, Number(m?.durationMinutes) || 45)),
        purpose: str(m?.purpose, 500),
      };
    })
    .filter((m) => m.title);
  const draft: Draft = {
    projectName: str(raw.projectName, 120),
    clientName: str(raw.clientName, 160),
    contactName: str(raw.contactName, 160),
    clientEmail: str(raw.clientEmail, 200).toLowerCase(),
    clientPhone: str(raw.clientPhone, 60),
    scope: str(raw.scope, 30_000),
    pricing: str(raw.pricing, 20_000),
    startDate: date(raw.startDate),
    endDate: date(raw.endDate),
    approvedOption: str(raw.approvedOption, 160),
    approvalNotes: str(raw.approvalNotes, 2000),
    phases,
    meetings,
    warnings: [],
  };
  if (mentionsPrice(draft.scope)) {
    draft.warnings.push('El alcance parece mencionar valores o pagos. Revísalo: tu equipo puede verlo.');
  }
  const tasks = phases.flatMap((p) => p.tasks);
  if (tasks.some((t) => mentionsPrice(`${t.title} ${t.description}`))) {
    draft.warnings.push('Alguna tarea menciona valores o pagos. Revísala: tu equipo puede verla.');
  }
  return draft;
}

/**
 * Texto que vive dentro del código: propuestas hechas con React, Babel o datos en JSON,
 * donde el HTML casi no trae texto visible. Toma las cadenas entre comillas y el texto de JSX,
 * y descarta lo que parece código o clases de CSS.
 */
export function codeToText(code: string): string {
  const out = new Set<string>();
  const add = (raw: string) => {
    const t = raw
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\n/g, ' ')
      .replace(/\\(["'`\\])/g, '$1')
      .replace(/\$\{[^}]*\}/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (t.length < 3 || !/\p{L}{2}/u.test(t)) return;
    // Clases (text-sm font-bold), rutas, URLs, identificadores y fragmentos de código no aportan.
    const tokens = t.split(' ');
    if (tokens.every((w) => /^[a-z0-9:/.[\]#%()_-]+$/.test(w)) && tokens.some((w) => /[-:/[]/.test(w))) return;
    if (/^(https?:|data:|\.{0,2}\/|#[0-9a-f]{3,8}$)/i.test(t)) return;
    if (/^[\w$.]+$/.test(t) && !/\s/.test(t) && !/[áéíóúñ]/i.test(t) && t.length < 25 && /[A-Z_$]/.test(t.slice(1))) return;
    if (/[{};]|=>|function\s*\(|&&|\|\||[=!]==?|\?\.|\breturn\b|\btypeof\b|\w\(|\)\w/.test(t)) return;
    // Una sola palabra en minúscula suele ser una clave o un nombre interno ("root", "anonymous").
    if (!t.includes(' ') && !/^\p{Lu}/u.test(t)) return;
    // Texto real: casi todo letras, números, espacios y puntuación de redacción.
    const prose = t.match(/[\p{L}\p{N}\s.,:;¿?¡!()$%·—–"'/+-]/gu)?.length ?? 0;
    if (prose / t.length < 0.9) return;
    out.add(t);
  };
  const clean = code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:"'\\])\/\/[^\n]*/g, '$1');
  for (const m of clean.matchAll(/"((?:[^"\\\n]|\\.){2,})"|'((?:[^'\\\n]|\\.){2,})'|`((?:[^`\\]|\\.){2,})`/g)) add(m[1] ?? m[2] ?? m[3]);
  // Texto entre etiquetas JSX: <p>Alcance del proyecto</p>
  for (const m of clean.matchAll(/>([^<>{}=;]*\p{L}[^<>{}=;]*)</gu)) add(m[1]);
  return [...out].join('\n');
}

const TEXT_FILES = /\.(m?js|jsx|json|html?|md|txt)$/i;
const MAX_TEXT = 150_000;

export async function proposalText(proposal: Pick<Proposal, 'id' | 'version'>): Promise<string> {
  const path = resolveFile(proposal.id, proposal.version, 'index.html');
  const html = path ? await readFile(path, 'utf8').catch(() => null) : null;
  if (!html) throw new AiError('No se encontró el HTML de la propuesta.');
  let text = htmlToText(html);

  // Poco texto visible: el contenido está en scripts (inline o en otros archivos del .zip).
  if (text.length < 1500) {
    // Las propuestas de generar_propuesta.py traen todo en <script type="application/json" id="propuesta">:
    // es la fuente más fiel, así que se pasa tal cual y no hace falta leer el código que la dibuja.
    const data = [...html.matchAll(/<script\b[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)]
      .map((m) => {
        try {
          return JSON.stringify(JSON.parse(m[1]));
        } catch {
          return m[1].trim();
        }
      })
      .filter((d) => d.length > 200);
    if (data.length) {
      return `${text}\n\n--- Contenido de la propuesta (datos estructurados en JSON) ---\n${data.join('\n')}`.slice(0, MAX_TEXT);
    }
    const parts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => codeToText(m[1]));
    for (const rel of (await listVersionFiles(proposal.id, proposal.version)).filter((f) => f !== 'index.html' && TEXT_FILES.test(f))) {
      const file = resolveFile(proposal.id, proposal.version, rel);
      const content = file ? await readFile(file, 'utf8').catch(() => '') : '';
      if (!content) continue;
      parts.push(/\.html?$/i.test(rel) ? htmlToText(content) : /\.(md|txt)$/i.test(rel) ? content : codeToText(content));
    }
    const extra = parts.filter(Boolean).join('\n').trim();
    if (extra) text = `${text}\n\n--- Contenido extraído del código de la propuesta ---\n${extra}`;
  }

  text = text.slice(0, MAX_TEXT);
  if (text.replace(/\s+/g, ' ').length < 200) {
    throw new AiError(
      'No se pudo leer el contenido de la propuesta: parece cargar su texto desde internet al abrirse. Súbela como un .html o .zip que incluya el contenido, o usa "Empezar en blanco".',
    );
  }
  return text;
}

const aiInfo = (c: Completion) => ({ provider: c.provider, model: c.model, costUsd: c.costUsd, latencyMs: c.latencyMs });

export interface ProposalOption {
  name: string;
  /** Qué incluye, sin valores. */
  summary: string;
  /** Valor tal como aparece en la propuesta; solo lo ve el administrador. */
  price: string;
}

/** ¿La propuesta ofrece alternativas excluyentes (Opción A / B, planes, paquetes)? Devuelve [] si es una sola oferta. */
export async function detectOptions(proposal: Proposal) {
  const text = await proposalText(proposal);
  const { data, completion } = await completeJson<{ options?: unknown }>({
    profile: 'propuestas',
    purpose: 'propuesta-opciones',
    system: 'Analizas propuestas comerciales de DeerSystems. Responde SOLO con JSON válido, en español.',
    prompt: `¿Esta propuesta le ofrece al cliente varias alternativas EXCLUYENTES entre las que debe elegir una (p. ej. "Opción A" y "Opción B", planes Básico/Pro, paquetes, modalidades de contratación)?
No cuentes como alternativas: fases del mismo proyecto, módulos que van todos incluidos, ni adicionales opcionales que se suman a la oferta.

Devuelve:
{
  "options": [
    { "name": "nombre tal como aparece (p. ej. \"Opción B · Plataforma completa\")", "summary": "qué incluye en 1-2 frases, SIN valores", "price": "valor y forma de pago tal como aparecen, o \"\"" }
  ]
}
Si es una sola oferta, devuelve {"options": []}.

PROPUESTA:
"""
${text}
"""`,
    maxOutputTokens: 4096,
  });
  const options: ProposalOption[] = (Array.isArray(data.options) ? data.options : [])
    .slice(0, 8)
    .map((o: Record<string, unknown>) => ({ name: str(o?.name, 160), summary: str(o?.summary, 600), price: str(o?.price, 400) }))
    .filter((o) => o.name);
  return { options: options.length > 1 ? options : [], ai: aiInfo(completion) };
}

export async function extractDraft(proposal: Proposal, approval: Approval = { option: null, notes: '' }) {
  const text = await proposalText(proposal);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  const { data, completion } = await completeJson<Record<string, unknown>>({
    profile: 'propuestas',
    purpose: 'propuesta',
    system: SYSTEM,
    prompt: prompt(text, today, approval),
  });
  const draft = normalizeDraft(data);
  draft.approvedOption = approval.option?.name ?? '';
  draft.approvalNotes = approval.notes;
  if (!draft.phases.some((p) => p.tasks.length)) {
    throw new AiError(`El modelo ${completion.model} no devolvió tareas. Vuelve a intentarlo o prueba otro modelo.`);
  }
  return { draft, ai: aiInfo(completion) };
}
