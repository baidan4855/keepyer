/**
 * 本地存储工具
 */

const STORAGE_KEYS = {
  PROVIDERS: 'keeyper_providers',
  API_KEYS: 'keeyper_api_keys',
};

/**
 * 从 localStorage 获取数据
 */
export function getStorageData<T>(key: string, defaultValue: T): T {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item, dateReviver) : defaultValue;
  } catch (error) {
    console.error(`Error reading ${key} from storage:`, error);
    return defaultValue;
  }
}

/**
 * 保存数据到 localStorage
 */
export function setStorageData<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Error writing ${key} to storage:`, error);
  }
}

/**
 * JSON 日期反序列化器
 */
function dateReviver(key: string, value: unknown): unknown {
  const dateFields = ['createdAt', 'updatedAt', 'expiresAt'];
  if (dateFields.includes(key) && typeof value === 'string') {
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }
  return value;
}
