import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, navigate, type Me, type ProjectSummary } from './lib';

interface Step {
  /** Elemento a resaltar (atributo data-tour). Sin target, la tarjeta va centrada. */
  target?: string;
  /** Página donde vive el paso: el tour lleva al usuario allí. Sin página, sirve en cualquiera (el encabezado). */
  page?: 'home' | 'project';
  /** Si el elemento no aparece (por ejemplo, no hay tareas pendientes), el paso se salta. */
  optional?: boolean;
  title: string;
  body: string;
}

/** Recorrido dentro de un proyecto real: avance, pestañas, vistas, filtros y tareas. */
function projectSteps(me: Me): Step[] {
  const client = me.role === 'client';
  return [
    {
      page: 'project',
      target: 'project-head',
      title: 'El avance del proyecto',
      body: client
        ? 'La barra y el porcentaje se calculan con las tareas completadas. Debajo ves cuántas van, la fecha de inicio, la entrega estimada y el estado del proyecto.'
        : 'La barra y el porcentaje se calculan con las tareas completadas. Debajo, el inicio, la entrega estimada y el estado, que puedes cambiar desde aquí (activo, en pausa, finalizado).',
    },
    ...(client
      ? [
          {
            page: 'project',
            target: 'project-callout',
            optional: true,
            title: 'Lo que depende de ti',
            body: 'Aquí te recordamos cuántas tareas están de tu lado. Cuando termines una, márcala «En revisión»: nosotros la revisamos y la cerramos.',
          } as Step,
        ]
      : []),
    {
      page: 'project',
      target: 'project-tabs',
      title: 'Todo el proyecto en pestañas',
      body: client
        ? 'Tareas · Reuniones (las próximas con su enlace de Meet y los resúmenes) · Avances que publicamos · Notas · Archivos · Pagos (fechas y montos pactados) · Bitácora con todo lo que ha pasado · Alcance aprobado · Propuesta y valores.'
        : 'Tareas · Reuniones (agendar, Meet y resúmenes) · Avances para el cliente · Notas (internas o compartidas) · Archivos de Drive · ' + (me.role === 'owner' ? 'Pagos (al marcarlos pagados van a tu Gestor financiero) · ' : '') + 'Bitácora · Alcance aprobado' +
          (me.role === 'owner' ? ' · Propuesta y valores (tu equipo no la ve).' : '.'),
    },
    {
      page: 'project',
      target: 'project-views',
      title: 'Cuatro formas de ver las tareas',
      body: client
        ? 'Lista por fases, Tablero por estado, Cronograma con las barras de cada tarea en el tiempo y Calendario por fecha de entrega. La plataforma recuerda la que elijas.'
        : 'Lista por fases, Tablero por estado (arrastra entre columnas), Cronograma tipo Gantt (arrastra o estira las barras para cambiar fechas) y Calendario. Se recuerda la última que uses.',
    },
    {
      page: 'project',
      target: 'project-filters',
      title: 'Filtra y busca',
      body: client
        ? '«Mías» deja solo las tareas que te tocan a ti; «DeerSystems», las nuestras. También puedes ocultar las completadas o buscar por nombre.'
        : 'Filtra por lado (DeerSystems o cliente) y por responsable, oculta las completadas o busca por nombre.',
    },
    {
      page: 'project',
      target: 'project-tasks',
      title: client ? 'Tus tareas' : 'Las tareas',
      body: client
        ? 'Cada tarea dice de quién es (CLIENTE o DEERSYSTEMS) y su fecha de entrega. En las tuyas cambias el estado con el selector de la derecha. Ábrela con un clic para ver el detalle, comentar y adjuntar archivos.'
        : 'Cambia el estado con el selector, como en ClickUp. Ábrela para editar fechas, responsable y descripción, comentar o adjuntar. ' +
          'Con «+ Nueva tarea» agregas más.',
    },
  ];
}

