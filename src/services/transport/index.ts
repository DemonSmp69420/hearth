import { isTauri, type Transport } from './types';
import { tauriTransport } from './tauri';
import { mockTransport } from './mock';
import { httpTransport, isCompanion } from './http';

export * from './types';
export * from './http';

export const transport: Transport = isTauri()
  ? tauriTransport
  : isCompanion()
    ? httpTransport
    : mockTransport;
