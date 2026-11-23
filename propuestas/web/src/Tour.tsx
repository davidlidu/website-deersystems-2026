import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, navigate, type Me, type ProjectSummary } from './lib';

interface Step {
  /** Elemento a resaltar (atributo data-tour). Sin target, la tarjeta va centrada. */
  target?: string;
  /** Página donde vive el paso: el tour lleva al usuario allí. Sin página, sirve en cualquiera (el encabezado). */
  page?: 'home' | 'project';
  /** Pestaña del proyecto que se abre para este paso (avances, tareas, documentacion…). */
  tab?: string;
  /** Si el elemento no aparece (por ejemplo, no hay tareas pendientes), el paso se salta. */
  optional?: boolean;
  title: string;
  body: string;
}

/** Recorrido dentro de un proyecto real: avance, pestañas, tareas, entregas y (para ti) plan y alcance. */
function projectSteps(me: Me): Step[] {
  const client = me.role === 'client';
  const owner = me.role === 'owner';
  const steps: Step[] = [
    {
      page: 'project',
      target: 'project-head',
      title: 'El avance',
      body: client
        ? 'El porcentaje sale de las tareas completadas. Debajo: inicio, entrega estimada y estado.'
        : 'El porcentaje sale de las tareas completadas. Debajo: inicio, entrega estimada y el estado, que cambias aquí.',
    },
  ];
  if (client) {
    steps.push(
      {
        page: 'project',
        target: 'review-banner',
        optional: true,
        title: 'Entregas para revisar',
        body: 'Cuando terminamos una entrega te avisamos aquí. Ábrela y apruébala o pide ajustes.',
      },
      {
        page: 'project',
        target: 'project-callout',
        optional: true,
        title: 'Lo que depende de ti',
        body: 'Tus tareas pendientes. Al terminar una, márcala «En revisión» y nosotros la cerramos.',
      },
    );
  }
  steps.push({
    page: 'project',
    tab: 'avances',
    target: 'project-tabs',
    title: 'Todo en pestañas',
    body: client
      ? 'Avances del equipo · Plan de trabajo (tareas, cronograma y reuniones) · Documentación · Informes · Alcance · Pagos.'
      : `Avances · Plan de trabajo (tareas, cronograma y reuniones) · Documentación (compartida o interna) · Informes · ${owner ? 'Alcance y propuesta · Pagos.' : 'Alcance.'}`,
  });
  if (!client) {
    steps.push({
      page: 'project',
      tab: 'avances',
      target: 'updates-ai',
      title: 'Avances con IA',
      body: 'La IA redacta el avance del día con lo completado y las reuniones; lo revisas y lo publicas. También puede publicarse solo a las 5:00 p. m.',
    });
  }
  steps.push(
    {
      page: 'project',
      tab: 'tareas',
      target: 'project-filters',
      title: 'Vistas y filtros',
      body: client
        ? 'Ve las tareas en lista, tablero o calendario. «Mías» deja solo las tuyas; también puedes buscar u ocultar las completadas.'
        : 'Lista, tablero (arrastra entre columnas) o calendario. Filtra por lado, responsable o nombre.',
    },
    {
      page: 'project',
      tab: 'tareas',
      target: 'project-tasks',
      title: client ? 'Tus tareas y nuestras entregas' : 'Tareas y entregas',
      body: client
        ? 'Cada tarea dice de quién es y cuándo vence; en las tuyas cambias el estado. Las marcadas «◆ Entrega» las revisas tú: apruébalas o pide ajustes desde su detalle.'
        : 'Ábrela para editar, comentar o adjuntar. Las «◆ Entrega» las aprueba el cliente o pide ajustes; cada pedido es una ronda («↺ Ajuste N»). Las demás son operativas y las cierra el equipo.',
    },
  );
  if (owner) {
    steps.push(
      {
        page: 'project',
        tab: 'tareas',
        target: 'plan-actions',
        title: 'Ajustar el plan',
        body: '«Ajustar con IA» reprograma tareas y reuniones con una instrucción. «◆ Entregas al cliente» marca qué revisa el cliente (la IA lo puede proponer). Aquí también descargas el PDF y creas tareas.',
      },
      {
        page: 'project',
        tab: 'alcance',
        target: 'scope-actions',
        title: 'Cambios de alcance',
        body: '«✦ Ajustar con IA» reescribe el alcance según lo acordado y propone los cambios del plan. «Agregar adicional» crea tareas y cobro en un paso; «Retirar del alcance» quita lo que ya no va. Aquí también defines las rondas de ajustes.',
      },
    );
  }
  return steps;
}

