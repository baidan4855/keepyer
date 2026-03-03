import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  ChevronDown,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Square,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStore } from "@/store";
import type {
  ApiKey,
  ClaudeGatewayConfig,
  GatewayModelMapping,
  Provider,
} from "@/types";
import { buildGatewayRuntimeConfig } from "@/domains/gateway/lib/config-builder";
import {
  getGatewayProcessStatus,
  startGatewayProcess,
  stopGatewayProcess,
  type GatewayProcessStatus,
  type GatewayProxyTestResult,
  testGatewayProxy,
} from "@/domains/gateway/lib/gateway-runtime";
import { toast } from "@/shared/lib/toast";
import { cn } from "@/shared/lib/cn";

type GatewayTab = "config" | "logs";

function cloneGatewayConfig(config: ClaudeGatewayConfig): ClaudeGatewayConfig {
  const modelMappings: Record<string, GatewayModelMapping> = {};
  Object.entries(config.modelMappings || {}).forEach(([name, mapping]) => {
    modelMappings[name] = { ...mapping };
  });

  const listenHost =
    typeof config.listenHost === "string" ? config.listenHost : "127.0.0.1";
  const listenPort =
    Number.isFinite(config.listenPort) && config.listenPort > 0
      ? Math.floor(config.listenPort)
      : 8787;
  const gatewayToken =
    typeof config.gatewayToken === "string" ? config.gatewayToken : "";
  const proxyEnabled = config.proxyEnabled === true;
  const proxyUrl = typeof config.proxyUrl === "string" ? config.proxyUrl : "";
  const requestLog = config.requestLog !== false;

  return {
    ...config,
    listenHost,
    listenPort,
    gatewayToken,
    proxyEnabled,
    proxyUrl,
    requestLog,
    modelMappings,
  };
}

function gatewayConfigSignature(config: ClaudeGatewayConfig): string {
  const sortedMappings = Object.entries(config.modelMappings)
    .sort(([a], [b]) => a.localeCompare(b))
    .reduce<Record<string, GatewayModelMapping>>((acc, [sourceModel, mapping]) => {
      acc[sourceModel] = {
        providerId: mapping.providerId,
        keyId: mapping.keyId,
        targetModel: mapping.targetModel,
      };
      return acc;
    }, {});

  return JSON.stringify({
    listenHost:
      typeof config.listenHost === "string" ? config.listenHost.trim() : "",
    listenPort:
      Number.isFinite(config.listenPort) && config.listenPort > 0
        ? Math.floor(config.listenPort)
        : 8787,
    gatewayToken:
      typeof config.gatewayToken === "string" ? config.gatewayToken : "",
    proxyEnabled: config.proxyEnabled === true,
    proxyUrl: typeof config.proxyUrl === "string" ? config.proxyUrl.trim() : "",
    requestLog: config.requestLog !== false,
    modelMappings: sortedMappings,
  });
}

function buildUniqueName(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  let index = 1;
  while (existing.has(`${base}-${index}`)) {
    index += 1;
  }
  return `${base}-${index}`;
}

function firstAvailableProviderWithKey(
  providers: Provider[],
  apiKeys: ApiKey[],
): { providerId: string; keyId: string } {
  const provider =
    providers.find((item) =>
      apiKeys.some((key) => key.providerId === item.id),
    ) || providers[0];
  if (!provider) {
    return { providerId: "", keyId: "" };
  }
  const key = apiKeys.find((item) => item.providerId === provider.id);
  return {
    providerId: provider.id,
    keyId: key?.id || "",
  };
}

function keysOfProvider(apiKeys: ApiKey[], providerId: string): ApiKey[] {
  return apiKeys.filter((key) => key.providerId === providerId);
}

function modelOptionsForKey(
  apiKeys: ApiKey[],
  keyId: string,
): Array<{ id: string; name: string }> {
  const key = apiKeys.find((item) => item.id === keyId);
  return (key?.models || []).map((model) => ({
    id: model.id,
    name: model.name || model.id,
  }));
}

