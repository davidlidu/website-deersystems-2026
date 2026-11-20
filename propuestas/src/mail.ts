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
  /** Imagen en línea (adjunta con Content-ID): p. ej. el QR de pago. Gmail no muestra imágenes data:. */
  image?: { cid: string; alt: string; caption: string };
  footnote?: string;
  /** Contenido ya armado (p. ej. un avance en Markdown): HTML escapado y su versión en texto plano; va después de los párrafos. */
  rich?: { html: string; text: string };
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
        ${b.rich?.html ?? ''}${facts}${items}${sections}${
          b.image
            ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 20px"><tr><td align="center" style="padding:14px;border-radius:12px;background:#ffffff">
                <img src="cid:${esc(b.image.cid)}" width="190" height="190" alt="${esc(b.image.alt)}" style="display:block;width:190px;height:190px;border:0">
              </td></tr><tr><td align="center" style="padding-top:8px;font:400 13px/1.5 ${FONT};color:${C.mute}">${esc(b.image.caption)}</td></tr></table>`
            : ''
        }${cta}
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
    ...(b.rich ? [b.rich.text, ''] : []),
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

export function welcomeClient(p: { to: string; name: string; projectName: string | null; password: string }): Mail {
  const first = p.name.split(' ')[0] || p.name;
  return {
    to: p.to,
    subject: p.projectName ? `Bienvenido a DeerSystems Partners · ${p.projectName}` : 'Bienvenido a DeerSystems Partners',
    ...layout({
      eyebrow: p.projectName ? 'Propuesta aprobada' : 'Tu espacio',
      title: p.projectName ? `¡Arrancamos, ${first}!` : `Hola, ${first}`,
      paragraphs: [
        p.projectName
          ? `Gracias por aprobar la propuesta de "${p.projectName}". Desde hoy puedes seguir el avance del proyecto en tu espacio de DeerSystems Partners: el cronograma, las tareas de cada parte, las reuniones y los acuerdos.`
          : 'Desde hoy tienes tu espacio en DeerSystems Partners: ahí ves tus proyectos, tus cuentas de cobro, tus pagos y tu saldo.',
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
/** La cuenta de cobro, con el PDF adjunto. Si el cliente tiene acceso al portal, también la ve allá. */
export function invoiceForClient(p: {
  to: string;
  name: string;
  number: string;
  date: string;
  total: string;
  totalCop: string | null;
  dueDate: string | null;
  projectName: string | null;
  bankInfo: string;
  portal: boolean;
  /** Link de pago en línea (opcional, solo si lo activaste para esta cuenta de cobro). */
  payUrl?: string | null;
  /** Hay QR de pago: va como imagen en línea con Content-ID "qr-pago". */
  qr?: boolean;
  /** Archivos de Drive que acompañan la cuenta de cobro: van como enlaces, no adjuntos. */
  links?: { name: string; url: string }[];
  /** Nombres de los archivos adicionales adjuntos. */
  extraFiles?: string[];
}): Mail {
  // p.name ya llega listo para el saludo: el nombre del contacto, o la razón social completa si no hay contacto.
  const first = p.name;
  return {
    to: p.to,
    subject: `Cuenta de cobro ${p.number}${p.projectName ? ` · ${p.projectName}` : ''}`,
    ...layout({
      eyebrow: 'Cuenta de cobro',
      title: `Hola${first ? `, ${first}` : ''}: te enviamos la cuenta de cobro ${p.number}`,
      paragraphs: [
        `Adjuntamos la cuenta de cobro${p.projectName ? ` del proyecto "${p.projectName}"` : ''} en PDF${p.extraFiles?.length ? `, junto con: ${p.extraFiles.join(', ')}` : ''}.`,
        ...(p.bankInfo ? ['Puedes pagar por transferencia a:', p.bankInfo] : []),
      ],
      facts: [
        ['Número', p.number],
        ['Fecha', p.date],
        ['Valor', p.total],
        ...(p.totalCop ? ([['Equivalente COP', p.totalCop]] as [string, string][]) : []),
        ...(p.dueDate ? ([['Fecha límite de pago', p.dueDate]] as [string, string][]) : []),
      ],
      ...(p.qr ? { image: { cid: 'qr-pago', alt: 'Código QR para pagar', caption: 'Escanéalo desde la app de tu banco o Nequi para pagar.' } } : {}),
      ...(p.links?.length ? { items: p.links.map((l) => ({ title: l.name, body: 'Documento adicional · abrir en Google Drive', url: l.url })) } : {}),
      ...(p.payUrl ? { cta: { label: 'Pagar en línea (PSE, Nequi, tarjeta)', url: p.payUrl } } : p.portal ? { cta: { label: 'Ver en mi espacio', url: loginUrl } } : {}),
      footnote: p.payUrl
        ? 'También puedes pagar por transferencia y respondernos este correo con el comprobante. ¡Gracias!'
        : 'Cuando hagas el pago, responde este correo con el comprobante. ¡Gracias!',
    }),
  };
}

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

/** Markdown del portal (negritas, cursivas, enlaces, viñetas) → HTML en línea para el correo. */
function mdHtml(md: string): string {
  const inline = (s: string) =>
    esc(s)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t: string, u: string) => `<a href="${u}" style="color:${C.verde};text-decoration:underline">${t}</a>`)
      .replace(/\*\*([^*]+)\*\*/g, `<strong style="color:${C.ink}">$1</strong>`)
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  const p = `margin:0 0 16px;font:400 15px/1.65 ${FONT};color:${C.body}`;
  const heading = (l: string) => {
    const level = /^#+/.exec(l)![0].length;
    const size = level <= 1 ? 20 : level === 2 ? 17 : 15;
    return `<div style="margin:24px 0 10px;font:700 ${size}px/1.35 ${DISPLAY};color:${C.ink}">${inline(l.replace(/^#{1,6}\s+/, ''))}</div>`;
  };
  const block = (raw: string): string => {
      const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
      if (!lines.length) return '';
      // Un título (## …) va solo, aunque no tenga una línea en blanco después.
      if (/^#{1,6}\s+/.test(lines[0])) return heading(lines[0]) + block(lines.slice(1).join('\n'));
      const bullet = /^([-*•]|\d+[.)])\s+/;
      if (lines.every((l) => bullet.test(l))) {
        const tag = /^\d/.test(lines[0]) ? 'ol' : 'ul';
        return `<${tag} style="margin:0 0 16px;padding-left:20px">${lines.map((l) => `<li style="margin:0 0 6px;font:400 15px/1.6 ${FONT};color:${C.body}">${inline(l.replace(bullet, ''))}</li>`).join('')}</${tag}>`;
      }
      return `<p style="${p}">${lines.map((l) => inline(l.replace(/^#{1,6}\s+/, ''))).join('<br>')}</p>`;
  };
  return md.split(/\n{2,}/).map(block).join('');
}

/** Un informe del proyecto (parcial o de cierre), completo, para el cliente. */
export function projectReport(p: { to: string; projectName: string; kind: 'parcial' | 'final'; title: string; body: string; url: string }): Mail {
  const final = p.kind === 'final';
  return {
    to: p.to,
    subject: p.title || (final ? `Informe de cierre · ${p.projectName}` : `Informe de avance · ${p.projectName}`),
    ...layout({
      eyebrow: `${p.projectName} · ${final ? 'Informe de cierre' : 'Informe parcial'}`,
      title: p.title || (final ? 'Cierre del proyecto' : 'Informe de avance'),
      paragraphs: [],
      rich: { html: mdHtml(p.body), text: p.body.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/^#{1,6}\s+/gm, '') },
      cta: { label: final ? 'Ver el informe de cierre en DeerSystems Partners' : 'Ver el informe en DeerSystems Partners', url: p.url },
      footnote: final
        ? 'Gracias por confiar en DeerSystems. Si tienes preguntas sobre el cierre, responde este correo.'
        : 'Recibes este correo porque tienes un proyecto activo con DeerSystems. Puedes responderlo si tienes comentarios.',
    }),
  };
}

/** Un avance del proyecto, completo, para el cliente. */
export function projectUpdate(p: { to: string; projectName: string; body: string; date: string; url: string }): Mail {
  return {
    to: p.to,
    subject: `Avance de ${p.projectName} · ${p.date}`,
    ...layout({
      eyebrow: `${p.projectName} · ${p.date}`,
      title: 'Nuevo avance de tu proyecto',
      // El avance ya trae su saludo.
      paragraphs: [],
      rich: { html: mdHtml(p.body), text: p.body.replace(/\*\*([^*]+)\*\*/g, '$1') },
      cta: { label: 'Ver el avance en DeerSystems Partners', url: p.url },
      footnote: 'Recibes este correo porque tienes un proyecto activo con DeerSystems. Puedes responderlo si tienes comentarios.',
    }),
  };
}

/** Al cliente, apenas aprueba la propuesta desde el enlace: confirmación y qué sigue. */
export function proposalApproved(p: { to: string; name: string; proposalTitle: string; option: string }): Mail {
  const first = p.name.split(' ')[0] || p.name;
  return {
    to: p.to,
    subject: `Recibimos tu aprobación · ${p.proposalTitle}`,
    ...layout({
      eyebrow: 'Propuesta aprobada',
      title: `¡Gracias, ${first}!`,
      paragraphs: [
        `Recibimos tu aprobación de «${p.proposalTitle}»${p.option ? ` (${p.option})` : ''}.`,
        'Ya estamos preparando el plan de trabajo. Te escribimos pronto para confirmar la fecha de arranque, el acceso a tu espacio en DeerSystems Partners y los siguientes pasos.',
      ],
      footnote: 'Si quieres ajustar algo antes de arrancar, responde este correo y lo revisamos.',
    }),
  };
}

/** Después de la Proposal Call: el mensaje que escribiste (o ajustaste) y el botón a la propuesta. */
export function proposalAfterCall(p: { to: string; subject: string; title: string; message: string; proposalUrl: string; proposalTitle: string }): Mail {
  return {
    to: p.to,
    subject: p.subject,
    ...layout({
      eyebrow: 'Propuesta',
      title: p.title,
      paragraphs: plainParagraphs(p.message),
      cta: { label: p.proposalTitle ? `Ver la propuesta «${p.proposalTitle}»` : 'Ver la propuesta', url: p.proposalUrl },
      footnote: 'Si tienes dudas o quieres ajustar algo, responde este correo y lo revisamos juntos.',
    }),
  };
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
  /** null = reunión sin proyecto y cliente sin cuenta en el portal: sin botón. */
  url: string | null;
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
      ...(p.url ? { cta: { label: p.url.includes('/proyectos/') ? 'Ver el proyecto' : 'Ir a DeerSystems Partners', url: p.url } } : {}),
      footnote:
        p.ourTasks.length || p.clientTasks.length
          ? 'Las tareas ya quedaron registradas en DeerSystems Partners. Si algo no quedó bien, respóndenos este correo.'
          : 'Si algo no quedó bien, respóndenos este correo.',
    }),
  };
}