function stepsFor(me: Me): Step[] {
  const first = me.name.split(' ')[0];
  const help: Step = {
    target: 'help',
    title: 'Vuelve cuando quieras',
    body: 'Con este botón puedes repetir el recorrido en cualquier momento.',
  };
  const bell: Step = {
    target: 'bell',
    title: 'Notificaciones',
    body: 'Aquí llegan las novedades de tus proyectos, con un sonido corto. Al abrir una, vas directo a la tarea o la sección exacta.',
  };

  if (me.role === 'client') {
    return [
      {
        page: 'home',
        title: `Hola${first ? `, ${first}` : ''} 👋`,
        body: 'Este es tu espacio en DeerSystems Partners. Aquí sigues tu proyecto de principio a fin. Te mostramos lo principal en un minuto.',
      },
      {
        page: 'home',
        target: 'projects',
        title: 'Tus proyectos',
        body: 'Cada tarjeta muestra el avance real (tareas completadas). Vamos a abrir tu proyecto para mostrarte qué hay adentro.',
      },
      ...projectSteps(me),
      bell,
      {
        target: 'account',
        title: 'Mi cuenta',
        body: 'Elige qué avisos quieres recibir y por dónde, y cambia tu contraseña.',
      },
      help,
    ];
  }

  if (me.role === 'team') {
    return [
      {
        page: 'home',
        title: `Hola${first ? `, ${first}` : ''} 👋`,
        body: 'Bienvenido al espacio de proyectos de DeerSystems. Te mostramos lo principal en un minuto.',
      },
      {
        page: 'home',
        target: 'nav-/',
        title: 'Clientes y proyectos',
        body: 'Los proyectos en marcha con su avance. Vamos a abrir uno para mostrarte cómo se trabaja.',
      },
      ...projectSteps(me),
      {
        title: 'Lo que ve el cliente',
        body: 'El cliente ve las tareas, los avances, las notas compartidas y los archivos compartidos. Nunca ve las notas ni los archivos internos.',
      },
      bell,
      {
        target: 'account',
        title: 'Mi cuenta',
        body: 'Elige qué avisos quieres recibir y cambia tu contraseña.',
      },
      help,
    ];
  }

  return [
    {
      page: 'home',
      title: 'Bienvenido a DeerSystems Partners 👋',
      body: 'Aquí gestionas a tus clientes después de aprobar la propuesta: proyecto, cronograma, reuniones y avances. Te muestro lo principal en un minuto.',
    },
    {
      target: 'nav-/propuestas',
      title: 'Propuestas',
      body: 'Publica las propuestas (el enlace queda en propuestas.deersystems.net) y sube versiones nuevas sin perder las anteriores. Con «Propuesta aprobada», la IA arma el proyecto: tareas, fases y reuniones de avance.',
    },
    {
      page: 'home',
      target: 'nav-/',
      title: 'Clientes y proyectos',
      body: 'Los proyectos en marcha y su avance. Vamos a abrir uno para mostrarte cómo se trabaja.',
    },
    ...projectSteps(me),
    {
      target: 'nav-/reuniones',
      title: 'Reuniones',
      body: 'Agenda con Meet desde aquí. Al terminar, la IA prepara el resumen y las tareas a partir de la transcripción; tú lo revisas y lo envías.',
    },
    {
      target: 'nav-/equipo',
      title: 'Equipo',
      body: 'Da acceso a tu equipo. Ven clientes, proyectos y tareas, pero nunca precios ni la propuesta original.',
    },
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
  // Proyecto de ejemplo: el que esté en curso con más tareas (o el más reciente). Sin proyectos, se omiten esos pasos.
  const [projectUrl, setProjectUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    api<ProjectSummary[]>('GET', 'projects')
      .then((list) => {
        const current = list.filter((x) => x.status !== 'finalizado').sort((a, b) => b.progress.total - a.progress.total);
        const p = current[0] ?? list[0];
        setProjectUrl(p ? `/proyectos/${p.id}` : null);
      })
      .catch(() => setProjectUrl(null));
  }, []);

  const steps = stepsFor(me).filter((s) => s.page !== 'project' || projectUrl !== null);
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [ready, setReady] = useState(false);
  const dir = useRef(1);
  const step = steps[Math.min(i, steps.length - 1)];
  const last = i >= steps.length - 1;

  const go = (n: number) => {
    dir.current = n > i ? 1 : -1;
    setI(n);
  };

  const find = () => {
    const el = step.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null;
    return el && el.offsetParent !== null ? el : null;
  };

  const measure = () => {
    const el = find();
    if (!el) return setBox(null);
    const r = el.getBoundingClientRect();
    // Un elemento muy alto (la lista de tareas) se resalta solo en su parte de arriba, para que quepa la tarjeta.
    const height = Math.min(r.height, window.innerHeight * 0.45);
    setBox({
      top: r.top - 6,
      left: r.left - 6,
      width: r.width + 12,
      height: height + 12,
    });
  };

  // Al cambiar de paso: lleva a su página, espera a que el elemento cargue y lo resalta.
  useLayoutEffect(() => {
    if (step.page === 'project' && projectUrl === undefined) return; // aún buscando el proyecto
    const want = step.page === 'home' ? '/' : step.page === 'project' ? projectUrl! : null;
    const here = location.pathname;
    if (want === '/' && here !== '/') navigate('/');
    if (want && want !== '/' && here !== want) navigate(want);

    setReady(false);
    let tries = 0;
    let settle = 0;
    // Un paso opcional espera poco: si su página ya cargó y el elemento no está, es que no aplica.
    const maxTries = step.optional ? 10 : 40;
    const timer = window.setInterval(() => {
      const el = find();
      if (el || !step.target || ++tries > maxTries) {
        window.clearInterval(timer);
        if (!el && step.optional) {
          // No aplica (por ejemplo, no hay tareas pendientes): sigue en la misma dirección.
          const n = i + dir.current;
          if (n >= 0 && n < steps.length) setI(n);
          return;
        }
        if (el) {
          const r = el.getBoundingClientRect();
          if (r.height > window.innerHeight * 0.45) {
            // Muy alto: su parte de arriba justo debajo del encabezado fijo.
            const header = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
            window.scrollTo({ top: window.scrollY + r.top - header - 16, behavior: 'smooth' });
          } else el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        measure();
        setReady(true);
        settle = window.setTimeout(measure, 350); // tras el desplazamiento suave
      }
    }, 75);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(settle);
    };
  }, [i, projectUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && !last) go(i + 1);
      if (e.key === 'ArrowLeft' && i > 0) go(i - 1);
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
    const fitsBelow = below + 230 < window.innerHeight;
    const fitsAbove = box.top - 230 > 0;
    cardStyle = {
      width: cardWidth,
      left: Math.min(Math.max(12, box.left), window.innerWidth - cardWidth - 12),
      ...(fitsBelow ? { top: below } : fitsAbove ? { bottom: window.innerHeight - box.top + 12 } : { bottom: 12 }),
    };
  } else {
    cardStyle = {
      width: cardWidth,
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
    };
  }

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {box ? <div className="tour__spot" style={box} /> : <div className="tour__dim" />}
      <div className={`tour__card${ready ? '' : ' is-waiting'}`} style={cardStyle}>
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
              <button className="btn btn--outline btn--sm" onClick={() => go(i - 1)}>
                Anterior
              </button>
            )}
            {last ? (
              <button className="btn btn--primary btn--sm" onClick={finish} autoFocus>
                Terminar tour
              </button>
            ) : (
              <button className="btn btn--primary btn--sm" onClick={() => go(i + 1)} autoFocus>
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
