import { api } from './lib';

/**
 * Google Picker: el selector oficial de Drive, dentro de la plataforma. Solo para el administrador.
 * Con el permiso drive.file, la app solo obtiene acceso a los archivos que elijas aquí.
 */

interface PickerConfig {
  configured: boolean;
  hasKey: boolean;
  apiKey?: string;
  appId?: string;
  accessToken?: string;
}

export interface PickedFile {
  id: string;
  name: string;
}

/* Tipos mínimos de la librería de Google que se carga en tiempo de ejecución. */
interface PickerBuilder {
  addView(v: unknown): PickerBuilder;
  enableFeature(f: string): PickerBuilder;
  setOAuthToken(t: string): PickerBuilder;
  setDeveloperKey(k: string): PickerBuilder;
  setAppId(id: string): PickerBuilder;
  setLocale(l: string): PickerBuilder;
  setTitle(t: string): PickerBuilder;
  setCallback(cb: (data: { action: string; docs?: { id: string; name: string }[] }) => void): PickerBuilder;
  build(): { setVisible(v: boolean): void };
}
interface GooglePicker {
  PickerBuilder: new () => PickerBuilder;
  DocsView: new (viewId?: string) => { setIncludeFolders(b: boolean): unknown; setOwnedByMe?(b: boolean): unknown };
  ViewId: Record<string, string>;
  Feature: Record<string, string>;
  Action: Record<string, string>;
}
declare global {
  interface Window {
    gapi?: { load(name: string, cb: () => void): void };
    google?: { picker: GooglePicker };
  }
}

let loading: Promise<void> | null = null;

function loadPicker(): Promise<void> {
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.onload = () => window.gapi!.load('picker', () => resolve());
    script.onerror = () => {
      loading = null;
      reject(new Error('No se pudo cargar el selector de Google Drive.'));
    };
    document.head.append(script);
  });
  return loading;
}

export async function pickerStatus(): Promise<PickerConfig> {
  return api<PickerConfig>('GET', 'settings/google/picker');
}

/** Abre el selector. Devuelve los archivos elegidos, o [] si se cerró sin elegir. */
export async function pickFromDrive(): Promise<PickedFile[]> {
  const config = await pickerStatus();
  if (!config.configured) throw new Error('Falta la clave de API del selector de Drive (Configuración → Google y correo).');
  await loadPicker();
  const gp = window.google!.picker;
  return new Promise((resolve) => {
    const docs = new gp.DocsView(gp.ViewId.DOCS);
    docs.setIncludeFolders(false);
    const picker = new gp.PickerBuilder()
      .addView(docs)
      .enableFeature(gp.Feature.MULTISELECT_ENABLED)
      .setOAuthToken(config.accessToken!)
      .setDeveloperKey(config.apiKey!)
      .setAppId(config.appId!)
      .setLocale('es')
      .setTitle('Elige archivos de tu Drive')
      .setCallback((data) => {
        if (data.action === gp.Action.PICKED) resolve((data.docs ?? []).map((d) => ({ id: d.id, name: d.name })));
        else if (data.action === gp.Action.CANCEL) resolve([]);
      })
      .build();
    picker.setVisible(true);
  });
}
