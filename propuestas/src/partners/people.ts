import type { IncomingMessage, ServerResponse } from 'node:http';
import { AiError, completeJson } from '../ai.ts';
import { db as sqlite } from '../db.ts';
import { HttpError, json, readJson } from '../http.ts';
import type { Viewer } from './auth.ts';
import { requireOwner, str } from './common.ts';
import * as db from './db.ts';

/**
 * Proyectos compartidos: el cliente pone parte del equipo (p. ej. dos personas con ciertas habilidades) y DeerSystems
 * ejecuta el resto y orquesta. El equipo del proyecto (quién, de qué lado, con qué habilidades) se arma al aprobar:
 * a mano o leyendo la reunión grabada donde se presentaron. La IA reparte las tareas del plan según esas habilidades,
 * con DeerSystems como orquestador y la mayor carga. Las tareas de una persona del cliente quedan del lado del cliente
 * con su nombre («Cliente · Ana»); las del equipo de DeerSystems, asignadas a su cuenta.
 */

export interface ProjectPerson {
  /** Clave estable en pantalla: 'yo' = DeerSystems (tú), el orquestador. */
  key: string;
  name: string;
  side: 'deersystems' | 'cliente';
  /** Rol y habilidades, en texto libre («diseñadora UX, Figma; maneja el CRM de ventas»). */
  skills: string;
  /** Cuenta del equipo de DeerSystems, si la persona la tiene (para asignarle las tareas). */
  accountId: number | null;
  /** El orquestador: lleva la coordinación y la mayor carga. */
  lead: boolean;
}

export const OWNER_KEY = 'yo';

export function normalizePeople(raw: unknown): ProjectPerson[] {
  const team = new Set(db.listTeam().map((a) => a.id));
  const seen = new Set<string>();
  return ((Array.isArray(raw) ? raw : []) as Record<string, unknown>[])
    .slice(0, 30)
    .map((p, i) => {
      const side = p?.side === 'cliente' ? ('cliente' as const) : ('deersystems' as const);
      const accountId = side === 'deersystems' && team.has(Number(p?.accountId)) ? Number(p.accountId) : null;
      return {
        key: str(p?.key, 40) || `p${i}`,
        name: str(p?.name, 120).trim(),
        side,
        skills: str(p?.skills, 1000).trim(),
        accountId,
        lead: p?.key === OWNER_KEY || p?.lead === true,
      };
    })
    .filter((p) => p.name && !seen.has(p.key) && seen.add(p.key));
}

export const peopleOf = (project: Pick<db.Project, 'people'>): ProjectPerson[] => {
  try {
    return normalizePeople(JSON.parse(project.people || '[]'));
  } catch {
    return [];
  }
};

const aiInfo = (c: { provider: string; model: string; costUsd: number; latencyMs: number }) => ({ provider: c.provider, model: c.model, costUsd: c.costUsd, latencyMs: c.latencyMs });

/** Las personas que se presentaron en la reunión grabada y sus habilidades (para revisar antes de usarlas). */
async function peopleFromMeeting(meetingId: number) {
  const m = sqlite.prepare('SELECT id, title, start_at, attendees, transcript, summary FROM meetings WHERE id = ?').get(meetingId) as
    | { id: number; title: string; start_at: string; attendees: string; transcript: string | null; summary: string }
    | undefined;
  if (!m) throw new HttpError(404, 'La reunión no existe.');
  const text = (m.transcript || m.summary || '').trim();
  if (text.length < 50) throw new HttpError(400, 'Esa reunión no tiene transcripción. Tráela primero desde Reuniones o escribe los perfiles a mano.');
  const { data, completion } = await completeJson<Record<string, unknown>>({
    profile: 'reuniones',
    purpose: 'equipo del proyecto desde una reunión',
    system: `Eres el asistente de operaciones de DeerSystems. Lees la transcripción de una reunión y sacas quién va a trabajar en el proyecto y con qué habilidades.
Responde SOLO con un objeto JSON válido, en español, sin comentarios ni texto adicional.`,
    prompt: `Reunión: "${m.title}" (${m.start_at.slice(0, 10)}). Asistentes: ${m.attendees}

TRANSCRIPCIÓN:
"""
${text.slice(0, 200_000)}
"""

Devuelve:
{
  "people": [{ "name": "nombre como se presentó", "side": "cliente | deersystems", "skills": "rol y habilidades concretas que se mencionaron, 1-3 frases" }],
  "notes": ["aviso corto si algo no queda claro"]
}

Reglas:
- Solo las personas que van a ejecutar trabajo del proyecto (las que el cliente asigna y las de DeerSystems que se mencionen). No incluyas a quien solo aprueba o asiste.
- "side": "cliente" para las personas del cliente; "deersystems" para las de DeerSystems. No incluyas al responsable principal de DeerSystems (quien lidera la reunión por DeerSystems): ya está como orquestador.
- En "skills" pon lo que se dijo (herramientas, áreas, experiencia, disponibilidad). No inventes.`,
    maxOutputTokens: 4096,
  });
  const people = ((Array.isArray(data.people) ? data.people : []) as Record<string, unknown>[])
    .slice(0, 20)
    .map((p) => ({ name: str(p?.name, 120).trim(), side: p?.side === 'deersystems' ? 'deersystems' : 'cliente', skills: str(p?.skills, 1000).trim() }))
    .filter((p) => p.name);
  const notes = (Array.isArray(data.notes) ? data.notes : []).map((n) => str(n, 300)).filter(Boolean).slice(0, 5);
  if (!people.length) notes.unshift('No encontré personas con tareas asignadas en esa reunión. Agrégalas a mano.');
  return { people, notes, ai: aiInfo(completion) };
}

