import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Play, RefreshCw, Save, Search, SendHorizontal, ShieldAlert, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import { useStore } from '@/store';
import { decryptApiKey } from '@/domains/settings/lib/secure-storage';
import { testModel, type ModelProtocolOptions, type ModelTestResult } from '@/domains/keys/lib/api-test';
import type { LlmProtocol } from '@/domains/chat/lib/llm-proxy';
import {
  getDefaultDebugInputPrompt,
  getDefaultSystemPrompt,
  getResponseLanguageInstruction,
  isDefaultSystemPrompt,
} from '@/shared/lib/prompts';
import {
  buildSecurityProbeSystemPrompt,
  evaluateSecurityProbe,
  getDefaultSecurityProbeCases,
  getDefaultSecurityProbeCustomPrompt,
  parsePatternLines,
  type SecurityProbeEvaluation,
} from '@/domains/chat/lib/security-probe';
import { toast } from '@/shared/lib/toast';
import { cn } from '@/shared/lib/cn';

type ModelOption = {
  id: string;
  name: string;
};

type ResultView = 'single' | 'probe';

type ProbeRun = {
  modelId: string;
  modelName: string;
  caseId: string;
  caseName: string;
  input: string;
  result: ModelTestResult;
  evaluation: SecurityProbeEvaluation;
  timestamp: number;
};

const protocolSelectOptions: Array<{ value: LlmProtocol; label: string }> = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
];

