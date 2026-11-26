import { useEffect, useState } from 'react';
import { api } from './lib';
import { useAction, useToast } from './ui';

/**
 * Notificaciones push en este dispositivo (celular, iPad o Mac): los avisos de la campana llegan aunque la app esté
 * cerrada. En iPhone y iPad solo funcionan con la app agregada a la pantalla de inicio (iOS 16.4 o más reciente).
 */

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Registra el service worker al abrir la app (necesario para recibir los avisos). */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && !location.hostname.endsWith('.localhost')) return;
  navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('No se pudo registrar el service worker:', err));
}

/** Clave pública VAPID (base64url) → bytes, como la pide PushManager. */
function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration('/');
  return reg ? reg.pushManager.getSubscription() : null;
}

export function PushToggle({ preview = false }: { preview?: boolean }) {
  const [state, setState] = useState<'cargando' | 'no-soportado' | 'ios-instalar' | 'bloqueado' | 'activo' | 'inactivo'>('cargando');
  const { busy, run } = useAction();
  const toast = useToast();

  useEffect(() => {
    if (!supported()) {
      setState(isIos() && !standalone() ? 'ios-instalar' : 'no-soportado');
      return;
    }
    if (Notification.permission === 'denied') {
      setState('bloqueado');
      return;
    }
    currentSubscription()
      .then((s) => setState(s ? 'activo' : 'inactivo'))
      .catch(() => setState('inactivo'));
  }, []);

  const enable = () =>
    run(async () => {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'bloqueado' : 'inactivo');
        throw new Error('No diste permiso para mostrar notificaciones en este dispositivo.');
      }
      const reg = (await navigator.serviceWorker.getRegistration('/')) ?? (await navigator.serviceWorker.register('/sw.js'));
      await navigator.serviceWorker.ready;
      const { publicKey } = await api<{ publicKey: string }>('GET', 'push/key');
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      await api('POST', 'push/subscribe', { subscription: sub.toJSON() });
      setState('activo');
      await api('POST', 'push/test');
      toast('Notificaciones activadas en este dispositivo. Te enviamos una de prueba.');
    });

  const disable = () =>
    run(async () => {
      const sub = await currentSubscription();
      if (sub) {
        await api('POST', 'push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
        await sub.unsubscribe();
      }
      setState('inactivo');
      toast('Notificaciones desactivadas en este dispositivo.');
    });

  return (
    <div className="push-card">
      <div>
        <strong>Notificaciones en este dispositivo</strong>
        <p className="hint">
          {state === 'activo'
            ? 'Activas: los avisos te llegan aquí aunque la app esté cerrada.'
            : state === 'ios-instalar'
              ? 'En iPhone o iPad, primero agrega la app a la pantalla de inicio (Safari → Compartir → Agregar a inicio), ábrela desde ahí y vuelve aquí.'
              : state === 'no-soportado'
                ? 'Este navegador no permite notificaciones push. Usa Safari, Chrome o Edge actualizados (o la app instalada).'
                : state === 'bloqueado'
                  ? 'Las notificaciones están bloqueadas para Partners en este dispositivo. Permítelas en los ajustes del navegador o del sistema y recarga.'
                  : 'Recibe los avisos de la campana en tu celular, iPad o Mac, aunque la app esté cerrada.'}
        </p>
      </div>
      {state === 'activo' ? (
        <span className="actions actions--tight">
          <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => run(async () => { await api('POST', 'push/test'); toast('Te enviamos una notificación de prueba.'); })}>
            Probar
          </button>
          <button className="btn btn--outline btn--sm" disabled={busy || preview} onClick={disable}>
            Desactivar
          </button>
        </span>
      ) : state === 'inactivo' ? (
        <button className="btn btn--primary btn--sm" disabled={busy || preview} onClick={enable}>
          {busy ? 'Activando…' : 'Activar notificaciones'}
        </button>
      ) : null}
    </div>
  );
}
