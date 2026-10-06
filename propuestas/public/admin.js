const $ = (id) => document.getElementById(id);

let me = { email: '', superadmin: false, publicUrl: location.origin };
let pending = null; // archivo elegido para una propuesta nueva
let replacing = null; // propuesta cuyo contenido se va a reemplazar

async function api(method, path, body) {
  const isFile = body instanceof Blob;
  const res = await fetch(`/admin/api/${path}`, {
    method,
    body: isFile ? body : body ? JSON.stringify(body) : undefined,
    headers: isFile ? { 'Content-Type': 'application/octet-stream' } : body ? { 'Content-Type': 'application/json' } : {},
  });
  if (res.status === 401) {
    location.href = '/admin/login';
    throw new Error('Sesión vencida.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
  return data;
}

let toastTimer;
function toast(message, isError = false) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('is-error', isError);
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), isError ? 6000 : 3000);
}

/** Ejecuta una acción con el botón bloqueado y muestra el error si falla. */
async function run(button, action) {
  if (button) button.disabled = true;
  try {
    await action();
  } catch (err) {
    toast(err.message, true);
  } finally {
    if (button) button.disabled = false;
  }
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

// Igual que slugify() del servidor, para previsualizar la URL antes de subir.
function slugify(name) {
  return name
    .replace(/\.(html?|zip)$/i, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function formatSize(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const fileQuery = (file, extra = {}) => new URLSearchParams({ filename: file.name, ...extra });

// ───────── Propuestas ─────────

function renderProposal(p) {
  const url = `${me.publicUrl}/${p.slug}`;
  const paused = !p.active;

  const copy = el('button', { className: 'btn btn--outline btn--sm', type: 'button', textContent: 'Copiar enlace' });
  copy.onclick = () =>
    run(null, async () => {
      await navigator.clipboard.writeText(url);
      toast('Enlace copiado.');
    });

  const replace = el('button', { className: 'btn btn--outline btn--sm', type: 'button', textContent: 'Reemplazar' });
  replace.onclick = () => {
    replacing = p;
    $('replace-file').click();
  };

  const toggle = el('button', { className: 'btn btn--outline btn--sm', type: 'button', textContent: paused ? 'Activar' : 'Pausar' });
  toggle.onclick = () =>
    run(toggle, async () => {
      await api('PATCH', `proposals/${p.id}`, { active: paused });
      toast(paused ? 'Enlace activo de nuevo.' : 'Enlace pausado: el cliente verá un 404.');
      await loadProposals();
    });

  const rename = el('button', { className: 'btn btn--outline btn--sm', type: 'button', textContent: 'Renombrar' });
  rename.onclick = () => {
    const title = prompt('Cliente o nota (solo la ves tú):', p.title);
    if (title === null) return;
    run(rename, async () => {
      await api('PATCH', `proposals/${p.id}`, { title });
      await loadProposals();
    });
  };

  const remove = el('button', { className: 'btn btn--outline btn--sm btn--danger', type: 'button', textContent: 'Eliminar' });
  remove.onclick = () => {
    if (!confirm(`¿Eliminar la propuesta /${p.slug}?\n\nEl enlace dejará de funcionar y los archivos se borran.`)) return;
    run(remove, async () => {
      await api('DELETE', `proposals/${p.id}`);
      toast('Propuesta eliminada.');
      await loadProposals();
    });
  };

  const title = el('div', { className: 'item__title' }, p.title || p.slug);
  if (paused) title.append(el('span', { className: 'tag tag--paused', textContent: 'Pausada' }));

  const views = p.views
    ? `${p.views} ${p.views === 1 ? 'apertura' : 'aperturas'} · última ${formatDate(p.last_viewed_at)}`
    : 'Sin abrir';

  return el(
    'article',
    { className: `item card${paused ? ' is-paused' : ''}` },
    el(
      'div',
      {},
      title,
      el('a', { className: 'item__url', href: url, target: '_blank', rel: 'noopener', textContent: url.replace(/^https?:\/\//, '') }),
      el(
        'div',
        { className: 'item__meta' },
        el('span', { textContent: `v${p.version} · ${formatDate(p.updated_at)}` }),
        el('span', { textContent: `${p.filename} · ${formatSize(p.size)}` }),
        el('span', { textContent: views }),
      ),
    ),
    el('div', { className: 'item__actions' }, copy, replace, toggle, rename, remove),
  );
}

async function loadProposals() {
  const proposals = await api('GET', 'proposals');
  $('count').textContent = `${proposals.length} ${proposals.length === 1 ? 'propuesta' : 'propuestas'}`;
  $('list').replaceChildren(
    ...(proposals.length
      ? proposals.map(renderProposal)
      : [el('div', { className: 'empty card', textContent: 'Todavía no has publicado propuestas.' })]),
  );
}

// ───────── Nueva propuesta ─────────

function choose(file) {
  if (!file) return;
  if (!/\.(html?|zip)$/i.test(file.name)) return toast('Sube un archivo .html o un .zip.', true);
  pending = file;
  $('publish-name').textContent = file.name;
  $('publish-size').textContent = formatSize(file.size);
  $('publish-slug').value = slugify(file.name);
  $('publish-title').value = '';
  $('publish').hidden = false;
  $('drop').hidden = true;
  $('publish-slug').focus();
}

function resetPublish() {
  pending = null;
  $('file').value = '';
  $('publish').hidden = true;
  $('drop').hidden = false;
}

const drop = $('drop');
drop.onclick = () => $('file').click();
drop.onkeydown = (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    $('file').click();
  }
};
$('file').onchange = (e) => choose(e.target.files[0]);

// Soltar un archivo fuera de la zona no debe sacar al usuario del panel.
for (const type of ['dragover', 'drop']) window.addEventListener(type, (e) => e.preventDefault());
drop.ondragover = () => drop.classList.add('is-over');
drop.ondragleave = () => drop.classList.remove('is-over');
drop.ondrop = (e) => {
  drop.classList.remove('is-over');
  choose(e.dataTransfer.files[0]);
};

$('publish-slug').onblur = (e) => (e.target.value = slugify(e.target.value));
$('publish-cancel').onclick = resetPublish;
$('publish').onsubmit = (e) => {
  e.preventDefault();
  const button = $('publish-submit');
  button.textContent = 'Publicando…';
  run(button, async () => {
    const query = fileQuery(pending, { slug: slugify($('publish-slug').value), title: $('publish-title').value });
    const created = await api('POST', `proposals?${query}`, pending);
    // Sin await: el portapapeles puede quedarse esperando permiso y no debe frenar el panel.
    navigator.clipboard.writeText(`${me.publicUrl}/${created.slug}`).then(
      () => toast('Propuesta publicada. Enlace copiado.'),
      () => toast('Propuesta publicada.'),
    );
    resetPublish();
    await loadProposals();
  }).finally(() => (button.textContent = 'Publicar propuesta'));
};

// ───────── Reemplazar contenido ─────────

$('replace-file').onchange = (e) => {
  const file = e.target.files[0];
  const target = replacing;
  e.target.value = '';
  if (!file || !target) return;
  if (!confirm(`¿Reemplazar el contenido de /${target.slug} con "${file.name}"?\n\nLa URL no cambia.`)) return;
  run(null, async () => {
    toast('Subiendo…');
    await api('PUT', `proposals/${target.id}/file?${fileQuery(file)}`, file);
    toast('Contenido actualizado. La URL sigue siendo la misma.');
    await loadProposals();
  });
};

// ───────── Usuarios (solo superusuario) ─────────

function renderUsers(users) {
  const owner = el('li', { className: 'card' }, me.email, el('span', { className: 'tag', textContent: 'Superusuario' }));
  const rows = users.map((u) => {
    const remove = el('button', { className: 'btn btn--outline btn--sm btn--danger', type: 'button', textContent: 'Quitar' });
    remove.onclick = () => run(remove, async () => renderUsers(await api('DELETE', `users/${encodeURIComponent(u.email)}`)));
    return el('li', { className: 'card' }, u.email, remove);
  });
  $('users').replaceChildren(owner, ...rows);
}

$('users-add').onsubmit = (e) => {
  e.preventDefault();
  const form = e.target;
  run(form.querySelector('button'), async () => {
    renderUsers(await api('POST', 'users', { email: form.email.value }));
    form.reset();
  });
};

// ───────── Inicio ─────────

run(null, async () => {
  me = await api('GET', 'me');
  $('me').textContent = me.email;
  $('publish-host').textContent = `${me.publicUrl.replace(/^https?:\/\//, '')}/`;
  await loadProposals();
  if (me.superadmin) {
    $('users-section').hidden = false;
    renderUsers(await api('GET', 'users'));
  }
});
