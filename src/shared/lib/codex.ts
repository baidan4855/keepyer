import type { ApiModel } from '@/types';

export const CODEX_FIXED_MODEL_IDS = [
  'gpt-5.3-codex',
  'gpt-5.2-codex',
  'gpt-5.1-codex-max',
  'gpt-5.2',
  'gpt-5.1-codex-mini',
] as const;

export function getCodexFixedModels(): ApiModel[] {
  return CODEX_FIXED_MODEL_IDS.map((id) => ({
    id,
    name: id,
    owned_by: 'codex',
  }));
}
