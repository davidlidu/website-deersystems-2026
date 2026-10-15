import { useState, type FormEvent, type ReactNode } from 'react';
import { api, navigate, useLocation, type Me } from '../lib';
import { Link, useAction } from '../ui';

const GOOGLE_ERRORS: Record<string, string> = {
  unauthorized: 'Esa cuenta de Google no tiene acceso de administrador. Si eres cliente o del equipo, entra con tu correo y contraseña.',
  state: 'El inicio de sesión expiró. Inténtalo de nuevo.',
  google: 'Google no pudo confirmar tu cuenta. Inténtalo de nuevo.',
  config: 'Falta configurar las credenciales de Google en el servidor.',
};

function AuthCard({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <main className="center">
      <div className="center__card card">
        <span className="wordmark">
          <img src="/favicon.svg" alt="" />
          <span>
            <span className="grad">Deer</span>Systems <span className="wordmark__sub">Partners</span>
          </span>
        </span>
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
        </div>
        {children}
      </div>
    </main>
  );
}

export function LoginPage({ onLogin }: { onLogin: (me: Me) => void }) {
  const { query } = useLocation();
  const [error, setError] = useState<string | null>(GOOGLE_ERRORS[query.get('error') ?? ''] ?? null);
  const { busy, run } = useAction();

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError(null);
    run(async () => {
      try {
        await api('POST', '/auth/login', { email: form.get('email'), password: form.get('password') });
      } catch (err) {
        setError((err as Error).message);
        return;
      }
      onLogin(await api<Me>('GET', 'me'));
      navigate('/', true);
    });
  };

  return (
    <AuthCard eyebrow="Espacio de clientes" title="Sigue tu proyecto">
      <p>Entra con el correo y la contraseña que te enviamos al aprobar la propuesta.</p>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <form className="stack" onSubmit={submit}>
        <label className="field">
          <span className="field__label">Correo</span>
          <span className="input">
            <input name="email" type="email" required autoComplete="username" autoFocus />
          </span>
        </label>
        <label className="field">
          <span className="field__label">Contraseña</span>
          <span className="input">
            <input name="password" type="password" required autoComplete="current-password" />
          </span>
        </label>
        <button className="btn btn--primary" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
      <div className="center__foot">
        <Link to="/recuperar">¿Olvidaste la contraseña?</Link>
        <a href="/auth/google">Administrador: entrar con Google</a>
      </div>
    </AuthCard>
  );
}

export function ForgotPage() {
  const [sent, setSent] = useState(false);
  const { busy, run } = useAction();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = new FormData(e.currentTarget).get('email');
    run(async () => {
      await api('POST', '/auth/forgot', { email });
      setSent(true);
    });
  };
  return (
    <AuthCard eyebrow="Acceso" title="Recuperar contraseña">
      {sent ? (
        <p>Si el correo tiene una cuenta, te llegará un enlace para elegir una contraseña nueva. Vence en 1 hora.</p>
      ) : (
        <form className="stack" onSubmit={submit}>
          <p>Escribe tu correo y te enviamos un enlace para elegir una contraseña nueva.</p>
          <label className="field">
            <span className="field__label">Correo</span>
            <span className="input">
              <input name="email" type="email" required autoComplete="username" autoFocus />
            </span>
          </label>
          <button className="btn btn--primary" disabled={busy}>
            Enviar enlace
          </button>
        </form>
      )}
      <div className="center__foot">
        <Link to="/login">Volver a entrar</Link>
      </div>
    </AuthCard>
  );
}

export function ResetPage() {
  const { query } = useLocation();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (form.get('password') !== form.get('confirm')) return setError('Las contraseñas no coinciden.');
    setError(null);
    run(async () => {
      try {
        await api('POST', '/auth/reset', { token: query.get('token'), password: form.get('password') });
        setDone(true);
      } catch (err) {
        setError((err as Error).message);
      }
    });
  };
  return (
    <AuthCard eyebrow="Acceso" title="Nueva contraseña">
      {done ? (
        <>
          <p>Listo. Ya puedes entrar con tu nueva contraseña.</p>
          <Link className="btn btn--primary" to="/login">
            Entrar
          </Link>
        </>
      ) : (
        <form className="stack" onSubmit={submit}>
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          <label className="field">
            <span className="field__label">Contraseña nueva (mínimo 10 caracteres)</span>
            <span className="input">
              <input name="password" type="password" minLength={10} required autoComplete="new-password" autoFocus />
            </span>
          </label>
          <label className="field">
            <span className="field__label">Repítela</span>
            <span className="input">
              <input name="confirm" type="password" minLength={10} required autoComplete="new-password" />
            </span>
          </label>
          <button className="btn btn--primary" disabled={busy}>
            Guardar contraseña
          </button>
        </form>
      )}
    </AuthCard>
  );
}
