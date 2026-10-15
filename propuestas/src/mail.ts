import { HOME_URL, PARTNERS_URL } from './config.ts';
import type { Mail } from './google.ts';

/**
 * Correos con el sistema de diseño de DeerSystems (DESIGN.md): lienzo Azul Profundo, tarjeta con hairline,
 * eyebrow mono, un solo acento verde en el botón. Todo en línea y con tablas para que se vea igual en Gmail y Outlook.
 */
const C = {
  canvas: '#051923',
  card: '#0d2a38',
  ink: '#F2F6F8',
  body: '#B9C6D2',
  mute: '#94A3B8',
  hairline: 'rgba(148,163,184,.22)',
  verde: '#7ED957',
  cian: '#00B4D8',
};
const FONT = "Inter, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
const DISPLAY = "Montserrat, 'Segoe UI', Arial, sans-serif";
const MONO = "'JetBrains Mono', Menlo, Consolas, monospace";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

interface Block {
  eyebrow: string;
  title: string;
  /** Párrafos en texto plano; se escapan. */
  paragraphs: string[];
  /** Pares etiqueta/valor que se muestran en mono, p. ej. el usuario y la contraseña. */
  facts?: [string, string][];
  /** Lista de novedades, cada una con su enlace (resumen de avisos). */
  items?: { title: string; body: string; url: string }[];
  /** Bloques con título y viñetas (resumen de reunión: acuerdos, tareas de cada parte). */
  sections?: { heading: string; bullets: string[] }[];
  cta?: { label: string; url: string };
  footnote?: string;
}