interface PlanTask {
  title: string;
  description: string;
  side: 'deersystems' | 'cliente';
}

/**
 * Reparte las tareas del plan entre el equipo: devuelve, por cada tarea (fase i, tarea j), la clave de la persona.
 * '' = el cliente en general (aprobar, pagar, entregar insumos). El lado de la tarea sigue a la persona.
 */
async function distribute(p: { projectName: string; scope: string; phases: { name: string; tasks: PlanTask[] }[]; people: ProjectPerson[]; instruction: string }) {
  const people = p.people.map((x) => ({ key: x.key, name: x.name, side: x.side, skills: x.skills || '(sin detalle)', orquestador: x.lead }));
  const tasks = p.phases.flatMap((ph, i) => ph.tasks.map((t, j) => ({ id: `${i}.${j}`, phase: ph.name, title: t.title, description: t.description.slice(0, 300), side: t.side })));
  const { data, completion } = await completeJson<Record<string, unknown>>({
    profile: 'propuestas',
    purpose: 'reparto del trabajo del proyecto',
    system: `Eres el asistente de operaciones de DeerSystems. Repartes las tareas de un proyecto compartido entre las personas del equipo según sus habilidades.
Responde SOLO con un objeto JSON válido, en español, sin comentarios ni texto adicional.`,
    prompt: `Proyecto: "${p.projectName}".

ALCANCE (contexto):
"""
${p.scope.slice(0, 8000)}
"""

EQUIPO (JSON):
${JSON.stringify(people)}

TAREAS (JSON; "id" = fase.tarea):
${JSON.stringify(tasks)}
${p.instruction ? `\nINDICACIONES DEL RESPONSABLE:\n"""\n${p.instruction}\n"""\n` : ''}
Devuelve:
{
  "assignments": [{ "id": "0.1", "person": "clave de una persona o \\"\\"" }],
  "load": [{ "person": "clave", "summary": "qué le toca, en una frase" }],
  "notes": ["aviso corto si falta alguien con una habilidad o si algo no cuadra"]
}

Reglas:
- Una entrada por cada tarea, con su "id".
- Asigna cada tarea a la persona cuyas habilidades encajan mejor. El orquestador ("orquestador": true) lleva la mayor carga: coordinación, arquitectura, integración, revisión de calidad, entregas al cliente y todo lo que nadie más cubre.
- Las personas del cliente ejecutan las tareas que encajan con sus habilidades, sin pasar su capacidad: si hay dudas, la tarea queda con el orquestador.
- Las tareas que son del cliente como empresa (aprobar, validar, pagar, entregar accesos o insumos) van a una persona del cliente solo si es claramente suya; si no, "person": "" (el cliente en general).
- No cambies las tareas: solo asígnalas.`,
    maxOutputTokens: 8192,
  });
  const keys = new Set(p.people.map((x) => x.key));
  const valid = new Set(tasks.map((t) => t.id));
  const assignments: Record<string, string> = {};
  for (const a of (Array.isArray(data.assignments) ? data.assignments : []) as Record<string, unknown>[]) {
    const id = str(a?.id, 20);
    const person = str(a?.person, 40);
    if (valid.has(id) && (person === '' || keys.has(person))) assignments[id] = person;
  }
  if (!Object.keys(assignments).length) throw new AiError(`El modelo ${completion.model} no repartió las tareas. Vuelve a intentarlo.`);
  const load = ((Array.isArray(data.load) ? data.load : []) as Record<string, unknown>[])
    .map((l) => ({ person: str(l?.person, 40), summary: str(l?.summary, 300) }))
    .filter((l) => keys.has(l.person) && l.summary);
  const notes = (Array.isArray(data.notes) ? data.notes : []).map((n) => str(n, 300)).filter(Boolean).slice(0, 6);
  const missing = tasks.length - Object.keys(assignments).length;
  if (missing > 0) notes.push(`${missing === 1 ? 'Una tarea quedó' : `${missing} tareas quedaron`} sin repartir: siguen como estaban.`);
  return { assignments, load, notes, ai: aiInfo(completion) };
}

