import { useStore } from '@/store';
import { X, ChevronDown } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/cn';
import { isValidUrl } from '@/utils/helpers';

type ApiType = 'openai' | 'claude' | 'generic';

interface SelectOption {
  value: ApiType;
  label: string;
}

const apiTypeOptions: SelectOption[] = [
  { value: 'openai', label: 'OpenAI 兼容' },
  { value: 'claude', label: 'Claude (Anthropic)' },
  { value: 'generic', label: '通用' },
];

// 自定义下拉选择器组件
function ApiTypeSelect({ value, onChange }: { value: ApiType; onChange: (v: ApiType) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
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
  const { t } = useTranslation();
  const { isAddProviderModalOpen, setAddProviderModalOpen, addProvider } = useStore();
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiType, setApiType] = useState<ApiType>('openai');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError(t('modals.addProvider.error.requiredName'));
      return;
    }

    if (!baseUrl.trim()) {
      setError(t('modals.addProvider.error.requiredUrl'));
      return;
    }

    if (!isValidUrl(baseUrl)) {
      setError(t('modals.addProvider.error.invalidUrl'));
      return;
    }

    addProvider({
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      apiType,
    } as any);
    handleClose();
  };

  const handleClose = () => {
    setName('');
    setBaseUrl('');
    setApiType('openai');
    setError('');
    setAddProviderModalOpen(false);
  };

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
              {t('modals.addProvider.title')}
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
                {t('modals.addProvider.baseUrl')}
              </label>
              <input
                id="baseUrl"
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={t('modals.addProvider.baseUrlPlaceholder')}
                className="input py-2.5 px-3 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                API 类型
              </label>
              <ApiTypeSelect value={apiType} onChange={setApiType} />
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
              >
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn-primary flex-1 py-2.5">
                {t('modals.addProvider.submit')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
