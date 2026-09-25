import { useEffect, useState } from 'react';
import { whatsappLink } from '../data/content';
import { Wordmark } from './Brand';
import { Icon } from './Icons';

const LINKS = [
  { href: '#servicios', label: 'Servicios' },
  { href: '#automatizacion', label: 'Automatización' },
  { href: '#proyectos', label: 'Proyectos' },
  { href: '#sobre-mi', label: 'Sobre mí' },
  { href: '#contacto', label: 'Contacto' },
];

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
  }, [open]);

  return (
    <header className={`header ${scrolled ? 'header--scrolled' : ''} ${open ? 'header--open' : ''}`}>
      <div className="container header__inner">
        <a href="#inicio" className="header__logo" aria-label="DeerSystems, ir al inicio">
          <Wordmark size={30} />
        </a>
        <nav className="header__nav" aria-label="Principal">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)}>
              {l.label}
            </a>
          ))}
          <a
            className="btn btn--primary header__cta"
            href={whatsappLink('Hola David, quiero automatizar procesos en mi negocio.')}
            target="_blank"
            rel="noopener"
          >
            Agenda una llamada
          </a>
        </nav>
        <button
          className="header__toggle"
          aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name={open ? 'close' : 'menu'} size={22} />
        </button>
      </div>
    </header>
  );
}