export async function handlePeople(route: string, id: number, req: IncomingMessage, res: ServerResponse, v: Viewer): Promise<boolean> {
  switch (route) {
    // Reuniones con transcripción, para sacar de ahí el equipo (las de este cliente o propuesta, primero).
    case 'GET people/meetings': {
      requireOwner(v);
      const url = new URL(req.url ?? '/', 'http://x');
      const proposalId = Number(url.searchParams.get('proposalId')) || 0;
      const clientId = Number(url.searchParams.get('clientId')) || 0;
      const rows = sqlite
        .prepare(
          `SELECT m.id, m.title, m.start_at, c.name AS client, (m.proposal_id = ? OR (? > 0 AND m.client_id = ?)) AS related
             FROM meetings m LEFT JOIN clients c ON c.id = m.client_id
            WHERE m.transcript IS NOT NULL AND m.transcript != ''
            ORDER BY related DESC, m.start_at DESC LIMIT 40`,
        )
        .all(proposalId, clientId, clientId) as { id: number; title: string; start_at: string; client: string | null; related: number }[];
      json(
        res,
        200,
        rows.map((r) => ({ id: r.id, title: r.title, startAt: r.start_at, client: r.client, related: !!r.related })),
      );
      return true;
    }

    case 'POST meetings/:id/people': {
      requireOwner(v);
      try {
        json(res, 200, await peopleFromMeeting(id));
      } catch (err) {
        if (err instanceof AiError) throw new HttpError(502, err.message);
        throw err;
      }
      return true;
    }

    case 'POST people/distribute': {
      requireOwner(v);
      const body = await readJson(req, 512 * 1024);
      const people = normalizePeople(body.people);
      if (people.length < 2) throw new HttpError(400, 'Agrega al menos otra persona al equipo para repartir el trabajo.');
      const phases = ((Array.isArray(body.phases) ? body.phases : []) as Record<string, unknown>[]).slice(0, 20).map((ph) => ({
        name: str(ph?.name, 120),
        tasks: ((Array.isArray(ph?.tasks) ? ph.tasks : []) as Record<string, unknown>[]).slice(0, 60).map((t) => ({
          title: str(t?.title, 200),
          description: str(t?.description, 2000),
          side: t?.side === 'cliente' ? ('cliente' as const) : ('deersystems' as const),
        })),
      }));
      if (!phases.some((ph) => ph.tasks.length)) throw new HttpError(400, 'El plan no tiene tareas.');
      try {
        json(
          res,
          200,
          await distribute({ projectName: str(body.projectName, 120), scope: str(body.scope, 30_000), phases, people, instruction: str(body.instruction, 2000) }),
        );
      } catch (err) {
        if (err instanceof AiError) throw new HttpError(502, err.message);
        throw err;
      }
      return true;
    }

    // El equipo de un proyecto ya creado (se ve en el alcance y lo usa el ajuste del plan con IA).
    case 'PUT projects/:id/people': {
      requireOwner(v);
      const project = db.getProject(id);
      if (!project) throw new HttpError(404, 'El proyecto no existe.');
      const body = await readJson(req, 64 * 1024);
      const people = normalizePeople(body.people);
      db.updateProject(project.id, { people: JSON.stringify(people) });
      json(res, 200, { people });
      return true;
    }
  }
  return false;
}
