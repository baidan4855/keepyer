import { useStore } from '@/store';
import { X, ChevronDown } from 'lucide-react';
import { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { isValidUrl } from '@/shared/lib/helpers';
import { toast } from '@/shared/lib/toast';
import type { ApiProviderType } from '@/types';
import { getDefaultSystemPrompt } from '@/shared/lib/prompts';
import { getCodexCliStatus } from '@/domains/chat/lib/codex-exec';

type ApiType = ApiProviderType;

interface SelectOption {
  value: ApiType;
  label: string;
}

// 自定义下拉选择器组件
function ApiTypeSelect({ value, onChange }: { value: ApiType; onChange: (v: ApiType) => void }) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const apiTypeOptions: SelectOption[] = [
    { value: 'openai', label: t('modals.addProvider.apiTypes.openai') },
    { value: 'claude', label: t('modals.addProvider.apiTypes.claude') },
    { value: 'generic', label: t('modals.addProvider.apiTypes.generic') },
    { value: 'codex', label: t('modals.addProvider.apiTypes.codex') },
  ];
  const selectedOption = apiTypeOptions.find(opt => opt.value === value);

  // 点击外部关闭下拉框
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
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'w-full py-2.5 px-3 rounded-xl text-left text-sm',
          'bg-white/70 border border-slate-200',
          'text-slate-800',
          'transition-all duration-200',
          'focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500',
          'flex items-center justify-between'
        )}
      >
        <span>{selectedOption?.label}</span>
        <ChevronDown className={cn(
          'w-4 h-4 text-slate-400 transition-transform duration-200',
          isOpen && 'rotate-180'
        )} />
      </button>

      {isOpen && (
        <div
          className={cn(
            'absolute z-50 w-full mt-1 p-1.5',
            'bg-white rounded-2xl shadow-soft-lg border border-primary-100/50',
            'animate-scale-in'
          )}
        >
          {apiTypeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={cn(
                'w-full px-3 py-2 rounded-lg text-sm text-left',
                'transition-all duration-150',
                'hover:bg-primary-50',
                value === option.value
                  ? 'bg-primary-100 text-primary-700 font-medium'
                  : 'text-slate-700'
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AddProviderModal() {
  const { t, i18n } = useTranslation();
  const {
    providers,
    isAddProviderModalOpen,
    editProviderId,
    setAddProviderModalOpen,
    addProvider,
    updateProvider,
  } = useStore();
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiType, setApiType] = useState<ApiType>('openai');
  const defaultSystemPrompt = useMemo(() => getDefaultSystemPrompt(i18n.language), [i18n.language]);
  const [systemPrompt, setSystemPrompt] = useState(defaultSystemPrompt);
  const [error, setError] = useState('');
  const [isCheckingCodexCli, setIsCheckingCodexCli] = useState(false);

  const editingProvider = useMemo(() => {
    if (!editProviderId) return null;
    return providers.find((provider) => provider.id === editProviderId) || null;
  }, [editProviderId, providers]);
  const isEditing = !!editingProvider;

  useEffect(() => {
    if (!isAddProviderModalOpen) {
      setName('');
      setBaseUrl('');
      setApiType('openai');
      setSystemPrompt(defaultSystemPrompt);
      setError('');
      setIsCheckingCodexCli(false);
      return;
    }

    if (editingProvider) {
      setName(editingProvider.name);
      setBaseUrl(editingProvider.baseUrl);
      setApiType(editingProvider.apiType || 'openai');
      setSystemPrompt(editingProvider.systemPrompt?.trim() || defaultSystemPrompt);
    } else {
      setName('');
      setBaseUrl('');
      setApiType('openai');
      setSystemPrompt(defaultSystemPrompt);
    }
    setError('');
    setIsCheckingCodexCli(false);
  }, [defaultSystemPrompt, editingProvider, isAddProviderModalOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError(t('modals.addProvider.error.requiredName'));
      return;
    }

    const normalizedBaseUrl = baseUrl.trim();
    const isCodexProvider = apiType === 'codex';

    if (!normalizedBaseUrl && !isCodexProvider) {
      setError(t('modals.addProvider.error.requiredUrl'));
      return;
    }

    if (!isCodexProvider && !isValidUrl(normalizedBaseUrl)) {
      setError(t('modals.addProvider.error.invalidUrl'));
      return;
    }

    if (!isEditing && isCodexProvider) {
      setIsCheckingCodexCli(true);
      try {
        const cliStatus = await getCodexCliStatus();
        if (!cliStatus.installed) {
          const installHint = t('modals.addProvider.error.codexCliNotInstalled')
            || 'Codex CLI is not installed. Please install it first and ensure `codex` is in PATH.';
          const details = cliStatus.message?.trim()
            ? `${installHint} (${cliStatus.message.trim()})`
            : installHint;
          setError(details);
          toast.error(details);
          return;
        }
      } catch {
        const checkFailed = t('modals.addProvider.error.codexCliCheckFailed')
          || 'Failed to check Codex CLI. Please verify the installation and try again.';
        setError(checkFailed);
        toast.error(checkFailed);
        return;
      } finally {
        setIsCheckingCodexCli(false);
      }
    }

    try {
      const payload = {
        name: name.trim(),
        baseUrl: normalizedBaseUrl,
        apiType,
        systemPrompt: systemPrompt.trim() || defaultSystemPrompt,
      };

      if (editingProvider) {
        updateProvider(editingProvider.id, payload);
      } else {
        addProvider(payload);
      }

      toast.success(t('notifications.saveSuccess') || '保存成功');
      handleClose();
    } catch {
      toast.error(t('notifications.saveFailed') || '保存失败');
    }
  };

  const handleClose = () => {
    setAddProviderModalOpen(false);
  };

  const baseUrlLabel = apiType === 'codex'
    ? (t('modals.addProvider.workspacePath') || '工作目录（可选）')
    : t('modals.addProvider.baseUrl');
  const baseUrlPlaceholder = apiType === 'codex'
    ? (t('modals.addProvider.workspacePathPlaceholder') || '/path/to/your/project')
    : t('modals.addProvider.baseUrlPlaceholder');

  if (!isAddProviderModalOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-black/20 backdrop-blur-sm animate-fade-in"
        onClick={handleClose}
      />

      {/* 模态框 */}
      <div className="relative w-full max-w-md mx-4 animate-scale-in">
        <div className="card p-5">
          {/* 标题 */}
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-bold text-slate-800">
              {isEditing ? t('modals.editProvider.title') : t('modals.addProvider.title')}
            </h2>
            <button
              onClick={handleClose}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* 表单 */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label htmlFor="providerName" className="block text-sm font-medium text-slate-700 mb-1.5">
                {t('modals.addProvider.providerName')}
              </label>
              <input
                id="providerName"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('modals.addProvider.providerNamePlaceholder')}
                className="input py-2.5 px-3 text-sm"
                autoFocus
              />
            </div>

            <div>
              <label htmlFor="baseUrl" className="block text-sm font-medium text-slate-700 mb-1.5">
                {baseUrlLabel}
              </label>
              <input
                id="baseUrl"
                type={apiType === 'codex' ? 'text' : 'url'}
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={baseUrlPlaceholder}
                className="input py-2.5 px-3 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                {t('modals.addProvider.apiTypeLabel')}
              </label>
              <ApiTypeSelect value={apiType} onChange={setApiType} />
            </div>

            <div>
              <label htmlFor="systemPrompt" className="block text-sm font-medium text-slate-700 mb-1.5">
                {t('modals.addProvider.systemPrompt')}
              </label>
              <textarea
                id="systemPrompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder={t('modals.addProvider.systemPromptPlaceholder')}
                rows={4}
                className="input resize-y py-2.5 px-3 text-sm"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                {error}
              </p>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="btn-secondary flex-1 py-2.5"
                disabled={isCheckingCodexCli}
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                className="btn-primary flex-1 py-2.5 disabled:opacity-60 disabled:cursor-not-allowed"
                disabled={isCheckingCodexCli}
              >
                {isCheckingCodexCli
                  ? (t('common.loading') || 'Loading...')
                  : (isEditing ? t('modals.editProvider.save') : t('modals.addProvider.submit'))}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