function stepsFor(me: Me): Step[] {
  const first = me.name.split(' ')[0];
  const hello = `Hola${first ? `, ${first}` : ''} 👋`;
  const calendar: Step = {
    target: 'nav-/calendario',
    title: 'Calendario',
    body: me.role === 'client' ? 'Las fechas de entrega y las reuniones de tus proyectos en un solo lugar.' : 'Entregas y reuniones de todos los proyectos, para ver la carga de la semana.',
  };
  const bell: Step = {
    target: 'bell',
    title: 'Notificaciones',
    body: 'Las novedades de tus proyectos. Al abrir una, vas directo a donde pasó.',
  };
  const account: Step = {
    target: 'account',
    title: 'Mi cuenta',
    body: 'Elige qué avisos recibir y cambia tu contraseña.',
  };
  const help: Step = {
    target: 'help',
    title: 'Vuelve cuando quieras',
    body: 'Con este botón repites el recorrido.',
  };

  if (me.role === 'client') {
    return [
      { page: 'home', title: hello, body: 'Aquí sigues tu proyecto de principio a fin. Te mostramos lo principal en un minuto.' },
      { page: 'home', target: 'projects', title: 'Tus proyectos', body: 'Cada tarjeta muestra el avance real. Vamos a abrir uno.' },
      ...projectSteps(me),
      calendar,
      bell,
      account,
      help,
    ];
  }

  if (me.role === 'team') {
    return [
      { page: 'home', title: hello, body: 'Este es el espacio de proyectos de DeerSystems. Te mostramos lo principal en un minuto.' },
      { page: 'home', target: 'nav-/', title: 'Clientes y proyectos', body: 'Los proyectos en marcha con su avance. Vamos a abrir uno.' },
      ...projectSteps(me),
      {
        title: 'Lo que ve el cliente',
        body: 'Tareas, avances y lo que marques como compartido. Las notas y los archivos internos nunca.',
      },
      calendar,
      bell,
      account,
      help,
    ];
  }

  return [
    {
      page: 'home',
      title: 'Bienvenido a DeerSystems Partners 👋',
      body: 'De la propuesta aprobada a la entrega: proyecto, reuniones, entregas, avances y cobros. Lo principal en un minuto.',
    },
    {
      target: 'nav-/propuestas',
      title: 'Propuestas',
      body: 'Publica propuestas y sus versiones. Al aprobarse, la IA arma el proyecto: fases, tareas, entregas y reuniones.',
    },
    { page: 'home', target: 'nav-/', title: 'Clientes y proyectos', body: 'Los proyectos en marcha con su avance. Vamos a abrir uno.' },
    ...projectSteps(me),
    {
      page: 'home',
      target: 'clients-tabs',
      title: 'Reuniones',
      body: 'Agenda con Meet. Al terminar, la IA saca de la transcripción el resumen, las tareas y los ajustes que pidió el cliente; tú lo revisas y lo envías.',
    },
    calendar,
    {
      target: 'nav-/facturacion',
      title: 'Facturación',
      body: 'Cuentas de cobro en PDF, abonos y estado de cuenta. Cada abono llega a tu Gestor financiero.',
    },
    {
      target: 'nav-/configuracion',
      title: 'Configuración',
      body: 'Equipo, IA, avisos (correo y Telegram), rondas de ajustes, Google, finanzas y la conexión con Claude (MCP).',
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
      // La página del proyecto puede tardar en montar: se le pide la pestaña en cada intento.
      if (step.tab) window.dispatchEvent(new CustomEvent('ds:project-tab', { detail: step.tab }));
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
