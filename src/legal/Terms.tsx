import { WHATSAPP_DISPLAY, whatsappLink } from '../data/content';
import { LegalPage, type LegalSection } from './LegalPage';

const SECTIONS: LegalSection[] = [
  {
    id: 'aceptacion',
    title: 'Aceptación',
    body: (
      <p>
        Al usar este sitio o contratar los servicios de <strong>DeerSystems</strong> aceptas estos términos y
        condiciones. Si no estás de acuerdo con ellos, te pedimos no utilizar el sitio.
      </p>
    ),
  },
  {
    id: 'servicios',
    title: 'Servicios',
    body: (
      <p>
        DeerSystems presta servicios de automatización de procesos e inteligencia artificial, desarrollo de sitios web y
        tiendas online, configuración de servidores, dominios y correo, y mantenimiento web. El alcance, el precio y los
        tiempos de cada proyecto se definen en una propuesta o cotización que ambas partes aprueban antes de empezar.
      </p>
    ),
  },
  {
    id: 'pagos',
    title: 'Pagos',
    body: (
      <ul>
        <li>Los proyectos se pagan 50% para iniciar y 50% a la entrega del proyecto terminado.</li>
        <li>
          Los ajustes por horas se estiman antes de empezar y se cobran según las horas trabajadas, con una cuenta de cobro
          a cierre de mes.
        </li>
        <li>
          Salvo que se indique lo contrario, los precios no incluyen IVA (19%), que aplica a la facturación a empresas
          colombianas.
        </li>
      </ul>
    ),
  },
  {
    id: 'insumos',
    title: 'Insumos y tiempos de entrega',
    body: (
      <>
        <p>
          El cliente debe entregar los textos, las imágenes en alta resolución, el logotipo y el diseño o guía de marca
          aprobados antes de iniciar el proyecto.
        </p>
        <p>
          Los plazos empiezan a contar cuando recibimos todos los insumos completos. Si los materiales llegan tarde, los
          tiempos se amplían en la misma proporción.
        </p>
      </>
    ),
  },
  {
    id: 'terceros',
    title: 'Cuentas y plataformas de terceros',
    body: (
      <>
        <p>
          El cliente crea y es titular de sus cuentas en pasarelas de pago, Shopify, dominios, hosting, APIs y demás
          plataformas. DeerSystems hace la integración técnica con las credenciales que el cliente entrega.
        </p>
        <p>
          Los costos, las condiciones, los cambios de precio y la disponibilidad de esas plataformas dependen de cada
          proveedor y no de DeerSystems.
        </p>
      </>
    ),
  },
  {
    id: 'alcance',
    title: 'Cambios y trabajo fuera del alcance',
    body: (
      <p>
        Cualquier funcionalidad o cambio que no esté en el alcance acordado se cotiza aparte y requiere tu aprobación
        antes de hacerse.
      </p>
    ),
  },
  {
    id: 'propiedad',
    title: 'Propiedad intelectual',
    body: (
      <>
        <p>
          Una vez pagado el total del proyecto, el cliente es dueño del contenido, del diseño y de los desarrollos hechos a
          la medida para él. Queremos que seas dueño de tu tecnología.
        </p>
        <p>
          Las herramientas, librerías, plugins y temas de terceros se rigen por sus propias licencias. DeerSystems puede
          mostrar el proyecto en su portafolio, salvo que el cliente pida lo contrario por escrito.
        </p>
      </>
    ),
  },
  {
    id: 'confidencialidad',
    title: 'Confidencialidad',
    body: (
      <p>
        Tratamos como confidenciales las credenciales, los datos y la información interna que el cliente comparta para
        ejecutar el proyecto, y los usamos solo para ese fin.
      </p>
    ),
  },
  {
    id: 'responsabilidad',
    title: 'Garantía y responsabilidad',
    body: (
      <>
        <p>
          Entregamos cada proyecto probado y funcionando según el alcance acordado. DeerSystems no responde por fallas,
          caídas o cambios de servicios de terceros (hosting, APIs, pasarelas o plataformas), ni por modificaciones que
          terceros o el cliente hagan después de la entrega.
        </p>
        <p>
          Los resultados comerciales, como ventas o leads, dependen de factores externos y no están garantizados.
        </p>
      </>
    ),
  },
  {
    id: 'sitio',
    title: 'Uso del sitio web',
    body: (
      <p>
        Los textos, la marca DeerSystems, el logotipo, el personaje Nexo y los demás elementos de este sitio son
        propiedad de DeerSystems. No se pueden copiar ni usar con fines comerciales sin autorización. Los proyectos del
        portafolio pertenecen a sus respectivos dueños.
      </p>
    ),
  },
  {
    id: 'ley',
    title: 'Ley aplicable y contacto',
    body: (
      <>
        <p>Estos términos se rigen por las leyes de la República de Colombia.</p>
        <p>
          Si tienes preguntas, escríbenos por{' '}
          <a href={whatsappLink('Hola, tengo una pregunta sobre los términos y condiciones.')} target="_blank" rel="noopener">
            WhatsApp {WHATSAPP_DISPLAY}
          </a>
          .
        </p>
      </>
    ),
  },
];

export function Terms() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Términos y condiciones"
      intro={
        <p>
          Condiciones claras para una colaboración profesional y sin sorpresas. Aquí explicamos cómo trabajamos y qué
          puedes esperar de nosotros.
        </p>
      }
      sections={SECTIONS}
    />
  );
}
