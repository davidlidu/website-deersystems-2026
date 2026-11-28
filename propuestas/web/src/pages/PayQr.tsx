import { useEffect, useRef, useState } from 'react';

/** Código QR para pagar: se ve grande en la tarjeta y al tocarlo se abre a pantalla completa para escanearlo. */
export function PayQr({ src }: { src: string }) {
  const [zoom, setZoom] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (zoom) ref.current?.showModal();
  }, [zoom]);
  return (
    <>
      <button type="button" className="how-to-pay__qr" onClick={() => setZoom(true)} title="Ver el código QR en grande">
        <img src={src} alt="Código QR para pagar" />
        <small>Toca para verlo en grande</small>
      </button>
      {zoom && (
        <dialog ref={ref} className="modal qr-zoom" onClose={() => setZoom(false)} onClick={() => ref.current?.close()}>
          <img src={src} alt="Código QR para pagar" />
          <small>Toca en cualquier parte para cerrar</small>
        </dialog>
      )}
    </>
  );
}