function layout(b: Block): { html: string; text: string } {
  const facts = b.facts?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;border:1px solid ${C.hairline};border-radius:10px;background:${C.canvas}">
        ${b.facts
          .map(
            ([k, v]) => `<tr><td style="padding:12px 16px;border-bottom:1px solid ${C.hairline}">
              <div style="font:500 11px/1.4 ${MONO};letter-spacing:.14em;text-transform:uppercase;color:${C.mute}">${esc(k)}</div>
              <div style="font:500 15px/1.5 ${MONO};color:${C.ink};word-break:break-all">${esc(v)}</div>
            </td></tr>`,
          )
          .join('')}
      </table>`
    : '';
  const items = b.items?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px">
        ${b.items
          .map(
            (it) => `<tr><td style="padding:12px 14px;border:1px solid ${C.hairline};border-left:3px solid ${C.cian};border-radius:8px;background:${C.canvas}">
              <a href="${esc(it.url)}" style="text-decoration:none">
                <div style="font:600 14px/1.45 ${FONT};color:${C.ink}">${esc(it.title)}</div>
                ${it.body ? `<div style="margin-top:4px;font:400 13px/1.55 ${FONT};color:${C.body}">${esc(it.body)}</div>` : ''}
              </a>
            </td></tr><tr><td style="height:8px;line-height:8px;font-size:0">&nbsp;</td></tr>`,
          )
          .join('')}
      </table>`
    : '';
  const sections = (b.sections ?? [])
    .filter((sec) => sec.bullets.length)
    .map(
      (sec) => `<div style="margin:20px 0 6px;font:500 11px/1.4 ${MONO};letter-spacing:.16em;text-transform:uppercase;color:${C.cian}">${esc(sec.heading)}</div>
        <ul style="margin:0 0 8px;padding-left:20px">
          ${sec.bullets.map((x) => `<li style="margin:0 0 6px;font:400 14px/1.6 ${FONT};color:${C.body}">${esc(x)}</li>`).join('')}
        </ul>`,
    )
    .join('');
  const cta = b.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px"><tr>
        <td style="border-radius:6px;background:${C.verde}">
          <a href="${esc(b.cta.url)}" style="display:inline-block;padding:12px 22px;font:600 15px/1 ${FONT};color:${C.canvas};text-decoration:none">${esc(b.cta.label)}</a>
        </td></tr></table>`
    : '';

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${esc(b.title)}</title></head>
<body style="margin:0;padding:0;background:${C.canvas}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.canvas}"><tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
      <tr><td style="padding:0 4px 20px">
        <a href="${HOME_URL}" style="text-decoration:none;font:700 18px/1 ${DISPLAY};letter-spacing:-.02em">
          <span style="color:${C.verde}">Deer</span><span style="color:${C.ink}">Systems</span>
        </a>
      </td></tr>
      <tr><td style="background:${C.card};border:1px solid ${C.hairline};border-radius:16px;padding:32px 28px">
        <div style="font:500 11px/1.4 ${MONO};letter-spacing:.18em;text-transform:uppercase;color:${C.cian};margin-bottom:10px">${esc(b.eyebrow)}</div>
        <h1 style="margin:0 0 16px;font:700 24px/1.2 ${DISPLAY};letter-spacing:-.03em;color:${C.ink}">${esc(b.title)}</h1>
        ${b.paragraphs.map((p) => `<p style="margin:0 0 16px;font:400 15px/1.65 ${FONT};color:${C.body}">${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}
        ${facts}${items}${sections}${cta}
        ${b.footnote ? `<p style="margin:20px 0 0;font:400 13px/1.6 ${FONT};color:${C.mute}">${esc(b.footnote)}</p>` : ''}
      </td></tr>
      <tr><td style="padding:20px 4px 0;font:400 12px/1.6 ${FONT};color:${C.mute}">
        Sistemas que conectan, soluciones que simplifican.<br>
        <a href="${HOME_URL}" style="color:${C.cian};text-decoration:none">${esc(HOME_URL.replace(/^https?:\/\//, ''))}</a>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  const text = [
    b.title,
    '',
    ...b.paragraphs.flatMap((p) => [p, '']),
    ...(b.facts ?? []).map(([k, v]) => `${k}: ${v}`),
    ...(b.sections ?? []).filter((sec) => sec.bullets.length).flatMap((sec) => [sec.heading.toUpperCase(), ...sec.bullets.map((x) => `• ${x}`), '']),
    ...(b.items ?? []).flatMap((it) => [`• ${it.title}`, ...(it.body ? [`  ${it.body}`] : []), `  ${it.url}`, '']),
    ...(b.cta ? ['', `${b.cta.label}: ${b.cta.url}`] : []),
    ...(b.footnote ? ['', b.footnote] : []),
    '',
    '— DeerSystems',
  ].join('\n');
  return { html, text };
}

const loginUrl = `${PARTNERS_URL}/login`;

export function welcomeClient(p: { to: string; name: string; projectName: string; password: string }): Mail {
  const first = p.name.split(' ')[0] || p.name;
  return {
    to: p.to,
    subject: `Bienvenido a DeerSystems Partners · ${p.projectName}`,
    ...layout({
      eyebrow: 'Propuesta aprobada',
      title: `¡Arrancamos, ${first}!`,
      paragraphs: [
        `Gracias por aprobar la propuesta de "${p.projectName}". Desde hoy puedes seguir el avance del proyecto en tu espacio de DeerSystems Partners: el cronograma, las tareas de cada parte, las reuniones y los acuerdos.`,
        'Estos son tus datos de acceso:',
      ],
      facts: [
        ['Usuario', p.to],
        ['Contraseña', p.password],
      ],
      cta: { label: 'Entrar a mi espacio', url: loginUrl },
      footnote: 'Te recomendamos cambiar la contraseña al entrar (menú Mi cuenta). Si no esperabas este correo, respóndelo y lo revisamos.',
    }),
  };
}

export function newProjectForClient(p: { to: string; name: string; projectName: string }): Mail {
  const first = p.name.split(' ')[0] || p.name;
  return {
    to: p.to,
    subject: `Nuevo proyecto en DeerSystems Partners · ${p.projectName}`,
    ...layout({
      eyebrow: 'Nuevo proyecto',
      title: `${first}, ya está tu nuevo proyecto`,
      paragraphs: [
        `Gracias por confiar de nuevo en nosotros. "${p.projectName}" ya aparece en tu espacio de DeerSystems Partners, junto al historial de los proyectos anteriores.`,
        'Entra con tu correo y la contraseña de siempre.',
      ],
      cta: { label: 'Ver el proyecto', url: loginUrl },
    }),
  };
}

export function welcomeTeam(p: { to: string; name: string; password: string }): Mail {
  const first = p.name.split(' ')[0] || p.name;
  return {
    to: p.to,
    subject: 'Tu acceso a DeerSystems Partners',
    ...layout({
      eyebrow: 'Equipo DeerSystems',
      title: `Hola, ${first}`,
      paragraphs: ['Ya tienes acceso al espacio de proyectos de DeerSystems. Desde ahí verás los clientes, el cronograma y las tareas.'],
      facts: [
        ['Usuario', p.to],
        ['Contraseña', p.password],
      ],
      cta: { label: 'Entrar', url: loginUrl },
      footnote: 'Cambia la contraseña al entrar (menú Mi cuenta).',
    }),
  };
}

export function newPassword(p: { to: string; name: string; password: string }): Mail {
  return {
    to: p.to,
    subject: 'Tu nueva contraseña de DeerSystems Partners',
    ...layout({
      eyebrow: 'Acceso',
      title: 'Te asignamos una nueva contraseña',
      paragraphs: [`Hola${p.name ? `, ${p.name.split(' ')[0]}` : ''}. La contraseña anterior dejó de funcionar y se cerraron las sesiones abiertas.`],
      facts: [
        ['Usuario', p.to],
        ['Contraseña', p.password],
      ],
      cta: { label: 'Entrar', url: loginUrl },
    }),
  };
}

export function passwordReset(p: { to: string; url: string }): Mail {
  return {
    to: p.to,
    subject: 'Restablece tu contraseña de DeerSystems Partners',
    ...layout({
      eyebrow: 'Acceso',
      title: 'Restablecer contraseña',
      paragraphs: ['Recibimos una solicitud para cambiar la contraseña de tu cuenta. El enlace vence en 1 hora y sirve una sola vez.'],
      cta: { label: 'Elegir nueva contraseña', url: p.url },
      footnote: 'Si no lo pediste, ignora este correo: tu contraseña sigue igual.',
    }),
  };
}

/** Vista previa para el panel: el mismo diseño con datos de ejemplo. */
export function sample(): Mail {
  return welcomeClient({ to: 'cliente@empresa.com', name: 'Laura Gómez', projectName: 'Portal de pedidos', password: 'Ejemplo-1234-abcd' });
}

/** Resumen de avisos: lo que pasó en los últimos minutos, agrupado en un solo correo. */
export function notificationDigest(p: { to: string; name: string; items: { title: string; body: string; url: string }[]; client: boolean }): Mail {
  const n = p.items.length;
  const first = p.name.split(' ')[0];
  return {
    to: p.to,
    subject: n === 1 ? p.items[0].title : `${n} novedades en DeerSystems Partners`,
    ...layout({
      eyebrow: 'Novedades',
      title: n === 1 ? 'Hay una novedad en tu proyecto' : `Hay ${n} novedades`,
      paragraphs: [`Hola${first ? `, ${first}` : ''}. Esto pasó en DeerSystems Partners:`],
      items: p.items,
      cta: { label: 'Abrir DeerSystems Partners', url: p.items[0]?.url ?? loginUrl },
      footnote: p.client
        ? 'Recibes este correo porque tienes un proyecto activo con DeerSystems.'
        : 'Puedes encender o apagar estos avisos en Configuración → Avisos.',
    }),
  };
}

/** Markdown simple → párrafos de texto plano para el correo. */
function plainParagraphs(md: string): string[] {
  return md
    .split(/\n{2,}/)
    .map((p) =>
      p
        .split('\n')
        .map((l) => l.replace(/^#{1,6}\s+/, '').replace(/^[-*•]\s+/, '• ').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/[*_`]/g, ''))
        .join('\n')
        .trim(),
    )
    .filter(Boolean);
}

/** Resumen de una reunión aprobado por DeerSystems: lo hablado, los acuerdos y lo que le toca a cada parte. */
export function meetingSummary(p: {
  to: string;
  projectName: string;
  meetingTitle: string;
  date: string;
  summary: string;
  agreements: string[];
  ourTasks: string[];
  clientTasks: string[];
  url: string;
}): Mail {
  return {
    to: p.to,
    subject: `Resumen de la reunión · ${p.meetingTitle}`,
    ...layout({
      eyebrow: `${p.projectName} · ${p.date}`,
      title: 'Resumen de la reunión',
      paragraphs: plainParagraphs(p.summary),
      sections: [
        { heading: 'Acuerdos', bullets: p.agreements },
        { heading: 'Tareas de tu equipo', bullets: p.clientTasks },
        { heading: 'Tareas de DeerSystems', bullets: p.ourTasks },
      ],
      cta: { label: 'Ver el proyecto', url: p.url },
      footnote: 'Las tareas ya quedaron registradas en DeerSystems Partners. Si algo no quedó bien, respóndenos este correo.',
    }),
  };
}
