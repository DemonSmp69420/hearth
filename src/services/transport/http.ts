import { isTauri, type Transport, type UnlistenFn } from './types';

const SESSION_KEY = 'hearth.companion.session';

export function isCompanion(): boolean {
  return typeof window !== 'undefined' && window.__HEARTH_COMPANION__ === true;
}

export function companionSession(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function storeSession(token: string): void {
  localStorage.setItem(SESSION_KEY, token);
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

/** One-time pairing: exchanges the Settings token for a bearer session. */
export async function pairWithToken(token: string): Promise<void> {
  const res = await fetch('/api/pair', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: token.trim().toUpperCase() }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `pairing failed (${res.status})`);
  }
  const body = (await res.json()) as { session: string };
  storeSession(body.session);
}

export class PairingRequiredError extends Error {
  constructor() {
    super('This device is not paired yet.');
    this.name = 'PairingRequiredError';
  }
}

// ---------------------------------------------------------------------------
// Shared event websocket: sub/unsub by topic, auto-resubscribe on reconnect
// ---------------------------------------------------------------------------

type TopicHandler = { topic: string; handler: (payload: unknown) => void };

let socket: WebSocket | null = null;
let socketWanted = false;
let reconnectDelay = 500;
const handlers = new Set<TopicHandler>();
const subscribed = new Set<string>();

function ensureSocket(): void {
  if (socket || !socketWanted || !companionSession()) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws?session=${companionSession()}`);
  socket = ws;
  ws.onopen = () => {
    reconnectDelay = 500;
    for (const topic of subscribed) ws.send(JSON.stringify({ type: 'sub', topic }));
  };
  ws.onmessage = (ev) => {
    try {
      const frame = JSON.parse(String(ev.data)) as { topic: string; payload: unknown };
      for (const h of handlers) {
        if (h.topic === frame.topic) h.handler(frame.payload);
      }
    } catch {
      // ignore malformed frames
    }
  };
  ws.onclose = () => {
    socket = null;
    if (!socketWanted) return;
    setTimeout(ensureSocket, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 8000);
  };
  ws.onerror = () => ws.close();
}

function sub(topic: string): void {
  if (subscribed.has(topic)) return;
  subscribed.add(topic);
  // Before the socket opens, onopen replays everything in `subscribed`.
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'sub', topic }));
  }
}

function unsub(topic: string): void {
  subscribed.delete(topic);
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'unsub', topic }));
  }
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!companionSession()) throw new PairingRequiredError();
  const res = await fetch(`/api/invoke/${cmd}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${companionSession()}`,
    },
    body: JSON.stringify(args ?? {}),
  });
  if (res.status === 401) {
    clearSession();
    throw new PairingRequiredError();
  }
  const body = (await res.json()) as { ok: boolean; data?: T; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error ?? `invoke ${cmd} failed (${res.status})`);
  return body.data as T;
}

async function listen<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  socketWanted = true;
  ensureSocket();
  const entry: TopicHandler = { topic: event, handler: handler as (p: unknown) => void };
  handlers.add(entry);
  sub(event);
  return () => {
    handlers.delete(entry);
    if (![...handlers].some((h) => h.topic === event)) unsub(event);
  };
}

export const httpTransport: Transport = { name: 'http', invoke, listen };

export function transportBackendLabel(): string {
  return isTauri() ? 'Tauri (real SQLite + keychain)' : isCompanion() ? 'Companion web client' : 'browser dev (mock transport)';
}
