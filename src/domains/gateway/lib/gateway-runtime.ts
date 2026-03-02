import { invoke } from '@tauri-apps/api/core';
import type { GatewayRuntimeConfigFile } from './config-builder';

export interface GatewayUsageEvent {
  id: number;
  timestamp: number;
  providerId: string;
  keyId: string;
  modelId: string;
  sourceModel: string;
  targetModel: string;
  route: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requestCount: number;
}

export interface GatewayProcessStatus {
  running: boolean;
  pid?: number;
  startedAt?: number;
  listenHost?: string;
  listenPort?: number;
  configPath?: string;
  logs: string[];
  usageEvents?: GatewayUsageEvent[];
  lastError?: string;
  lastExitCode?: number;
  lastExitAt?: number;
}

export async function startGatewayProcess(
  runtimeConfig: GatewayRuntimeConfigFile,
): Promise<GatewayProcessStatus> {
  return invoke<GatewayProcessStatus>('start_gateway_process', {
    configContent: JSON.stringify(runtimeConfig),
    listenHost: runtimeConfig.listen.host,
    listenPort: runtimeConfig.listen.port,
  });
}

export async function stopGatewayProcess(): Promise<GatewayProcessStatus> {
  return invoke<GatewayProcessStatus>('stop_gateway_process');
}

export async function getGatewayProcessStatus(): Promise<GatewayProcessStatus> {
  return invoke<GatewayProcessStatus>('get_gateway_process_status');
}
