// Iconografía lineal (trazo 1.6) en línea con la geometría de nodos del logo.
const PATHS: Record<string, string> = {
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7l1-8Z',
  code: 'm8 8-5 4 5 4M16 8l5 4-5 4M14 4l-4 16',
  server: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01',
  shield: 'M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Zm-3 9 2 2 4-4',
  cart: 'M3 4h2l2.4 11h10.2L20 8H6.2M9 20h.01M17 20h.01',
  brain: 'M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a3 3 0 0 0-3-1Zm6 0a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1',
  shirt: 'M8 3 3 6l2 4 2-1v12h10V9l2 1 2-4-5-3a4 4 0 0 1-8 0Z',
  paw: 'M7 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM17 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM10 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM14 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM12 12c-3 0-6 4-6 6.5S8 21 12 19.5c4 1.5 6 .5 6-1S15 12 12 12Z',
  home: 'M3 11 12 4l9 7M5 10v10h14V10M10 20v-6h4v6',
  bank: 'M3 10 12 4l9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6',
  building: 'M4 21V5l8-2v18M12 8h8v13M8 8h.01M8 12h.01M8 16h.01M16 12h.01M16 16h.01M2 21h20',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  arrowUpRight: 'M7 17 17 7M8 7h9v9',
  check: 'm5 12 4.5 4.5L19 7',
  whatsapp: 'M4 20l1.3-3.9A8 8 0 1 1 8 19l-4 1Zm5-11c0 3 3 6 6 6l1.3-1.3-2-1-1 1c-1-.4-2.5-1.9-3-3l1-1-1-2L9 9Z',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3 12h18M12 3c2.5 2.7 3.5 5.7 3.5 9s-1 6.3-3.5 9c-2.5-2.7-3.5-5.7-3.5-9s1-6.3 3.5-9Z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM21 21l-5-5',
  flow: 'M5 3h4v4H5zM15 17h4v4h-4zM7 7v4a2 2 0 0 0 2 2h6a2 2 0 0 1 2 2v2',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6 6 18',
  dns: 'M12 3a9 9 0 1 0 0 18M3 12h9M12 3v18M16 15h5v5h-5zM18.5 15v-2',
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={PATHS[name] ?? PATHS.spark} />
    </svg>
  );
}
