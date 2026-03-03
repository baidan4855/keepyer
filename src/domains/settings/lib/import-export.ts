/**
 * 导入导出工具
 */

import type {
  Provider,
  ApiKey,
  ClaudeGatewayConfig,
  GatewayConfigProfile,
} from '@/types';
import { useStore } from '@/store';
import { encryptApiKey } from './secure-storage';
import { generateId } from '@/shared/lib/helpers';
import { buildGatewayRuntimeConfig } from '@/domains/gateway/lib/config-builder';

interface ExportApiKey {
  id?: string;
  providerId?: string;
  serviceId?: string; // legacy (import only)
  key: string; // 明文或加密格式
  name?: string;
  note?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 导出数据格式
 */
export interface ExportData {
  version: string;
  exportedAt: string;
  providers?: Provider[];
  services?: Provider[]; // legacy (import only)
  apiKeys: ExportApiKey[];
  gatewayConfig?: ClaudeGatewayConfig;
  gatewayConfigProfiles?: GatewayConfigProfile[];
  activeGatewayConfigProfileId?: string | null;
}

function toISOString(date: Date | string | undefined): string | undefined {
  if (!date) return undefined;
  if (typeof date === 'string') return date;
  return date.toISOString();
}

function parseDate(value: string | undefined): Date {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

async function saveJsonFile(fileName: string, data: unknown): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  const content = JSON.stringify(data, null, 2);
  await invoke('save_file', { fileName, content });
}

/**
 * 导出数据备份
 */
export async function exportData(): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  const {
    providers,
    apiKeys,
    gatewayConfig,
    gatewayConfigProfiles,
    activeGatewayConfigProfileId,
  } = useStore.getState();

  const exportKeys: ExportApiKey[] = await Promise.all(
    apiKeys.map(async (key) => {
      let decryptedKey: string;

      try {
        const result = await invoke<string>('decrypt_data', { encryptedData: key.key });
        if (result && !result.startsWith('{"nonce":')) {
          decryptedKey = result;
        } else {
          console.warn('解密失败，保留加密格式');
          decryptedKey = key.key;
        }
      } catch (error) {
        console.error('解密异常:', error);
        decryptedKey = key.key;
      }

      return {
        id: key.id,
        providerId: key.providerId,
        key: decryptedKey,
        name: key.name,
        note: key.note,
        expiresAt: toISOString(key.expiresAt),
        createdAt: toISOString(key.createdAt) || new Date().toISOString(),
        updatedAt: toISOString(key.updatedAt) || new Date().toISOString(),
      };
    }),
  );

  const data: ExportData = {
    version: '2.1.0',
    exportedAt: new Date().toISOString(),
    providers,
    apiKeys: exportKeys,
    gatewayConfig,
    gatewayConfigProfiles,
    activeGatewayConfigProfileId,
  };

  const fileName = `keeyper-backup-${new Date().toISOString().split('T')[0]}.json`;
  await saveJsonFile(fileName, data);
}

/**
 * 导出 Claude Code 网关配置（gateway.config.json）
 */
export async function exportGatewayConfigFile(): Promise<void> {
  const { gatewayConfig, providers, apiKeys } = useStore.getState();
  const runtimeConfig = await buildGatewayRuntimeConfig(gatewayConfig, providers, apiKeys);
  await saveJsonFile('gateway.config.json', runtimeConfig);
}

/**
 * 导入数据
 */
export async function importData(file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async (event) => {
      try {
        const content = String(event.target?.result || '');
        const data = JSON.parse(content) as ExportData;

        const providers = data.providers ?? data.services;
        if (!data.version || !Array.isArray(providers) || !Array.isArray(data.apiKeys)) {
          throw new Error('invalidFile');
        }

        const { providers: existingProviders, apiKeys: existingKeys } = useStore.getState();

        const providersMap = new Map<string, Provider>();
        existingProviders.forEach((provider) => providersMap.set(provider.id, provider));
        providers.forEach((provider) => providersMap.set(provider.id, provider));
        const mergedProviders = Array.from(providersMap.values());
        const providerIds = new Set(mergedProviders.map((provider) => provider.id));

        const keysMap = new Map<string, ApiKey>();
        existingKeys.forEach((key) => keysMap.set(key.id, key));

        const importedKeys = await Promise.all(
          data.apiKeys.map(async (rawKey) => {
            const sourceProviderId = rawKey.providerId ?? rawKey.serviceId;
            if (!sourceProviderId || !providerIds.has(sourceProviderId)) {
              return null;
            }

            const encryptedKey = await encryptApiKey(rawKey.key);
            const createdAt = parseDate(rawKey.createdAt);
            const updatedAt = parseDate(rawKey.updatedAt);
            const expiresAt = rawKey.expiresAt ? parseDate(rawKey.expiresAt) : undefined;

            return {
              id: rawKey.id ?? generateId(),
              providerId: sourceProviderId,
              key: encryptedKey,
              name: rawKey.name,
              note: rawKey.note,
              expiresAt,
              createdAt,
              updatedAt,
              models: [],
            } as ApiKey;
          }),
        );

        importedKeys
          .filter((key): key is ApiKey => key !== null)
          .forEach((key) => {
            keysMap.set(key.id, key);
          });

        const mergedKeys = Array.from(keysMap.values());
        useStore.getState().importData(
          mergedProviders,
          mergedKeys,
          data.gatewayConfig,
          data.gatewayConfigProfiles,
          data.activeGatewayConfigProfileId ?? null,
        );
        resolve();
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(new Error('invalidFile'));
    reader.readAsText(file);
  });
}
