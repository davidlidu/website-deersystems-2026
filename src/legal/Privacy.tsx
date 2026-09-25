import { WHATSAPP_DISPLAY, whatsappLink } from '../data/content';
import { LegalPage, type LegalSection } from './LegalPage';

const wa = (
  <a href={whatsappLink('Hola, quiero hacer una consulta sobre mis datos personales.')} target="_blank" rel="noopener">
    WhatsApp {WHATSAPP_DISPLAY}
  </a>
);

const SECTIONS: LegalSection[] = [
  {
    id: 'responsable',
    title: 'Responsable del tratamiento',
    body: (
      <>
        <p>
          El responsable del tratamiento de los datos personales recolectados a través de este sitio es{' '}
          <strong>DeerSystems</strong>, representada por David Lidueñas Gil, con domicilio en Colombia.
        </p>
        <p>Canal de atención para asuntos de datos personales: {wa}.</p>
      </>
    ),
  },
  {
    id: 'marco',
    title: 'Marco legal',
    body: (
      <p>
        Esta política se rige por la Constitución Política de Colombia (artículo 15), la Ley Estatutaria 1581 de 2012,
        el Decreto 1377 de 2013 (compilado en el Decreto Único 1074 de 2015) y demás normas que las modifiquen o
        complementen.
      </p>
    ),
  },
  {
    id: 'datos',
    title: 'Datos que recolectamos',
    body: (
      <>
        <p>Solo recolectamos los datos que tú decides enviarnos:</p>
        <ul>
          <li>
            <strong>Formulario de contacto:</strong> nombre, empresa o marca (opcional), el servicio que te interesa y
            la descripción de tu proyecto.
          </li>
          <li>
            <strong>WhatsApp:</strong> tu número de teléfono y los mensajes que nos envíes al escribirnos.
          </li>
        </ul>
        <p>
          El formulario no guarda información en nuestros servidores: al enviarlo, se abre WhatsApp con tu mensaje
          prellenado y eres tú quien decide enviarlo. No solicitamos datos sensibles ni datos de menores de edad.
        </p>
      </>
    ),
  },
  {
    id: 'finalidades',
    title: 'Finalidades del tratamiento',
    body: (
      <ul>
        <li>Responder tus consultas y solicitudes de cotización.</li>
        <li>Elaborar y enviar propuestas comerciales.</li>
        <li>Ejecutar, coordinar y dar soporte a los servicios contratados.</li>
        <li>Emitir cuentas de cobro y facturas, y cumplir obligaciones legales, contables y tributarias.</li>
        <li>Enviarte información sobre nuestros servicios, solo si nos autorizas previamente.</li>
      </ul>
    ),
  },
  {
    id: 'derechos',
    title: 'Derechos del titular',
    body: (
      <>
        <p>Como titular de los datos tienes derecho a:</p>
        <ul>
          <li>Conocer, actualizar y rectificar tus datos personales.</li>
          <li>Solicitar prueba de la autorización otorgada.</li>
          <li>Ser informado sobre el uso que se ha dado a tus datos.</li>
          <li>Revocar la autorización y solicitar la supresión de tus datos cuando no exista un deber legal de conservarlos.</li>
          <li>Acceder gratuitamente a tus datos personales.</li>
          <li>Presentar quejas ante la Superintendencia de Industria y Comercio (SIC) por infracciones a la ley.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'procedimiento',
    title: 'Consultas y reclamos',
    body: (
      <>
        <p>
          Puedes ejercer tus derechos escribiéndonos a través de {wa}, indicando tu nombre, el dato o la solicitud
          concreta y un medio de respuesta.
        </p>
        <ul>
          <li>
            <strong>Consultas:</strong> se responden en un máximo de 10 días hábiles, prorrogables por 5 días hábiles
            más, informándote el motivo.
          </li>
          <li>
            <strong>Reclamos</strong> (corrección, actualización, supresión o revocatoria): se resuelven en un máximo de
            15 días hábiles, prorrogables por 8 días hábiles más, informándote el motivo.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'terceros',
    title: 'Terceros y servicios externos',
    body: (
      <>
        <p>No vendemos ni cedemos tus datos personales. Este sitio utiliza los siguientes servicios de terceros:</p>
        <ul>
          <li>
            <strong>WhatsApp (Meta):</strong> canal de comunicación, sujeto a sus propias políticas de privacidad.
          </li>
          <li>
            <strong>Google Fonts:</strong> carga de tipografías; puede registrar tu dirección IP.
          </li>
          <li>
            <strong>Microlink:</strong> genera las capturas de los proyectos del portafolio.
          </li>
        </ul>
        <p>
          Cuando ejecutamos un proyecto, podemos compartir los datos estrictamente necesarios con proveedores de
          hosting, dominios o plataformas (por ejemplo, Shopify o pasarelas de pago) para prestar el servicio.
        </p>
      </>
    ),
  },
  {
    id: 'cookies',
    title: 'Cookies',
    body: (
      <p>
        Este sitio no usa cookies propias de analítica ni de publicidad. Si en el futuro las incorporamos,
        actualizaremos esta política e informaremos su uso.
      </p>
    ),
  },
  {
    id: 'seguridad',
    title: 'Seguridad y conservación',
    body: (
      <p>
        Aplicamos medidas técnicas y organizativas razonables para proteger tu información contra acceso no autorizado,
        pérdida o alteración. Conservamos los datos solo durante el tiempo necesario para cumplir las finalidades
        descritas y las obligaciones legales aplicables.
      </p>
    ),
  },
  {
    id: 'cambios',
    title: 'Vigencia y cambios',
    body: (
      <p>
        Esta política rige desde su publicación. Cualquier cambio sustancial se publicará en esta página con su
        fecha de actualización.
      </p>
    ),
  },
];

export function Privacy() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Política de privacidad y tratamiento de datos"
      intro={
        <p>
          En DeerSystems protegemos tu información. Esta política explica qué datos recolectamos, para qué los usamos y
          cómo puedes ejercer tus derechos.
        </p>
      }
      sections={SECTIONS}
    />
  );
}
