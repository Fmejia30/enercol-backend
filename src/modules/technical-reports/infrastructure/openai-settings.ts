export const DEFAULT_OPENAI_MODEL = 'gpt-6-luna';
export const DEFAULT_OPENAI_REASONING_EFFORT = 'low';
export const DEFAULT_OPENAI_MAX_OUTPUT_TOKENS = 6_000;

export const OPENAI_REASONING_EFFORTS = [
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export type OpenAiReasoningEffort = (typeof OPENAI_REASONING_EFFORTS)[number];

export interface OpenAiSettings {
  readonly apiKey: string | null;
  readonly model: string;
  readonly reasoningEffort: OpenAiReasoningEffort;
  readonly maxOutputTokens: number;
}

export function openAiSettings(source: {
  get(key: string): unknown;
}): OpenAiSettings {
  return {
    apiKey: optionalText(source.get('openaiApiKey')),
    model: textOr(source.get('openaiModel'), DEFAULT_OPENAI_MODEL),
    reasoningEffort: effortOr(source.get('openaiReasoningEffort')),
    maxOutputTokens: tokensOr(source.get('openaiMaxOutputTokens')),
  };
}

function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function textOr(value: unknown, fallback: string): string {
  const text = optionalText(value);
  return text && /^[A-Za-z0-9._-]{1,64}$/.test(text) ? text : fallback;
}

function effortOr(value: unknown): OpenAiReasoningEffort {
  if (typeof value !== 'string') {
    return DEFAULT_OPENAI_REASONING_EFFORT;
  }
  return (
    OPENAI_REASONING_EFFORTS.find((effort) => effort === value) ??
    DEFAULT_OPENAI_REASONING_EFFORT
  );
}

function tokensOr(value: unknown): number {
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 16 &&
    value <= 128_000
  ) {
    return value;
  }
  return DEFAULT_OPENAI_MAX_OUTPUT_TOKENS;
}
