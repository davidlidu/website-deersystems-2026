import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { LiquidOrb } from '../orb/LiquidOrb';
import {
  PROJECTS,
  SECTORS,
  STACK,
  WHATSAPP_DISPLAY,
  screenshotUrl,
  whatsappLink,
  type Platform,
} from '../data/content';
import { Icon } from './Icons';
import { Wordmark } from './Brand';

function SectionHead({ eyebrow, title, text }: { eyebrow: string; title: ReactNode; text?: string }) {
  return (
    <div className="section-head" data-reveal>
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="h2">{title}</h2>
      {text && <p className="lead">{text}</p>}
    </div>
  );
}

/* ───────────────────────── Stack (marquee) ───────────────────────── */

export function StackMarquee() {
  const items = [...STACK, ...STACK];
  return (
    <div className="marquee" aria-label="Tecnologías con las que trabajamos">
      <div className="marquee__track">
        {items.map((s, i) => (
          <span key={i} className="marquee__item" aria-hidden={i >= STACK.length}>
            <span className="marquee__node" /> {s}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────── Servicios ───────────────────────── */

const SERVICES = [
  {
    icon: 'brain',
    tag: 'Core',
    title: 'Automatización e IA',
    text: 'Flujos con n8n, agentes de IA y APIs que conectan tu CRM, WhatsApp, formularios, pagos y reportes. Tu operación corre sola mientras tú te enfocas en vender.',
    points: ['Agentes de IA para atención y calificación', 'Integraciones entre plataformas vía API', 'Reportes y alertas automáticas'],
    featured: true,
  },
  {
    icon: 'code',
    tag: 'Web',
    title: 'Sitios web y E-commerce',
    text: 'WordPress, Shopify y React. Landing pages de alta conversión, sitios corporativos y tiendas con pasarela de pagos lista para vender.',
    points: ['Wompi, PayU, Mercado Pago y ePayco', 'SEO técnico y velocidad', 'Diseño orientado a conversión'],
  },
  {
    icon: 'server',
    tag: 'Infra',
    title: 'Servidores, dominios y correo',
    text: 'Configuración y gestión de VPS, Docker y cPanel; dominios, DNS, SSL y correo corporativo que simplemente funcionan.',
    points: ['Despliegues y migraciones', 'DNS, SSL y correo corporativo', 'Monitoreo y copias de seguridad'],
  },
  {
    icon: 'shield',
    tag: 'Soporte',
    title: 'Mantenimiento continuo',
    text: 'Actualizaciones, seguridad, rendimiento y mejoras constantes para que tu plataforma evolucione contigo.',
    points: ['Seguridad y firewall', 'Core Web Vitals', 'Informe mensual con métricas'],
  },
];

export function Services() {
  return (
    <section id="servicios" className="section">
      <div className="container">
        <SectionHead
          eyebrow="Servicios"
          title={
            <>
              Todo lo que tu negocio necesita, <span className="grad">conectado</span>.
            </>
          }
          text="Más de 10 años construyendo en la web y 3 años llevando procesos al siguiente nivel con automatización e inteligencia artificial."
        />
        <div className="services">
          {SERVICES.map((s) => (
            <article key={s.title} className={`card service ${s.featured ? 'service--featured' : ''}`} data-reveal>
              <div className="service__top">
                <span className="icon-box">
                  <Icon name={s.icon} size={22} />
                </span>
                <span className="pill">{s.tag}</span>
              </div>
              <h3 className="h3">{s.title}</h3>
              <p>{s.text}</p>
              <ul className="checklist">
                {s.points.map((p) => (
                  <li key={p}>
                    <Icon name="check" size={16} /> {p}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── Automatización (mockup de flujo) ───────────────────────── */

const LOG = [
  { t: '09:14:02', ok: true, msg: 'Nuevo lead desde formulario web', tag: 'webhook' },
  { t: '09:14:03', ok: true, msg: 'IA clasificó intención: “cotización”', tag: 'llm' },
  { t: '09:14:03', ok: true, msg: 'Contacto creado y etiquetado en CRM', tag: 'crm' },
  { t: '09:14:04', ok: true, msg: 'Mensaje de bienvenida por WhatsApp', tag: 'whatsapp' },
  { t: '09:14:05', ok: true, msg: 'Asesor notificado con resumen del lead', tag: 'notify' },
  { t: '09:30:00', ok: true, msg: 'Recordatorio programado si no responde', tag: 'cron' },
];

export function Automation() {
  const ref = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer = 0;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !timer) {
          let n = 0;
          timer = window.setInterval(() => {
            n = n >= LOG.length + 3 ? 0 : n + 1;
            setLines(Math.min(n, LOG.length));
          }, 700);
        } else if (!e.isIntersecting && timer) {
          clearInterval(timer);
          timer = 0;
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      clearInterval(timer);
    };
  }, []);

  return (
    <section id="automatizacion" className="section section--divided">
      <div className="container automation">
        <div className="automation__copy">
          <SectionHead
            eyebrow="Automatización"
            title={
              <>
                Tu operación, trabajando <span className="grad">mientras duermes</span>.
              </>
            }
            text="Diseñamos sistemas que capturan, clasifican, responden y dan seguimiento sin intervención manual. Menos tareas repetitivas, cero leads olvidados y datos siempre al día."
          />
          <ul className="steps" data-reveal>
            <li>
              <span className="mono">01</span>
              <div>
                <strong>Captura</strong>
                <p>Formularios, anuncios, WhatsApp, Instagram y tu tienda alimentan un solo flujo.</p>
              </div>
            </li>
            <li>
              <span className="mono">02</span>
              <div>
                <strong>Procesa con IA</strong>
                <p>Clasifica, resume y decide el siguiente paso con modelos de lenguaje.</p>
              </div>
            </li>
            <li>
              <span className="mono">03</span>
              <div>
                <strong>Actúa y reporta</strong>
                <p>CRM, mensajes, tareas y reportes se actualizan solos, en tiempo real.</p>
              </div>
            </li>
          </ul>
        </div>

        <div className="terminal" ref={ref} data-reveal>
          <div className="terminal__bar">
            <span />
            <span />
            <span />
            <p className="mono">workflow · nuevo-lead.json</p>
            <span className="status">
              <i /> activo
            </span>
          </div>
          <div className="terminal__nodes" aria-hidden="true">
            {['Webhook', 'IA', 'CRM', 'WhatsApp'].map((n, i) => (
              <div key={n} className={`node ${lines > i ? 'node--on' : ''}`}>
                {n}
              </div>
            ))}
          </div>
          <ol className="terminal__log mono" aria-label="Ejemplo de registro de ejecución">
            {LOG.map((l, i) => (
              <li key={i} className={i < lines ? 'is-in' : ''}>
                <span className="t">{l.t}</span>
                <span className="ok">✓</span>
                <span className="msg">{l.msg}</span>
                <span className="tag">{l.tag}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── Nexo ───────────────────────── */

export function Nexo() {
  return (
    <section className="section nexo" aria-labelledby="nexo-title">
      <div className="container nexo__inner">
        <div className="nexo__visual" data-reveal>
          <LiquidOrb preset="violetaIA" className="nexo__orb" />
          <img src="/img/nexo-front.webp" alt="Nexo, el agente de IA de DeerSystems" width={520} height={1260} loading="lazy" />
        </div>
        <div className="nexo__copy">
          <p className="eyebrow eyebrow--violet" data-reveal>
            Agentes de IA
          </p>
          <h2 id="nexo-title" className="h2" data-reveal>
            Conoce a <span className="grad grad--violet">Nexo</span>.
          </h2>
          <p className="lead" data-reveal>
            Nexo es la cara de los agentes de inteligencia artificial que construimos: asistentes que responden,
            califican y agendan por ti, conectados a tus datos y a tus herramientas.
          </p>
          <div className="nexo__pillars" data-reveal>
            {[
              { k: 'Analiza', v: 'Entiende a cada cliente y detecta ineficiencias antes de proponer una solución.' },
              { k: 'Automatiza', v: 'Ejecuta tareas repetitivas con precisión, en cualquier canal y a cualquier hora.' },
              { k: 'Evoluciona', v: 'Aprende de cada interacción: sistemas que crecen como las astas del ciervo.' },
            ].map((p) => (
              <div key={p.k} className="pillar">
                <strong className="mono">{p.k}</strong>
                <p>{p.v}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── Sectores ───────────────────────── */

export function Sectors() {
  return (
    <section className="section section--divided">
      <div className="container">
        <SectionHead
          eyebrow="Sectores"
          title={
            <>
              Automatizaciones con <span className="grad">resultados reales</span> en cada industria.
            </>
          }
          text="Desde marcas de ropa y tiendas para mascotas hasta realtors, lenders en USA y coaches: cada negocio tiene procesos que pueden trabajar solos."
        />
        <div className="sectors">
          {SECTORS.map((s) => (
            <article key={s.title} className="card sector" data-reveal>
              <span className="icon-box icon-box--cyan">
                <Icon name={s.icon} size={22} />
              </span>
              <h3 className="h4">{s.title}</h3>
              <p>{s.text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── Proyectos ───────────────────────── */

const FILTERS: Array<'Todos' | Platform> = ['Todos', 'WordPress', 'Shopify', 'React'];

function ProjectShot({ url, name, emoji }: { url: string; name: string; emoji: string }) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  return (
    <div className={`project__shot project__shot--${state}`}>
      <div className="project__fallback" aria-hidden="true">
        <span>{emoji}</span>
      </div>
      {state !== 'error' && (
        <img
          src={screenshotUrl(url)}
          alt={`Captura del sitio ${name}`}
          loading="lazy"
          decoding="async"
          onLoad={() => setState('ok')}
          onError={() => setState('error')}
        />
      )}
    </div>
  );
}

export function Projects() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('Todos');
  const list = filter === 'Todos' ? PROJECTS : PROJECTS.filter((p) => p.platform === filter);
  return (
    <section id="proyectos" className="section">
      <div className="container">
        <SectionHead
          eyebrow="Portafolio"
          title={
            <>
              Proyectos que <span className="grad">hablan por sí solos</span>.
            </>
          }
          text="Sitios web en producción, entregados con calidad para clientes reales en diferentes industrias."
        />
        <div className="filters" role="tablist" aria-label="Filtrar por plataforma" data-reveal>
          {FILTERS.map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              className={`filter ${filter === f ? 'filter--active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f}
              <span className="mono">
                {f === 'Todos' ? PROJECTS.length : PROJECTS.filter((p) => p.platform === f).length}
              </span>
            </button>
          ))}
        </div>
        <div className="projects">
          {list.map((p) => (
            <a key={p.domain} href={p.url} target="_blank" rel="noopener" className="card project">
              <div className="project__browser">
                <span />
                <span />
                <span />
                <em className="mono">{p.domain}</em>
              </div>
              <ProjectShot url={p.url} name={p.name} emoji={p.emoji} />
              <div className="project__meta">
                <div>
                  <h3 className="h4">{p.name}</h3>
                  <span className="mono muted">{p.domain}</span>
                </div>
                <span className={`pill pill--${p.platform.toLowerCase()}`}>{p.platform}</span>
              </div>
              <Icon name="arrowUpRight" size={18} className="project__go" />
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── Proceso ───────────────────────── */

const PROCESS = [
  { n: '01', icon: 'search', title: 'Diagnóstico', text: 'Entendemos tu operación y detectamos qué tareas te están costando tiempo y dinero.' },
  { n: '02', icon: 'flow', title: 'Diseño del sistema', text: 'Mapeamos el flujo ideal y elegimos las herramientas correctas para tu negocio.' },
  { n: '03', icon: 'bolt', title: 'Implementación', text: 'Construimos, conectamos y probamos cada integración antes de salir a producción.' },
  { n: '04', icon: 'chart', title: 'Evolución', text: 'Medimos, optimizamos y escalamos. Tú eres dueño de tu tecnología.' },
];

export function Process() {
  return (
    <section className="section section--divided">
      <div className="container">
        <SectionHead
          eyebrow="Cómo trabajamos"
          title={
            <>
              De la complejidad técnica a la <span className="grad">simplicidad</span>.
            </>
          }
        />
        <ol className="process">
          {PROCESS.map((p) => (
            <li key={p.n} className="process__step" data-reveal>
              <div className="process__head">
                <span className="icon-box">
                  <Icon name={p.icon} size={20} />
                </span>
                <span className="mono muted">{p.n}</span>
              </div>
              <h3 className="h4">{p.title}</h3>
              <p>{p.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ───────────────────────── Sobre mí ───────────────────────── */

export function About() {
  return (
    <section id="sobre-mi" className="section">
      <div className="container about">
        <figure className="about__photo" data-reveal>
          <img
            src="/img/david-liduenas.webp"
            alt="David Lidueñas Gil, CEO de DeerSystems"
            width={900}
            height={1389}
            loading="lazy"
          />
          <figcaption>
            <strong>David Lidueñas Gil</strong>
            <span className="mono">CEO · DeerSystems</span>
          </figcaption>
        </figure>
        <div className="about__copy">
          <p className="eyebrow" data-reveal>
            Sobre mí
          </p>
          <h2 className="h2" data-reveal>
            No solo escribo código. Construyo <span className="grad">sistemas que conectan</span>.
          </h2>
          <p className="lead" data-reveal>
            Soy David Lidueñas Gil, CEO de DeerSystems y desarrollador de software con más de 10 años de experiencia
            en desarrollo de sitios web, gestión de servidores, configuración de dominios, correos y todo lo que hace
            que un negocio funcione en internet.
          </p>
          <p data-reveal>
            Desde hace 3 años me dedico a automatizar y sistematizar procesos que llevan a marcas personales y
            grandes compañías a otro nivel: marcas de ropa, tiendas de insumos para mascotas, realtors, lenders en USA y
            coaches. Mi enfoque es simple: entender el problema antes de proponer la solución y traducir lo técnico
            en beneficios reales.
          </p>
          <ul className="about__facts" data-reveal>
            <li>
              <span className="mono grad">10+</span>
              <small>años en desarrollo web</small>
            </li>
            <li>
              <span className="mono grad">3</span>
              <small>años en automatización e IA</small>
            </li>
            <li>
              <span className="mono grad">5+</span>
              <small>sectores atendidos</small>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── Contacto ───────────────────────── */

// Cada necesidad trae su propio ejemplo para guiar al usuario en el mensaje.
const NEEDS = [
  {
    label: 'Automatización / IA',
    placeholder: 'Ej: recibo leads de Instagram y los paso a mano a una hoja de cálculo; quiero que lleguen solos al CRM y reciban respuesta por WhatsApp…',
  },
  {
    label: 'Sitio web',
    placeholder: 'Ej: necesito un sitio de 4 páginas para mi empresa, con formulario de contacto y botón de WhatsApp. Ya tengo logo y textos…',
  },
  {
    label: 'Tienda online',
    placeholder: 'Ej: vendo ropa por Instagram y quiero una tienda con unos 80 productos, pagos con PSE y tarjeta, y envíos a todo el país…',
  },
  {
    label: 'Servidores y dominios',
    placeholder: 'Ej: quiero migrar mi sitio a un VPS, configurar mi dominio y crear correos corporativos para 5 personas…',
  },
  {
    label: 'Mantenimiento',
    placeholder: 'Ej: tengo un WordPress con WooCommerce que está lento y desactualizado; necesito soporte mensual y copias de seguridad…',
  },
  {
    label: 'Otro',
    placeholder: 'Cuéntanos qué necesitas y en qué punto está tu proyecto…',
  },
];

export function Contact() {
  const [need, setNeed] = useState(NEEDS[0]);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const msg = [
      `Hola David, soy ${data.get('name')}${data.get('company') ? ` de ${data.get('company')}` : ''}.`,
      `Me interesa: ${need.label}.`,
      data.get('message') ? `${data.get('message')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    window.open(whatsappLink(msg), '_blank', 'noopener');
  };

  return (
    <section id="contacto" className="section section--divided contact">
      <div className="contact__orb" aria-hidden="true">
        <LiquidOrb preset="nexo" params={{ glow: 0.7, speed: 0.6 }} />
      </div>
      <div className="container contact__inner">
        <div className="contact__copy">
          <p className="eyebrow" data-reveal>
            Contacto
          </p>
          <h2 className="h2" data-reveal>
            ¿Listo para que tu negocio <span className="grad">trabaje solo</span>?
          </h2>
          <p className="lead" data-reveal>
            Cuéntanos qué proceso te quita más tiempo. Te respondemos por WhatsApp con una propuesta clara, directa y
            sin tecnicismos.
          </p>
          <a
            className="contact__wa card"
            href={whatsappLink('Hola David, quiero hablar sobre un proyecto.')}
            target="_blank"
            rel="noopener"
            data-reveal
          >
            <span className="icon-box">
              <Icon name="whatsapp" size={22} />
            </span>
            <span>
              <small>WhatsApp directo</small>
              <strong className="mono">{WHATSAPP_DISPLAY}</strong>
            </span>
            <Icon name="arrowUpRight" size={18} />
          </a>
        </div>

        <form className="card form" onSubmit={onSubmit} data-reveal>
          <div className="form__row">
            <label>
              <span>Nombre</span>
              <input name="name" required autoComplete="name" placeholder="Tu nombre" />
            </label>
            <label>
              <span>Empresa o marca</span>
              <input name="company" autoComplete="organization" placeholder="Opcional" />
            </label>
          </div>
          <fieldset>
            <legend>¿Qué necesitas?</legend>
            <div className="form__chips">
              {NEEDS.map((n) => (
                <button
                  type="button"
                  key={n.label}
                  className={`chip ${need === n ? 'chip--on' : ''}`}
                  aria-pressed={need === n}
                  onClick={() => setNeed(n)}
                >
                  {n.label}
                </button>
              ))}
            </div>
          </fieldset>
          <label>
            <span>{need.label === 'Automatización / IA' ? 'Cuéntanos tu proceso' : 'Cuéntanos tu proyecto'}</span>
            <textarea name="message" rows={4} placeholder={need.placeholder} />
          </label>
          <label className="form__consent">
            <input type="checkbox" name="consent" required />
            <span>
              Acepto la <a href="/privacidad.html">Política de privacidad</a> y el tratamiento de mis datos para
              responder a mi solicitud.
            </span>
          </label>
          <button className="btn btn--primary btn--lg btn--block" type="submit">
            Enviar por WhatsApp <Icon name="arrow" size={18} />
          </button>
        </form>
      </div>
    </section>
  );
}

/* ───────────────────────── Footer + chat flotante ───────────────────────── */

/** `base` = '/' en páginas internas (legales) para que las anclas vuelvan al inicio. */
export function Footer({ base = '' }: { base?: string }) {
  return (
    <footer className="footer">
      <div className="container footer__inner">
        <div className="footer__brand">
          <Wordmark size={32} />
          <p className="footer__slogan">Sistemas que conectan, soluciones que simplifican.</p>
        </div>
        <nav className="footer__nav" aria-label="Pie de página">
          <a href={`${base}#servicios`}>Servicios</a>
          <a href={`${base}#automatizacion`}>Automatización</a>
          <a href={`${base}#proyectos`}>Proyectos</a>
          <a href={`${base}#sobre-mi`}>Sobre mí</a>
          <a href={`${base}#contacto`}>Contacto</a>
        </nav>
        <div className="footer__contact">
          <a href={whatsappLink('Hola David')} target="_blank" rel="noopener">
            <Icon name="whatsapp" size={16} /> {WHATSAPP_DISPLAY}
          </a>
          <span className="muted">Colombia · Clientes en LATAM y USA</span>
        </div>
      </div>
      <div className="container footer__legal">
        <span>© {new Date().getFullYear()} DeerSystems. Todos los derechos reservados.</span>
        <nav className="footer__legal-links" aria-label="Legal">
          <a href="/privacidad.html">Política de privacidad</a>
          <a href="/terminos.html">Términos y condiciones</a>
        </nav>
      </div>
    </footer>
  );
}
