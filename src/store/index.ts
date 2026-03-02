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
} from '@/types';
import {
  generateId,
  buildProviderWithKeys,
} from '@/shared/lib/helpers';
import { encryptApiKey } from '@/domains/settings/lib/secure-storage';
import { getDefaultSystemPrompt, isLegacyDefaultSystemPrompt } from '@/shared/lib/prompts';

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
  gatewayConfig: createDefaultGatewayConfig(),
};

const PERSIST_STORAGE_KEY = 'keeyper-storage';

const getLocalizedDefaultSystemPrompt = () => getDefaultSystemPrompt(i18n.language);

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
        set((state) => ({
          providers: [...state.providers, newProvider],
          selectedProviderId: newProvider.id,
        }));
      },

      updateProvider: (id, data) => {
        const defaultSystemPrompt = getLocalizedDefaultSystemPrompt();
        const normalizedData: Partial<AddProviderForm> = { ...data };
        if ('systemPrompt' in normalizedData) {
          normalizedData.systemPrompt = normalizedData.systemPrompt?.trim() || defaultSystemPrompt;
        }

        set((state) => ({
          providers: state.providers.map((provider) =>
            provider.id === id
              ? { ...provider, ...normalizedData, updatedAt: new Date() }
              : provider
          ),
        }));
      },

      deleteProvider: (id) => {
        set((state) => {
          const providers = state.providers.filter((provider) => provider.id !== id);
          const apiKeys = state.apiKeys.filter((key) => key.providerId !== id);
          const gatewayConfig = sanitizeGatewayConfigResources(state.gatewayConfig, providers, apiKeys);

          return {
            providers,
            apiKeys,
            gatewayConfig,
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

        // 加密 API Key 后存储
        const encryptedKey = await encryptApiKey(data.key);
        const newKey: ApiKey = {
          id: generateId(),
          providerId,
          key: encryptedKey, // 存储加密后的密钥
          name: trimmedName,
          note: data.note,
          expiresAt: data.expiresAt,
          createdAt: new Date(),
          updatedAt: new Date(),
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
          const apiKeys = state.apiKeys.filter((key) => key.id !== id);
          const gatewayConfig = sanitizeGatewayConfigResources(state.gatewayConfig, state.providers, apiKeys);
          return {
            apiKeys,
            gatewayConfig,
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
        set((state) => ({
          modelTestResults: {
            ...state.modelTestResults,
            [resultKey]: {
              ...result,
              timestamp: Date.now(),
            },
          },
        }));
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
        const sanitizedGatewayConfig = sanitizeGatewayConfigResources(
          normalizedGatewayConfig,
          normalizedProviders,
          apiKeys,
        );
        set({
          providers: normalizedProviders,
          apiKeys,
          gatewayConfig: sanitizedGatewayConfig,
        });
      },
    }),
    {
      name: PERSIST_STORAGE_KEY,
      version: 5,
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
          const normalizedApiKeys = ((state as any).apiKeys ?? []) as ApiKey[];
          const gatewayConfig = sanitizeGatewayConfigResources(
            normalizeGatewayConfig((state as any).gatewayConfig),
            normalizedProviders,
            normalizedApiKeys,
          );
          return {
            ...state,
            activePage: (state as any).activePage === 'gateway' ? 'gateway' : 'providers',
            providers: normalizedProviders,
            apiKeys: normalizedApiKeys,
            gatewayConfig,
          } as AppState;
        }

        const legacyProviders = (state as any).services ?? [];
        const legacyKeys = (state as any).apiKeys ?? [];
        const migratedKeys = legacyKeys.map((key: any) => ({
          ...key,
          providerId: key.providerId ?? key.serviceId,
        }));

        return {
          ...state,
          providers: normalizeProviders(legacyProviders),
          apiKeys: migratedKeys,
          activePage: 'providers',
          selectedProviderId: (state as any).selectedServiceId ?? null,
          gatewayConfig: sanitizeGatewayConfigResources(
            normalizeGatewayConfig(undefined),
            normalizeProviders(legacyProviders),
            migratedKeys,
          ),
        } as AppState;
      },
      partialize: (state) => ({
        activePage: state.activePage,
        providers: state.providers,
        apiKeys: state.apiKeys,
        selectedProviderId: state.selectedProviderId,
        gatewayConfig: state.gatewayConfig,
      }),
    }
  )
);
