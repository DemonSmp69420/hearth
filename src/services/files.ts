import { isTauri, transport } from './transport';

export interface OpenedTextFile {
  name: string;
  contents: string;
}

/**
 * Save a text file. Desktop: native save dialog (rfd). Companion/browser:
 * blob download to the browser's download folder.
 * Returns false if the user cancelled the dialog (desktop only).
 */
export async function saveTextFile(fileName: string, contents: string): Promise<boolean> {
  if (isTauri()) {
    const saved = await transport.invoke<string | null>('save_text_file', {
      fileName,
      contents,
    });
    return saved !== null;
  }
  const blob = new Blob([contents], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

/** Open a text file. Desktop: native open dialog. Companion/browser: file input. */
export function openTextFile(extensions: string[]): Promise<OpenedTextFile | null> {
  if (isTauri()) {
    return transport.invoke<OpenedTextFile | null>('open_text_file', { extensions });
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = extensions.map((e) => `.${e}`).join(',');
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) {
        resolve(null);
        return;
      }
      void f.text().then((contents) => resolve({ name: f.name, contents }));
    };
    input.click();
  });
}
