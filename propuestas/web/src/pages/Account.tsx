import { type FormEvent } from 'react';
import { api, useApi, type Me } from '../lib';
import { setSoundEnabled, soundEnabled } from '../sound';
import { ErrorBox, Loading, PageHead, useAction, useToast } from '../ui';

interface Pref {
  key: string;
  label: string;
  allowed: { app: boolean; email: boolean };
  app: boolean;
  email: boolean;
}

/** Cada persona elige qué avisos recibe. Lo que DeerSystems desactivó para todos aparece bloqueado. */
function MyNotifications({ me }: { me: Me }) {
  const { data, error, loading, reload, setData } = useApi<Pref[]>('me/notifications');
  const { busy, run } = useAction();
  const toast = useToast();
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const toggle = (p: Pref, ch: 'app' | 'email') =>
    run(async () => {
      setData(await api<Pref[]>('PUT', 'me/notifications', { events: { [p.key]: { [ch]: !p[ch] } } }));
      toast('Preferencia guardada.');
    });
  return (
    <section className="card form-section narrow-col">
      <h2>Mis avisos</h2>
      <p className="hint">
        Elige qué quieres recibir en la campana de la plataforma y en tu correo ({me.email}).
      </p>
      <div className="notify-group">
        <div className="notify-row notify-row--head">
          <span>Aviso</span>
          <span>En la plataforma</span>
          <span>Por correo</span>
        </div>
        {data!.map((p) => (
          <div key={p.key} className="notify-row">
            <span>{p.label}</span>
            {(['app', 'email'] as const).map((ch) => (
              <label key={ch} className={`switch${p.allowed[ch] ? '' : ' is-locked'}`} title={p.allowed[ch] ? '' : 'Desactivado por DeerSystems'}>
                <input
                  type="checkbox"
                  role="switch"
                  checked={p[ch]}
                  disabled={busy || !p.allowed[ch]}
                  aria-label={`${p.label}: ${ch === 'app' ? 'en la plataforma' : 'por correo'}`}
                  onChange={() => toggle(p, ch)}
                />
                <span className="switch__track" />
              </label>
            ))}
          </div>
        ))}
      </div>
      <label className="check">
        <input type="checkbox" defaultChecked={soundEnabled()} onChange={(e) => setSoundEnabled(e.target.checked)} />
        Sonido al llegar un aviso nuevo (en este navegador)
      </label>
    </section>
  );
}

export function AccountPage({ me }: { me: Me }) {
  const { busy, run } = useAction();
  const toast = useToast();

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    if (fd.get('password') !== fd.get('confirm')) return toast('Las contraseñas nuevas no coinciden.', true);
    run(async () => {
      await api('POST', 'me/password', { current: fd.get('current'), password: fd.get('password') });
      form.reset();
      toast('Contraseña actualizada. Se cerraron tus otras sesiones.');
    });
  };

  return (
    <>
      <PageHead eyebrow="Mi cuenta" title={me.name || me.email}>
        <p>Entras con {me.email}.</p>
      </PageHead>
      <MyNotifications me={me} />
      <form className="card form-section narrow" onSubmit={submit} style={{ marginTop: 16 }}>
        <h2>Cambiar contraseña</h2>
        <input type="email" name="username" value={me.email} autoComplete="username" hidden readOnly />
        <label className="field">
          <span className="field__label">Contraseña actual</span>
          <span className="input">
            <input name="current" type="password" required autoComplete="current-password" />
          </span>
        </label>
        <label className="field">
          <span className="field__label">Nueva (mínimo 10 caracteres)</span>
          <span className="input">
            <input name="password" type="password" minLength={10} required autoComplete="new-password" />
          </span>
        </label>
        <label className="field">
          <span className="field__label">Repite la nueva</span>
          <span className="input">
            <input name="confirm" type="password" minLength={10} required autoComplete="new-password" />
          </span>
        </label>
        <button className="btn btn--primary" disabled={busy}>
          Guardar
        </button>
      </form>
    </>
  );
}
