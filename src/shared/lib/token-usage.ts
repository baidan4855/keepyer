import type { TokenUsageStats } from '@/types';

type TokenUsagePayload = Record<string, unknown>;

type NumericEntry = {
  canonicalPath: string;
  value: number;
};

function canonicalizeKey(input: string): string {
  return input.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number') return null;
  if (!Number.isFinite(value)) return null;
  if (value < 0) return null;
  return value;
}

function flattenNumericEntries(value: unknown, path = ''): NumericEntry[] {
  const direct = toFiniteNumber(value);
  if (direct !== null) {
    return [{ canonicalPath: canonicalizeKey(path), value: direct }];
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const entries: NumericEntry[] = [];
  Object.entries(value as Record<string, unknown>).forEach(([key, nested]) => {
    const childPath = path ? `${path}.${key}` : key;
    entries.push(...flattenNumericEntries(nested, childPath));
  });
  return entries;
}

function findByAliases(entries: NumericEntry[], aliases: string[]): number | null {
  const normalizedAliases = aliases.map(canonicalizeKey);
  for (const alias of normalizedAliases) {
    const match = entries.find((entry) => (
      entry.canonicalPath === alias
      || entry.canonicalPath.endsWith(alias)
    ));
    if (match) return match.value;
  }
  return null;
}

function sumByAliases(entries: NumericEntry[], aliases: string[]): number | null {
  const normalizedAliases = aliases.map(canonicalizeKey);
  const picked = entries
    .filter((entry) => normalizedAliases.some((alias) => entry.canonicalPath.endsWith(alias)))
    .map((entry) => entry.value);
  if (picked.length === 0) return null;
  return picked.reduce((sum, value) => sum + value, 0);
}

export function normalizeTokenUsage(usage?: TokenUsagePayload): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
} | null {
  if (!usage || typeof usage !== 'object') return null;

  const entries = flattenNumericEntries(usage);
  if (!entries.length) return null;

  const explicitInput = findByAliases(entries, [
    'input_tokens',
    'prompt_tokens',
    'inputTokens',
    'promptTokens',
  ]);
  const explicitOutput = findByAliases(entries, [
    'output_tokens',
    'completion_tokens',
    'outputTokens',
    'completionTokens',
  ]);
  const explicitTotal = findByAliases(entries, [
    'total_tokens',
    'totalTokens',
  ]);

  const inputTokens = explicitInput ?? sumByAliases(entries, ['input_tokens', 'prompt_tokens']) ?? 0;
  const outputTokens = explicitOutput ?? sumByAliases(entries, ['output_tokens', 'completion_tokens']) ?? 0;
  const totalTokens = explicitTotal ?? (inputTokens + outputTokens);

  if (inputTokens <= 0 && outputTokens <= 0 && totalTokens <= 0) {
    return null;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

export function accumulateTokenUsage(
  current: TokenUsageStats | undefined,
  delta: { inputTokens: number; outputTokens: number; totalTokens: number },
): TokenUsageStats {
  return {
    inputTokens: (current?.inputTokens ?? 0) + delta.inputTokens,
    outputTokens: (current?.outputTokens ?? 0) + delta.outputTokens,
    totalTokens: (current?.totalTokens ?? 0) + delta.totalTokens,
    requestCount: (current?.requestCount ?? 0) + 1,
    updatedAt: Date.now(),
  };
}

export function formatTokenCount(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '-';
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return `${Math.floor(value)}`;
}