/**
 * Una o varias propuestas para un cliente: correo comercial con portada, una tarjeta por propuesta (con su botón)
 * y por qué trabajar con DeerSystems. Mismo sistema de diseño, pensado para que destaque en la bandeja.
 */
export function proposalsOffer(p: {
  to: string;
  subject: string;
  /** Nombre de quien lo recibe, para el saludo; vacío = saludo general. */
  name: string;
  message: string;
  items: { title: string; note: string; url: string }[];
}): Mail {
  const first = p.name.trim().split(/\s+/)[0] ?? '';
  const many = p.items.length > 1;
  const greeting = first ? `Hola, ${first}:` : 'Hola:';
  const paragraphs = plainParagraphs(p.message);
  const num = (i: number) => String(i + 1).padStart(2, '0');

  const cards = p.items
    .map(
      (it, i) => `<tr><td style="padding:0 0 14px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.hairline};border-radius:14px;background:${C.canvas}">
          <tr><td style="height:4px;line-height:4px;font-size:0;border-radius:14px 14px 0 0;background:${C.verde};background-image:linear-gradient(100deg,${C.verde} 0%,#3fcf9c 45%,${C.cian} 100%)">&nbsp;</td></tr>
          <tr><td style="padding:20px 22px 22px">
            <div style="font:500 11px/1.4 ${MONO};letter-spacing:.18em;text-transform:uppercase;color:${C.cian}">${many ? `Propuesta ${num(i)}` : 'Tu propuesta'}</div>
            <div style="margin:8px 0 ${it.note ? '8px' : '16px'};font:700 20px/1.25 ${DISPLAY};letter-spacing:-.02em;color:${C.ink}">${esc(it.title)}</div>
            ${it.note ? `<div style="margin:0 0 16px;font:400 14px/1.6 ${FONT};color:${C.body}">${esc(it.note).replace(/\n/g, '<br>')}</div>` : ''}
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              <td style="border-radius:6px;background:${C.verde}">
                <a href="${esc(it.url)}" style="display:inline-block;padding:12px 20px;font:600 14px/1 ${FONT};color:${C.canvas};text-decoration:none">Ver la propuesta &rarr;</a>
              </td></tr></table>
          </td></tr>
        </table>
      </td></tr>`,
    )
    .join('');

  const why = [
    ['Por fases', 'Entregas claras por etapa, con fechas y avances que puedes seguir en tu portal.'],
    ['Acompañamiento', 'Un equipo cercano que te explica cada paso y responde rápido.'],
    ['Resultados', 'Software, automatización e IA pensados para ahorrarte tiempo y vender más.'],
  ];
  const whyHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 22px;border-top:1px solid ${C.hairline}">
    <tr><td style="padding:18px 0 4px;font:500 11px/1.4 ${MONO};letter-spacing:.18em;text-transform:uppercase;color:${C.mute}">Por qué DeerSystems</td></tr>
    ${why
      .map(
        ([k, v]) => `<tr><td style="padding:8px 0">
          <span style="display:inline-block;width:8px;height:8px;margin-right:10px;border-radius:50%;background:${C.verde};vertical-align:middle"></span>
          <span style="font:600 14px/1.5 ${FONT};color:${C.ink}">${esc(k)}.</span>
          <span style="font:400 14px/1.5 ${FONT};color:${C.body}"> ${esc(v)}</span>
        </td></tr>`,
      )
      .join('')}
  </table>`;

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${esc(p.subject)}</title></head>
<body style="margin:0;padding:0;background:${C.canvas}">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(many ? `${p.items.length} propuestas preparadas para ti: ${p.items.map((i) => i.title).join(' · ')}` : `Tu propuesta: ${p.items[0]?.title ?? ''}`)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.canvas}"><tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
      <tr><td style="padding:0 4px 20px">
        <a href="${HOME_URL}" style="text-decoration:none;font:700 18px/1 ${DISPLAY};letter-spacing:-.02em">
          <span style="color:${C.verde}">Deer</span><span style="color:${C.ink}">Systems</span>
        </a>
      </td></tr>
      <tr><td style="background:${C.card};border:1px solid ${C.hairline};border-radius:18px;overflow:hidden">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="padding:34px 30px 26px;background:${C.card};background-image:radial-gradient(120% 140% at 100% 0%,rgba(0,180,216,.22) 0%,rgba(126,217,87,.10) 38%,rgba(13,42,56,0) 70%)">
            <div style="font:500 11px/1.4 ${MONO};letter-spacing:.18em;text-transform:uppercase;color:${C.verde};margin-bottom:12px">${many ? `${p.items.length} propuestas para ti` : 'Propuesta comercial'}</div>
            <h1 style="margin:0;font:800 28px/1.15 ${DISPLAY};letter-spacing:-.03em;color:${C.ink}">${many ? 'Preparamos estas opciones para tu empresa' : 'Preparamos esta propuesta para tu empresa'}</h1>
          </td></tr>
          <tr><td style="padding:4px 30px 8px">
            <p style="margin:0 0 14px;font:600 15px/1.65 ${FONT};color:${C.ink}">${esc(greeting)}</p>
            ${paragraphs.map((x) => `<p style="margin:0 0 14px;font:400 15px/1.65 ${FONT};color:${C.body}">${esc(x).replace(/\n/g, '<br>')}</p>`).join('')}
          </td></tr>
          <tr><td style="padding:10px 30px 4px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cards}</table>
          </td></tr>
          <tr><td style="padding:0 30px">${whyHtml}</td></tr>
          <tr><td style="padding:0 30px 30px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:12px;background:${C.canvas};border:1px solid ${C.hairline}"><tr>
              <td style="padding:18px 20px;font:400 14px/1.6 ${FONT};color:${C.body}">
                <strong style="color:${C.ink}">¿Hablamos?</strong> Responde este correo con tus preguntas o con el día que te sirva para ${many ? 'revisarlas' : 'revisarla'} juntos. Desde ${many ? 'cada propuesta' : 'la propuesta'} también puedes aprobarla en línea.
              </td></tr></table>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:20px 4px 0;font:400 12px/1.6 ${FONT};color:${C.mute}">
        Sistemas que conectan, soluciones que simplifican.<br>
        <a href="${HOME_URL}" style="color:${C.cian};text-decoration:none">${esc(HOME_URL.replace(/^https?:\/\//, ''))}</a>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  const text = [
    greeting,
    '',
    ...paragraphs.flatMap((x) => [x, '']),
    ...p.items.flatMap((it, i) => [`${many ? `Propuesta ${num(i)}: ` : ''}${it.title}`, ...(it.note ? [it.note] : []), `Ver la propuesta: ${it.url}`, '']),
    'Por qué DeerSystems',
    ...why.map(([k, v]) => `• ${k}. ${v}`),
    '',
    `¿Hablamos? Responde este correo con tus preguntas o con el día que te sirva para ${many ? 'revisarlas' : 'revisarla'} juntos.`,
    '',
    '— DeerSystems',
  ].join('\n');

  return { to: p.to, subject: p.subject, html, text };
}
