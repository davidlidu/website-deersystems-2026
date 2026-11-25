import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AiError, completeJson } from '../ai.ts';
import { db as sqlite, getProposal, getProposalBySlug, type Proposal } from '../db.ts';
import { HttpError, json, readJson } from '../http.ts';
import * as proposals from '../proposals.ts';
import { slugify } from '../storage.ts';
import { setProposalClient } from './approvals.ts';
import type { Viewer } from './auth.ts';
import { requireOwner, str } from './common.ts';
import * as db from './db.ts';

/**
 * Plantillas de propuestas: propuestas prediseñadas (los planes para agencias y las que armas a la medida) guardadas
 * como datos. Con una plantilla se publica una propuesta en propuestas.deersystems.net (HTML con la marca, con el
 * botón de aprobar) y se le asigna a un cliente para enviársela.
 */

export type Billing = 'unico' | 'mensual' | 'anual' | 'hora';
export const BILLINGS: Billing[] = ['unico', 'mensual', 'anual', 'hora'];
export type Category = 'agencia' | 'personalizada';

export interface TemplateItem {
  name: string;
  description: string;
  price: number;
  billing: Billing;
  /** Adicional que el cliente puede sumar (no entra en los totales). */
  optional: boolean;
  details: string[];
  /** Cobro mensual que el cliente puede pagar por año (12 meses) al aprobar. */
  annual: boolean;
}

export interface TemplateData {
  /** Lo que ve el cliente como título de la propuesta. */
  title: string;
  /** A quién va dirigida (p. ej. la agencia). */
  agency: string;
  /** Cliente final de la agencia, si aplica. */
  endClient: string;
  intro: string;
  currency: 'COP' | 'USD';
  items: TemplateItem[];
  includes: string[];
  terms: string[];
  validityDays: number;
  /** Plazo de implementación (p. ej. «Máximo 1 mes desde la aprobación»); vacío = no se muestra. */
  timeline: string;
}

interface Row {
  id: number;
  name: string;
  category: Category;
  data: string;
  seed_key: string | null;
  uses: number;
  created_at: string;
  updated_at: string;
}

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS proposal_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'personalizada',
    data TEXT NOT NULL DEFAULT '{}',
    seed_key TEXT UNIQUE,
    uses INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

const now = () => new Date().toISOString();
const get = (id: number) => sqlite.prepare('SELECT * FROM proposal_templates WHERE id = ?').get(id) as unknown as Row | undefined;

// ───────── Validación ─────────

const lines = (v: unknown, max = 40) =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n') : [])
    .map((x) => str(x, 400))
    .filter(Boolean)
    .slice(0, max);

export function cleanData(raw: unknown): TemplateData {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 40).flatMap((x): TemplateItem[] => {
    const i = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const name = str(i.name, 160);
    if (!name) return [];
    const price = Math.max(0, Math.round(Number(i.price) || 0));
    return [
      {
        name,
        description: str(i.description, 600),
        price,
        billing: BILLINGS.includes(i.billing as Billing) ? (i.billing as Billing) : 'unico',
        optional: i.optional === true,
        details: lines(i.details, 20),
        annual: i.annual === true && i.billing === 'mensual',
      },
    ];
  });
  return {
    title: str(b.title, 200),
    agency: str(b.agency, 160),
    endClient: str(b.endClient, 160),
    intro: str(b.intro, 3000),
    currency: b.currency === 'USD' ? 'USD' : 'COP',
    items,
    includes: lines(b.includes),
    terms: lines(b.terms),
    validityDays: Math.min(365, Math.max(0, Math.round(Number(b.validityDays) || 0))) || 30,
    timeline: str(b.timeline, 160),
  };
}

const parse = (s: string): TemplateData => {
  try {
    return cleanData(JSON.parse(s));
  } catch {
    return cleanData({});
  }
};

// ───────── Plantillas base ─────────

const AGENCY_TERMS = [
  'Pagos: 50% para iniciar y 50% al entregar el proyecto terminado.',
  'El diseño, mockup o layout corre por cuenta de la agencia: necesitamos la guía de marca o el diseño aprobado antes de iniciar.',
  'Textos, imágenes en alta resolución y logotipo listos antes del inicio.',
  'Los tiempos de entrega aplican desde la recepción de todos los insumos completos.',
];

function agencyPlan(key: string, name: string, title: string, intro: string, price: number, details: string[], billing: Billing = 'unico', extraTerms: string[] = []) {
  return {
    key,
    name: `Agencias · ${name}`,
    category: 'agencia' as Category,
    data: cleanData({
      title,
      agency: '',
      endClient: '',
      intro,
      currency: 'COP',
      items: [{ name: title, description: intro, price, billing, optional: false, details }],
      includes: [],
      terms: [...AGENCY_TERMS, ...extraTerms],
      validityDays: 30,
    }),
  };
}