function resolveProxyTestUrl(
  config: ClaudeGatewayConfig,
  providers: Provider[],
): string {
  const providerMap = new Map(providers.map((provider) => [provider.id, provider]));
  for (const mapping of Object.values(config.modelMappings)) {
    const baseUrl = providerMap.get(mapping.providerId)?.baseUrl?.trim() || "";
    if (baseUrl) {
      return baseUrl;
    }
  }
  return "https://api.openai.com/v1/models";
}

type SelectOption = {
  value: string;
  label: string;
  description?: string;
};

const COMMON_CLAUDE_SOURCE_MODELS = [
  "claude-opus-4-6",
  "claude-opus-4-6-latest",
  "claude-sonnet-4-6",
  "claude-sonnet-4-6-latest",
  "claude-opus-4-5",
  "claude-opus-4-5-latest",
  "claude-sonnet-4-5",
  "claude-sonnet-4-5-latest",
  "claude-opus-4-1-20250805",
  "claude-opus-4-20250514",
  "claude-sonnet-4-20250514",
  "claude-3-7-sonnet-latest",
  "claude-3-7-sonnet-20250219",
  "claude-3-5-sonnet-latest",
  "claude-3-5-haiku-latest",
  "claude-3-5-sonnet-20241022",
  "claude-3-5-haiku-20241022",
  "claude-3-opus-20240229",
  "claude-3-sonnet-20240229",
  "claude-3-haiku-20240307",
  "*",
];

function dedupeOptions(options: SelectOption[]): SelectOption[] {
  const seen = new Set<string>();
  const result: SelectOption[] = [];
  for (const option of options) {
    const normalized = option.value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push({ ...option, value: normalized });
  }
  return result;
}

