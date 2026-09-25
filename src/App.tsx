import { useCallback, useEffect, useState } from 'react';
import { NexoChat } from './components/NexoChat';
import { Header } from './components/Header';
import { Hero } from './components/Hero';
import { Loader } from './components/Loader';
import {
  About,
  Automation,
  Contact,
  Footer,
  Nexo,
  Process,
  Projects,
  Sectors,
  Services,
  StackMarquee,
} from './components/Sections';

/** Revela con animación los elementos marcados con [data-reveal] al entrar en pantalla. */
function useReveal(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('is-visible');
            io.unobserve(e.target);
          }
        }),
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    const observe = () =>
      document.querySelectorAll('[data-reveal]:not(.is-visible)').forEach((el) => io.observe(el));
    observe();
    const mo = new MutationObserver(observe);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, [enabled]);
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const done = useCallback(() => setLoading(false), []);
  useReveal(!loading);

  return (
    <>
      {loading && <Loader onDone={done} />}
      <a className="skip-link" href="#main">
        Saltar al contenido
      </a>
      <Header />
      <main id="main" className={loading ? 'is-loading' : 'is-ready'}>
        <Hero />
        <StackMarquee />
        <Services />
        <Automation />
        <Nexo />
        <Sectors />
        <Projects />
        <Process />
        <About />
        <Contact />
      </main>
      <Footer />
      <NexoChat />
    </>
  );
}
