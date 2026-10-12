export const PROVIDERS = {
  groq: {
    label: 'Groq',
    model: 'openai/gpt-oss-20b',
    models: [
      { id: 'openai/gpt-oss-20b', label: 'GPT OSS 20B' },
      { id: 'openai/gpt-oss-120b', label: 'GPT OSS 120B' },
      { id: 'qwen/qwen3.8-27b', label: 'Qwen 3.8 27B' },
    ],
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
  },
  openai: {
    label: 'OpenAI (ChatGPT API)',
    model: 'gpt-4.1-mini',
    models: [
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
      { id: 'gpt-4.1', label: 'GPT-4.1' },
      { id: 'gpt-4.1-nano', label: 'GPT-4.1 nano' },
    ],
    endpoint: 'https://api.openai.com/v1/chat/completions',
  },
  gemini: {
    label: 'Google Gemini',
    model: 'gemini-2.5-flash',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    ],
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/',
  },
} as const;

export type ProviderId = keyof typeof PROVIDERS;

export interface ProviderAccess {
  provider: ProviderId;
  model: string;
  key: string;
}

export function validateAccess(value: unknown): ProviderAccess {
  const v = value as Partial<ProviderAccess> | null;
  if (
    !v ||
    !Object.hasOwn(PROVIDERS, v.provider ?? '') ||
    typeof v.key !== 'string' ||
    !/^[\x21-\x7e]{10,512}$/.test(v.key.trim()) ||
    typeof v.model !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(v.model) ||
    v.model.includes('..')
  )
    throw new Error(
      'Select a provider and enter a valid API key and model ID.',
    );
  return { provider: v.provider!, model: v.model, key: v.key.trim() };
}
