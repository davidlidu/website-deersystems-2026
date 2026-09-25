import type { ReactNode } from 'react';
import { Header } from '../components/Header';
import { FloatingChat, Footer } from '../components/Sections';

export const LAST_UPDATE = '25 de septiembre de 2026';

export type LegalSection = { id: string; title: string; body: ReactNode };

export function LegalPage({ eyebrow, title, intro, sections }: {
  eyebrow: string;
  title: string;
  intro: ReactNode;
  sections: LegalSection[];
}) {
  return (
    <>
      <a className="skip-link" href="#main">
        Saltar al contenido
      </a>
      <Header base="/" />
      <main id="main" className="legal">
        <div className="container legal__inner">
          <header className="legal__head">
            <p className="eyebrow">{eyebrow}</p>
            <h1 className="h2">{title}</h1>
            <p className="mono muted legal__date">Última actualización: {LAST_UPDATE}</p>
            <div className="lead">{intro}</div>
          </header>

          <div className="legal__layout">
            <nav className="legal__toc" aria-label="Contenido">
              <p className="mono">Contenido</p>
              <ol>
                {sections.map((s) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`}>{s.title}</a>
                  </li>
                ))}
              </ol>
            </nav>
            <article className="legal__body">
              {sections.map((s, i) => (
                <section key={s.id} id={s.id}>
                  <h2 className="h4">
                    <span className="mono">{String(i + 1).padStart(2, '0')}</span> {s.title}
                  </h2>
                  {s.body}
                </section>
              ))}
            </article>
          </div>
        </div>
      </main>
      <Footer base="/" />
      <FloatingChat />
    </>
  );
}
