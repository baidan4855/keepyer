/**
 * 应用状态管理
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type {
  Provider,
  ApiKey,
  AppState,
  AddProviderForm,
  AddKeyForm,
  SecuritySettings,
  ApiModel,
  ModelTestResult,
} from '@/types';
import {
  generateId,
  buildProviderWithKeys,
} from '@/shared/lib/helpers';
import { encryptApiKey } from '@/domains/settings/lib/secure-storage';

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
  importData: (providers: Provider[], apiKeys: ApiKey[]) => void;

  // UI 状态
  setSelectedProviderId: (id: string | null) => void;
  setAddProviderModalOpen: (open: boolean) => void;
  setAddKeyModalOpen: (open: boolean) => void;
  setEditKeyId: (id: string | null) => void;
  setDeleteConfirmOpen: (open: boolean) => void;
  setDeleteTarget: (target: { type: 'provider' | 'key'; id: string } | null) => void;
  setCopiedItem: (item: { type: 'key' | 'url'; id: string } | null) => void;
  setModelsModalOpen: (open: boolean, keyId: string | null) => void;

  // 安全设置
  updateSecuritySettings: (settings: Partial<SecuritySettings>) => void;
  setAuthModalOpen: (open: boolean) => void;
  setPasswordSetupOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setAuthAction: (action: 'view' | 'copy' | 'edit' | 'delete' | null) => void;
  setPendingAuthKeyId: (id: string | null) => void;
  setLastAuthTime: (time: number | null) => void;
  checkAuthSession: () => boolean;

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

const initialState: AppState = {
  providers: [],
  apiKeys: [],
  selectedProviderId: null,
  isAddProviderModalOpen: false,
  isAddKeyModalOpen: false,
  editKeyId: null,
  isDeleteConfirmOpen: false,
  deleteTarget: null,
  copiedItem: null,
  isModelsModalOpen: false,
  modelsModalKeyId: null,
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
};

const PERSIST_STORAGE_KEY = 'keeyper-storage';

export const useStore = create<AppStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      // 提供方操作
      addProvider: (data) => {
        const newProvider: Provider = {
          id: generateId(),
          name: data.name,
          baseUrl: data.baseUrl,
          apiType: data.apiType || 'openai',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        set((state) => ({
          providers: [...state.providers, newProvider],
          selectedProviderId: newProvider.id,
        }));
      },

      updateProvider: (id, data) => {
        set((state) => ({
          providers: state.providers.map((provider) =>
            provider.id === id
              ? { ...provider, ...data, updatedAt: new Date() }
              : provider
          ),
        }));
      },

      deleteProvider: (id) => {
        set((state) => ({
          providers: state.providers.filter((provider) => provider.id !== id),
          apiKeys: state.apiKeys.filter((k) => k.providerId !== id),
          selectedProviderId:
            state.selectedProviderId === id ? null : state.selectedProviderId,
        }));
      },

      // API Key 操作
      addKey: async (providerId, data) => {
        // 加密 API Key 后存储
        const encryptedKey = await encryptApiKey(data.key);
        const newKey: ApiKey = {
          id: generateId(),
          providerId,
          key: encryptedKey, // 存储加密后的密钥
          name: data.name,
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
        set((state) => ({
          apiKeys: state.apiKeys.filter((k) => k.id !== id),
        }));
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
      setSelectedProviderId: (id) => set({ selectedProviderId: id }),
      setAddProviderModalOpen: (open) => set({ isAddProviderModalOpen: open }),
      setAddKeyModalOpen: (open) => set({ isAddKeyModalOpen: open, editKeyId: null }),
      setEditKeyId: (id) => set({ editKeyId: id, isAddKeyModalOpen: !!id }),
      setDeleteConfirmOpen: (open) => set({ isDeleteConfirmOpen: open }),
      setDeleteTarget: (target) => set({ deleteTarget: target }),
      setCopiedItem: (item) => set({ copiedItem: item }),
      setModelsModalOpen: (open, keyId) => set({ isModelsModalOpen: open, modelsModalKeyId: keyId }),

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
      importData: (providers, apiKeys) => {
        set({ providers, apiKeys });
      },
    }),
    {
      name: PERSIST_STORAGE_KEY,
      version: 2,
      storage: createJSONStorage(() => localStorage, {
        reviver: dateReviver,
      }),
      migrate: (persistedState) => {
        if (!persistedState || typeof persistedState !== 'object') {
          return persistedState as AppState;
        }

        const state = persistedState as Record<string, unknown>;
        if ('providers' in state || 'selectedProviderId' in state) {
          return persistedState as AppState;
        }

        const legacyProviders = (state as any).services ?? [];
        const legacyKeys = (state as any).apiKeys ?? [];
        const migratedKeys = legacyKeys.map((key: any) => ({
          ...key,
          providerId: key.providerId ?? key.serviceId,
        }));

        return {
          ...state,
          providers: legacyProviders,
          apiKeys: migratedKeys,
          selectedProviderId: (state as any).selectedServiceId ?? null,
        } as AppState;
      },
      partialize: (state) => ({
        providers: state.providers,
        apiKeys: state.apiKeys,
        selectedProviderId: state.selectedProviderId,
      }),
    }
  )
);
