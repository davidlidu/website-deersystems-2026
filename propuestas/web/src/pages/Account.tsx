import { type FormEvent } from 'react';
import { api, type Me } from '../lib';
import { PageHead, useAction, useToast } from '../ui';

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
      <form className="card form-section narrow" onSubmit={submit}>
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
