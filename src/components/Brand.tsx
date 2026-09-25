import { useId } from 'react';

/** Isotipo de DeerSystems: cabeza de ciervo con astas de circuito (degradado verde → cian). */
export function DeerMark({ size = 32, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  const half = (
    <>
      <path d="M440 392 L270 292 L260 206" />
      <path d="M340 334 L340 172" />
      <path d="M340 292 L386 252" />
      <path d="M312 372 Q386 372 424 406 Q404 452 364 456 Q318 452 312 372 Z" />
      <path d="M404 440 L466 528 Q484 554 512 554" />
      <path d="M416 492 L422 590 L512 690" />
      <circle cx="258" cy="196" r="15" stroke="none" fill={`url(#g${id})`} />
      <circle cx="394" cy="244" r="14" stroke="none" fill={`url(#g${id})`} />
    </>
  );
  return (
    <svg
      width={size}
      height={size}
      viewBox="226 150 572 572"
      className={className}
      aria-hidden="true"
      fill="none"
      stroke={`url(#g${id})`}
      strokeWidth={26}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="160" x2="0" y2="700" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7ED957" />
          <stop offset="0.55" stopColor="#1FB8A8" />
          <stop offset="1" stopColor="#00B4D8" />
        </linearGradient>
      </defs>
      {half}
      <g transform="translate(1024 0) scale(-1 1)">{half}</g>
      <path d="M490 490 L544 380" />
    </svg>
  );
}

export function Wordmark({ size = 30 }: { size?: number }) {
  return (
    <span className="wordmark">
      <DeerMark size={size} />
      <span className="wordmark__text">
        <span className="wordmark__deer">Deer</span>Systems
      </span>
    </span>
  );
}
