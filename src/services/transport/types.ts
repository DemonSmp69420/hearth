export type UnlistenFn = () => void;

declare global {
  interface Window {
    /** Set by the companion server when it serves the UI (F18/D-021). */
    __HEARTH_COMPANION__?: boolean;
  }
}

/**
 * The only way the UI talks to the backend. Implementations:
 *  - `tauri` — desktop webview IPC (zero hop)
 *  - `mock`  — unit tests, e2e, and plain-browser dev
 *  - `http`  — LAN companion server (M4.11, F18/D-021): fetch + WebSocket events
 *
 * Views and stores must never import from `@tauri-apps/*` directly.
 */
export interface Transport {
  readonly name: 'tauri' | 'mock' | 'http';
  invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  listen<T = unknown>(event: string, handler: (payload: T) => void): Promise<UnlistenFn>;
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
