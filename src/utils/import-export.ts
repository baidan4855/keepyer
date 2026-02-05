/**
 * 导入导出工具
 */

import type { Provider, ApiKey } from '@/types';
import { useStore } from '@/store';
import { encryptApiKey } from './secure-storage';
import { generateId } from './helpers';

/**
 * 导出数据格式
 */
export interface ExportData {
  version: string;
  exportedAt: string;
  providers?: Provider[];
  services?: Provider[]; // legacy
  apiKeys: Array<{
    id?: string;
    providerId?: string;
    serviceId?: string; // legacy
    key: string; // 已加密的密钥
    name?: string;
    note?: string;
    expiresAt?: string;
    createdAt: string;
    updatedAt: string;
  }>;
}

/**
 * 导出数据
 */
export async function exportData(): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  const { providers, apiKeys } = useStore.getState();

  // 辅助函数：将日期转换为 ISO 字符串
  const toISOString = (date: Date | string | undefined): string | undefined => {
    if (!date) return undefined;
    if (typeof date === 'string') return date;
    return date.toISOString();
  };

  // 解密并导出密钥数据
  const exportKeys = await Promise.all(apiKeys.map(async (key) => {
    let decryptedKey: string;

    try {
      // 尝试解密
      const result = await invoke<string>('decrypt_data', { encryptedData: key.key });

      // 检查解密是否成功（结果不应是加密数据格式）
      if (result && !result.startsWith('{"nonce":')) {
        decryptedKey = result;
      } else {
        // 解密失败，使用原始密钥（虽然仍是加密格式）
        console.warn('解密失败，保留加密格式');
        decryptedKey = key.key;
      }
    } catch (error) {
      console.error('解密异常:', error);
      // 解密失败时使用原始密钥
      decryptedKey = key.key;
    }

    return {
      id: key.id,
      providerId: key.providerId,
      serviceId: key.providerId, // legacy
      key: decryptedKey,
      name: key.name,
      note: key.note,
      expiresAt: toISOString(key.expiresAt),
      createdAt: toISOString(key.createdAt),
      updatedAt: toISOString(key.updatedAt),
    };
  }));

  const data: ExportData = {
    version: '2.0.0',
    exportedAt: new Date().toISOString(),
    providers,
    services: providers, // legacy
    apiKeys: exportKeys,
  };

  const fileName = `keeyper-backup-${new Date().toISOString().split('T')[0]}.json`;
  const content = JSON.stringify(data, null, 2);

  // 使用 Tauri 命令保存文件
  await invoke('save_file', { fileName, content });
}

/**
 * 导入数据
 */
export async function importData(file: File): Promise<void> {
  return new Promise(async (resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const content = e.target?.result as string;
        const data = JSON.parse(content) as ExportData;

        // 验证数据格式
        const providers = data.providers ?? data.services;
        if (!data.version || !providers || !Array.isArray(data.apiKeys)) {
          throw new Error('invalidFile');
        }

        // 获取现有数据（从 store）
        const { providers: existingProviders, apiKeys: existingKeys } = useStore.getState();

        // 合并提供方（使用 Map 根据 ID 去重）
        const providersMap = new Map<string, Provider>();
        existingProviders.forEach((p) => providersMap.set(p.id, p));
        providers.forEach((p) => providersMap.set(p.id, p));
        const mergedProviders = Array.from(providersMap.values());

        // 加密并合并密钥（使用 Map 根据 ID 去重）
        const keysMap = new Map<string, ApiKey>();
        existingKeys.forEach((k) => keysMap.set(k.id, k));

        // 并行加密所有导入的密钥
        const importKeys = await Promise.all(data.apiKeys.map(async (k) => {
          // 加密明文密钥
          const encryptedKey = await encryptApiKey(k.key);

          return {
            id: k.id ?? generateId(),
            providerId: k.providerId ?? k.serviceId,
            key: encryptedKey, // 存储加密后的密钥
            name: k.name,
            note: k.note,
            expiresAt: k.expiresAt ? new Date(k.expiresAt) : undefined,
            createdAt: new Date(k.createdAt),
            updatedAt: new Date(k.updatedAt),
            // 不导入模型列表和测试结果
            models: [],
            testResult: undefined,
          };
        }));

        importKeys.forEach((k) => keysMap.set(k.id, k));
        const mergedKeys = Array.from(keysMap.values());

        // 使用 store 更新数据（会自动持久化到 localStorage）
        useStore.getState().importData(mergedProviders, mergedKeys);

        resolve();
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(new Error('invalidFile'));
    reader.readAsText(file);
  });
}