function ProtocolSelect({
  value,
  onChange,
  options,
}: {
  value: LlmProtocol;
  onChange: (protocol: LlmProtocol) => void;
  options: Array<{ value: LlmProtocol; label: string }>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selected = options.find((option) => option.value === value) || null;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          'w-full h-10 py-2.5 px-3 rounded-xl text-left text-sm',
          'bg-white border border-slate-200',
          'text-slate-800',
          'transition-all duration-200',
          'focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500',
          'flex items-center justify-between'
        )}
      >
        <span className="truncate pr-2">{selected?.label || value}</span>
        <ChevronDown className={cn('w-4 h-4 text-slate-400 transition-transform', isOpen && 'rotate-180')} />
      </button>

      {isOpen ? (
        <div className="absolute z-50 w-full mt-1.5 p-2 bg-white rounded-2xl shadow-soft-lg border border-primary-100/50 animate-scale-in">
          <div className="space-y-1">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={cn(
                  'w-full px-3 py-2 rounded-lg text-left text-xs transition-all duration-150',
                  'hover:bg-primary-50',
                  value === option.value
                    ? 'bg-primary-100 text-primary-700 font-medium'
                    : 'text-slate-700'
                )}
              >
                <div className="truncate">{option.label}</div>
                <div className="truncate text-[10px] text-slate-400">{option.value}</div>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ModelSearchSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (id: string) => void;
  options: ModelOption[];
}) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selected = options.find((option) => option.id === value) || null;

  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return options;

    return options.filter((option) =>
      option.name.toLowerCase().includes(normalized) ||
      option.id.toLowerCase().includes(normalized)
    );
  }, [options, query]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
    }
  }, [isOpen]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          'w-full py-2.5 px-3 rounded-xl text-left text-sm',
          'bg-white border border-slate-200',
          'text-slate-800',
          'transition-all duration-200',
          'focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500',
          'flex items-center justify-between'
        )}
      >
        <span className="truncate pr-2">{selected?.name || t('keys.selectModel') || '选择模型'}</span>
        <ChevronDown className={cn('w-4 h-4 text-slate-400 transition-transform', isOpen && 'rotate-180')} />
      </button>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1.5 p-2 bg-white rounded-2xl shadow-soft-lg border border-primary-100/50 animate-scale-in">
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('keys.debugChatModelFilter') || '筛选模型名称或 ID...'}
              className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
            />
          </div>

          <div className="max-h-56 overflow-y-auto space-y-1">
            {filteredOptions.length === 0 ? (
              <p className="text-xs text-slate-400 px-2 py-2">
                {t('keys.noSearchResults') || '未找到匹配的模型'}
              </p>
            ) : (
              filteredOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    onChange(option.id);
                    setIsOpen(false);
                  }}
                  className={cn(
                    'w-full px-3 py-2 rounded-lg text-left text-xs transition-all duration-150',
                    'hover:bg-primary-50',
                    value === option.id
                      ? 'bg-primary-100 text-primary-700 font-medium'
                      : 'text-slate-700'
                  )}
                >
                  <div className="truncate">{option.name}</div>
                  <div className="truncate text-[10px] text-slate-400">{option.id}</div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function prettyJson(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function createCanaryToken(): string {
  return `HONEY_${Date.now().toString(36).toUpperCase()}_${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

export default function DebugChatModal() {
  const { t, i18n } = useTranslation();
  const {
    isDebugChatOpen,
    debugChatKeyId,
    getKeyById,
    providers,
    setDebugChatOpen,
    updateProvider,
  } = useStore();

  const [chatModelId, setChatModelId] = useState('');
  const [chatInput, setChatInput] = useState('');
  const defaultSystemPrompt = useMemo(() => getDefaultSystemPrompt(i18n.language), [i18n.language]);
  const defaultDebugInputPrompt = useMemo(() => getDefaultDebugInputPrompt(i18n.language), [i18n.language]);
  const responseLanguageInstruction = useMemo(() => getResponseLanguageInstruction(i18n.language), [i18n.language]);
  const [chatSystemPrompt, setChatSystemPrompt] = useState('');
  const [thinkingEnabled, setThinkingEnabled] = useState(true);
  const [chatInputProtocol, setChatInputProtocol] = useState<LlmProtocol>('openai');
  const [chatTargetProtocol, setChatTargetProtocol] = useState<LlmProtocol>('openai');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [latestResult, setLatestResult] = useState<ModelTestResult | null>(null);
  const [responseDataTab, setResponseDataTab] = useState<'payload' | 'raw' | 'meta'>('payload');
  const [streamedResponse, setStreamedResponse] = useState('');
  const [isRenderingStream, setIsRenderingStream] = useState(false);
  const [resultView, setResultView] = useState<ResultView>('single');
  const [probeCanaryToken, setProbeCanaryToken] = useState('');
  const [probeCustomInput, setProbeCustomInput] = useState('');
  const [probeForbiddenPatternText, setProbeForbiddenPatternText] = useState('');
  const [probeAllModels, setProbeAllModels] = useState(true);
  const [isProbeRunning, setIsProbeRunning] = useState(false);
  const [probeRuns, setProbeRuns] = useState<ProbeRun[]>([]);
  const [probeProgress, setProbeProgress] = useState<{ done: number; total: number; current?: string } | null>(null);
  const [selectedProbeCell, setSelectedProbeCell] = useState<{ modelId: string; caseId: string } | null>(null);
  const renderTimerRef = useRef<number | null>(null);

  const key = debugChatKeyId ? getKeyById(debugChatKeyId) : null;
  const models = key?.models || [];
  const modelOptions = useMemo(() => models.map((model) => ({ id: model.id, name: model.name })), [models]);

  const provider = useMemo(() => {
    if (!key) return null;
    return providers.find((p) => p.id === key.providerId) || null;
  }, [key, providers]);

  const providerSystemPrompt = useMemo(() => {
    const normalized = provider?.systemPrompt?.trim();
    if (!normalized || isDefaultSystemPrompt(normalized)) {
      return '';
    }
    return normalized;
  }, [provider?.systemPrompt]);
  const defaultTargetProtocol = useMemo<LlmProtocol>(
    () => (provider?.apiType === 'claude' ? 'anthropic' : 'openai'),
    [provider?.apiType]
  );
  const defaultInputProtocol = useMemo<LlmProtocol>(
    () => (provider?.apiType === 'claude' ? 'openai' : defaultTargetProtocol),
    [defaultTargetProtocol, provider?.apiType]
  );
  const modelProtocolOptions = useMemo<ModelProtocolOptions>(
    () => ({
      inputProtocol: chatInputProtocol,
      targetProtocol: chatTargetProtocol,
      enableProtocolTransform: chatInputProtocol !== chatTargetProtocol,
    }),
    [chatInputProtocol, chatTargetProtocol]
  );

  const defaultProbeCustomPrompt = useMemo(
    () => getDefaultSecurityProbeCustomPrompt(i18n.language),
    [i18n.language]
  );
  const probeCases = useMemo(
    () => getDefaultSecurityProbeCases(i18n.language, probeCustomInput),
    [i18n.language, probeCustomInput]
  );
  const probeForbiddenPatterns = useMemo(
    () => parsePatternLines(probeForbiddenPatternText),
    [probeForbiddenPatternText]
  );
  const probeTargetModels = useMemo(() => {
    if (probeAllModels) return models;
    return models.filter((model) => model.id === chatModelId);
  }, [chatModelId, models, probeAllModels]);
  const probeRunMap = useMemo(() => {
    const map = new Map<string, ProbeRun>();
    for (const run of probeRuns) {
      map.set(`${run.caseId}::${run.modelId}`, run);
    }
    return map;
  }, [probeRuns]);
  const probeSummary = useMemo(() => {
    return probeRuns.reduce(
      (acc, run) => {
        if (run.evaluation.status === 'fail') acc.fail += 1;
        else if (run.evaluation.status === 'warn') acc.warn += 1;
        else acc.pass += 1;
        return acc;
      },
      { pass: 0, warn: 0, fail: 0 }
    );
  }, [probeRuns]);

  useEffect(() => {
    if (!isDebugChatOpen || !key) return;

    setChatInput('');
    setLatestResult(null);
    setResponseDataTab('payload');
    setIsChatLoading(false);
    setChatSystemPrompt(providerSystemPrompt);
    setThinkingEnabled(true);
    setChatInputProtocol(defaultInputProtocol);
    setChatTargetProtocol(defaultTargetProtocol);
    setStreamedResponse('');
    setIsRenderingStream(false);
    setResultView('single');
    setProbeCanaryToken(createCanaryToken());
    setProbeCustomInput('');
    setProbeForbiddenPatternText('sk-[A-Za-z0-9_-]{16,}\napi[_\\-\\s]?key');
    setProbeAllModels(true);
    setIsProbeRunning(false);
    setProbeRuns([]);
    setProbeProgress(null);
    setSelectedProbeCell(null);
  }, [defaultInputProtocol, defaultTargetProtocol, isDebugChatOpen, key?.id, providerSystemPrompt]);

  useEffect(() => {
    if (!models.length) {
      setChatModelId('');
      return;
    }

    setChatModelId((prev) => {
      if (prev && models.some((model) => model.id === prev)) {
        return prev;
      }
      return models[0].id;
    });
  }, [models]);

  useEffect(() => {
    return () => {
      if (renderTimerRef.current) {
        window.clearInterval(renderTimerRef.current);
        renderTimerRef.current = null;
      }
    };
  }, []);

  const handleClose = () => {
    if (renderTimerRef.current) {
      window.clearInterval(renderTimerRef.current);
      renderTimerRef.current = null;
    }
    setDebugChatOpen(false, null);
    setChatInput('');
    setLatestResult(null);
    setIsChatLoading(false);
    setStreamedResponse('');
    setIsRenderingStream(false);
    setIsProbeRunning(false);
    setProbeProgress(null);
  };

  const startStreamingRender = (fullText: string) => {
    if (renderTimerRef.current) {
      window.clearInterval(renderTimerRef.current);
      renderTimerRef.current = null;
    }

    if (!fullText) {
      setStreamedResponse('');
      setIsRenderingStream(false);
      return;
    }

    const chunks = fullText.match(/[\s\S]{1,4}/g) || [];
    let index = 0;

    setStreamedResponse('');
    setIsRenderingStream(true);

    renderTimerRef.current = window.setInterval(() => {
      index += 1;
      setStreamedResponse(chunks.slice(0, index).join(''));

      if (index >= chunks.length) {
        if (renderTimerRef.current) {
          window.clearInterval(renderTimerRef.current);
          renderTimerRef.current = null;
        }
        setIsRenderingStream(false);
      }
    }, 18);
  };

  const handleSaveSystemPrompt = () => {
    if (!provider) return;

    const trimmedPrompt = chatSystemPrompt.trim();
    const useDefaultPrompt = !trimmedPrompt || isDefaultSystemPrompt(trimmedPrompt);
    const normalizedPrompt = useDefaultPrompt ? defaultSystemPrompt : trimmedPrompt;
    updateProvider(provider.id, { systemPrompt: normalizedPrompt });
    setChatSystemPrompt(useDefaultPrompt ? '' : trimmedPrompt);
    toast.success(t('notifications.saveSuccess') || '保存成功');
  };

  const handleSendChat = async () => {
    if (!key || !provider || !chatModelId) return;

    const trimmedInput = chatInput.trim();
    const rawInput = trimmedInput ? chatInput : defaultDebugInputPrompt;
    const trimmedSystemPrompt = chatSystemPrompt.trim();
    const normalizedSystemPrompt = (!trimmedSystemPrompt || isDefaultSystemPrompt(trimmedSystemPrompt))
      ? defaultSystemPrompt
      : trimmedSystemPrompt;
    const requestSystemPrompt = normalizedSystemPrompt.includes(responseLanguageInstruction)
      ? normalizedSystemPrompt
      : `${normalizedSystemPrompt}\n\n${responseLanguageInstruction}`.trim();

    setResultView('single');
    setLatestResult(null);
    setStreamedResponse('');
    setIsRenderingStream(false);
    setResponseDataTab('payload');
    setIsChatLoading(true);

    try {
      const decryptedKey = await decryptApiKey(key.key);
      const result = await testModel(
        provider,
        decryptedKey,
        chatModelId,
        rawInput,
        undefined,
        requestSystemPrompt,
        thinkingEnabled,
        modelProtocolOptions,
      );

      setLatestResult({ ...result, timestamp: Date.now() });
      startStreamingRender(result.response || '');
    } catch (error) {
      setLatestResult({
        status: 'error',
        message: t('apiTest.modelTestFailed'),
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      });
      setStreamedResponse('');
      setIsRenderingStream(false);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleResetProbeConfig = () => {
    setProbeCanaryToken(createCanaryToken());
    setProbeCustomInput('');
    setProbeForbiddenPatternText('sk-[A-Za-z0-9_-]{16,}\napi[_\\-\\s]?key');
    setProbeAllModels(true);
  };

  const handleRunProbe = async () => {
    if (!key || !provider) return;

    const targetModels = probeTargetModels;
    if (!targetModels.length) {
      toast.error(t('keys.securityProbeNoModel') || '请先选择至少一个模型');
      return;
    }

    const trimmedSystemPrompt = chatSystemPrompt.trim();
    const normalizedSystemPrompt = (!trimmedSystemPrompt || isDefaultSystemPrompt(trimmedSystemPrompt))
      ? defaultSystemPrompt
      : trimmedSystemPrompt;
    const baseSystemPrompt = normalizedSystemPrompt.includes(responseLanguageInstruction)
      ? normalizedSystemPrompt
      : `${normalizedSystemPrompt}\n\n${responseLanguageInstruction}`.trim();
    const canaryToken = probeCanaryToken.trim() || createCanaryToken();
    const probeSystemPrompt = buildSecurityProbeSystemPrompt(baseSystemPrompt, canaryToken, i18n.language);

    if (!probeCanaryToken.trim()) {
      setProbeCanaryToken(canaryToken);
    }

    const cases = probeCases;
    const total = targetModels.length * cases.length;
    if (!total) return;

    setResultView('probe');
    setIsProbeRunning(true);
    setProbeRuns([]);
    setProbeProgress({ done: 0, total });
    setSelectedProbeCell(null);

    try {
      const decryptedKey = await decryptApiKey(key.key);
      const runs: ProbeRun[] = [];
      let done = 0;

      for (const model of targetModels) {
        for (const probeCase of cases) {
          setProbeProgress({
            done,
            total,
            current: `${model.name} · ${probeCase.name}`,
          });

          const result = await testModel(
            provider,
            decryptedKey,
            model.id,
            probeCase.input,
            undefined,
            probeSystemPrompt,
            thinkingEnabled,
            modelProtocolOptions,
          );

          const evaluation = evaluateSecurityProbe({
            result,
            canaryToken,
            forbiddenPatterns: probeForbiddenPatterns,
          });
          done += 1;

          runs.push({
            modelId: model.id,
            modelName: model.name,
            caseId: probeCase.id,
            caseName: probeCase.name,
            input: probeCase.input,
            result: { ...result, timestamp: Date.now() },
            evaluation,
            timestamp: Date.now(),
          });

          setProbeRuns([...runs]);
          setProbeProgress({
            done,
            total,
            current: done >= total ? undefined : `${model.name} · ${probeCase.name}`,
          });
        }
      }

      const prioritized =
        runs.find((item) => item.evaluation.status === 'fail')
        || runs.find((item) => item.evaluation.status === 'warn')
        || runs[0];

      if (prioritized) {
        setSelectedProbeCell({ modelId: prioritized.modelId, caseId: prioritized.caseId });
      }

      const passCount = runs.filter((item) => item.evaluation.status === 'pass').length;
      const warnCount = runs.filter((item) => item.evaluation.status === 'warn').length;
      const failCount = runs.filter((item) => item.evaluation.status === 'fail').length;
      toast.success(
        `${t('keys.securityProbe') || '安全探测'}: PASS ${passCount} / WARN ${warnCount} / FAIL ${failCount}`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setIsProbeRunning(false);
    }
  };

  const prettyPayload = useMemo(() => prettyJson(latestResult?.responsePayload), [latestResult?.responsePayload]);
  const prettyRaw = useMemo(() => prettyJson(latestResult?.rawResponse), [latestResult?.rawResponse]);
  const hasPayload = useMemo(() => Boolean(prettyPayload), [prettyPayload]);
  const hasRaw = useMemo(() => Boolean(prettyRaw), [prettyRaw]);
  const hasMeta = useMemo(() => Boolean(latestResult), [latestResult]);
  const renderedResponse = useMemo(() => {
    if (!latestResult?.response) return '';
    if (isRenderingStream) return streamedResponse;
    return streamedResponse || latestResult.response;
  }, [isRenderingStream, latestResult?.response, streamedResponse]);

  const usageEntries = useMemo(() => {
    if (!latestResult?.usage) return [];
    return Object.entries(latestResult.usage);
  }, [latestResult?.usage]);

  const headerEntries = useMemo(() => {
    if (!latestResult?.responseHeaders) return [];
    return Object.entries(latestResult.responseHeaders);
  }, [latestResult?.responseHeaders]);
  const selectedProbeRun = useMemo(() => {
    if (!selectedProbeCell) return null;
    return probeRunMap.get(`${selectedProbeCell.caseId}::${selectedProbeCell.modelId}`) || null;
  }, [probeRunMap, selectedProbeCell]);

  useEffect(() => {
    if (!probeRuns.length) {
      setSelectedProbeCell(null);
      return;
    }

    if (
      selectedProbeCell
      && probeRunMap.has(`${selectedProbeCell.caseId}::${selectedProbeCell.modelId}`)
    ) {
      return;
    }

    const prioritized =
      probeRuns.find((item) => item.evaluation.status === 'fail')
      || probeRuns.find((item) => item.evaluation.status === 'warn')
      || probeRuns[0];

    if (prioritized) {
      setSelectedProbeCell({ modelId: prioritized.modelId, caseId: prioritized.caseId });
    }
  }, [probeRunMap, probeRuns, selectedProbeCell]);

  useEffect(() => {
    if (responseDataTab === 'payload' && !hasPayload) {
      if (hasRaw) {
        setResponseDataTab('raw');
      } else if (hasMeta) {
        setResponseDataTab('meta');
      }
    } else if (responseDataTab === 'raw' && !hasRaw) {
      if (hasPayload) {
        setResponseDataTab('payload');
      } else if (hasMeta) {
        setResponseDataTab('meta');
      }
    } else if (responseDataTab === 'meta' && !hasMeta) {
      if (hasPayload) {
        setResponseDataTab('payload');
      } else if (hasRaw) {
        setResponseDataTab('raw');
      }
    }
  }, [hasMeta, hasPayload, hasRaw, responseDataTab]);

  if (!isDebugChatOpen || !key) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm animate-fade-in"
        onClick={handleClose}
      />

      <div className="relative w-full max-w-[1280px] h-[calc(100vh-2rem)] animate-scale-in">
        <div className="card overflow-hidden w-full h-full min-h-0 flex flex-col">
          <div className="px-6 py-4 border-b border-primary-100/50">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-800">
                  {t('keys.debugChat') || '拷问'}
                </h3>
                <p className="text-sm text-slate-500 mt-1">
                  {key.name || t('keys.unnamedKey')}
                </p>
              </div>
              <button
                onClick={handleClose}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all duration-200"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {models.length === 0 ? (
            <div className="p-6">
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-800">
                {t('keys.debugChatNoModels') || '请先测试 API Key 并拉取模型列表后再使用拷问。'}
              </div>
            </div>
          ) : (
            <div className="p-4 min-h-0 flex-1 overflow-hidden">
              <div className="grid h-full min-h-0 grid-cols-1 sm:grid-cols-[300px_minmax(0,1fr)] gap-3">
                <div className="rounded-2xl border border-slate-200 bg-white/90 p-3 space-y-3 min-h-0 overflow-y-auto">
                  <div className="grid grid-cols-1 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        {t('keys.chatModel') || '模型'}
                      </label>
                      <ModelSearchSelect
                        value={chatModelId}
                        onChange={setChatModelId}
                        options={modelOptions}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          {t('keys.inputProtocol') || 'Input Protocol'}
                        </label>
                        <ProtocolSelect
                          value={chatInputProtocol}
                          onChange={setChatInputProtocol}
                          options={protocolSelectOptions}
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          {t('keys.targetProtocol') || 'Target Protocol'}
                        </label>
                        <ProtocolSelect
                          value={chatTargetProtocol}
                          onChange={setChatTargetProtocol}
                          options={protocolSelectOptions}
                        />
                      </div>
                    </div>
                    {chatInputProtocol !== chatTargetProtocol && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
                        {t('keys.protocolTransformEnabled') || 'Protocol transform is enabled for this request.'}
                      </div>
                    )}
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        {t('keys.thinking') || 'Thinking'}
                      </label>
                      <button
                        type="button"
                        onClick={() => setThinkingEnabled((prev) => !prev)}
                        className={cn(
                          'w-full h-10 rounded-xl border px-3 text-sm transition-all',
                          'flex items-center justify-between',
                          thinkingEnabled
                            ? 'bg-primary-50 border-primary-300 text-primary-700'
                            : 'bg-white border-slate-200 text-slate-600'
                        )}
                      >
                        <span>{thinkingEnabled ? (t('common.enabled') || '已开启') : (t('common.disabled') || '已关闭')}</span>
                        <span className={cn(
                          'inline-block w-10 h-5 rounded-full relative transition-colors',
                          thinkingEnabled ? 'bg-primary-500' : 'bg-slate-300'
                        )}>
                          <span className={cn(
                            'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all',
                            thinkingEnabled ? 'left-5' : 'left-0.5'
                          )} />
                        </span>
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <label className="text-[11px] font-medium text-slate-600">
                        {t('keys.systemPrompt') || 'System Prompt'}
                      </label>
                      <button
                        onClick={handleSaveSystemPrompt}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-lg border border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100 transition-all"
                        title={t('common.save')}
                      >
                        <Save className="w-3 h-3" />
                        {t('common.save')}
                      </button>
                    </div>
                    <textarea
                      value={chatSystemPrompt}
                      onChange={(e) => setChatSystemPrompt(e.target.value)}
                      placeholder={defaultSystemPrompt}
                      rows={6}
                      className="w-full px-2.5 py-1.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 resize-y"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      {t('keys.debugChatInput') || '调试输入'}
                    </label>
                    <div className="space-y-2">
                      <textarea
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            if (!isChatLoading) {
                              void handleSendChat();
                            }
                          }
                        }}
                        rows={6}
                        placeholder={t('keys.chatInputPlaceholder') || '输入消息，按 Enter 发送，Shift+Enter 换行'}
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 resize-y"
                      />
                      <button
                        onClick={() => void handleSendChat()}
                        disabled={isChatLoading || !chatModelId}
                        className="inline-flex items-center justify-center gap-1.5 w-full px-3 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                      >
                        <SendHorizontal className="w-4 h-4" />
                        {isChatLoading ? (t('keys.sending') || '发送中...') : (t('keys.send') || '发送')}
                      </button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-2.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-semibold text-slate-700">
                        {t('keys.securityProbe') || '安全探测'}
                      </label>
                      <button
                        type="button"
                        onClick={handleResetProbeConfig}
                        className="inline-flex items-center gap-1 text-[11px] text-slate-600 hover:text-slate-800"
                      >
                        <RefreshCw className="w-3 h-3" />
                        {t('keys.probeReset') || '重置'}
                      </button>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        {t('keys.securityCanaryToken') || '蜜罐 Token'}
                      </label>
                      <input
                        type="text"
                        value={probeCanaryToken}
                        onChange={(e) => setProbeCanaryToken(e.target.value)}
                        placeholder={t('keys.securityCanaryTokenPlaceholder') || '例如 HONEY_TOKEN_xxx'}
                        className="w-full px-2.5 py-1.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                      />
                    </div>

                    <label className="inline-flex items-center gap-2 text-xs text-slate-700 select-none">
                      <input
                        type="checkbox"
                        checked={probeAllModels}
                        onChange={(e) => setProbeAllModels(e.target.checked)}
                        className="rounded border-slate-300 text-primary-600 focus:ring-primary-500/30"
                      />
                      {t('keys.securityProbeAllModels') || '对所有模型执行探测'}
                    </label>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        {t('keys.securityProbeCustomInput') || '自定义攻击提示词（可选）'}
                      </label>
                      <textarea
                        value={probeCustomInput}
                        onChange={(e) => setProbeCustomInput(e.target.value)}
                        rows={4}
                        placeholder={defaultProbeCustomPrompt}
                        className="w-full px-2.5 py-1.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 resize-y"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        {t('keys.securityProbeForbiddenPatterns') || '额外禁用模式（每行一个正则，可选）'}
                      </label>
                      <textarea
                        value={probeForbiddenPatternText}
                        onChange={(e) => setProbeForbiddenPatternText(e.target.value)}
                        rows={3}
                        placeholder="sk-[A-Za-z0-9_-]{16,}"
                        className="w-full px-2.5 py-1.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 resize-y"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleRunProbe()}
                      disabled={isProbeRunning || isChatLoading || !chatModelId}
                      className="inline-flex items-center justify-center gap-1.5 w-full px-3 py-2 text-sm font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      {isProbeRunning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                      {isProbeRunning ? (t('keys.probeRunning') || '探测中...') : (t('keys.runSecurityProbe') || '运行安全探测')}
                    </button>
                  </div>
                </div>

                <div className="min-h-0 overflow-hidden flex flex-col">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 h-full min-h-0 overflow-hidden w-full max-w-[920px] mx-auto flex flex-col">
                    <div className="flex items-center justify-between gap-2 shrink-0">
                      <div className="inline-flex items-center rounded-lg border border-slate-200 p-0.5 bg-white">
                        <button
                          type="button"
                          onClick={() => setResultView('single')}
                          className={cn(
                            'px-2.5 py-1 rounded-md text-[11px] transition-all',
                            resultView === 'single'
                              ? 'bg-primary-600 text-white shadow-soft'
                              : 'text-slate-600 hover:bg-slate-100'
                          )}
                        >
                          {t('keys.singleDebug') || '单轮调试'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setResultView('probe')}
                          className={cn(
                            'px-2.5 py-1 rounded-md text-[11px] transition-all',
                            resultView === 'probe'
                              ? 'bg-primary-600 text-white shadow-soft'
                              : 'text-slate-600 hover:bg-slate-100'
                          )}
                        >
                          {t('keys.securityProbe') || '安全探测'}
                        </button>
                      </div>
                      {resultView === 'single' && (isChatLoading || latestResult) && (
                        <div className={cn(
                          'shrink-0 rounded-lg border px-2 py-1 text-xs max-w-[65%] inline-flex items-center gap-1.5 overflow-hidden',
                          isChatLoading
                            ? 'border-primary-200 bg-primary-50 text-primary-700'
                            : latestResult?.status === 'success'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                              : 'border-red-200 bg-red-50 text-red-800'
                        )}>
                          <span className="font-medium truncate">
                            {isChatLoading ? (t('keys.sending') || '发送中...') : latestResult?.message}
                          </span>
                          {!isChatLoading && latestResult?.timestamp && (
                            <span className="opacity-80 shrink-0">
                              {new Date(latestResult.timestamp).toLocaleTimeString()}
                            </span>
                          )}
                        </div>
                      )}
                      {resultView === 'probe' && (isProbeRunning || probeRuns.length > 0) && (
                        <div className={cn(
                          'shrink-0 rounded-lg border px-2 py-1 text-xs max-w-[70%] inline-flex items-center gap-1.5 overflow-hidden',
                          isProbeRunning
                            ? 'border-primary-200 bg-primary-50 text-primary-700'
                            : probeSummary.fail > 0
                              ? 'border-red-200 bg-red-50 text-red-800'
                              : probeSummary.warn > 0
                                ? 'border-amber-200 bg-amber-50 text-amber-800'
                                : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        )}>
                          {isProbeRunning ? (
                            <>
                              <RefreshCw className="w-3 h-3 animate-spin shrink-0" />
                              <span className="truncate">
                                {(t('keys.probeRunning') || '探测中...')} {probeProgress ? `${probeProgress.done}/${probeProgress.total}` : ''}
                              </span>
                            </>
                          ) : (
                            <span className="font-medium truncate">
                              PASS {probeSummary.pass} / WARN {probeSummary.warn} / FAIL {probeSummary.fail}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain space-y-4 pr-1">
                      {resultView === 'single' && (
                        <>
                          {!isChatLoading && !latestResult && (
                            <div className="rounded-xl border border-slate-200 bg-white px-4 py-8">
                              <div className="mx-auto w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500">
                                <SendHorizontal className="w-4 h-4" />
                              </div>
                              <p className="mt-3 text-sm font-medium text-slate-700 text-center">
                                {t('keys.debugChatPlaceholderTitle') || '等待调试请求'}
                              </p>
                              <p className="mt-1 text-xs text-slate-500 text-center">
                                {t('keys.debugChatPlaceholder') || '请在左侧填写参数并点击发送，结果会显示在这里。'}
                              </p>
                            </div>
                          )}

                          {latestResult && (
                            <div className="space-y-3">
                              {latestResult.response && (
                                <div className="rounded-xl border border-emerald-100 bg-white p-3">
                                  <div className="text-xs font-medium text-slate-600 mb-1.5">{t('keys.debugChatResponse') || 'Model Answer'}</div>
                                  <div className="max-h-[36vh] overflow-y-auto bg-slate-50 rounded-lg p-2">
                                    <pre className="text-sm text-slate-700 whitespace-pre-wrap break-words font-sans">
                                      {renderedResponse}
                                    </pre>
                                  </div>
                                  {isRenderingStream && (
                                    <div className="mt-1 text-xs text-primary-600">
                                      {t('keys.streaming') || 'Streaming...'}
                                    </div>
                                  )}
                                </div>
                              )}

                              {latestResult.error && (
                                <div className="rounded-xl border border-red-200 bg-white p-3">
                                  <div className="text-xs font-medium text-slate-600 mb-1.5">{t('apiTest.modelTestFailed') || 'Error'}</div>
                                  <div className="max-h-40 overflow-y-auto bg-red-50/60 rounded-lg p-2">
                                    <pre className="text-sm text-red-700 whitespace-pre-wrap break-words font-sans">{latestResult.error}</pre>
                                  </div>
                                </div>
                              )}

                              {(hasPayload || hasRaw || hasMeta) && (
                                <div className="rounded-xl border border-slate-200 bg-white p-3">
                                  <div className="mb-2 flex items-center justify-between gap-2">
                                    <div className="text-xs font-medium text-slate-600">Response Data</div>
                                    <div className="inline-flex items-center rounded-lg border border-slate-200 p-0.5 bg-slate-50">
                                      <button
                                        type="button"
                                        onClick={() => setResponseDataTab('payload')}
                                        disabled={!hasPayload}
                                        className={cn(
                                          'px-2 py-1 rounded-md text-[11px] transition-all',
                                          responseDataTab === 'payload'
                                            ? 'bg-white text-primary-700 shadow-soft'
                                            : 'text-slate-600 hover:bg-white/70',
                                          !hasPayload && 'opacity-50 cursor-not-allowed hover:bg-transparent'
                                        )}
                                      >
                                        payload
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setResponseDataTab('raw')}
                                        disabled={!hasRaw}
                                        className={cn(
                                          'px-2 py-1 rounded-md text-[11px] transition-all',
                                          responseDataTab === 'raw'
                                            ? 'bg-white text-primary-700 shadow-soft'
                                            : 'text-slate-600 hover:bg-white/70',
                                          !hasRaw && 'opacity-50 cursor-not-allowed hover:bg-transparent'
                                        )}
                                      >
                                        {t('keys.debugChatRaw') || 'Raw Response'}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setResponseDataTab('meta')}
                                        disabled={!hasMeta}
                                        className={cn(
                                          'px-2 py-1 rounded-md text-[11px] transition-all',
                                          responseDataTab === 'meta'
                                            ? 'bg-white text-primary-700 shadow-soft'
                                            : 'text-slate-600 hover:bg-white/70',
                                          !hasMeta && 'opacity-50 cursor-not-allowed hover:bg-transparent'
                                        )}
                                      >
                                        {t('keys.debugChatMeta') || 'Metadata'}
                                      </button>
                                    </div>
                                  </div>
                                  {responseDataTab === 'meta' ? (
                                    <div className="space-y-3">
                                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-slate-700">
                                        <div className="rounded-lg bg-slate-50 px-2 py-1.5 break-all">HTTP: {latestResult.httpStatus ?? '-'}</div>
                                        <div className="rounded-lg bg-slate-50 px-2 py-1.5 break-all">model: {latestResult.responseModel ?? '-'}</div>
                                        <div className="rounded-lg bg-slate-50 px-2 py-1.5 break-all">id: {latestResult.responseId ?? '-'}</div>
                                        <div className="rounded-lg bg-slate-50 px-2 py-1.5 break-all">stop: {latestResult.stopReason ?? '-'}</div>
                                        <div className="rounded-lg bg-slate-50 px-2 py-1.5 break-all">retries: {latestResult.retryCount ?? 0}</div>
                                      </div>

                                      {usageEntries.length > 0 && (
                                        <div>
                                          <div className="text-xs font-medium text-slate-600 mb-1.5">usage</div>
                                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-slate-700">
                                            {usageEntries.map(([k, v]) => (
                                              <div key={k} className="rounded-lg bg-slate-50 px-2 py-1.5 break-all">
                                                {k}: {String(v)}
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      )}

                                      {headerEntries.length > 0 && (
                                        <div>
                                          <div className="text-xs font-medium text-slate-600 mb-1.5">{t('keys.debugChatHeaders') || 'Response Headers'}</div>
                                          <div className="max-h-28 overflow-y-auto space-y-1">
                                            {headerEntries.map(([k, v]) => (
                                              <div key={k} className="rounded bg-slate-50 px-2 py-1 text-[11px] text-slate-700 break-all">
                                                {k}: {v}
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <pre className="text-[12px] leading-5 text-slate-700 whitespace-pre-wrap break-words bg-slate-50 rounded-lg p-2 overflow-y-auto overflow-x-hidden max-h-56">
                                      {responseDataTab === 'payload'
                                        ? (hasPayload ? prettyPayload : 'No payload data')
                                        : (hasRaw ? prettyRaw : 'No raw response data')}
                                    </pre>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )}

                      {resultView === 'probe' && (
                        <>
                          {!isProbeRunning && probeRuns.length === 0 && (
                            <div className="rounded-xl border border-slate-200 bg-white px-4 py-8">
                              <div className="mx-auto w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500">
                                <ShieldCheck className="w-4 h-4" />
                              </div>
                              <p className="mt-3 text-sm font-medium text-slate-700 text-center">
                                {t('keys.probeEmptyTitle') || '尚未执行安全探测'}
                              </p>
                              <p className="mt-1 text-xs text-slate-500 text-center">
                                {t('keys.probeEmpty') || '在左侧配置蜜罐与规则后，点击运行安全探测。'}
                              </p>
                            </div>
                          )}

                          {(isProbeRunning || probeRuns.length > 0) && (
                            <div className="space-y-3">
                              <div className="grid grid-cols-3 gap-2">
                                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-800">
                                  PASS: {probeSummary.pass}
                                </div>
                                <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                                  WARN: {probeSummary.warn}
                                </div>
                                <div className="rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">
                                  FAIL: {probeSummary.fail}
                                </div>
                              </div>

                              {probeProgress && (
                                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                                  {(t('keys.probeProgress') || '进度')}: {probeProgress.done}/{probeProgress.total}
                                  {probeProgress.current ? ` · ${probeProgress.current}` : ''}
                                </div>
                              )}

                              <div className="rounded-xl border border-slate-200 bg-white p-3 overflow-hidden">
                                <div className="text-xs font-medium text-slate-600 mb-2">
                                  {t('keys.probeMatrix') || '探测矩阵'}
                                </div>
                                <div className="overflow-x-auto">
                                  <table className="min-w-full border-separate border-spacing-1.5">
                                    <thead>
                                      <tr>
                                        <th className="sticky left-0 z-10 bg-white text-left text-[11px] font-medium text-slate-600 px-2 py-1.5 min-w-[140px]">
                                          {t('keys.probeCase') || '用例'}
                                        </th>
                                        {probeTargetModels.map((model) => (
                                          <th key={model.id} className="text-left text-[11px] font-medium text-slate-600 px-2 py-1.5 min-w-[120px]">
                                            <span className="block truncate" title={model.name}>{model.name}</span>
                                          </th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {probeCases.map((probeCase) => (
                                        <tr key={probeCase.id}>
                                          <td className="sticky left-0 z-10 bg-white rounded-md px-2 py-1.5 text-[11px] text-slate-700">
                                            <span className="block truncate" title={probeCase.name}>{probeCase.name}</span>
                                          </td>
                                          {probeTargetModels.map((model) => {
                                            const run = probeRunMap.get(`${probeCase.id}::${model.id}`);
                                            const status = run?.evaluation.status;
                                            return (
                                              <td key={`${probeCase.id}-${model.id}`} className="px-0.5 py-0.5">
                                                <button
                                                  type="button"
                                                  disabled={!run}
                                                  onClick={() => {
                                                    if (!run) return;
                                                    setSelectedProbeCell({ modelId: model.id, caseId: probeCase.id });
                                                  }}
                                                  className={cn(
                                                    'w-full rounded-md px-2 py-1.5 text-[11px] font-medium text-left transition-all',
                                                    !run && 'bg-slate-100 text-slate-400 cursor-default',
                                                    run && status === 'pass' && 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200',
                                                    run && status === 'warn' && 'bg-amber-100 text-amber-800 hover:bg-amber-200',
                                                    run && status === 'fail' && 'bg-red-100 text-red-800 hover:bg-red-200',
                                                    run && selectedProbeCell?.modelId === model.id && selectedProbeCell?.caseId === probeCase.id && 'ring-2 ring-primary-400'
                                                  )}
                                                >
                                                  {!run && '--'}
                                                  {run && status === 'pass' && (
                                                    <span className="inline-flex items-center gap-1">
                                                      <ShieldCheck className="w-3 h-3" />
                                                      PASS
                                                    </span>
                                                  )}
                                                  {run && status === 'warn' && (
                                                    <span className="inline-flex items-center gap-1">
                                                      <TriangleAlert className="w-3 h-3" />
                                                      WARN
                                                    </span>
                                                  )}
                                                  {run && status === 'fail' && (
                                                    <span className="inline-flex items-center gap-1">
                                                      <ShieldAlert className="w-3 h-3" />
                                                      FAIL
                                                    </span>
                                                  )}
                                                </button>
                                              </td>
                                            );
                                          })}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>

                              {selectedProbeRun && (
                                <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
                                  <div className="flex items-start justify-between gap-2">
                                    <div>
                                      <div className="text-xs font-medium text-slate-600">
                                        {selectedProbeRun.caseName} · {selectedProbeRun.modelName}
                                      </div>
                                      <div className="mt-0.5 text-[11px] text-slate-500">{selectedProbeRun.evaluation.summary}</div>
                                    </div>
                                    <div className="text-[11px] text-slate-500 shrink-0">
                                      {new Date(selectedProbeRun.timestamp).toLocaleTimeString()}
                                    </div>
                                  </div>

                                  <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                                    <div className="text-[11px] font-medium text-slate-600 mb-1">{t('keys.probeInput') || '探测输入'}</div>
                                    <pre className="text-xs text-slate-700 whitespace-pre-wrap break-words font-sans">{selectedProbeRun.input}</pre>
                                  </div>

                                  <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                                    <div className="text-[11px] font-medium text-slate-600 mb-1">{t('keys.probeEvidence') || '命中证据'}</div>
                                    {selectedProbeRun.evaluation.hits.length === 0 ? (
                                      <p className="text-xs text-slate-500">{t('keys.probeNoEvidence') || '未命中异常信号。'}</p>
                                    ) : (
                                      <div className="space-y-1.5 max-h-40 overflow-y-auto">
                                        {selectedProbeRun.evaluation.hits.map((hit, idx) => (
                                          <div key={`${hit.rule}-${idx}`} className="rounded border border-slate-200 bg-white px-2 py-1.5">
                                            <div className="text-[11px] font-medium text-slate-700">
                                              {hit.rule === 'canary' && (t('keys.probeHitCanary') || '蜜罐泄露')}
                                              {hit.rule === 'forbidden_pattern' && (t('keys.probeHitPattern') || '命中禁用模式')}
                                              {hit.rule === 'tool_signal' && (t('keys.probeHitTool') || '可疑工具调用信号')}
                                              {hit.rule === 'request_error' && (t('keys.probeHitError') || '请求异常')}
                                              <span className="text-slate-400 font-normal"> · {hit.source}</span>
                                            </div>
                                            <div className="text-[11px] text-slate-500 break-all">{hit.matcher}</div>
                                            <pre className="mt-1 text-xs text-slate-700 whitespace-pre-wrap break-words font-sans">{hit.excerpt}</pre>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>

                                  {selectedProbeRun.result.response && (
                                    <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                                      <div className="text-[11px] font-medium text-slate-600 mb-1">{t('keys.debugChatResponse') || '模型回复'}</div>
                                      <pre className="text-xs text-slate-700 whitespace-pre-wrap break-words font-sans max-h-40 overflow-y-auto">
                                        {selectedProbeRun.result.response}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
