import type { Transport, UnlistenFn } from './types';

type Handler = (args: Record<string, unknown>) => unknown;

// In-memory key/value stand-in for the OS keychain. Deliberately per-process:
// browser dev should never pretend to have persistence it doesn't have.
const secretStore = new Map<string, string>();
const listeners = new Map<string, Set<(payload: unknown) => void>>();
const generationTimers = new Map<string, ReturnType<typeof setTimeout>[]>();

function emit(event: string, payload: unknown): void {
  for (const handler of listeners.get(event) ?? []) handler(payload);
}

function mockReply(messages: { role: string; content: string }[]): string {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const excerpt = lastUser.slice(0, 120);
  return (
    '*The hearth crackles softly as she leans forward.* ' +
    `This is a mock reply from Hearth's offline provider, so the whole chat pipeline ` +
    `runs without keys or network. You said: "${excerpt}" ` +
    '"Swipes, edits, branches and forks all work on this reply like any other." ' +
    '(Configure a real provider in Providers when you are ready.)'
  );
}

function simulateStream(request: {
  generation_id: string;
  model: string;
  messages: { role: string; content: string }[];
}): void {
  const reply = mockReply(request.messages);
  const words = reply.split(/(?<= )/);
  const event = `provider://stream/${request.generation_id}`;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const delay = 30;
  words.forEach((word, i) => {
    timers.push(
      setTimeout(() => emit(event, { type: 'delta', text: word }), delay + i * 25),
    );
  });
  const end = delay + words.length * 25;
  timers.push(
    setTimeout(
      () =>
        emit(event, {
          type: 'usage',
          prompt_tokens: Math.ceil(
            request.messages.reduce((n, m) => n + m.content.length, 0) / 4,
          ),
          completion_tokens: Math.ceil(reply.length / 4),
        }),
      end,
    ),
  );
  timers.push(setTimeout(() => emit(event, { type: 'done', finish_reason: 'stop' }), end + 20));
  generationTimers.set(request.generation_id, timers);
}

const handlers: Record<string, Handler> = {
  secrets_set(args) {
    secretStore.set(String(args.account), String(args.secret));
    return null;
  },
  secrets_get(args) {
    return secretStore.get(String(args.account)) ?? null;
  },
  secrets_delete(args) {
    secretStore.delete(String(args.account));
    return null;
  },
  provider_test() {
    return { ok: true, detail: 'mock provider: connection always succeeds (browser dev)' };
  },
  provider_list_models() {
    return ['mock-large', 'mock-small'];
  },
  provider_stream(args) {
    const request = args.request as Parameters<typeof simulateStream>[0];
    simulateStream(request);
    return request.generation_id;
  },
  provider_cancel(args) {
    const gid = String(args.generation_id);
    for (const t of generationTimers.get(gid) ?? []) clearTimeout(t);
    generationTimers.delete(gid);
    emit(`provider://stream/${gid}`, { type: 'done', finish_reason: 'cancelled' });
    return null;
  },
};

export const mockTransport: Transport = {
  name: 'mock',
  async invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    const handler = handlers[cmd];
    if (!handler) throw new Error(`mockTransport: no handler for "${cmd}"`);
    return (await handler(args ?? {})) as T;
  },
  async listen<T = unknown>(
    event: string,
    handler: (payload: T) => void,
  ): Promise<UnlistenFn> {
    const set = listeners.get(event) ?? new Set();
    const wrapped = handler as (payload: unknown) => void;
    set.add(wrapped);
    listeners.set(event, set);
    return () => {
      set.delete(wrapped);
    };
  },
};
