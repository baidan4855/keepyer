/**
 * 应用状态管理
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import i18n from '@/i18n';
import type {
  Provider,
  ApiKey,
  AppState,
  AddProviderForm,
  AddKeyForm,
  SecuritySettings,
  ApiModel,
  ModelTestResult,
  ClaudeGatewayConfig,
  TokenUsageStats,
  LiveTokenUsageDelta,
} from '@/types';
import {
  generateId,
  buildProviderWithKeys,
} from '@/shared/lib/helpers';
import { encryptApiKey } from '@/domains/settings/lib/secure-storage';
import { getDefaultSystemPrompt, isLegacyDefaultSystemPrompt } from '@/shared/lib/prompts';
import { getCodexFixedModels } from '@/shared/lib/codex';
import { accumulateTokenUsage, normalizeTokenUsage } from '@/shared/lib/token-usage';

interface StoreActions {
  // 提供方操作
  addProvider: (data: AddProviderForm) => void;
  updateProvider: (id: string, data: Partial<AddProviderForm>) => void;
  deleteProvider: (id: string) => void;

  // API Key 操作
  addKey: (providerId: string, data: AddKeyForm) => void;
  updateKey: (id: string, data: Partial<AddKeyForm>) => void;
  updateKeyModels: (id: string, models: ApiModel[]) => void;
  deleteKey: (id: string) => void;

  // 批量导入数据
  importData: (providers: Provider[], apiKeys: ApiKey[], gatewayConfig?: ClaudeGatewayConfig) => void;

  // UI 状态
  setActivePage: (page: 'providers' | 'gateway') => void;
  setSelectedProviderId: (id: string | null) => void;
  setAddProviderModalOpen: (open: boolean) => void;
  setEditProviderId: (id: string | null) => void;
  setAddKeyModalOpen: (open: boolean) => void;
  setEditKeyId: (id: string | null) => void;
  setDeleteConfirmOpen: (open: boolean) => void;
  setDeleteTarget: (target: { type: 'provider' | 'key'; id: string } | null) => void;
  setCopiedItem: (item: { type: 'key' | 'url'; id: string } | null) => void;
  setModelsModalOpen: (open: boolean, keyId: string | null) => void;
  setDebugChatOpen: (open: boolean, keyId: string | null) => void;

  // 安全设置
  updateSecuritySettings: (settings: Partial<SecuritySettings>) => void;
  setAuthModalOpen: (open: boolean) => void;
  setPasswordSetupOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setAuthAction: (action: 'view' | 'copy' | 'edit' | 'delete' | null) => void;
  setPendingAuthKeyId: (id: string | null) => void;
  setLastAuthTime: (time: number | null) => void;
  checkAuthSession: () => boolean;
  setGatewayConfig: (config: ClaudeGatewayConfig) => void;
  updateGatewayConfig: (config: Partial<ClaudeGatewayConfig>) => void;
  resetGatewayConfig: () => void;

  // 获取提供方列表（带状态）
  getProvidersWithKeys: () => ReturnType<typeof buildProviderWithKeys>[];
  getSelectedProvider: () => ReturnType<typeof buildProviderWithKeys> | null;
  getKeyById: (id: string) => ApiKey | undefined;

  // 模型测试
  setModelTestResult: (keyId: string, modelId: string, result: ModelTestResult) => void;
  clearModelTestResults: (keyId?: string) => void;
  getModelTestResult: (keyId: string, modelId: string) => ModelTestResult | undefined;

  // Token 统计
  recordModelTokenUsage: (providerId: string, keyId: string, modelId: string, usage?: Record<string, unknown>) => void;
  setLiveModelTokenUsage: (
    providerId: string,
    keyId: string,
    modelId: string,
    usage: { inputTokens: number; outputTokens: number; totalTokens: number },
  ) => void;
  clearLiveModelTokenUsage: (keyId: string, modelId: string) => void;
  getModelTokenUsage: (keyId: string, modelId: string) => TokenUsageStats | undefined;
  getKeyTokenUsage: (keyId: string) => TokenUsageStats | undefined;
  getProviderTokenUsage: (providerId: string) => TokenUsageStats | undefined;
}

type AppStore = AppState & StoreActions;

function dateReviver(key: string, value: unknown): unknown {
  const dateFields = ['createdAt', 'updatedAt', 'expiresAt'];
  if (dateFields.includes(key) && (typeof value === 'string' || typeof value === 'number')) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  return value;
}

function createDefaultGatewayConfig(): ClaudeGatewayConfig {
  return {
    listenHost: '127.0.0.1',
    listenPort: 8787,
    gatewayToken: '',
    requestLog: true,
    modelMappings: {},
  };
}

function normalizeGatewayConfig(config: unknown): ClaudeGatewayConfig {
  const defaults = createDefaultGatewayConfig();
  if (!config || typeof config !== 'object') {
    return defaults;
  }

  const raw = config as Record<string, unknown>;
  const rawRoutes = raw.routes && typeof raw.routes === 'object'
    ? raw.routes as Record<string, unknown>
    : {};
  const rawMappings = raw.modelMappings && typeof raw.modelMappings === 'object'
    ? raw.modelMappings as Record<string, unknown>
    : {};

  const resolveLegacyRoute = (routeName: string): { providerId: string; keyId: string } | null => {
    const route = rawRoutes[routeName];
    if (!route || typeof route !== 'object') return null;
    const typedRoute = route as Record<string, unknown>;
    const providerId = typeof typedRoute.providerId === 'string' ? typedRoute.providerId.trim() : '';
    const keyId = typeof typedRoute.keyId === 'string' ? typedRoute.keyId.trim() : '';
    if (!providerId || !keyId) return null;
    return { providerId, keyId };
  };

  const modelMappings: ClaudeGatewayConfig['modelMappings'] = {};

  for (const [sourceModelRaw, value] of Object.entries(rawMappings)) {
    const modelName = sourceModelRaw.trim();
    if (!modelName) continue;
    if (!value || typeof value !== 'object') continue;

    const mapping = value as Record<string, unknown>;
    const providerId = typeof mapping.providerId === 'string' ? mapping.providerId.trim() : '';
    const keyId = typeof mapping.keyId === 'string' ? mapping.keyId.trim() : '';

    let resolvedProviderId = providerId;
    let resolvedKeyId = keyId;

    if ((!resolvedProviderId || !resolvedKeyId) && typeof mapping.route === 'string') {
      const legacy = resolveLegacyRoute(mapping.route.trim());
      if (legacy) {
        resolvedProviderId = legacy.providerId;
        resolvedKeyId = legacy.keyId;
      }
    }

    if (!resolvedProviderId || !resolvedKeyId) continue;

    const targetModel = typeof mapping.targetModel === 'string' && mapping.targetModel.trim()
      ? mapping.targetModel.trim()
      : (typeof mapping.model === 'string' && mapping.model.trim() ? mapping.model.trim() : modelName);

    modelMappings[modelName] = {
      providerId: resolvedProviderId,
      keyId: resolvedKeyId,
      targetModel,
    };
  }

  return {
    listenHost: typeof raw.listenHost === 'string' && raw.listenHost.trim()
      ? raw.listenHost.trim()
      : defaults.listenHost,
    listenPort: typeof raw.listenPort === 'number' && Number.isFinite(raw.listenPort) && raw.listenPort > 0
      ? Math.floor(raw.listenPort)
      : defaults.listenPort,
    gatewayToken: typeof raw.gatewayToken === 'string' ? raw.gatewayToken : '',
    requestLog: raw.requestLog !== false,
    modelMappings,
  };
}

function sanitizeGatewayConfigResources(
  gatewayConfig: ClaudeGatewayConfig,
  providers: Provider[],
  apiKeys: ApiKey[],
): ClaudeGatewayConfig {
  const providerIds = new Set(providers.map((provider) => provider.id));
  const keyMap = new Map(apiKeys.map((key) => [key.id, key]));
  const nextMappings: ClaudeGatewayConfig['modelMappings'] = {};
  Object.entries(gatewayConfig.modelMappings).forEach(([sourceModelRaw, mapping]) => {
    const sourceModel = sourceModelRaw.trim();
    if (!sourceModel) return;
    if (!providerIds.has(mapping.providerId)) return;
    const key = keyMap.get(mapping.keyId);
    if (!key || key.providerId !== mapping.providerId) return;
    nextMappings[sourceModel] = {
      providerId: mapping.providerId,
      keyId: mapping.keyId,
      targetModel: mapping.targetModel?.trim() || sourceModel,
    };
  });

  return {
    ...gatewayConfig,
    modelMappings: nextMappings,
  };
}

type PersistedTokenUsageStateSlice = Pick<AppState, 'modelTokenUsage' | 'keyTokenUsage' | 'providerTokenUsage'>;
type TokenUsageStateSlice = PersistedTokenUsageStateSlice & Pick<AppState, 'liveModelTokenUsage'>;

function createEmptyTokenUsageState(): TokenUsageStateSlice {
  return {
    modelTokenUsage: {},
    keyTokenUsage: {},
    providerTokenUsage: {},
    liveModelTokenUsage: {},
  };
}

function getModelUsageStorageKey(keyId: string, modelId: string): string {
  return `${keyId}:${modelId}`;
}

function appendTokenUsage(
  state: PersistedTokenUsageStateSlice,
  providerId: string | undefined,
  keyId: string,
  modelId: string,
  usage?: Record<string, unknown>,
): PersistedTokenUsageStateSlice | null {
  const parsed = normalizeTokenUsage(usage);
  if (!parsed) return null;

  const modelUsageKey = getModelUsageStorageKey(keyId, modelId);
  const nextModelTokenUsage = {
    ...state.modelTokenUsage,
    [modelUsageKey]: accumulateTokenUsage(state.modelTokenUsage[modelUsageKey], parsed),
  };
  const nextKeyTokenUsage = {
    ...state.keyTokenUsage,
    [keyId]: accumulateTokenUsage(state.keyTokenUsage[keyId], parsed),
  };
  const nextProviderTokenUsage = providerId
    ? {
        ...state.providerTokenUsage,
        [providerId]: accumulateTokenUsage(state.providerTokenUsage[providerId], parsed),
      }
    : state.providerTokenUsage;

  return {
    modelTokenUsage: nextModelTokenUsage,
    keyTokenUsage: nextKeyTokenUsage,
    providerTokenUsage: nextProviderTokenUsage,
  };
}

function sanitizeTokenUsageState(
  tokenUsageState: PersistedTokenUsageStateSlice,
  providers: Provider[],
  apiKeys: ApiKey[],
): PersistedTokenUsageStateSlice {
  const providerIds = new Set(providers.map((provider) => provider.id));
  const keyIds = new Set(apiKeys.map((key) => key.id));

  const keyTokenUsage: Record<string, TokenUsageStats> = {};
  Object.entries(tokenUsageState.keyTokenUsage).forEach(([keyId, stats]) => {
    if (keyIds.has(keyId)) {
      keyTokenUsage[keyId] = stats;
    }
  });

  const modelTokenUsage: Record<string, TokenUsageStats> = {};
  Object.entries(tokenUsageState.modelTokenUsage).forEach(([key, stats]) => {
    const separatorIndex = key.indexOf(':');
    if (separatorIndex <= 0) return;
    const keyId = key.slice(0, separatorIndex);
    if (keyIds.has(keyId)) {
      modelTokenUsage[key] = stats;
    }
  });

  const providerTokenUsage: Record<string, TokenUsageStats> = {};
  Object.entries(tokenUsageState.providerTokenUsage).forEach(([providerId, stats]) => {
    if (providerIds.has(providerId)) {
      providerTokenUsage[providerId] = stats;
    }
  });

  return {
    modelTokenUsage,
    keyTokenUsage,
    providerTokenUsage,
  };
}

function sanitizeLiveTokenUsageState(
  liveModelTokenUsage: Record<string, LiveTokenUsageDelta>,
  providers: Provider[],
  apiKeys: ApiKey[],
): Record<string, LiveTokenUsageDelta> {
  const providerIds = new Set(providers.map((provider) => provider.id));
  const keyMap = new Map(apiKeys.map((key) => [key.id, key.providerId]));
  const next: Record<string, LiveTokenUsageDelta> = {};

  Object.entries(liveModelTokenUsage).forEach(([usageKey, live]) => {
    const providerId = keyMap.get(live.keyId);
    if (!providerId) return;
    if (providerId !== live.providerId) return;
    if (!providerIds.has(providerId)) return;
    next[usageKey] = live;
  });

  return next;
}

function buildTokenUsageStats(
  base: TokenUsageStats | undefined,
  live: { inputTokens: number; outputTokens: number; totalTokens: number; updatedAt: number } | null,
): TokenUsageStats | undefined {
  if (!base && (!live || (live.inputTokens <= 0 && live.outputTokens <= 0 && live.totalTokens <= 0))) {
    return undefined;
  }

  return {
    inputTokens: (base?.inputTokens ?? 0) + (live?.inputTokens ?? 0),
    outputTokens: (base?.outputTokens ?? 0) + (live?.outputTokens ?? 0),
    totalTokens: (base?.totalTokens ?? 0) + (live?.totalTokens ?? 0),
    requestCount: base?.requestCount ?? 0,
    updatedAt: Math.max(base?.updatedAt ?? 0, live?.updatedAt ?? 0),
  };
}

function getLiveUsageForModel(
  liveModelTokenUsage: Record<string, LiveTokenUsageDelta>,
  keyId: string,
  modelId: string,
): { inputTokens: number; outputTokens: number; totalTokens: number; updatedAt: number } | null {
  const usageKey = getModelUsageStorageKey(keyId, modelId);
  const live = liveModelTokenUsage[usageKey];
  if (!live) return null;
  return {
    inputTokens: live.inputTokens,
    outputTokens: live.outputTokens,
    totalTokens: live.totalTokens,
    updatedAt: live.updatedAt,
  };
}

function getLiveUsageForKey(
  liveModelTokenUsage: Record<string, LiveTokenUsageDelta>,
  keyId: string,
): { inputTokens: number; outputTokens: number; totalTokens: number; updatedAt: number } | null {
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let updatedAt = 0;

  Object.values(liveModelTokenUsage).forEach((live) => {
    if (live.keyId !== keyId) return;
    inputTokens += live.inputTokens;
    outputTokens += live.outputTokens;
    totalTokens += live.totalTokens;
    updatedAt = Math.max(updatedAt, live.updatedAt);
  });

  if (inputTokens <= 0 && outputTokens <= 0 && totalTokens <= 0) {
    return null;
  }
  return { inputTokens, outputTokens, totalTokens, updatedAt };
}

function getLiveUsageForProvider(
  liveModelTokenUsage: Record<string, LiveTokenUsageDelta>,
  providerId: string,
): { inputTokens: number; outputTokens: number; totalTokens: number; updatedAt: number } | null {
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let updatedAt = 0;

  Object.values(liveModelTokenUsage).forEach((live) => {
    if (live.providerId !== providerId) return;
    inputTokens += live.inputTokens;
    outputTokens += live.outputTokens;
    totalTokens += live.totalTokens;
    updatedAt = Math.max(updatedAt, live.updatedAt);
  });

  if (inputTokens <= 0 && outputTokens <= 0 && totalTokens <= 0) {
    return null;
  }
  return { inputTokens, outputTokens, totalTokens, updatedAt };
}

const initialState: AppState = {
  activePage: 'providers',
  providers: [],
  apiKeys: [],
  selectedProviderId: null,
  isAddProviderModalOpen: false,
  editProviderId: null,
  isAddKeyModalOpen: false,
  editKeyId: null,
  isDeleteConfirmOpen: false,
  deleteTarget: null,
  copiedItem: null,
  isModelsModalOpen: false,
  modelsModalKeyId: null,
  isDebugChatOpen: false,
  debugChatKeyId: null,
  securitySettings: {
    requireAuthToView: false,
    requireAuthToCopy: false,
  },
  isAuthModalOpen: false,
  isPasswordSetupOpen: false,
  isSettingsOpen: false,
  authAction: null,
  pendingAuthKeyId: null,
  lastAuthTime: null,
  modelTestResults: {},
  ...createEmptyTokenUsageState(),
  gatewayConfig: createDefaultGatewayConfig(),
};

const PERSIST_STORAGE_KEY = 'keeyper-storage';

const getLocalizedDefaultSystemPrompt = () => getDefaultSystemPrompt(i18n.language);
const CODEX_DEFAULT_KEY_VALUE = 'codex-default-local-key';

function getLocalizedCodexDefaultKeyName(): string {
  const localized = i18n.t('keys.codexDefaultKey');
  if (typeof localized === 'string' && localized.trim()) {
    return localized;
  }
  return 'Codex Default Key';
}

function createCodexDefaultKey(providerId: string): ApiKey {
  const now = new Date();
  return {
    id: generateId(),
    providerId,
    key: CODEX_DEFAULT_KEY_VALUE,
    name: getLocalizedCodexDefaultKeyName(),
    models: getCodexFixedModels(),
    modelsUpdatedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function ensureCodexProvidersHaveDefaultKey(providers: Provider[], apiKeys: ApiKey[]): ApiKey[] {
  const codexProviderIds = new Set(
    providers
      .filter((provider) => provider.apiType === 'codex')
      .map((provider) => provider.id),
  );
  if (!codexProviderIds.size) return apiKeys;

  const hasKeyProviderIds = new Set(
    apiKeys
      .filter((key) => codexProviderIds.has(key.providerId))
      .map((key) => key.providerId),
  );

  let nextKeys = apiKeys;
  codexProviderIds.forEach((providerId) => {
    if (hasKeyProviderIds.has(providerId)) return;
    if (nextKeys === apiKeys) {
      nextKeys = [...apiKeys];
    }
    nextKeys.push(createCodexDefaultKey(providerId));
  });

  return nextKeys;
}

function ensureCodexKeysHaveDefaultModels(providers: Provider[], apiKeys: ApiKey[]): ApiKey[] {
  const codexProviderIds = new Set(
    providers
      .filter((provider) => provider.apiType === 'codex')
      .map((provider) => provider.id),
  );
  if (!codexProviderIds.size) return apiKeys;

  const fixedModels = getCodexFixedModels();
  const fixedIds = fixedModels.map((model) => model.id);
  const isSameFixedModels = (models?: ApiModel[]) => {
    if (!Array.isArray(models)) return false;
    const ids = models.map((item) => item.id);
    if (ids.length !== fixedIds.length) return false;
    return ids.every((id, index) => id === fixedIds[index]);
  };

  let changed = false;
  const now = new Date();
  const next = apiKeys.map((key) => {
    if (!codexProviderIds.has(key.providerId)) return key;
    if (isSameFixedModels(key.models)) return key;
    changed = true;
    return {
      ...key,
      models: fixedModels,
      modelsUpdatedAt: now,
      updatedAt: now,
    };
  });

  return changed ? next : apiKeys;
}

export const useStore = create<AppStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      // 提供方操作
      addProvider: (data) => {
        const defaultSystemPrompt = getLocalizedDefaultSystemPrompt();
        const newProvider: Provider = {
          id: generateId(),
          name: data.name,
          baseUrl: data.baseUrl,
          apiType: data.apiType || 'openai',
          systemPrompt: data.systemPrompt?.trim() || defaultSystemPrompt,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        set((state) => {
          const providers = [...state.providers, newProvider];
          const withDefaultKey = ensureCodexProvidersHaveDefaultKey(providers, state.apiKeys);
          const apiKeys = ensureCodexKeysHaveDefaultModels(providers, withDefaultKey);
          return {
            providers,
            apiKeys,
            selectedProviderId: newProvider.id,
          };
        });
      },

      updateProvider: (id, data) => {
        const defaultSystemPrompt = getLocalizedDefaultSystemPrompt();
        const normalizedData: Partial<AddProviderForm> = { ...data };
        if ('systemPrompt' in normalizedData) {
          normalizedData.systemPrompt = normalizedData.systemPrompt?.trim() || defaultSystemPrompt;
        }

        set((state) => {
          const providers = state.providers.map((provider) =>
            provider.id === id
              ? { ...provider, ...normalizedData, updatedAt: new Date() }
              : provider
          );
          const withDefaultKey = ensureCodexProvidersHaveDefaultKey(providers, state.apiKeys);
          const apiKeys = ensureCodexKeysHaveDefaultModels(providers, withDefaultKey);
          return {
            providers,
            apiKeys,
          };
        });
      },

      deleteProvider: (id) => {
        set((state) => {
          const providers = state.providers.filter((provider) => provider.id !== id);
          const apiKeys = state.apiKeys.filter((key) => key.providerId !== id);
          const gatewayConfig = sanitizeGatewayConfigResources(state.gatewayConfig, providers, apiKeys);
          const tokenUsageState = sanitizeTokenUsageState(
            {
              modelTokenUsage: state.modelTokenUsage,
              keyTokenUsage: state.keyTokenUsage,
              providerTokenUsage: state.providerTokenUsage,
            },
            providers,
            apiKeys,
          );
          const liveModelTokenUsage = sanitizeLiveTokenUsageState(
            state.liveModelTokenUsage,
            providers,
            apiKeys,
          );

          return {
            providers,
            apiKeys,
            gatewayConfig,
            ...tokenUsageState,
            liveModelTokenUsage,
            selectedProviderId:
              state.selectedProviderId === id ? null : state.selectedProviderId,
          };
        });
      },

      // API Key 操作
      addKey: async (providerId, data) => {
        const trimmedName = data.name?.trim();
        if (!trimmedName) {
          throw new Error(i18n.t('modals.addKey.error.requiredName') || 'API key name is required');
        }
        const provider = get().providers.find((item) => item.id === providerId);
        const isCodexProvider = provider?.apiType === 'codex';
        const now = new Date();

        // 加密 API Key 后存储
        const encryptedKey = await encryptApiKey(data.key);
        const newKey: ApiKey = {
          id: generateId(),
          providerId,
          key: encryptedKey, // 存储加密后的密钥
          name: trimmedName,
          note: data.note,
          expiresAt: data.expiresAt,
          models: isCodexProvider ? getCodexFixedModels() : undefined,
          modelsUpdatedAt: isCodexProvider ? now : undefined,
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({
          apiKeys: [...state.apiKeys, newKey],
        }));
      },

      updateKey: async (id, data) => {
        if (data.key) {
          // 如果要更新密钥，需要加密新值
          const encryptedKey = await encryptApiKey(data.key);
          set((state) => ({
            apiKeys: state.apiKeys.map((k) =>
              k.id === id
                ? { ...k, ...data, key: encryptedKey, updatedAt: new Date() }
                : k
            ),
          }));
        } else {
          set((state) => ({
            apiKeys: state.apiKeys.map((k) =>
              k.id === id
                ? { ...k, ...data, updatedAt: new Date() }
                : k
            ),
          }));
        }
      },

      deleteKey: (id) => {
        set((state) => {
          const removed = state.apiKeys.filter((key) => key.id !== id);
          const withDefaultKey = ensureCodexProvidersHaveDefaultKey(state.providers, removed);
          const apiKeys = ensureCodexKeysHaveDefaultModels(state.providers, withDefaultKey);
          const gatewayConfig = sanitizeGatewayConfigResources(state.gatewayConfig, state.providers, apiKeys);
          const tokenUsageState = sanitizeTokenUsageState(
            {
              modelTokenUsage: state.modelTokenUsage,
              keyTokenUsage: state.keyTokenUsage,
              providerTokenUsage: state.providerTokenUsage,
            },
            state.providers,
            apiKeys,
          );
          const liveModelTokenUsage = sanitizeLiveTokenUsageState(
            state.liveModelTokenUsage,
            state.providers,
            apiKeys,
          );
          return {
            apiKeys,
            gatewayConfig,
            ...tokenUsageState,
            liveModelTokenUsage,
          };
        });
      },

      updateKeyModels: (id, models) => {
        set((state) => ({
          apiKeys: state.apiKeys.map((k) =>
            k.id === id
              ? { ...k, models, modelsUpdatedAt: new Date(), updatedAt: new Date() }
              : k
          ),
        }));
      },

      // UI 状态
      setActivePage: (page) => set({ activePage: page }),
      setSelectedProviderId: (id) => set({ selectedProviderId: id }),
      setAddProviderModalOpen: (open) =>
        set((state) => ({
          isAddProviderModalOpen: open,
          editProviderId: open ? state.editProviderId : null,
        })),
      setEditProviderId: (id) => set({ editProviderId: id, isAddProviderModalOpen: !!id }),
      setAddKeyModalOpen: (open) => set({ isAddKeyModalOpen: open, editKeyId: null }),
      setEditKeyId: (id) => set({ editKeyId: id, isAddKeyModalOpen: !!id }),
      setDeleteConfirmOpen: (open) => set({ isDeleteConfirmOpen: open }),
      setDeleteTarget: (target) => set({ deleteTarget: target }),
      setCopiedItem: (item) => set({ copiedItem: item }),
      setModelsModalOpen: (open, keyId) => set({ isModelsModalOpen: open, modelsModalKeyId: keyId }),
      setDebugChatOpen: (open, keyId) => set({ isDebugChatOpen: open, debugChatKeyId: keyId }),

      // 安全设置
      updateSecuritySettings: (settings) =>
        set((state) => ({
          securitySettings: { ...state.securitySettings, ...settings },
        })),

      setAuthModalOpen: (open) => set({ isAuthModalOpen: open }),
      setPasswordSetupOpen: (open) => set({ isPasswordSetupOpen: open }),
      setSettingsOpen: (open) => set({ isSettingsOpen: open }),
      setAuthAction: (action) => set({ authAction: action }),
      setPendingAuthKeyId: (id) => set({ pendingAuthKeyId: id }),
      setLastAuthTime: (time) => set({ lastAuthTime: time }),
      checkAuthSession: () => {
        const state = get();
        if (!state.lastAuthTime) return false;
        // 10分钟 = 600000 毫秒
        const TEN_MINUTES = 10 * 60 * 1000;
        return Date.now() - state.lastAuthTime < TEN_MINUTES;
      },
      setGatewayConfig: (config) =>
        set((state) => ({
          gatewayConfig: sanitizeGatewayConfigResources(
            normalizeGatewayConfig(config),
            state.providers,
            state.apiKeys,
          ),
        })),
      updateGatewayConfig: (config) =>
        set((state) => ({
          gatewayConfig: sanitizeGatewayConfigResources(
            normalizeGatewayConfig({
              ...state.gatewayConfig,
              ...config,
            }),
            state.providers,
            state.apiKeys,
          ),
        })),
      resetGatewayConfig: () =>
        set((state) => ({
          gatewayConfig: sanitizeGatewayConfigResources(
            createDefaultGatewayConfig(),
            state.providers,
            state.apiKeys,
          ),
        })),

      // 获取方法
      getProvidersWithKeys: () => {
        const state = get();
        return state.providers.map((provider) =>
          buildProviderWithKeys(provider, state.apiKeys)
        );
      },

      getSelectedProvider: () => {
        const state = get();
        if (!state.selectedProviderId) return null;
        const provider = state.providers.find((p) => p.id === state.selectedProviderId);
        if (!provider) return null;
        return buildProviderWithKeys(provider, state.apiKeys);
      },

      getKeyById: (id) => {
        const state = get();
        return state.apiKeys.find((k) => k.id === id);
      },

      // 模型测试
      setModelTestResult: (keyId, modelId, result) => {
        const resultKey = `${keyId}:${modelId}`;
        set((state) => {
          const providerId = state.apiKeys.find((item) => item.id === keyId)?.providerId;
          const usageState = appendTokenUsage(
            {
              modelTokenUsage: state.modelTokenUsage,
              keyTokenUsage: state.keyTokenUsage,
              providerTokenUsage: state.providerTokenUsage,
            },
            providerId,
            keyId,
            modelId,
            result.usage,
          );

          return {
            modelTestResults: {
              ...state.modelTestResults,
              [resultKey]: {
                ...result,
                timestamp: Date.now(),
              },
            },
            ...(usageState || {}),
          };
        });
      },

      clearModelTestResults: (keyId) => {
        if (keyId) {
          // 清除指定 key 的所有测试结果
          set((state) => {
            const newResults: Record<string, ModelTestResult> = {};
            Object.entries(state.modelTestResults).forEach(([k, v]) => {
              if (!k.startsWith(`${keyId}:`)) {
                newResults[k] = v;
              }
            });
            return { modelTestResults: newResults };
          });
        } else {
          // 清除所有测试结果
          set({ modelTestResults: {} });
        }
      },

      getModelTestResult: (keyId, modelId) => {
        const state = get();
        const resultKey = `${keyId}:${modelId}`;
        return state.modelTestResults[resultKey];
      },

      recordModelTokenUsage: (providerId, keyId, modelId, usage) => {
        set((state) => {
          const usageState = appendTokenUsage(
            {
              modelTokenUsage: state.modelTokenUsage,
              keyTokenUsage: state.keyTokenUsage,
              providerTokenUsage: state.providerTokenUsage,
            },
            providerId,
            keyId,
            modelId,
            usage,
          );
          return usageState || {};
        });
      },

      setLiveModelTokenUsage: (providerId, keyId, modelId, usage) => {
        set((state) => {
          const usageKey = getModelUsageStorageKey(keyId, modelId);
          return {
            liveModelTokenUsage: {
              ...state.liveModelTokenUsage,
              [usageKey]: {
                providerId,
                keyId,
                modelId,
                inputTokens: Math.max(0, Math.floor(usage.inputTokens)),
                outputTokens: Math.max(0, Math.floor(usage.outputTokens)),
                totalTokens: Math.max(0, Math.floor(usage.totalTokens)),
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      clearLiveModelTokenUsage: (keyId, modelId) => {
        set((state) => {
          const usageKey = getModelUsageStorageKey(keyId, modelId);
          if (!(usageKey in state.liveModelTokenUsage)) {
            return {};
          }
          const next = { ...state.liveModelTokenUsage };
          delete next[usageKey];
          return { liveModelTokenUsage: next };
        });
      },

      getModelTokenUsage: (keyId, modelId) => {
        const state = get();
        const usageKey = getModelUsageStorageKey(keyId, modelId);
        const base = state.modelTokenUsage[usageKey];
        const live = getLiveUsageForModel(state.liveModelTokenUsage, keyId, modelId);
        return buildTokenUsageStats(base, live);
      },

      getKeyTokenUsage: (keyId) => {
        const state = get();
        const base = state.keyTokenUsage[keyId];
        const live = getLiveUsageForKey(state.liveModelTokenUsage, keyId);
        return buildTokenUsageStats(base, live);
      },

      getProviderTokenUsage: (providerId) => {
        const state = get();
        const base = state.providerTokenUsage[providerId];
        const live = getLiveUsageForProvider(state.liveModelTokenUsage, providerId);
        return buildTokenUsageStats(base, live);
      },

      // 批量导入数据
      importData: (providers, apiKeys, gatewayConfig) => {
        const defaultSystemPrompt = getLocalizedDefaultSystemPrompt();
        const normalizedGatewayConfig = gatewayConfig
          ? normalizeGatewayConfig(gatewayConfig)
          : get().gatewayConfig;
        const normalizedProviders = providers.map((provider) => ({
          ...provider,
          apiType: provider.apiType || 'openai',
          systemPrompt: provider.systemPrompt?.trim()
            ? (
                isLegacyDefaultSystemPrompt(provider.systemPrompt)
                  ? defaultSystemPrompt
                  : provider.systemPrompt
              )
            : defaultSystemPrompt,
        }));
        const withDefaultKey = ensureCodexProvidersHaveDefaultKey(normalizedProviders, apiKeys);
        const normalizedApiKeys = ensureCodexKeysHaveDefaultModels(normalizedProviders, withDefaultKey);
        const sanitizedGatewayConfig = sanitizeGatewayConfigResources(
          normalizedGatewayConfig,
          normalizedProviders,
          normalizedApiKeys,
        );
        const tokenUsageState = sanitizeTokenUsageState(
          {
            modelTokenUsage: get().modelTokenUsage,
            keyTokenUsage: get().keyTokenUsage,
            providerTokenUsage: get().providerTokenUsage,
          },
          normalizedProviders,
          normalizedApiKeys,
        );
        const liveModelTokenUsage = sanitizeLiveTokenUsageState(
          get().liveModelTokenUsage,
          normalizedProviders,
          normalizedApiKeys,
        );
        set({
          providers: normalizedProviders,
          apiKeys: normalizedApiKeys,
          gatewayConfig: sanitizedGatewayConfig,
          ...tokenUsageState,
          liveModelTokenUsage,
        });
      },
    }),
    {
      name: PERSIST_STORAGE_KEY,
      version: 8,
      storage: createJSONStorage(() => localStorage, {
        reviver: dateReviver,
      }),
      migrate: (persistedState) => {
        if (!persistedState || typeof persistedState !== 'object') {
          return persistedState as AppState;
        }

        const state = persistedState as Record<string, unknown>;
        const defaultSystemPrompt = getLocalizedDefaultSystemPrompt();
        const normalizeProviders = (providers: any[]) =>
          providers.map((provider) => ({
            ...provider,
            apiType: provider.apiType || 'openai',
            systemPrompt: typeof provider.systemPrompt === 'string' && provider.systemPrompt.trim()
              ? (
                  isLegacyDefaultSystemPrompt(provider.systemPrompt)
                    ? defaultSystemPrompt
                    : provider.systemPrompt
                )
              : defaultSystemPrompt,
          }));

        if ('providers' in state || 'selectedProviderId' in state) {
          const normalizedProviders = normalizeProviders(((state as any).providers ?? []) as any[]);
          const withDefaultKey = ensureCodexProvidersHaveDefaultKey(
            normalizedProviders,
            ((state as any).apiKeys ?? []) as ApiKey[],
          );
          const normalizedApiKeys = ensureCodexKeysHaveDefaultModels(
            normalizedProviders,
            withDefaultKey,
          );
          const gatewayConfig = sanitizeGatewayConfigResources(
            normalizeGatewayConfig((state as any).gatewayConfig),
            normalizedProviders,
            normalizedApiKeys,
          );
          const tokenUsageState = sanitizeTokenUsageState(
            {
              modelTokenUsage: ((state as any).modelTokenUsage ?? {}) as Record<string, TokenUsageStats>,
              keyTokenUsage: ((state as any).keyTokenUsage ?? {}) as Record<string, TokenUsageStats>,
              providerTokenUsage: ((state as any).providerTokenUsage ?? {}) as Record<string, TokenUsageStats>,
            },
            normalizedProviders,
            normalizedApiKeys,
          );
          return {
            ...state,
            activePage: (state as any).activePage === 'gateway' ? 'gateway' : 'providers',
            providers: normalizedProviders,
            apiKeys: normalizedApiKeys,
            gatewayConfig,
            ...tokenUsageState,
            liveModelTokenUsage: {},
          } as AppState;
        }

        const legacyProviders = (state as any).services ?? [];
        const legacyKeys = (state as any).apiKeys ?? [];
        const migratedKeys = legacyKeys.map((key: any) => ({
          ...key,
          providerId: key.providerId ?? key.serviceId,
        }));
        const normalizedLegacyProviders = normalizeProviders(legacyProviders);
        const withDefaultKey = ensureCodexProvidersHaveDefaultKey(
          normalizedLegacyProviders,
          migratedKeys,
        );
        const normalizedMigratedKeys = ensureCodexKeysHaveDefaultModels(
          normalizedLegacyProviders,
          withDefaultKey,
        );

        return {
          ...state,
          providers: normalizedLegacyProviders,
          apiKeys: normalizedMigratedKeys,
          activePage: 'providers',
          selectedProviderId: (state as any).selectedServiceId ?? null,
          gatewayConfig: sanitizeGatewayConfigResources(
            normalizeGatewayConfig(undefined),
            normalizedLegacyProviders,
            normalizedMigratedKeys,
          ),
          ...createEmptyTokenUsageState(),
        } as AppState;
      },
      partialize: (state) => ({
        activePage: state.activePage,
        providers: state.providers,
        apiKeys: state.apiKeys,
        selectedProviderId: state.selectedProviderId,
        gatewayConfig: state.gatewayConfig,
        modelTokenUsage: state.modelTokenUsage,
        keyTokenUsage: state.keyTokenUsage,
        providerTokenUsage: state.providerTokenUsage,
      }),
    }
  )
);
