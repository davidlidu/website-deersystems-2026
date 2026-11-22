import { useState } from 'react';
import { api, formatDateTime, useApi } from '../lib';
import { ErrorBox, Loading, SecretBox, useAction, useToast } from '../ui';

interface Connection {
  id: number;
  kind: 'personal' | 'oauth';
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}
interface McpStatus {
  url: string;
  connections: Connection[];
}

function Copy({ value, label = 'Copiar' }: { value: string; label?: string }) {
  const toast = useToast();
  return (
    <button
      className="btn btn--outline btn--sm"
      type="button"
      onClick={() =>
        navigator.clipboard.writeText(value).then(
          () => toast('Copiado.'),
          () => toast('No se pudo copiar: selecciónalo a mano.', true),
        )
      }
    >
      {label}
    </button>
  );
}

/**
 * Configuración → Claude (MCP): conectar Claude al portal. En claude.ai (y desde ahí la app de escritorio y el móvil)
 * se agrega como conector personalizado y se autoriza con tu cuenta; en Claude Code, con el mismo flujo o con un token.
 */
export function ClaudeTab() {
  const { data, error, loading, reload, setData } = useApi<McpStatus>('settings/mcp');
  const [name, setName] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  const { busy, run } = useAction();
  const toast = useToast();
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const s = data!;
  const cmd = `claude mcp add --transport http deersystems ${s.url}`;
  const cmdToken = (t: string) => `${cmd} --header "Authorization: Bearer ${t}"`;

  const create = () =>
    run(async () => {
      const r = await api<McpStatus & { token: string }>('POST', 'settings/mcp/tokens', { name: name.trim() || 'Claude Code' });
      setCreated(r.token);
      setName('');
      setData({ url: r.url, connections: r.connections });
    });
  const revoke = (c: Connection) => {
    if (!confirm(`¿Desconectar «${c.name}»? Claude dejará de tener acceso con esa conexión.`)) return;
    run(async () => {
      setData(await api<McpStatus>('DELETE', `settings/mcp/connections/${c.id}`));
      toast('Conexión revocada.');
    });
  };

  return (
    <div className="stack narrow-col">
      <section className="card form-section">
        <h2>Conectar Claude</h2>
        <p className="hint">
          Con esta conexión, Claude puede consultar clientes, proyectos, tareas, reuniones, avances y pagos, y además crear tareas, cambiar su estado y
          comentar. No puede borrar nada ni tocar la facturación. Todo lo que haga queda en la bitácora y dispara los mismos avisos que en la app.
        </p>
        <span className="field__label">Dirección del conector</span>
        <div className="secret__row mcp-code">
          <code>{s.url}</code>
          <Copy value={s.url} />
        </div>
      </section>

      <section className="card form-section">
        <h2>En claude.ai, la app de escritorio o el móvil</h2>
        <ol className="steps">
          <li>
            En <a href="https://claude.ai/settings/connectors" target="_blank" rel="noopener">claude.ai → Configuración → Conectores</a>, toca «Agregar conector
            personalizado».
          </li>
          <li>Nombre: «DeerSystems». URL: la dirección de arriba. Guarda y toca «Conectar».</li>
          <li>Se abre esta plataforma: entra con tu cuenta de Google de administrador y toca «Permitir».</li>
        </ol>
        <p className="hint">
          Queda disponible también en la app de escritorio y en el móvil con la misma cuenta. En un plan de equipo o empresa, el conector lo agrega quien
          administra la organización en Claude.
        </p>
      </section>

      <section className="card form-section">
        <h2>En Claude Code</h2>
        <p className="hint">Con este comando, Claude Code abre el navegador para que lo autorices igual que arriba (o usa /mcp para conectarlo después):</p>
        <div className="secret__row mcp-code">
          <code>{cmd}</code>
          <Copy value={cmd} />
        </div>
        <p className="hint">Si prefieres un token (por ejemplo, en un servidor sin navegador), créalo aquí. Se muestra una sola vez.</p>
        <div className="actions actions--tight">
          <span className="input">
            <input placeholder="Nombre (p. ej. Mi portátil)" value={name} maxLength={60} disabled={busy} onChange={(e) => setName(e.target.value)} />
          </span>
          <button className="btn btn--primary btn--sm" disabled={busy} onClick={create}>
            Crear token
          </button>
        </div>
        {created && (
          <>
            <SecretBox label="Token (cópialo ahora: no se vuelve a mostrar)" value={created} />
            <span className="field__label">Comando con el token</span>
            <div className="secret__row mcp-code">
              <code>{cmdToken(created)}</code>
              <Copy value={cmdToken(created)} />
            </div>
          </>
        )}
      </section>

      <section className="card form-section">
        <h2>Conexiones activas</h2>
        {!s.connections.length ? (
          <p className="hint">Todavía no has conectado Claude.</p>
        ) : (
          <div className="table">
            {s.connections.map((c) => (
              <div key={c.id} className="table__row">
                <span>
                  <strong>{c.name}</strong>
                  <small>{c.kind === 'oauth' ? 'Autorizado desde Claude' : 'Token personal'}</small>
                </span>
                <span>
                  <small>Creada {formatDateTime(c.createdAt)}</small>
                  <small>{c.lastUsedAt ? `Último uso ${formatDateTime(c.lastUsedAt)}` : 'Sin usar todavía'}</small>
                </span>
                <span className="actions actions--tight">
                  <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => revoke(c)}>
                    Desconectar
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
