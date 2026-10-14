import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { api, type Me } from './lib';

interface Step {
  /** Elemento a resaltar (atributo data-tour). Sin target, la tarjeta va centrada. */
  target?: string;
  title: string;
  body: string;
}

function stepsFor(me: Me): Step[] {
  const first = me.name.split(' ')[0];
  const help: Step = { target: 'help', title: 'Vuelve cuando quieras', body: 'Con este botón puedes repetir el recorrido en cualquier momento.' };
  const bell: Step = {
    target: 'bell',
    title: 'Notificaciones',
    body: 'Aquí llegan las novedades de tus proyectos, con un sonido corto. Al abrir una, vas directo a la tarea o la sección exacta.',
  };

  if (me.role === 'client') {
    return [
      {
        title: `Hola${first ? `, ${first}` : ''} 👋`,
        body: 'Este es tu espacio en DeerSystems Partners. Aquí sigues tu proyecto de principio a fin. Te mostramos lo principal en un minuto.',
      },
      {
        target: 'projects',
        title: 'Tus proyectos',
        body: 'Cada tarjeta muestra el avance real (tareas completadas). Ábrela para ver el cronograma, las reuniones, los avances, los archivos y el alcance aprobado.',
      },
      {
        title: 'Tus tareas',
        body: 'Algunas tareas dependen de ti (logos, accesos, aprobaciones). Cuando termines una, cámbiala a «En revisión» y nosotros la cerramos. También puedes comentar y adjuntar archivos.',
      },
      bell,
      { target: 'account', title: 'Mi cuenta', body: 'Elige qué avisos quieres recibir y por dónde, y cambia tu contraseña.' },
      help,
    ];
  }

  if (me.role === 'team') {
    return [
      {
        title: `Hola${first ? `, ${first}` : ''} 👋`,
        body: 'Bienvenido al espacio de proyectos de DeerSystems. Te mostramos lo principal en un minuto.',
      },
      {
        target: 'nav-/',
        title: 'Clientes y proyectos',
        body: 'Los proyectos en marcha con su avance. En cada uno: tareas en lista, tablero, cronograma y calendario; notas internas, avances para el cliente, archivos y bitácora.',
      },
      {
        title: 'Lo que ve el cliente',
        body: 'El cliente ve las tareas, los avances, las notas compartidas y los archivos compartidos. Nunca ve las notas ni los archivos internos.',
      },
      bell,
      { target: 'account', title: 'Mi cuenta', body: 'Elige qué avisos quieres recibir y cambia tu contraseña.' },
      help,
    ];
  }

  return [
    {
      title: 'Bienvenido a DeerSystems Partners 👋',
      body: 'Aquí gestionas a tus clientes después de aprobar la propuesta: proyecto, cronograma, reuniones y avances. Te muestro lo principal en un minuto.',
    },
    {
      target: 'nav-/propuestas',
      title: 'Propuestas',
      body: 'Publica las propuestas (el enlace queda en propuestas.deersystems.net) y sube versiones nuevas sin perder las anteriores. Con «Propuesta aprobada», la IA arma el proyecto: tareas, fases y reuniones de avance.',
    },
    {
      target: 'nav-/',
      title: 'Clientes y proyectos',
      body: 'Los proyectos en marcha y su avance. En cada uno: tareas en lista, tablero, cronograma y calendario; notas, avances, archivos de Drive y bitácora.',
    },
    {
      target: 'nav-/reuniones',
      title: 'Reuniones',
      body: 'Agenda con Meet desde aquí. Al terminar, la IA prepara el resumen y las tareas a partir de la transcripción; tú lo revisas y lo envías.',
    },
    { target: 'nav-/equipo', title: 'Equipo', body: 'Da acceso a tu equipo. Ven clientes, proyectos y tareas, pero nunca precios ni la propuesta original.' },
    {
      target: 'nav-/configuracion',
      title: 'Configuración',
      body: 'La IA (modelos, claves, consumo), los avisos, la conexión con Google (Gmail, Drive, Calendar y Meet) y la clave del selector de Drive.',
    },
    bell,
    help,
  ];
}

const LATER_KEY = 'ds:tour-later';

/** ¿Se pospuso en esta sesión del navegador? (vuelve a salir en el próximo inicio de sesión) */
export function tourPostponed(): boolean {
  try {
    return sessionStorage.getItem(LATER_KEY) === '1';
  } catch {
    return false;
  }
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Recorrido guiado: resalta cada parte de la pantalla con una explicación.
 * «Terminar tour» lo guarda en la cuenta y no vuelve a aparecer; «Ver después» solo lo cierra por ahora.
 */
export function Tour({ me, onClose }: { me: Me; onClose: (done: boolean) => void }) {
  const steps = stepsFor(me);
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const step = steps[i];
  const last = i === steps.length - 1;

  const measure = useCallback(() => {
    const el = step.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null;
    if (!el || el.offsetParent === null) return setBox(null);
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const r = el.getBoundingClientRect();
    setBox({ top: r.top - 6, left: r.left - 6, width: r.width + 12, height: r.height + 12 });
  }, [step.target]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && !last) setI(i + 1);
      if (e.key === 'ArrowLeft' && i > 0) setI(i - 1);
      if (e.key === 'Escape') later();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('keydown', onKey);
    };
  });

  const finish = () => {
    api('POST', 'me/tour', { done: true }).catch(() => {});
    onClose(true);
  };
  const later = () => {
    try {
      sessionStorage.setItem(LATER_KEY, '1');
    } catch {
      /* sin almacenamiento: puede volver a salir al recargar */
    }
    onClose(false);
  };

  // La tarjeta va debajo del elemento resaltado; si no cabe, arriba. Siempre dentro de la pantalla.
  const cardWidth = Math.min(360, window.innerWidth - 24);
  let cardStyle: React.CSSProperties;
  if (box) {
    const below = box.top + box.height + 12;
    const fitsBelow = below + 220 < window.innerHeight;
    cardStyle = {
      width: cardWidth,
      left: Math.min(Math.max(12, box.left), window.innerWidth - cardWidth - 12),
      ...(fitsBelow ? { top: below } : { bottom: window.innerHeight - box.top + 12 }),
    };
  } else {
    cardStyle = { width: cardWidth, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  }

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {box ? <div className="tour__spot" style={box} /> : <div className="tour__dim" />}
      <div className="tour__card" style={cardStyle}>
        <span className="tour__count mono">
          {i + 1} / {steps.length}
        </span>
        <h2 id="tour-title">{step.title}</h2>
        <p>{step.body}</p>
        <div className="tour__dots" aria-hidden="true">
          {steps.map((_, k) => (
            <span key={k} className={k === i ? 'is-active' : ''} />
          ))}
        </div>
        <div className="tour__actions">
          <button className="linklike" onClick={later}>
            Ver después
          </button>
          <span>
            {i > 0 && (
              <button className="btn btn--outline btn--sm" onClick={() => setI(i - 1)}>
                Anterior
              </button>
            )}
            {last ? (
              <button className="btn btn--primary btn--sm" onClick={finish} autoFocus>
                Terminar tour
              </button>
            ) : (
              <button className="btn btn--primary btn--sm" onClick={() => setI(i + 1)} autoFocus>
                Siguiente
              </button>
            )}
          </span>
        </div>
        {!last && (
          <button className="tour__finish linklike" onClick={finish}>
            Terminar tour (no volver a mostrar)
          </button>
        )}
      </div>
    </div>
  );
}