const SEEDS: { key: string; name: string; category: Category; data: TemplateData }[] = [
  {
    key: 'chatbot-grupo-oral-flex-click-lab',
    name: 'Chatbot Grupo Oral Flex Click Lab',
    category: 'agencia',
    data: cleanData({
      title: 'Chatbot con inteligencia artificial para Grupo Oral Flex',
      agency: 'Click Lab',
      endClient: 'Grupo Oral Flex',
      intro:
        'Propuesta para implementar un chatbot con inteligencia artificial que atiende a los pacientes de Grupo Oral Flex: responde preguntas frecuentes, informa sobre los servicios y canaliza las solicitudes. Click Lab la presenta a su cliente y DeerSystems se encarga de la implementación técnica y la operación del sistema.',
      currency: 'COP',
      items: [
        {
          name: 'Instalación y setup del sistema',
          description: 'Puesta en marcha del chatbot con la información de Grupo Oral Flex.',
          price: 1_000_000,
          billing: 'unico',
          optional: false,
          details: [
            'Configuración del chatbot y de su base de conocimiento',
            'Conexión con el canal de atención acordado',
            'Pruebas y puesta en producción',
          ],
        },
        {
          name: 'Inteligencia artificial',
          description: 'Consumo de inteligencia artificial del chatbot: hasta 800 chats mensuales.',
          price: 70_000,
          billing: 'mensual',
          optional: false,
          details: [],
          annual: true,
        },
        {
          name: 'Servidor',
          description: 'Alojamiento y operación del sistema.',
          price: 850_000,
          billing: 'anual',
          optional: false,
          details: [],
        },
        {
          name: 'Soporte',
          description: 'En caso de requerir soporte: ajustes, cambios en las respuestas y acompañamiento.',
          price: 200_000,
          billing: 'mensual',
          optional: true,
          details: [],
        },
        {
          name: 'Sincronización de agenda',
          description: 'Ítem adicional: conexión del chatbot con la agenda para consultar disponibilidad y agendar citas.',
          price: 250_000,
          billing: 'unico',
          optional: true,
          details: [],
        },
      ],
      includes: [],
      terms: [
        'La instalación y el setup son un pago único.',
        'La mensualidad de inteligencia artificial cubre hasta 800 chats mensuales y se puede pagar mes a mes o por año.',
        'El servidor se paga por año.',
        'El soporte mensual y la sincronización de agenda son opcionales: se suman solo si se requieren.',
        'Valores en pesos colombianos (COP).',
      ],
      validityDays: 30,
      timeline: 'Máximo 1 mes desde la aprobación',
    }),
  },
  agencyPlan('wp-landing', 'WordPress · Plan A Landing Page', 'Landing Page en WordPress', 'Una página de alta conversión para captar leads y comunicar la propuesta de valor.', 1_000_000, [
    '1 página, hasta 6 secciones',
    'Configuración de WordPress y adaptación de marca',
    'Diseño orientado a conversión',
    'Formulario de captación con notificación',
    'Píxel de Facebook / Google',
    'SEO básico y WhatsApp flotante',
    'Hasta 6 productos o servicios destacados (sin catálogo)',
    'Capacitación grabada de 1 h',
    'Entrega: 3 a 5 días hábiles',
  ]),
  agencyPlan('wp-website', 'WordPress · Plan B Website sin pasarela', 'Website en WordPress (sin pasarela)', 'Sitio completo de 4 páginas para una presencia digital sólida, sin pagos en línea.', 1_440_000, [
    '4 páginas: Inicio, Nosotros, Servicios y Contacto',
    'Configuración de WordPress y adaptación de marca',
    'Menú de navegación y footer',
    'Formulario de contacto con notificación',
    'Google Maps integrado',
    'Galería o portafolio básico',
    'Blog activado y configurado',
    'Píxel de Facebook / Google, SEO básico y WhatsApp flotante',
    'Catálogo informativo de hasta 15 productos o servicios (sin carrito)',
    'Capacitación grabada de 1 h',
    'Entrega: 5 a 8 días hábiles',
  ]),
  agencyPlan(
    'wp-ecommerce',
    'WordPress · Plan C Website con pasarela',
    'Website con tienda en WordPress (WooCommerce)',
    'Sitio de 4 páginas con WooCommerce y pasarela de pagos, listo para vender en línea.',
    1_680_000,
    [
      '4 páginas: Inicio, Nosotros, Tienda y Contacto',
      'Configuración de WordPress y adaptación de marca',
      'Menú de navegación, footer, Google Maps y blog',
      'WooCommerce configurado',
      'Pasarela: Wompi, PayU, Mercado Pago o ePayco (tarjeta y PSE)',
      'Carrito, checkout y confirmación',
      'Pruebas en sandbox antes del lanzamiento',
      'Píxel de Facebook / Google, SEO básico y WhatsApp flotante',
      'Carga de hasta 50 productos',
      'Capacitación grabada de 1 h',
      'Entrega: 7 a 10 días hábiles',
    ],
    'unico',
    ['La agencia o el cliente final crea la cuenta en la pasarela; nosotros hacemos la integración técnica.'],
  ),
  agencyPlan(
    'shopify-basico',
    'Shopify · Básico',
    'Tienda Shopify · Catálogo online',
    'Para mostrar productos con pasarela de pago, sin gestión avanzada de inventario.',
    1_760_000,
    [
      'Hasta 20 productos cargados',
      'Instalación y configuración del tema',
      'Adaptación de marca',
      'Pasarela de pago configurada',
      'Integración con redes sociales',
      'Configuración de envíos básica',
      'SEO básico',
      'Capacitación grabada de 1 h',
      'Entrega: 5 a 8 días hábiles',
    ],
    'unico',
    ['El cliente final debe tener una cuenta activa de Shopify.'],
  ),
  agencyPlan(
    'shopify-estandar',
    'Shopify · Estándar',
    'Tienda Shopify completa',
    'Tienda funcional para negocios con catálogo mediano y ventas activas.',
    2_240_000,
    [
      'Hasta 100 productos cargados',
      'Instalación y personalización parcial del tema',
      'Adaptación de marca',
      'Pasarela de pago configurada',
      'Integración con redes sociales',
      'Colecciones y filtros de catálogo',
      'Configuración de envíos estándar',
      'SEO básico',
      'Capacitación grabada de 1 h',
      'Entrega: 8 a 12 días hábiles',
    ],
    'unico',
    ['El cliente final debe tener una cuenta activa de Shopify.'],
  ),
  agencyPlan(
    'shopify-avanzado',
    'Shopify · Avanzado',
    'Tienda Shopify avanzada',
    'Para marcas con catálogos grandes que necesitan personalización y lógica avanzada.',
    2_880_000,
    [
      'Hasta 300 productos cargados (importación masiva)',
      'Instalación y personalización avanzada del tema',
      'Adaptación de marca',
      'Pasarela de pago configurada',
      'Redes sociales completas: Facebook, Instagram y Google Shopping',
      'Colecciones, filtros y variantes avanzadas',
      'Configuración de envíos avanzada',
      'SEO básico',
      'Capacitación grabada de 1 h',
      'Más de 300 productos: se cotiza aparte',
      'Entrega: 12 a 18 días hábiles',
    ],
    'unico',
    ['El cliente final debe tener una cuenta activa de Shopify.'],
  ),
  {
    key: 'email-sms',
    name: 'Agencias · Email y SMS marketing',
    category: 'agencia',
    data: cleanData({
      title: 'Email y SMS marketing',
      intro: 'Base de datos limpia, canales de envío por correo y SMS configurados en Brevo y campañas saliendo a tiempo con el diseño que entrega la agencia.',
      currency: 'COP',
      items: [
        {
          name: 'Setup de email y SMS marketing',
          description: 'Base de datos lista y canal de envío configurado, para empezar a enviar campañas.',
          price: 650_000,
          billing: 'unico',
          details: [
            'Normalización de hasta 5.000 contactos: filtrado, deduplicado y validación',
            'Importación en listas y segmentos',
            'Creación y configuración de la cuenta Brevo, si el cliente no la tiene',
            'Subdominio de envío con SPF, DKIM y DMARC',
            'Activación del canal SMS y configuración del remitente',
            'Gestión de bajas y cumplimiento de habeas data',
            'Entrega: 3 a 5 días hábiles',
          ],
        },
        {
          name: 'Gestión de campañas',
          description: 'Montaje y envío de campañas con el diseño que entrega la agencia.',
          price: 480_000,
          billing: 'mensual',
          details: [
            'Hasta 4 campañas al mes, por email o SMS',
            'Segmentación, pruebas y programación del envío',
            'Informe por campaña: entregas, aperturas, clics, rebotes y bajas',
          ],
        },
        { name: 'Cada 5.000 contactos adicionales', description: 'Normalización e importación de más contactos.', price: 150_000, billing: 'unico', optional: true },
        { name: 'Campaña adicional', description: 'Una campaña más en el mes.', price: 120_000, billing: 'unico', optional: true },
      ],
      terms: [
        'Pagos: el setup 50% para iniciar y 50% al entregar; la gestión de campañas se paga mes a mes.',
        'El diseño de las campañas y los textos SMS los entrega la agencia.',
        'La licencia de Brevo y los créditos SMS los paga el cliente directamente a Brevo.',
        'Las campañas no usadas en el mes no se acumulan.',
      ],
      validityDays: 30,
    }),
  },
  agencyPlan(
    'mantenimiento-basico',
    'Mantenimiento WordPress · Básico',
    'Mantenimiento WordPress · Plan Básico',
    'Ideal para sitios informativos que requieren estabilidad y actualizaciones puntuales.',
    280_000,
    [
      'Actualización de WordPress, temas y plugins',
      'Escaneo básico de malware y revisión de usuarios',
      'Copia de seguridad semanal (archivos y base de datos)',
      'Limpieza básica de base de datos y ajustes menores de caché',
      'Hasta 15 productos actualizados y cambios menores de contenido',
      'SEO on-page básico',
      'Reporte mensual',
    ],
    'mensual',
  ),
  agencyPlan(
    'mantenimiento-premium',
    'Mantenimiento WordPress · Premium',
    'Mantenimiento WordPress · Plan Premium',
    'Para marcas activas con e-commerce que necesitan el sitio siempre optimizado.',
    550_000,
    [
      'Actualización de WordPress, temas y plugins',
      'Escaneo avanzado de malware y firewall',
      'Backups automáticos semanales y respaldo manual',
      'Optimización de imágenes, caché, scripts y Core Web Vitals',
      'Hasta 35 productos actualizados y hasta 5 blogs al mes',
      'SEO on-page avanzado y revisión de Search Console',
      'Informe detallado con métricas y recomendaciones',
    ],
    'mensual',
  ),
  agencyPlan(
    'ajustes-horas',
    'Ajustes por horas',
    'Ajustes por horas (WordPress o Shopify)',
    'Para sitios que ya existen y necesitan cambios puntuales, sin armar un proyecto completo.',
    50_000,
    [
      'Modificaciones de diseño, textos e imágenes',
      'Corrección de errores y ajuste de plugins',
      'Optimización de velocidad',
      'Soporte técnico puntual',
      'Mínimo facturable: 1 hora',
    ],
    'hora',
    ['Estimación previa para tu aprobación, cobro según horas reales y reporte de actividades.'],
  ),
];

