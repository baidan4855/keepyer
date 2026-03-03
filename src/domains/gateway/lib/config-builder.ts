import { decryptApiKey } from '@/domains/settings/lib/secure-storage';
import type {
  ApiKey,
  ClaudeGatewayConfig,
  GatewayRouteProtocol,
  Provider,
} from '@/types';

export interface GatewayRuntimeRouteConfig {
  protocol: GatewayRouteProtocol;
  baseUrl: string;
  apiKey: string;
  providerId?: string;
  keyId?: string;
  anthropicVersion?: string;
}

export interface GatewayRuntimeProxyConfig {
  enabled: boolean;
  url: string;
}

export interface GatewayRuntimeConfigFile {
  gatewayToken: string;
  listen: {
    host: string;
    port: number;
  };
  proxy: GatewayRuntimeProxyConfig;
  defaultRoute: string;
  requestLog: boolean;
  routes: Record<string, GatewayRuntimeRouteConfig>;
  modelMappings: Record<string, { route: string; targetModel: string }>;
}

function toRouteName(provider: Provider, apiKey: ApiKey, usedNames: Set<string>): string {
  const providerPart = (provider.name || 'provider').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const keyPart = (apiKey.name || apiKey.id || 'key').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const base = `${providerPart || 'provider'}-${keyPart || 'key'}`.slice(0, 48);
  if (!usedNames.has(base)) {
    usedNames.add(base);
    return base;
  }

  let index = 1;
  while (usedNames.has(`${base}-${index}`)) {
    index += 1;
  }
  const name = `${base}-${index}`;
  usedNames.add(name);
  return name;
}

function resolveProtocol(provider: Provider): GatewayRouteProtocol {
  if (provider.apiType === 'claude') return 'anthropic';
  if (provider.apiType === 'codex') return 'codex';
  return 'openai';
}

export async function buildGatewayRuntimeConfig(
  gatewayConfig: ClaudeGatewayConfig,
  providers: Provider[],
  apiKeys: ApiKey[],
): Promise<GatewayRuntimeConfigFile> {
  const proxyEnabled = gatewayConfig.proxyEnabled === true;
  const proxyUrl = typeof gatewayConfig.proxyUrl === 'string'
    ? gatewayConfig.proxyUrl.trim()
    : '';
  const providerMap = new Map(providers.map((provider) => [provider.id, provider]));
  const keyMap = new Map(apiKeys.map((key) => [key.id, key]));
  const routeIdToName = new Map<string, string>();
  const routeNames = new Set<string>();
  const runtimeRoutes: Record<string, GatewayRuntimeRouteConfig> = {};
  const runtimeMappings: Record<string, { route: string; targetModel: string }> = {};

  for (const [sourceModelRaw, mapping] of Object.entries(gatewayConfig.modelMappings)) {
    const sourceModel = sourceModelRaw.trim();
    if (!sourceModel) continue;

    if (!mapping.providerId) {
      throw new Error(`Mapping "${sourceModel}" missing provider`);
    }
    if (!mapping.keyId) {
      throw new Error(`Mapping "${sourceModel}" missing API key`);
    }

    const provider = providerMap.get(mapping.providerId);
    if (!provider) {
      throw new Error(`Mapping "${sourceModel}" provider not found`);
    }

    const apiKey = keyMap.get(mapping.keyId);
    if (!apiKey || apiKey.providerId !== provider.id) {
      throw new Error(`Mapping "${sourceModel}" API key not found for selected provider`);
    }

    const routeId = `${provider.id}::${apiKey.id}`;
    let routeName = routeIdToName.get(routeId);

    if (!routeName) {
      routeName = toRouteName(provider, apiKey, routeNames);
      routeIdToName.set(routeId, routeName);

      const decryptedApiKey = (await decryptApiKey(apiKey.key)).trim();
      if (!decryptedApiKey) {
        throw new Error(`Route key for "${sourceModel}" is empty`);
      }

      const protocol = resolveProtocol(provider);
      runtimeRoutes[routeName] = {
        protocol,
        baseUrl: provider.baseUrl.trim(),
        apiKey: decryptedApiKey,
        providerId: provider.id,
        keyId: apiKey.id,
        ...(protocol === 'anthropic' ? { anthropicVersion: '2023-06-01' } : {}),
      };
    }

    runtimeMappings[sourceModel] = {
      route: routeName,
      targetModel: mapping.targetModel?.trim() || sourceModel,
    };
  }

  const availableRoutes = Object.keys(runtimeRoutes);
  if (!availableRoutes.length) {
    throw new Error('No valid gateway mappings configured');
  }

  const wildcardRoute = runtimeMappings['*']?.route;
  const defaultRoute = wildcardRoute && runtimeRoutes[wildcardRoute]
    ? wildcardRoute
    : availableRoutes[0];

  return {
    gatewayToken: gatewayConfig.gatewayToken.trim(),
    listen: {
      host: gatewayConfig.listenHost.trim() || '127.0.0.1',
      port: Number.isFinite(gatewayConfig.listenPort) && gatewayConfig.listenPort > 0
        ? Math.floor(gatewayConfig.listenPort)
        : 8787,
    },
    proxy: {
      enabled: proxyEnabled,
      url: proxyUrl,
    },
    defaultRoute,
    requestLog: gatewayConfig.requestLog !== false,
    routes: runtimeRoutes,
    modelMappings: runtimeMappings,
  };
}
