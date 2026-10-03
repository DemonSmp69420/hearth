import { transport } from '../transport';
import type { ProviderProfile, ProviderType } from '../../domain/types';

export interface ProviderPreset {
  id: string;
  label: string;
  type: ProviderType;
  baseUrl: string;
  needsKey: boolean;
}

/** Convenience presets (F4/D-016): local tools speak OpenAI-compatible. */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'mock', label: 'Mock (offline dev)', type: 'mock', baseUrl: 'mock://local', needsKey: false },
  { id: 'openai', label: 'OpenAI', type: 'openai_compat', baseUrl: 'https://api.openai.com/v1', needsKey: true },
  { id: 'anthropic', label: 'Anthropic', type: 'anthropic', baseUrl: 'https://api.anthropic.com', needsKey: true },
  { id: 'gemini', label: 'Google Gemini', type: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', needsKey: true },
  { id: 'openrouter', label: 'OpenRouter', type: 'openai_compat', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true },
  { id: 'deepseek', label: 'DeepSeek', type: 'openai_compat', baseUrl: 'https://api.deepseek.com/v1', needsKey: true },
  { id: 'groq', label: 'Groq', type: 'openai_compat', baseUrl: 'https://api.groq.com/openai/v1', needsKey: true },
  { id: 'mistral', label: 'Mistral', type: 'openai_compat', baseUrl: 'https://api.mistral.ai/v1', needsKey: true },
  { id: 'together', label: 'Together', type: 'openai_compat', baseUrl: 'https://api.together.xyz/v1', needsKey: true },
  { id: 'ollama', label: 'Ollama (local)', type: 'openai_compat', baseUrl: 'http://localhost:11434/v1', needsKey: false },
  { id: 'lmstudio', label: 'LM Studio (local)', type: 'openai_compat', baseUrl: 'http://localhost:1234/v1', needsKey: false },
  { id: 'koboldcpp', label: 'KoboldCpp (local)', type: 'openai_compat', baseUrl: 'http://localhost:5001/v1', needsKey: false },
];

export interface TestResult {
  ok: boolean;
  detail: string;
}

export async function testConnection(
  kind: ProviderType,
  baseUrl: string,
  keyAccount: string | null,
): Promise<TestResult> {
  try {
    const result = await transport.invoke<{ ok: boolean; detail: string }>('provider_test', {
      kind,
      base_url: baseUrl,
      api_key_account: keyAccount,
    });
    return result;
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}

export async function listModels(
  kind: ProviderType,
  baseUrl: string,
  keyAccount: string | null,
): Promise<string[]> {
  return transport.invoke<string[]>('provider_list_models', {
    kind,
    base_url: baseUrl,
    api_key_account: keyAccount,
  });
}

export async function setSecret(account: string, secret: string): Promise<void> {
  await transport.invoke('secrets_set', { account, secret });
}

export async function getSecret(account: string): Promise<string | null> {
  return transport.invoke<string | null>('secrets_get', { account });
}

export async function deleteSecret(account: string): Promise<void> {
  await transport.invoke('secrets_delete', { account });
}

export function hasApiKey(profile: ProviderProfile): boolean {
  return PROVIDER_PRESETS.find((p) => p.type === profile.type)?.needsKey ?? true;
}