/** Crea las plantillas base que falten (una vez cada una: si la eliminas, no vuelve). */
function seed(): void {
  const done = new Set(db.getSetting<string[]>('proposal_templates_seeded') ?? []);
  const t = now();
  for (const s of SEEDS) {
    if (done.has(s.key)) continue;
    sqlite
      .prepare('INSERT OR IGNORE INTO proposal_templates (name, category, data, seed_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(s.name, s.category, JSON.stringify(s.data), s.key, t, t);
    done.add(s.key);
  }
  db.setSetting('proposal_templates_seeded', [...done]);
}
seed();

/**
 * Ajustes a plantillas base que ya se crearon (una vez cada uno). Chatbot Grupo Oral Flex: la IA se puede pagar por
 * año y la implementación dura máximo 1 mes. Solo completa lo que falte: no pisa lo que hayas editado.
 */
function patchSeeds(): void {
  const done = new Set(db.getSetting<string[]>('proposal_templates_patches') ?? []);
  const key = 'chatbot-anual-y-plazo';
  if (done.has(key)) return;
  const r = sqlite.prepare('SELECT * FROM proposal_templates WHERE seed_key = ?').get('chatbot-grupo-oral-flex-click-lab') as unknown as Row | undefined;
  if (r) {
    const d = parse(r.data);
    if (!d.timeline) d.timeline = 'Máximo 1 mes desde la aprobación';
    for (const it of d.items) if (it.billing === 'mensual' && /inteligencia artificial/i.test(it.name)) it.annual = true;
    d.terms = d.terms.map((t) =>
      t === 'La mensualidad de inteligencia artificial cubre hasta 800 chats mensuales.'
        ? 'La mensualidad de inteligencia artificial cubre hasta 800 chats mensuales y se puede pagar mes a mes o por año.'
        : t,
    );
    sqlite.prepare('UPDATE proposal_templates SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(d), now(), r.id);
  }
  done.add(key);
  db.setSetting('proposal_templates_patches', [...done]);
}
patchSeeds();

// ───────── La propuesta en HTML (diseño del Cotizador 2026) ─────────

/**
 * La propuesta se publica con la plantilla del Cotizador 2026 (plantilla-propuesta.html): una presentación con el
 * Design System de DeerSystems que se dibuja a partir del JSON en <script id="propuesta">. Aquí se arma ese JSON
 * (portada con ficha, contexto, alcance, inversión, adicionales, medios de pago, trayectoria y cierre) igual que
 * generar_propuesta.py, e incluye meta.aprobacion para que Partners lea los valores exactos al aprobar.
 */
const PLANTILLA = readFileSync(new URL('./plantilla-propuesta.html', import.meta.url), 'utf8');

const CONTACTO = { name: 'David Lidueñas Gil', role: 'CEO', email: 'ceo@deersystems.net', web: 'deersystems.net', legal: 'NIT 1036658641-8 · Persona natural' };
const ESLOGAN = 'Sistemas que conectan, soluciones que simplifican.';
const PRESENTA = 'David Lidueñas Gil · DeerSystems';
const MEDIOS_PAGO = {
  titular: 'David Lidueñas Gil · NIT 1036658641-8',
  medios: [
    { nombre: 'Transferencia Bancolombia', detalle: 'Cuenta de ahorros', valor: '236-982348-14' },
    { nombre: 'Nequi', detalle: 'Número celular', valor: '312 876 5844' },
    { nombre: 'Llave Bre-B', detalle: 'Desde la app de cualquier banco', valor: '@deersystems' },
  ],
  resumen: 'Transferencia Bancolombia, Nequi, llave Bre-B o QR',
};
const TRAYECTORIA = {
  role: 'trayectoria',
  type: 'proof',
  menu: 'Trayectoria',
  eyebrow: 'Trayectoria',
  title: 'Más de 10 años desarrollando web y más de 12 sitios en producción.',
  stats: [
    { figure: '10+', label: 'años desarrollando web' },
    { figure: '12+', label: 'sitios en producción para clientes reales' },
    { figure: '3', label: 'plataformas: WordPress, Shopify y React' },
  ],
  groups: [
    {
      label: 'WordPress',
      items: [
        ['MercadoLibre Experience', 'https://mercadolibreexperience.com.co'],
        ['Latam Motos', 'https://latammotos.com'],
        ['Propiedades Nakama', 'https://propiedadesnakama.com'],
        ['Frotex', 'https://frotex.com'],
        ['Made Mármol', 'https://mademarmol.co'],
        ['LendingSpot', 'https://lendingspot.net'],
      ],
    },
    {
      label: 'Shopify · E-Commerce',
      variant: 'ai',
      items: [
        ['Licores Medellín', 'https://licoresmedellin.com'],
        ['Santiago Corazón', 'https://santiagocorazon.org'],
        ['Tom Lampert', 'https://tomlampert.com'],
      ],
    },
    {
      label: 'React',
      items: [
        ['Call to Action Plus', 'https://calltoactionplus.com'],
        ['Hesvor', 'https://hesvor.com'],
        ['Primo Team', 'https://primoteam.com'],
      ],
    },
  ],
  tags: ['Portafolio en deersystems.net'],
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const cop = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;
const PERIOD: Record<Billing, string> = { unico: 'pago único', mensual: '/ mes', anual: '/ año', hora: '/ hora' };
const GROUP: Record<Billing, string> = { unico: 'Pago único', mensual: 'Mensual', anual: 'Anual', hora: 'Por hora' };
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const priceText = (i: TemplateItem, c: string) =>
  `${cop(i.price)} ${c} ${PERIOD[i.billing]}`.replace(' pago único', ' · pago único') + (i.annual ? ` · o ${cop(i.price * 12)} ${c} / año` : '');
const annualLine = (i: TemplateItem, c: string) => (i.annual ? `También en pago anual: ${cop(i.price * 12)} ${c} / año (12 meses).` : '');

/** «Chatbot con inteligencia artificial para» + «Grupo Oral Flex.»: el cliente (o las últimas palabras) va resaltado. */
function headline(d: TemplateData): { title: string; accent: string } {
  const t = d.title.trim().replace(/[.]$/, '');
  for (const who of [d.endClient, d.agency]) {
    if (who && t.toLowerCase().endsWith(who.toLowerCase()) && t.length > who.length) return { title: t.slice(0, -who.length).trim(), accent: `${who}.` };
  }
  const words = t.split(/\s+/);
  const n = words.length > 4 ? 3 : Math.max(1, words.length - 1);
  return words.length > 1 ? { title: words.slice(0, -n).join(' '), accent: `${words.slice(-n).join(' ')}.` } : { title: '', accent: `${t}.` };
}

/** Datos de la presentación (lo mismo que arma generar_propuesta.py para la plantilla). */
export function proposalData(d: TemplateData, date = new Date(), nro = String(10000 + Math.floor(Math.random() * 90000))) {
  const c = d.currency;
  const local = new Date(date.getTime() - 5 * 3_600_000);
  const fecha = `${local.getUTCDate()} de ${MESES[local.getUTCMonth()]} de ${local.getUTCFullYear()}`;
  const vigencia = `${d.validityDays} días calendario`;
  const base = d.items.filter((i) => !i.optional);
  const extras = d.items.filter((i) => i.optional);
  const cliente = d.endClient || d.agency || 'Cliente';
  const who = d.endClient || d.agency;
  const unico = base.filter((i) => i.billing === 'unico').reduce((s, i) => s + i.price, 0);
  const split = d.terms.some((t) => /50\s*%/.test(t));
  const ficha = d.agency && d.endClient ? [['Agencia', d.agency], ['Cliente final', d.endClient]] : [['Cliente', cliente]];
  const h = headline(d);
  const intro = d.intro.split(/\n+/).map((x) => x.trim()).filter(Boolean);
  const slides: Record<string, unknown>[] = [];

  slides.push({
    role: 'portada',
    type: 'cover',
    menu: 'Portada',
    eyebrow: `Propuesta N.º DS-${nro}`,
    title: h.title,
    accent: h.accent,
    lead: intro[0] ?? '',
    slogan: ESLOGAN,
    ficha: [...ficha, ...(d.timeline ? [['Implementación', d.timeline]] : []), ['Fecha', fecha], ['Vigencia', vigencia], ['Presenta', PRESENTA]],
  });
  if (intro.length) {
    slides.push({
      role: 'contexto',
      type: 'split',
      menu: 'Contexto y objetivo',
      eyebrow: 'Contexto y objetivo',
      title: who ? `Lo que proponemos para ${who}.` : 'Lo que proponemos.',
      left: { heading: d.includes.length ? 'Lo que incluye' : 'La propuesta', items: (d.includes.length ? d.includes : base.map((i) => i.name)).slice(0, 6) },
      right: { eyebrow: 'Cómo lo resolvemos', paragraphs: intro.slice(0, 3) },
    });
  }
  const cards = base.map((i) => ({ title: i.name, items: (i.details.length ? i.details : [i.description]).filter(Boolean).slice(0, 6) }));
  if (cards.length) {
    slides.push({ role: 'alcance', type: 'cards', menu: 'Alcance general', eyebrow: 'Alcance general', title: 'Esto incluye la propuesta.', cards, cols: Math.min(4, cards.length) });
  }

  // Inversión: un plan por ítem, la tarjeta «Cómo se paga» y las condiciones.
  const steps: { value: string; label: string; text: string }[] = [];
  if (unico) {
    if (split) {
      steps.push({ value: '50%', label: 'Anticipo', text: `Al aprobar. ${cop(unico / 2)} ${c}.` });
      steps.push({ value: '50%', label: 'Contra entrega', text: `Al entregar. ${cop(unico - Math.round(unico / 2))} ${c}.` });
    } else {
      steps.push({ value: 'Único', label: `${cop(unico)} ${c}`, text: base.filter((i) => i.billing === 'unico').map((i) => i.name).join(', ') + '.' });
    }
  }
  for (const b of ['mensual', 'anual', 'hora'] as Billing[]) {
    const its = base.filter((i) => i.billing === b);
    if (its.length) steps.push({ value: GROUP[b], label: `${cop(its.reduce((s, i) => s + i.price, 0))} ${c} ${PERIOD[b]}`, text: its.map((i) => (i.annual ? `${i.name} (o ${cop(i.price * 12)} ${c} al año)` : i.name)).join(', ') + '.' });
  }
  slides.push({
    role: 'inversion',
    type: 'pricing',
    menu: 'Inversión y pago',
    eyebrow: 'Inversión y forma de pago',
    title: base.length > 1 ? 'Una inversión clara, separada por concepto.' : 'Una inversión clara, sin sorpresas.',
    plans: base.map((i) => ({ name: i.name, price: cop(i.price), unit: `${c} ${i.billing === 'unico' ? '· pago único' : PERIOD[i.billing]}`, items: [i.description, ...i.details, annualLine(i, c)].filter(Boolean).slice(0, 6) })),
    payment: { heading: 'Cómo se paga', steps },
    notes: {
      heading: 'Ten en cuenta',
      items: [
        ...(d.timeline ? [`Implementación: ${d.timeline.charAt(0).toLowerCase()}${d.timeline.slice(1).replace(/\.$/, '')}.`] : []),
        ...(d.terms.length ? d.terms : [`Valores en ${c === 'USD' ? 'dólares (USD)' : 'pesos colombianos (COP)'}.`]),
      ]
        .slice(0, 6)
        .concat(`La propuesta tiene vigencia de ${vigencia} desde su fecha.`)
        .slice(0, 7),
    },
    tags: [c === 'USD' ? 'Dólares (USD)' : 'Pesos colombianos (COP)'],
  });
  if (extras.length) {
    slides.push({
      role: 'adicionales',
      type: 'cards',
      menu: 'Adicionales opcionales',
      eyebrow: 'Adicionales opcionales',
      title: 'Súmalos solo si los necesitas.',
      cards: extras.map((i) => ({ chip: 'Opcional', title: i.name, text: i.description, items: i.details.length ? i.details.slice(0, 5) : undefined, foot: `+ ${priceText(i, c)}` })),
      cols: Math.min(3, extras.length),
    });
  }
  slides.push({
    role: 'medios',
    type: 'methods',
    menu: 'Medios de pago',
    eyebrow: 'Medios de pago',
    title: 'Paga desde la app de tu banco, sin complicaciones.',
    holder: MEDIOS_PAGO.titular,
    methods: MEDIOS_PAGO.medios,
    qr: true,
    qrKey: '@deersystems',
    note:
      (c === 'USD' ? 'Los pagos en dólares (USD) se reciben en la cuenta Bancolombia. ' : '') +
      'Cada pago se hace por el valor indicado en la propuesta. Al recibirlo te enviamos la cuenta de cobro y la confirmación.',
  });
  slides.push(structuredClone(TRAYECTORIA));
  slides.push({
    role: 'cierre',
    type: 'closing',
    menu: 'Siguiente paso',
    bg: 'soft',
    eyebrow: 'Siguiente paso',
    title: 'Aprueba la propuesta y arrancamos.',
    summary: [
      ...base.map((i) => [i.name, priceText(i, c)]),
      ...extras.map((i) => [`${i.name} (opcional)`, priceText(i, c)]),
      ...(unico && split ? [['Forma de pago', '50% anticipo · 50% contra entrega']] : []),
      ...(d.timeline ? [['Implementación', d.timeline]] : []),
      ['Medios de pago', MEDIOS_PAGO.resumen],
      ['Vigencia', vigencia],
    ],
    contact: CONTACTO,
    cta: { label: 'Aprobar la propuesta', href: `mailto:${CONTACTO.email}?subject=Aprobaci%C3%B3n%20propuesta%20DS-${nro}` },
    secondary: { label: 'Ver portafolio', href: 'https://deersystems.net/' },
  });

  const tipo = d.title.slice(0, 60);
  const titulo = d.title;
  const descripcion = (intro[0] ?? d.title).slice(0, 160);
  return {
    meta: {
      cliente,
      ...(d.agency && d.endClient ? { agencia: d.agency } : {}),
      nro,
      tipo,
      titulo,
      archivo: `Propuesta_${tipo.replace(/\s+/g, '_')}_${cliente.replace(/\s+/g, '')}_${nro}`,
      seo: { titulo: `${titulo} · Propuesta DS-${nro}`, descripcion, url: '' },
      // Datos exactos para Partners al aprobar desde el enlace (una sola oferta; los pagos únicos del plan).
      aprobacion: {
        moneda: c,
        opciones: [],
        pagos: unico
          ? split
            ? [
                { concepto: 'Anticipo', cuando: 'Al aprobar', fecha: null, porcentaje: 50, valores: { _: Math.round(unico / 2) } },
                { concepto: 'Contra entrega', cuando: 'Al entregar', fecha: null, porcentaje: 50, valores: { _: unico - Math.round(unico / 2) } },
              ]
            : [{ concepto: 'Pago único', cuando: 'Al aprobar', fecha: null, porcentaje: 100, valores: { _: unico } }]
          : [],
        // Cobros recurrentes; con `anual`, el cliente elige al aprobar si paga mes a mes o por año (12 meses).
        recurrentes: base.filter((i) => i.billing !== 'unico').map((i) => ({ concepto: i.name, valor: i.price, periodo: i.billing, anual: i.annual ? i.price * 12 : null })),
        plazo: d.timeline || null,
        adicionales: extras.map((i) => ({ concepto: i.name, valor: i.price, periodo: i.billing })),
      },
    },
    slides,
  };
}

function seoHtml(m: { seo: { titulo: string; descripcion: string } }): string {
  const t = esc(m.seo.titulo);
  const d = esc(m.seo.descripcion);
  const img = 'https://deersystems.net/img/og-image.png';
  const alt = esc('DeerSystems · Sistemas que conectan, soluciones que simplifican');
  return [
    '<!--SEO:INICIO — lo escribe Partners (plantillas de propuestas); no editar a mano-->',
    `<title>${t}</title>`,
    `<meta name="description" content="${d}">`,
    '<meta name="robots" content="noindex, nofollow">',
    '<meta name="author" content="DeerSystems">',
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="DeerSystems">',
    '<meta property="og:locale" content="es_CO">',
    `<meta property="og:title" content="${t}">`,
    `<meta property="og:description" content="${d}">`,
    `<meta property="og:image" content="${img}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    `<meta property="og:image:alt" content="${alt}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${t}">`,
    `<meta name="twitter:description" content="${d}">`,
    `<meta name="twitter:image" content="${img}">`,
    '<!--SEO:FIN-->',
  ].join('\n');
}

export function renderHtml(d: TemplateData, date = new Date()): string {
  const data = proposalData(d, date);
  const payload = JSON.stringify(data, null, 2).replace(/<\//g, '<\\/');
  return PLANTILLA.replace(/(<script type="application\/json" id="propuesta">)[\s\S]*?(<\/script>)/, (_m, a: string, b: string) => `${a}\n${payload}\n${b}`).replace(
    /<!--SEO:INICIO[\s\S]*?<!--SEO:FIN-->/,
    () => seoHtml(data.meta),
  );
}

// ───────── Vista y API ─────────

/** URL sugerida: el título y, si no lo menciona, el cliente. */
export function defaultSlug(d: TemplateData): string {
  const who = d.endClient || d.agency;
  return who && !d.title.toLowerCase().includes(who.toLowerCase()) ? `${d.title} ${who}` : d.title;
}

function view(r: Row) {
  const data = parse(r.data);
  const base = data.items.filter((i) => !i.optional);
  const sum = (b: Billing) => base.filter((i) => i.billing === b).reduce((s, i) => s + i.price, 0);
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    base: !!r.seed_key,
    uses: r.uses,
    updatedAt: r.updated_at,
    data,
    totals: { unico: sum('unico'), mensual: sum('mensual'), anual: sum('anual'), hora: sum('hora') },
  };
}

function save(id: number | null, body: Record<string, unknown>): Row {
  const name = str(body.name, 160);
  if (!name) throw new HttpError(400, 'Ponle un nombre a la plantilla.');
  const data = cleanData(body.data);
  if (!data.title) throw new HttpError(400, 'Falta el título de la propuesta.');
  if (!data.items.length) throw new HttpError(400, 'Agrega al menos un ítem con su valor.');
  const category: Category = body.category === 'agencia' ? 'agencia' : 'personalizada';
  const t = now();
  if (id) {
    if (!get(id)) throw new HttpError(404, 'La plantilla no existe.');
    sqlite.prepare('UPDATE proposal_templates SET name = ?, category = ?, data = ?, updated_at = ? WHERE id = ?').run(name, category, JSON.stringify(data), t, id);
    return get(id)!;
  }
  const r = sqlite
    .prepare('INSERT INTO proposal_templates (name, category, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(name, category, JSON.stringify(data), t, t);
  return get(Number(r.lastInsertRowid))!;
}

/** Borrador de plantilla con IA a partir de lo que describes (servicio, cliente, valores). */
async function draftWithAi(brief: string): Promise<{ name: string; data: TemplateData }> {
  if (brief.length < 20) throw new HttpError(400, 'Describe un poco más la propuesta: servicio, cliente y valores.');
  const { data } = await completeJson<{ name?: unknown; data?: unknown }>({
    profile: 'propuestas',
    purpose: 'plantilla',
    system: `Eres el asistente comercial de DeerSystems, una agencia colombiana de desarrollo de software, automatización e IA.
Convierte la descripción en una propuesta comercial estructurada, en español neutro y claro, sin inventar valores: usa solo los precios que te den (si no hay, deja 0).
Devuelve SOLO JSON con esta forma:
{"name": "nombre corto de la plantilla", "data": {"title": "título que ve el cliente", "agency": "a quién va dirigida (empresa o agencia)", "endClient": "cliente final si es una agencia, si no vacío", "intro": "2 a 4 frases: qué se propone y para qué", "currency": "COP" o "USD", "items": [{"name": "...", "description": "...", "price": número entero sin puntos, "billing": "unico" | "mensual" | "anual" | "hora", "optional": true si es un adicional, "details": ["qué incluye", "..."], "annual": true solo si es mensual y se permite pagarlo por año}], "includes": [], "terms": ["condiciones: pagos, qué es opcional, qué no incluye"], "validityDays": 30, "timeline": "plazo de implementación si lo dan, p. ej. Máximo 1 mes desde la aprobación; si no, vacío"}}`,
    prompt: brief.slice(0, 6000),
    maxOutputTokens: 4000,
  });
  return { name: str(data.name, 160) || 'Propuesta personalizada', data: cleanData(data.data) };
}

export async function handleTemplates(
  route: string,
  id: number,
  req: IncomingMessage,
  res: ServerResponse,
  v: Viewer,
  proposalView: (p: Proposal) => unknown,
): Promise<boolean> {
  if (!route.includes('proposal-templates')) return false;
  requireOwner(v);
  switch (route) {
    case 'GET proposal-templates': {
      const rows = sqlite.prepare('SELECT * FROM proposal_templates ORDER BY category, name COLLATE NOCASE').all() as unknown as Row[];
      json(res, 200, rows.map(view));
      return true;
    }
    case 'POST proposal-templates':
      json(res, 201, view(save(null, await readJson(req))));
      return true;
    case 'PUT proposal-templates/:id':
      json(res, 200, view(save(id, await readJson(req))));
      return true;
    case 'DELETE proposal-templates/:id':
      if (!get(id)) throw new HttpError(404, 'La plantilla no existe.');
      sqlite.prepare('DELETE FROM proposal_templates WHERE id = ?').run(id);
      json(res, 200, { ok: true });
      return true;

    // Vista previa: el HTML tal como lo verá el cliente (con lo que hay en pantalla, guardado o no).
    case 'POST proposal-templates/preview': {
      const body = await readJson(req);
      json(res, 200, { html: renderHtml(cleanData(body.data)) });
      return true;
    }

    case 'POST proposal-templates/draft': {
      const body = await readJson(req);
      try {
        json(res, 200, await draftWithAi(str(body.brief, 6000)));
      } catch (err) {
        if (err instanceof AiError) throw new HttpError(502, err.message);
        throw err;
      }
      return true;
    }

    // Publica una propuesta a partir de la plantilla (con los ajustes de este cliente) y la asigna al cliente.
    case 'POST proposal-templates/:id/publish': {
      const t = get(id);
      if (!t) throw new HttpError(404, 'La plantilla no existe.');
      const body = await readJson(req);
      const data = cleanData(body.data ?? parse(t.data));
      if (!data.items.length) throw new HttpError(400, 'La propuesta no tiene ítems.');
      const clientId = Number(body.clientId) || null;
      if (clientId && !db.getClient(clientId)) throw new HttpError(400, 'El cliente no existe.');
      const html = Buffer.from(renderHtml(data), 'utf8');
      const slug = slugify(str(body.slug, 120) || defaultSlug(data));
      const upload = { filename: `${slug}.html`, files: new Map([['index.html', html]]), size: html.length, hasAssets: false };
      // Misma URL que una propuesta ya publicada: con `replace`, se publica como versión nueva en el mismo enlace
      // (el cliente que ya lo tiene ve la propuesta actualizada; la anterior queda en el historial).
      const current = getProposalBySlug(slug);
      if (current && body.replace !== true) {
        throw new HttpError(409, `Ya hay una propuesta publicada en /${slug}. Puedes publicarla como versión nueva en ese mismo enlace.`);
      }
      const created = current
        ? await proposals.replace(current, upload, { by: v.email, note: `Actualizada desde la plantilla «${t.name}»` })
        : await proposals.publish(upload, { slug, title: str(body.title, 200) || [data.agency, data.endClient].filter(Boolean).join(' · ') || t.name, by: v.email });
      if (clientId) setProposalClient(created.id, clientId);
      sqlite.prepare('UPDATE proposal_templates SET uses = uses + 1 WHERE id = ?').run(id);
      json(res, 201, proposalView(getProposal(created.id)!));
      return true;
    }
  }
  return false;
}
