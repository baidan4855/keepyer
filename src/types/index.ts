/**
 * 提供方模型
 */
export type ApiProviderType = 'openai' | 'claude' | 'generic' | 'codex';

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiType?: ApiProviderType;
  systemPrompt?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * API 模型信息
 */
export interface ApiModel {
  id: string;
  name: string;
  owned_by?: string;
  task_type?: string | string[];
  input_modalities?: string[];
  output_modalities?: string[];
  token_limits?: {
    context_window?: number;
    max_input_token_length?: number;
    max_output_token_length?: number;
    max_reasoning_token_length?: number;
  };
  domain?: string;
  version?: string;
  created?: number;
}

/**
 * API Key 模型
 */
export interface ApiKey {
  id: string;
  providerId: string;
  key: string;
  name?: string;
  note?: string;
  expiresAt?: Date;
  models?: ApiModel[];
  modelsUpdatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 密钥状态
 */
export type KeyStatus = 'valid' | 'expired' | 'expiring-soon';

/**
 * 带状态信息的 API Key
 */
export interface ApiKeyWithStatus extends ApiKey {
  status: KeyStatus;
  daysUntilExpiry?: number;
}

/**
 * 提供方详情（包含关联的 Keys）
 */
export interface ProviderWithKeys extends Provider {
  keys: ApiKeyWithStatus[];
  validCount: number;
  expiredCount: number;
}

/**
 * 添加提供方表单数据
 */
export interface AddProviderForm {
  name: string;
  baseUrl: string;
  apiType?: ApiProviderType;
  systemPrompt?: string;
}

/**
 * 添加 API Key 表单数据
 */
export interface AddKeyForm {
  key: string;
  name?: string;
  note?: string;
  expiresAt?: Date;
}

/**
 * 安全设置
 */
export interface SecuritySettings {
  requireAuthToView: boolean;
  requireAuthToCopy: boolean;
}

/**
 * Claude Code 网关路由协议
 */
export type GatewayRouteProtocol = 'anthropic' | 'openai' | 'codex';

/**
 * Claude Code 网关路由配置
 */
export interface GatewayRouteConfig {
  protocol: GatewayRouteProtocol;
  baseUrl: string;
  apiKey: string;
  anthropicVersion?: string;
}

/**
 * Claude Code 模型映射配置
 */
export interface GatewayModelMapping {
  providerId: string;
  keyId: string;
  targetModel: string;
}

/**
 * Claude Code 网关配置
 */
export interface ClaudeGatewayConfig {
  listenHost: string;
  listenPort: number;
  gatewayToken: string;
  requestLog: boolean;
  modelMappings: Record<string, GatewayModelMapping>;
}

/**
 * Claude Code 网关配置方案
 */
export interface GatewayConfigProfile {
  id: string;
  name: string;
  config: ClaudeGatewayConfig;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 模型测试结果
 */
export interface ModelTestResult {
  status: 'idle' | 'loading' | 'success' | 'error';
  message?: string;
  response?: string;
  error?: string;
  timestamp?: number;
  httpStatus?: number;
  responseHeaders?: Record<string, string>;
  rawResponse?: string;
  responsePayload?: unknown;
  responseId?: string;
  responseModel?: string;
  stopReason?: string;
  usage?: Record<string, unknown>;
  retryCount?: number;
}

/**
 * Token 使用统计
 */
export interface TokenUsageStats {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requestCount: number;
  updatedAt: number;
}

/**
 * 实时 Token 增量（仅内存态，不持久化）
 */
export interface LiveTokenUsageDelta {
  providerId: string;
  keyId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  updatedAt: number;
}

/**
 * 进行中的测试任务
 */
export interface PendingModelTest {
  keyId: string;
  modelId: string;
  abortController: AbortController;
}

/**
 * 应用状态
 */
export interface AppState {
  activePage: 'providers' | 'gateway';
  providers: Provider[];
  apiKeys: ApiKey[];
  selectedProviderId: string | null;
  isAddProviderModalOpen: boolean;
  editProviderId: string | null;
  isAddKeyModalOpen: boolean;
  editKeyId: string | null;
  isDeleteConfirmOpen: boolean;
  deleteTarget: { type: 'provider' | 'key'; id: string } | null;
  copiedItem: { type: 'key' | 'url'; id: string } | null;
  isModelsModalOpen: boolean;
  modelsModalKeyId: string | null;
  isDebugChatOpen: boolean;
  debugChatKeyId: string | null;
  securitySettings: SecuritySettings;
  isAuthModalOpen: boolean;
  isPasswordSetupOpen: boolean;
  isSettingsOpen: boolean;
  authAction: 'view' | 'copy' | 'edit' | 'delete' | null;
  pendingAuthKeyId: string | null;
  lastAuthTime: number | null;
  modelTestResults: Record<string, ModelTestResult>;
  modelTokenUsage: Record<string, TokenUsageStats>;
  keyTokenUsage: Record<string, TokenUsageStats>;
  providerTokenUsage: Record<string, TokenUsageStats>;
  liveModelTokenUsage: Record<string, LiveTokenUsageDelta>;
  gatewayConfigProfiles: GatewayConfigProfile[];
  activeGatewayConfigProfileId: string | null;
  gatewayConfig: ClaudeGatewayConfig;
}