function SearchableSelect({
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
  noResultsText,
  disabled,
  allowCustom = false,
  customPrefix,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder: string;
  searchPlaceholder: string;
  noResultsText: string;
  disabled?: boolean;
  allowCustom?: boolean;
  customPrefix?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selected = options.find((option) => option.value === value) || null;

  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return options;
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(normalized) ||
        option.value.toLowerCase().includes(normalized) ||
        option.description?.toLowerCase().includes(normalized),
    );
  }, [options, query]);

  const customValue = query.trim();
  const canUseCustom =
    allowCustom &&
    customValue.length > 0 &&
    !options.some(
      (option) => option.value.toLowerCase() === customValue.toLowerCase(),
    );

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const handleSelect = (nextValue: string) => {
    onChange(nextValue.trim());
    setIsOpen(false);
    setQuery("");
  };

  return (
    <div className="relative min-w-0" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        disabled={disabled}
        className={cn(
          "w-full h-10 py-2.5 px-3 rounded-xl text-left text-sm",
          "bg-white border border-slate-200 text-slate-800",
          "transition-all duration-200",
          "focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500",
          "flex items-center justify-between",
          disabled && "bg-slate-100 text-slate-400 cursor-not-allowed",
        )}
      >
        <span
          className={cn(
            "truncate pr-2",
            !selected?.label && !value && "text-slate-400",
          )}
        >
          {selected?.label || value || placeholder}
        </span>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-slate-400 transition-transform",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {isOpen && !disabled ? (
        <div className="absolute z-50 w-full mt-1.5 p-2 bg-white rounded-2xl shadow-soft-lg border border-primary-100/50 animate-scale-in">
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                if (canUseCustom) {
                  handleSelect(customValue);
                } else if (filteredOptions[0]) {
                  handleSelect(filteredOptions[0].value);
                }
              }}
              placeholder={searchPlaceholder}
              className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
            />
          </div>

          <div className="max-h-56 overflow-y-auto space-y-1">
            {canUseCustom ? (
              <button
                type="button"
                onClick={() => handleSelect(customValue)}
                className="w-full px-3 py-2 rounded-lg text-left text-xs transition-all duration-150 bg-primary-50 text-primary-700 hover:bg-primary-100"
              >
                <div className="truncate">{`${customPrefix || "Use custom value"}: ${customValue}`}</div>
              </button>
            ) : null}

            {filteredOptions.length === 0 ? (
              <p className="text-xs text-slate-400 px-2 py-2">
                {noResultsText}
              </p>
            ) : (
              filteredOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleSelect(option.value)}
                  className={cn(
                    "w-full px-3 py-2 rounded-lg text-left text-xs transition-all duration-150",
                    "hover:bg-primary-50",
                    value === option.value
                      ? "bg-primary-100 text-primary-700 font-medium"
                      : "text-slate-700",
                  )}
                >
                  <div className="truncate">{option.label}</div>
                  {option.description || option.label !== option.value ? (
                    <div className="truncate text-[10px] text-slate-400">
                      {option.description || option.value}
                    </div>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const EMPTY_STATUS: GatewayProcessStatus = {
  running: false,
  logs: [],
};

export default function GatewayDashboard() {
  const { t } = useTranslation();
  const {
    providers,
    apiKeys,
    gatewayConfig,
    gatewayConfigProfiles,
    activeGatewayConfigProfileId,
    setGatewayConfig,
    resetGatewayConfig,
    createGatewayConfigProfile,
    renameGatewayConfigProfile,
    deleteGatewayConfigProfile,
    setActiveGatewayConfigProfile,
  } = useStore();
  const [activeTab, setActiveTab] = useState<GatewayTab>("config");
  const [draft, setDraft] = useState<ClaudeGatewayConfig>(() =>
    cloneGatewayConfig(gatewayConfig),
  );
  const [profileNameInput, setProfileNameInput] = useState("");
  const [status, setStatus] = useState<GatewayProcessStatus>(EMPTY_STATUS);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isTestingProxy, setIsTestingProxy] = useState(false);
  const [proxyTestResult, setProxyTestResult] =
    useState<GatewayProxyTestResult | null>(null);
  const activeProfile = useMemo(
    () =>
      gatewayConfigProfiles.find(
        (profile) => profile.id === activeGatewayConfigProfileId,
      ) ||
      gatewayConfigProfiles[0] ||
      null,
    [gatewayConfigProfiles, activeGatewayConfigProfileId],
  );
  const hasUnsavedChanges = useMemo(
    () => gatewayConfigSignature(draft) !== gatewayConfigSignature(gatewayConfig),
    [draft, gatewayConfig],
  );
  const profileOptions = useMemo(
    () =>
      gatewayConfigProfiles.map((profile) => ({
        value: profile.id,
        label: profile.name,
      })),
    [gatewayConfigProfiles],
  );

  useEffect(() => {
    setDraft(cloneGatewayConfig(gatewayConfig));
  }, [gatewayConfig]);

  useEffect(() => {
    setProfileNameInput(activeProfile?.name || "");
  }, [activeProfile?.id, activeProfile?.name]);

  const refreshStatus = async () => {
    try {
      setStatus(await getGatewayProcessStatus());
    } catch (error) {
      console.error("刷新网关状态失败:", error);
    }
  };

  useEffect(() => {
    void refreshStatus();
    const timer = window.setInterval(() => void refreshStatus(), 3000);
    return () => window.clearInterval(timer);
  }, []);

  const handleSaveConfig = () => {
    setGatewayConfig(draft);
    toast.success(t("gateway.configSaved") || "网关配置已保存");
  };

  const handleResetConfig = () => {
    resetGatewayConfig();
    const latest = useStore.getState().gatewayConfig;
    setDraft(cloneGatewayConfig(latest));
    toast.success(t("gateway.configReset") || "网关配置已重置");
  };

  const handleSwitchProfile = (profileId: string) => {
    const nextProfileId = profileId.trim();
    if (!nextProfileId || nextProfileId === activeGatewayConfigProfileId) return;
    if (hasUnsavedChanges) {
      const confirmed = window.confirm(
        t("gateway.profileSwitchConfirm") ||
          "当前有未保存修改，切换方案将丢失这些修改，是否继续？",
      );
      if (!confirmed) return;
    }
    setActiveGatewayConfigProfile(nextProfileId);
  };

  const handleCreateProfile = () => {
    createGatewayConfigProfile(undefined, draft);
    toast.success(t("gateway.profileCreated") || "已创建新配置方案");
  };

  const handleRenameProfile = () => {
    if (!activeProfile) return;
    const name = profileNameInput.trim();
    if (!name) {
      setProfileNameInput(activeProfile.name);
      return;
    }
    if (name === activeProfile.name) return;
    renameGatewayConfigProfile(activeProfile.id, name);
    const latestName =
      useStore
        .getState()
        .gatewayConfigProfiles.find((profile) => profile.id === activeProfile.id)
        ?.name || name;
    setProfileNameInput(latestName);
    toast.success(t("gateway.profileRenamed") || "配置方案已重命名");
  };

  const handleDeleteProfile = () => {
    if (gatewayConfigProfiles.length <= 1) {
      toast.error(t("gateway.profileDeleteBlocked") || "至少保留一个配置方案");
      return;
    }
    if (!activeProfile) return;
    const confirmed = window.confirm(
      t("gateway.profileDeleteConfirm") || "确认删除当前配置方案吗？",
    );
    if (!confirmed) return;
    deleteGatewayConfigProfile(activeProfile.id);
    toast.success(t("gateway.profileDeleted") || "已删除配置方案");
  };

  const handleAddMapping = () => {
    setDraft((prev) => {
      const existing = new Set(Object.keys(prev.modelMappings));
      const sourceModel = buildUniqueName("claude-model", existing);
      const seed = firstAvailableProviderWithKey(providers, apiKeys);

      return {
        ...prev,
        modelMappings: {
          ...prev.modelMappings,
          [sourceModel]: {
            providerId: seed.providerId,
            keyId: seed.keyId,
            targetModel: sourceModel,
          },
        },
      };
    });
  };

  const handleRenameMapping = (oldName: string, newNameRaw: string) => {
    const newName = newNameRaw.trim();
    if (!newName || newName === oldName) return;

    setDraft((prev) => {
      if (!prev.modelMappings[oldName] || prev.modelMappings[newName])
        return prev;
      const nextMappings: Record<string, GatewayModelMapping> = {};
      Object.entries(prev.modelMappings).forEach(([name, mapping]) => {
        nextMappings[name === oldName ? newName : name] = mapping;
      });
      return {
        ...prev,
        modelMappings: nextMappings,
      };
    });
  };

  const handleUpdateMapping = (
    sourceModel: string,
    updates: Partial<GatewayModelMapping>,
  ) => {
    setDraft((prev) => {
      const mapping = prev.modelMappings[sourceModel];
      if (!mapping) return prev;
      return {
        ...prev,
        modelMappings: {
          ...prev.modelMappings,
          [sourceModel]: {
            ...mapping,
            ...updates,
          },
        },
      };
    });
  };

  const handleRemoveMapping = (sourceModel: string) => {
    setDraft((prev) => {
      const nextMappings = { ...prev.modelMappings };
      delete nextMappings[sourceModel];
      return {
        ...prev,
        modelMappings: nextMappings,
      };
    });
  };

  const handleStart = async () => {
    setIsStarting(true);
    try {
      const runtimeConfig = await buildGatewayRuntimeConfig(
        draft,
        providers,
        apiKeys,
      );
      setGatewayConfig(draft);
      setStatus(await startGatewayProcess(runtimeConfig));
      toast.success(t("gateway.startSuccess") || "网关已启动");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message || t("gateway.startFailed") || "网关启动失败");
    } finally {
      setIsStarting(false);
    }
  };

  const handleTestProxyConnectivity = async () => {
    setIsTestingProxy(true);
    try {
      const testUrl = resolveProxyTestUrl(draft, providers);
      const result = await testGatewayProxy({
        proxyEnabled: draft.proxyEnabled === true,
        proxyUrl: typeof draft.proxyUrl === "string" ? draft.proxyUrl.trim() : "",
        testUrl,
        timeoutMs: 12000,
      });
      setProxyTestResult(result);
      if (result.ok) {
        toast.success(t("gateway.proxyTestSuccess") || "代理连通性测试通过");
      } else {
        const fallback =
          t("gateway.proxyTestFailed") || "代理连通性测试失败";
        toast.error(result.message ? `${fallback}: ${result.message}` : fallback);
      }
    } catch (error) {
      const fallback = t("gateway.proxyTestFailed") || "代理连通性测试失败";
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message ? `${fallback}: ${message}` : fallback);
    } finally {
      setIsTestingProxy(false);
    }
  };

  const handleStop = async () => {
    setIsStopping(true);
    try {
      setStatus(await stopGatewayProcess());
      toast.success(t("gateway.stopSuccess") || "网关已停止");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message || t("gateway.stopFailed") || "网关停止失败");
    } finally {
      setIsStopping(false);
    }
  };

  return (
    <main className="flex-1 flex flex-col overflow-hidden">
      <header className="px-6 py-4 bg-white/50 backdrop-blur-md border-b border-primary-100/50">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-primary-600" />
              <h2 className="text-xl font-bold text-slate-800">
                {t("gateway.title") || "LLM 代理网关"}
              </h2>
            </div>
            <p className="text-sm text-slate-500 mt-1">
              {t("gateway.subtitle") ||
                "将 Claude Code 模型映射到已配置 Provider 及其模型，并统一代理协议。"}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleStop}
              disabled={!status.running || isStopping}
              className="btn-secondary flex items-center gap-1.5 py-2 px-3"
            >
              <Square className="w-3.5 h-3.5" />
              {isStopping
                ? t("gateway.stopping") || "停止中..."
                : t("gateway.stop") || "停止"}
            </button>
            <button
              onClick={handleStart}
              disabled={status.running || isStarting}
              className="btn-primary flex items-center gap-1.5 py-2 px-3"
            >
              <Play className="w-3.5 h-3.5" />
              {isStarting
                ? t("gateway.starting") || "启动中..."
                : t("gateway.start") || "启动网关"}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-3 text-xs">
          <span
            className={`badge ${status.running ? "badge-success" : "badge-neutral"}`}
          >
            {status.running
              ? t("gateway.statusRunning") || "运行中"
              : t("gateway.statusStopped") || "已停止"}
          </span>
          <span className="text-slate-500 font-mono">
            {status.listenHost && status.listenPort
              ? `${status.listenHost}:${status.listenPort}`
              : `${draft.listenHost}:${draft.listenPort}`}
          </span>
          {status.pid ? (
            <span className="text-slate-400">PID: {status.pid}</span>
          ) : null}
          <button
            onClick={() => void refreshStatus()}
            className="p-1 rounded text-slate-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
            title={t("gateway.refreshStatus") || "刷新状态"}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="card p-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <button
              onClick={() => setActiveTab("config")}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${activeTab === "config" ? "bg-primary-100 text-primary-700" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {t("gateway.tabConfig") || "网关配置"}
            </button>
            <button
              onClick={() => setActiveTab("logs")}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${activeTab === "logs" ? "bg-primary-100 text-primary-700" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {t("gateway.tabLogs") || "网关运行日志"}
            </button>
          </div>

          {activeTab === "config" ? (
            <div className="pt-4 space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-800">
                    {t("gateway.profileSection") || "配置方案"}
                  </h3>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCreateProfile}
                      className="btn-secondary py-1.5 px-2.5 text-xs inline-flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {t("gateway.profileCreate") || "新建方案"}
                    </button>
                    <button
                      onClick={handleDeleteProfile}
                      className="btn-secondary py-1.5 px-2.5 text-xs inline-flex items-center gap-1 text-red-600"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {t("gateway.profileDelete") || "删除方案"}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)_auto] gap-3">
                  <div className="min-w-0">
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      {t("gateway.profileSelect") || "选择方案"}
                    </label>
                    <SearchableSelect
                      value={activeProfile?.id || ""}
                      onChange={handleSwitchProfile}
                      options={profileOptions}
                      placeholder={t("gateway.profileSelect") || "选择方案"}
                      searchPlaceholder={
                        t("gateway.profileSearch") || "搜索配置方案..."
                      }
                      noResultsText={
                        t("gateway.profileNoResults") || "未找到匹配方案"
                      }
                    />
                  </div>

                  <div className="min-w-0">
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      {t("gateway.profileName") || "方案名称"}
                    </label>
                    <input
                      type="text"
                      value={profileNameInput}
                      onChange={(event) => setProfileNameInput(event.target.value)}
                      onBlur={handleRenameProfile}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        handleRenameProfile();
                      }}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      className="input py-2.5 px-3 text-sm"
                      placeholder={
                        t("gateway.profileNamePlaceholder") || "输入方案名称"
                      }
                    />
                  </div>

                  <div className="flex items-end">
                    <button
                      onClick={handleRenameProfile}
                      className="btn-secondary py-2 px-3 text-xs"
                    >
                      {t("gateway.profileRename") || "重命名"}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800">
                  {t("gateway.configSection") || "网关配置"}
                </h3>
                <div className="flex items-center gap-2">
                  {hasUnsavedChanges ? (
                    <span className="text-xs text-amber-600">
                      {t("gateway.unsavedHint") ||
                        "当前存在未保存配置，启动前建议先保存。"}
                    </span>
                  ) : null}
                  <button
                    onClick={handleResetConfig}
                    className="btn-secondary py-1.5 px-2.5 text-xs"
                  >
                    {t("gateway.reset") || "重置"}
                  </button>
                  <button
                    onClick={handleSaveConfig}
                    className="btn-primary py-1.5 px-2.5 text-xs inline-flex items-center gap-1"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {t("gateway.saveConfig") || "保存配置"}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_140px_minmax(0,1.4fr)] gap-3">
                <div className="min-w-0">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {t("gateway.listenHost") || "监听地址"}
                  </label>
                  <input
                    type="text"
                    value={draft.listenHost}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        listenHost: event.target.value,
                      }))
                    }
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="input py-2.5 px-3 text-sm"
                    placeholder="127.0.0.1"
                  />
                </div>
                <div className="min-w-0">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {t("gateway.listenPort") || "监听端口"}
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={draft.listenPort}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        listenPort: Number(event.target.value) || 8787,
                      }))
                    }
                    className="input py-2.5 px-3 text-sm"
                    placeholder="8787"
                  />
                </div>
                <div className="min-w-0">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {t("gateway.gatewayToken") || "Gateway Token"}
                  </label>
                  <input
                    type="text"
                    value={draft.gatewayToken}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        gatewayToken: event.target.value,
                      }))
                    }
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="input py-2.5 px-3 text-sm font-mono"
                    placeholder={
                      t("gateway.gatewayTokenPlaceholder") ||
                      "供 Claude Code 使用"
                    }
                  />
                </div>
              </div>

              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={draft.requestLog}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      requestLog: event.target.checked,
                    }))
                  }
                  className="rounded border-slate-300 text-primary-600 focus:ring-primary-500/30"
                />
                {t("gateway.requestLog") || "启用请求日志"}
              </label>

              <div className="grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)_auto] gap-3">
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={draft.proxyEnabled === true}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        proxyEnabled: event.target.checked,
                      }))
                    }
                    className="rounded border-slate-300 text-primary-600 focus:ring-primary-500/30"
                  />
                  {t("gateway.proxyEnabled") || "使用代理"}
                </label>
                <div className="min-w-0">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {t("gateway.proxyUrl") || "代理地址"}
                  </label>
                  <input
                    type="text"
                    value={draft.proxyUrl}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        proxyUrl: event.target.value,
                      }))
                    }
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    disabled={!draft.proxyEnabled}
                    className={cn(
                      "input py-2.5 px-3 text-sm font-mono",
                      !draft.proxyEnabled && "opacity-60 cursor-not-allowed",
                    )}
                    placeholder={
                      t("gateway.proxyUrlPlaceholder") ||
                      "http://127.0.0.1:7890"
                    }
                  />
                </div>
                <div className="flex items-end">
                  <button
                    onClick={() => void handleTestProxyConnectivity()}
                    disabled={isTestingProxy}
                    className="btn-secondary py-2 px-3 text-xs inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <RefreshCw
                      className={cn(
                        "w-3.5 h-3.5",
                        isTestingProxy && "animate-spin",
                      )}
                    />
                    {isTestingProxy
                      ? t("gateway.proxyTesting") || "测试中..."
                      : t("gateway.testProxy") || "代理连通性测试"}
                  </button>
                </div>
              </div>
              {proxyTestResult ? (
                <div
                  className={cn(
                    "rounded-lg border px-3 py-2 text-xs space-y-1",
                    proxyTestResult.ok
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-rose-200 bg-rose-50 text-rose-700",
                  )}
                >
                  <div>
                    {(t("gateway.proxyTestResult") || "最近一次测试") + ": "}
                    {proxyTestResult.ok
                      ? t("gateway.proxyTestSuccess") || "代理连通性测试通过"
                      : t("gateway.proxyTestFailed") || "代理连通性测试失败"}
                    {` · via=${proxyTestResult.via} · ${proxyTestResult.durationMs}ms`}
                    {proxyTestResult.status
                      ? ` · HTTP ${proxyTestResult.status}`
                      : ""}
                  </div>
                  <div className="font-mono break-all">{proxyTestResult.url}</div>
                  {!proxyTestResult.ok && proxyTestResult.message ? (
                    <div className="break-all">{proxyTestResult.message}</div>
                  ) : null}
                </div>
              ) : null}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium text-slate-800">
                    {t("gateway.mappingsTitle") ||
                      "模型映射（Claude -> 上游模型）"}
                  </h4>
                  <button
                    onClick={handleAddMapping}
                    className="btn-secondary py-1.5 px-2.5 text-xs inline-flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {t("gateway.addMapping") || "新增映射"}
                  </button>
                </div>

                <div className="space-y-2">
                  {Object.entries(draft.modelMappings).map(
                    ([sourceModel, mapping]) => {
                      const providerKeys = mapping.providerId
                        ? keysOfProvider(apiKeys, mapping.providerId)
                        : [];
                      const providerOptions = dedupeOptions(
                        providers.map((provider) => ({
                          value: provider.id,
                          label: provider.name,
                          description: provider.baseUrl,
                        })),
                      );
                      const apiKeyOptions = dedupeOptions(
                        providerKeys.map((apiKey) => ({
                          value: apiKey.id,
                          label: apiKey.name || apiKey.id,
                          description:
                            apiKey.name && apiKey.name !== apiKey.id
                              ? apiKey.id
                              : undefined,
                        })),
                      );
                      const sourceModelOptions = dedupeOptions(
                        COMMON_CLAUDE_SOURCE_MODELS.map((modelId) => ({
                          value: modelId,
                          label: modelId,
                        })),
                      );
                      const targetOptions = dedupeOptions(
                        modelOptionsForKey(apiKeys, mapping.keyId).map(
                          (model) => ({
                            value: model.id,
                            label: model.name,
                            description:
                              model.name !== model.id ? model.id : undefined,
                          }),
                        ),
                      );

                      return (
                        <div
                          key={sourceModel}
                          className="p-3 rounded-xl border border-slate-200 bg-slate-50/40 grid grid-cols-1 md:grid-cols-[repeat(4,minmax(0,1fr))_auto] gap-2"
                        >
                          <div className="min-w-0">
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              {t("gateway.sourceModel") || "Claude 模型名"}
                            </label>
                            <SearchableSelect
                              value={sourceModel}
                              onChange={(nextSourceModel) =>
                                handleRenameMapping(
                                  sourceModel,
                                  nextSourceModel,
                                )
                              }
                              options={sourceModelOptions}
                              placeholder={
                                t("gateway.selectSourceModel") ||
                                "选择 Claude 模型名"
                              }
                              searchPlaceholder={
                                t("gateway.searchSourceModel") ||
                                "搜索或输入 Claude 模型名..."
                              }
                              noResultsText={
                                t("gateway.noModelResults") || "未找到匹配模型"
                              }
                              allowCustom
                              customPrefix={
                                t("gateway.useCustomValue") || "使用自定义值"
                              }
                            />
                          </div>
                          <div className="min-w-0">
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              {t("gateway.provider") || "Provider"}
                            </label>
                            <SearchableSelect
                              value={mapping.providerId}
                              onChange={(providerId) => {
                                const keys = keysOfProvider(
                                  apiKeys,
                                  providerId,
                                );
                                const nextKeyId = keys.some(
                                  (key) => key.id === mapping.keyId,
                                )
                                  ? mapping.keyId
                                  : keys[0]?.id || "";
                                const firstTargetModel =
                                  modelOptionsForKey(apiKeys, nextKeyId)[0]
                                    ?.id || "";
                                handleUpdateMapping(sourceModel, {
                                  providerId,
                                  keyId: nextKeyId,
                                  targetModel:
                                    mapping.targetModel.trim() ||
                                    firstTargetModel ||
                                    sourceModel,
                                });
                              }}
                              options={providerOptions}
                              placeholder={
                                t("gateway.selectProvider") || "请选择 Provider"
                              }
                              searchPlaceholder={
                                t("gateway.searchProvider") ||
                                "搜索 Provider..."
                              }
                              noResultsText={
                                t("gateway.noProviderResults") ||
                                "未找到匹配 Provider"
                              }
                            />
                          </div>
                          <div className="min-w-0">
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              {t("gateway.apiKey") || "API Key"}
                            </label>
                            <SearchableSelect
                              value={mapping.keyId}
                              onChange={(keyId) => {
                                const firstTargetModel =
                                  modelOptionsForKey(apiKeys, keyId)[0]?.id ||
                                  "";
                                handleUpdateMapping(sourceModel, {
                                  keyId,
                                  targetModel:
                                    mapping.targetModel.trim() ||
                                    firstTargetModel ||
                                    sourceModel,
                                });
                              }}
                              disabled={!mapping.providerId}
                              options={apiKeyOptions}
                              placeholder={
                                t("gateway.selectKey") || "请选择 Key"
                              }
                              searchPlaceholder={
                                t("gateway.searchKey") || "搜索 API Key..."
                              }
                              noResultsText={
                                t("gateway.noKeyResults") || "未找到匹配 Key"
                              }
                            />
                          </div>
                          <div className="min-w-0">
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              {t("gateway.targetModel") || "上游模型名"}
                            </label>
                            <SearchableSelect
                              value={mapping.targetModel}
                              onChange={(targetModel) =>
                                handleUpdateMapping(sourceModel, {
                                  targetModel,
                                })
                              }
                              options={targetOptions}
                              placeholder={
                                t("gateway.selectTargetModel") || "选择上游模型"
                              }
                              searchPlaceholder={
                                t("gateway.searchTargetModel") ||
                                "搜索或输入上游模型名..."
                              }
                              noResultsText={
                                t("gateway.noModelResults") || "未找到匹配模型"
                              }
                              allowCustom
                              customPrefix={
                                t("gateway.useCustomValue") || "使用自定义值"
                              }
                            />
                          </div>
                          <div className="flex items-end">
                            <button
                              onClick={() => handleRemoveMapping(sourceModel)}
                              className="p-2 rounded-lg text-red-600 hover:bg-red-100 transition-colors"
                              title={t("gateway.removeMapping") || "删除"}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    },
                  )}

                  {Object.keys(draft.modelMappings).length === 0 ? (
                    <p className="text-xs text-slate-500 p-3 bg-slate-50 rounded-lg border border-slate-200">
                      {t("gateway.noMappingHint") ||
                        "请先新增至少一个模型映射。"}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === "logs" ? (
            <div className="pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800">
                  {t("gateway.runtimeLogs") || "网关运行日志"}
                </h3>
                <button
                  onClick={() => void refreshStatus()}
                  className="btn-secondary py-1.5 px-2.5 text-xs inline-flex items-center gap-1"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {t("gateway.refreshStatus") || "刷新状态"}
                </button>
              </div>
              <div className="h-[520px] overflow-y-auto rounded-lg bg-slate-900 text-slate-100 p-3 font-mono text-xs">
                {status.logs.length ? (
                  status.logs.map((line, index) => (
                    <div key={`${index}-${line.slice(0, 24)}`}>{line}</div>
                  ))
                ) : (
                  <div className="text-slate-400">
                    {t("gateway.noLogs") || "暂无日志"}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
