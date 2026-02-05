import { useStore } from '@/store';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { decryptApiKey, isEncrypted } from '@/domains/settings/lib/secure-storage';
import { toast } from '@/shared/lib/toast';
import type { AddKeyForm } from '@/types';

// 自定义日期选择器组件
function DatePicker({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled: boolean }) {
  const { t, i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth() + 1);

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

  // 当有值时，更新视图到选择的日期所在月份
  useEffect(() => {
    if (value) {
      const [year, month] = value.split('-').map(Number);
      setViewYear(year);
      setViewMonth(month);
    }
  }, [value]);

  // 解析日期
  const parseDate = (dateStr: string) => {
    if (!dateStr) return null;
    const [year, month, day] = dateStr.split('-').map(Number);
    return { year, month, day };
  };

  // 切换到上一个月
  const prevMonth = () => {
    if (viewMonth === 1) {
      setViewMonth(12);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
  };

  // 切换到下一个月
  const nextMonth = () => {
    if (viewMonth === 12) {
      setViewMonth(1);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  };

  const date = parseDate(value);

  // 生成月份名称
  const getMonthName = (month: number) => {
    const months = i18n.language === 'zh'
      ? ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']
      : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[month - 1];
  };

  // 生成星期名称
  const getWeekdayNames = () => {
    return i18n.language === 'zh'
      ? ['日', '一', '二', '三', '四', '五', '六']
      : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  };

  // 获取当月天数
  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month, 0).getDate();
  };

  // 生成日历
  const generateCalendar = () => {
    const firstDay = new Date(viewYear, viewMonth - 1, 1).getDay();
    const daysInMonth = getDaysInMonth(viewYear, viewMonth);
    const minDate = new Date(Date.now() + 86400000);

    const days = [];
    const totalCells = 42; // 6行 x 7列 = 42个格子

    // 填充空白天（月初之前的空白）
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-before-${i}`} className="h-8" />);
    }

    // 填充日期
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${viewYear}-${String(viewMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isSelected = value === dateStr;
      const isPast = new Date(viewYear, viewMonth - 1, day) < minDate;
      const isToday = new Date().toDateString() === new Date(viewYear, viewMonth - 1, day).toDateString();

      days.push(
        <button
          key={day}
          type="button"
          disabled={isPast}
          onClick={() => {
            onChange(dateStr);
            setIsOpen(false);
          }}
          className={cn(
            'h-8 w-8 rounded-lg text-sm font-medium transition-all duration-150',
            'hover:bg-primary-100',
            'relative',
            isSelected && 'bg-primary-600 text-white hover:bg-primary-700',
            isToday && !isSelected && 'ring-2 ring-primary-400 ring-offset-1',
            isPast && 'opacity-30 cursor-not-allowed hover:bg-transparent'
          )}
        >
          {day}
        </button>
      );
    }

    // 填充月末的空白格子，确保始终有42个格子（6行）
    const remainingCells = totalCells - days.length;
    for (let i = 0; i < remainingCells; i++) {
      days.push(<div key={`empty-after-${i}`} className="h-8" />);
    }

    return days;
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={cn(
          'w-full px-4 py-3 rounded-xl text-left',
          'bg-white/70 border border-slate-200',
          'text-slate-800 placeholder:text-slate-400',
          'transition-all duration-200',
          'focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        {value || (i18n.language === 'zh' ? '选择日期' : 'Select date')}
      </button>

      {isOpen && !disabled && (
        <div
          ref={dropdownRef}
          className="absolute z-50 p-4 bg-white rounded-2xl shadow-soft-lg border border-primary-100/50 animate-scale-in"
          style={{
            bottom: 'calc(100% + 8px)',
            left: '0',
            right: '0',
          }}
        >
          {/* 月份和年份选择 */}
          <div className="flex items-center justify-between mb-4">
            <button
              type="button"
              onClick={prevMonth}
              className="p-1 rounded-lg hover:bg-slate-100 transition-colors text-slate-600 hover:text-slate-800"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="text-lg font-semibold text-slate-800">
              {getMonthName(viewMonth)} {viewYear}
            </div>
            <button
              type="button"
              onClick={nextMonth}
              className="p-1 rounded-lg hover:bg-slate-100 transition-colors text-slate-600 hover:text-slate-800"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {/* 星期标题 */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {getWeekdayNames().map((day) => (
              <div key={day} className="h-8 flex items-center justify-center text-xs text-slate-500 font-medium">
                {day}
              </div>
            ))}
          </div>

          {/* 日期网格 */}
          <div className="grid grid-cols-7 gap-1">
            {generateCalendar()}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AddKeyModal() {
  const { t } = useTranslation();
  const { isAddKeyModalOpen, setAddKeyModalOpen, addKey, updateKey, selectedProviderId, editKeyId, getKeyById } = useStore();
  const [key, setKey] = useState('');
  const [originalKey, setOriginalKey] = useState(''); // 保存原始解密后的密钥
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [neverExpire, setNeverExpire] = useState(true);
  const [error, setError] = useState('');

  const isEditing = !!editKeyId;
  const existingKey = editKeyId ? getKeyById(editKeyId) : null;

  useEffect(() => {
    const loadKeyData = async () => {
      if (isAddKeyModalOpen) {
        if (isEditing && existingKey) {
          // 解密密钥后再显示
          let displayKey = existingKey.key;
          if (isEncrypted(existingKey.key)) {
            try {
              displayKey = await decryptApiKey(existingKey.key);
            } catch (err) {
              console.error('Failed to decrypt key:', err);
              displayKey = existingKey.key;
            }
          }
          setKey(displayKey);
          setOriginalKey(displayKey); // 保存原始密钥用于比较
          setName(existingKey.name || '');
          setNote(existingKey.note || '');
          if (existingKey.expiresAt) {
            setExpiresAt(new Date(existingKey.expiresAt).toISOString().split('T')[0]);
            setNeverExpire(false);
          } else {
            setExpiresAt('');
            setNeverExpire(true);
          }
        }
      } else {
        // Reset form
        setKey('');
        setOriginalKey('');
        setName('');
        setNote('');
        setExpiresAt('');
        setNeverExpire(true);
        setError('');
      }
    };

    loadKeyData();
  }, [isAddKeyModalOpen, isEditing, existingKey]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!key.trim()) {
      setError(t('modals.addKey.error.requiredKey'));
      return;
    }

    if (!selectedProviderId) {
      setError(t('modals.addKey.error.noProvider'));
      return;
    }

    // 在编辑模式下，检查密钥是否被修改
    const keyTrimmed = key.trim();
    const isKeyChanged = !isEditing || keyTrimmed !== originalKey;

    try {
      // 构建数据
      if (isEditing && editKeyId) {
        // 编辑模式：只传递修改的字段
        const updateData: Partial<AddKeyForm> = {
          name: name.trim() || undefined,
          note: note.trim() || undefined,
          expiresAt: neverExpire ? undefined : expiresAt ? new Date(expiresAt) : undefined,
        };

        // 只有密钥被修改时才添加 key 字段
        if (isKeyChanged) {
          updateData.key = keyTrimmed;
        }

        await updateKey(editKeyId, updateData);
      } else {
        // 新增模式：传递所有数据
        const data: AddKeyForm = {
          key: keyTrimmed,
          name: name.trim() || undefined,
          note: note.trim() || undefined,
          expiresAt: neverExpire ? undefined : expiresAt ? new Date(expiresAt) : undefined,
        };
        await addKey(selectedProviderId, data);
      }
      toast.success(t('notifications.saveSuccess') || '保存成功');
      setAddKeyModalOpen(false);
    } catch (err) {
      const message = t('notifications.saveFailed') || '保存失败';
      toast.error(message);
    }
  };

  const handleClose = () => {
    setAddKeyModalOpen(false);
  };

  if (!isAddKeyModalOpen || !selectedProviderId) return null;

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
              {isEditing ? t('modals.editKey.title') : t('modals.addKey.title')}
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
              <label htmlFor="apiKey" className="block text-sm font-medium text-slate-700 mb-1.5">
                {t('modals.addKey.key')} <span className="text-red-500">*</span>
              </label>
              <input
                id="apiKey"
                type="text"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="sk-..."
                className="input font-mono py-2.5 px-3 text-sm"
                autoFocus
              />
            </div>

            <div>
              <label htmlFor="keyName" className="block text-sm font-medium text-slate-700 mb-1.5">
                {t('modals.addKey.name')}
              </label>
              <input
                id="keyName"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('modals.addKey.namePlaceholder')}
                className="input py-2.5 px-3 text-sm"
              />
            </div>

            <div>
              <label htmlFor="keyNote" className="block text-sm font-medium text-slate-700 mb-1.5">
                {t('modals.addKey.note')}
              </label>
              <textarea
                id="keyNote"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('modals.addKey.notePlaceholder')}
                rows={2}
                className="input resize-none py-2.5 px-3 text-sm"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="expiresAt" className="block text-sm font-medium text-slate-700">
                  {t('modals.addKey.expiresAt')}
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={neverExpire}
                    onChange={(e) => setNeverExpire(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-xs text-slate-600">{t('modals.addKey.neverExpires')}</span>
                </label>
              </div>
              <DatePicker
                value={expiresAt}
                onChange={setExpiresAt}
                disabled={neverExpire}
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
              >
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn-primary flex-1 py-2.5">
                {isEditing ? t('modals.editKey.save') : t('modals.addKey.submit')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
