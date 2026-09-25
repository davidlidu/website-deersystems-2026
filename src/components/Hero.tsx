import { LiquidOrb } from '../orb/LiquidOrb';
import { whatsappLink } from '../data/content';
import { Icon } from './Icons';

const FLOW = [
  { icon: 'bolt', label: 'Lead capturado', meta: 'Formulario · Meta Ads' },
  { icon: 'flow', label: 'CRM actualizado', meta: 'Etiquetado y asignado' },
  { icon: 'whatsapp', label: 'Seguimiento enviado', meta: 'WhatsApp · automático' },
];

export function Hero() {
  return (
    <section id="inicio" className="hero">
      <div className="hero__grid-bg" aria-hidden="true" />
      <div className="container hero__inner">
        <div className="hero__copy">
          <p className="eyebrow" data-reveal>
            <span className="dot" /> Sistemas que conectan, soluciones que simplifican
          </p>
          <h1 className="display" data-reveal>
            Automatizamos los procesos que <span className="grad">frenan tu crecimiento</span>.
          </h1>
          <p className="lead" data-reveal>
            Desarrollo web, servidores e inteligencia artificial conectados en un solo sistema. Llevamos a marcas
            personales y grandes compañías de la operación manual a procesos que trabajan solos, 24/7.
          </p>
          <div className="hero__ctas" data-reveal>
            <a
              className="btn btn--primary btn--lg"
              href={whatsappLink('Hola David, quiero automatizar procesos en mi negocio.')}
              target="_blank"
              rel="noopener"
            >
              Hablemos de tu proceso <Icon name="arrow" size={18} />
            </a>
            <a className="btn btn--outline btn--lg" href="#proyectos">
              Ver proyectos
            </a>
          </div>
          <dl className="hero__stats" data-reveal>
            <div>
              <dt>Años desarrollando</dt>
              <dd className="mono">10+</dd>
            </div>
            <div>
              <dt>Años automatizando</dt>
              <dd className="mono">3</dd>
            </div>
            <div>
              <dt>Sitios en producción</dt>
              <dd className="mono">12+</dd>
            </div>
          </dl>
        </div>

        <div className="hero__visual" data-reveal>
          <div className="hero__ring" aria-hidden="true" />
          <div className="hero__ring hero__ring--2" aria-hidden="true" />
          <LiquidOrb preset="nexo" interactive className="hero__orb" label="Orbe líquido de DeerSystems" />
          <ol className="hero__flow" aria-label="Ejemplo de flujo automatizado">
            {FLOW.map((f, i) => (
              <li key={f.label} className={`chip-card chip-card--${i + 1}`}>
                <span className="chip-card__icon">
                  <Icon name={f.icon} size={16} />
                </span>
                <span>
                  <strong>{f.label}</strong>
                  <small>{f.meta}</small>
                </span>
                <Icon name="check" size={16} className="chip-card__ok" />
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
