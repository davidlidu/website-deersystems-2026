export const WHATSAPP_NUMBER = '573128765844';
export const WHATSAPP_DISPLAY = '+57 312 876 5844';

export function whatsappLink(message: string) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

export type Platform = 'WordPress' | 'Shopify' | 'React';

export type Project = {
  name: string;
  domain: string;
  url: string;
  platform: Platform;
  emoji: string;
};

// Portafolio tomado de la Propuesta Comercial DeerSystems 2026.
export const PROJECTS: Project[] = [
  { name: 'MercadoLibre Experience', domain: 'mercadolibreexperience.com.co', url: 'https://mercadolibreexperience.com.co/', platform: 'WordPress', emoji: '🛒' },
  { name: 'Latam Motos', domain: 'latammotos.com', url: 'https://latammotos.com/', platform: 'WordPress', emoji: '🏍️' },
  { name: 'Propiedades Nakama', domain: 'propiedadesnakama.com', url: 'https://propiedadesnakama.com/', platform: 'WordPress', emoji: '🏠' },
  { name: 'Frotex', domain: 'frotex.com', url: 'https://frotex.com/', platform: 'WordPress', emoji: '🏭' },
  { name: 'Made Mármol', domain: 'mademarmol.co', url: 'https://mademarmol.co/', platform: 'WordPress', emoji: '🪨' },
  { name: 'LendingSpot', domain: 'lendingspot.net', url: 'https://lendingspot.net/', platform: 'WordPress', emoji: '💰' },
  { name: 'Licores Medellín', domain: 'licoresmedellin.com', url: 'https://licoresmedellin.com/', platform: 'Shopify', emoji: '🍷' },
  { name: 'Santiago Corazón', domain: 'santiagocorazon.org', url: 'https://santiagocorazon.org/', platform: 'Shopify', emoji: '❤️' },
  { name: 'Tom Lampert', domain: 'tomlampert.com', url: 'https://tomlampert.com/', platform: 'Shopify', emoji: '🎨' },
  { name: 'Call to Action Plus', domain: 'calltoactionplus.com', url: 'https://calltoactionplus.com/', platform: 'React', emoji: '📣' },
  { name: 'Hesvor', domain: 'hesvor.com', url: 'https://www.hesvor.com/', platform: 'React', emoji: '⚡' },
  { name: 'Primo Team', domain: 'primoteam.com', url: 'https://primoteam.com/', platform: 'React', emoji: '🚀' },
];

export function screenshotUrl(url: string) {
  return `https://api.microlink.io/?url=${encodeURIComponent(url)}&screenshot=true&meta=false&embed=screenshot.url`;
}

export const STACK = [
  'n8n', 'IA / LLMs', 'API REST', 'React', 'Next.js', 'JavaScript', 'WordPress', 'WooCommerce',
  'Shopify', 'Wompi', 'PayU', 'Mercado Pago', 'ePayco', 'Docker', 'VPS', 'cPanel',
  'Dominios & DNS', 'Correo corporativo', 'HTML5', 'CSS3',
];

export const SECTORS = [
  { icon: 'shirt', title: 'Marcas de ropa', text: 'Catálogos sincronizados, pedidos que llegan solos al equipo y seguimiento postventa por WhatsApp.' },
  { icon: 'paw', title: 'Tiendas para mascotas', text: 'Recompras automáticas, recordatorios de alimento e inventario conectado con tu tienda online.' },
  { icon: 'home', title: 'Realtors', text: 'Leads de portales al CRM en segundos, asignación por zona y nurturing hasta la cita.' },
  { icon: 'bank', title: 'Lenders en USA', text: 'Pre-calificación, captura de documentos y pipelines que no dejan caer ni un préstamo.' },
  { icon: 'spark', title: 'Coaches y marcas personales', text: 'Funnels, agendamiento, cobros y onboarding de alumnos sin tocar una hoja de cálculo.' },
  { icon: 'building', title: 'Empresas en crecimiento', text: 'Integración entre áreas, reportes automáticos y procesos que escalan sin sumar nómina.' },
] as const;
