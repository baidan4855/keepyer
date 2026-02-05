import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';

export default function LanguageSwitcher() {
  const { i18n } = useTranslation();

  const toggleLanguage = () => {
    const newLang = i18n.language === 'zh' ? 'en' : 'zh';
    i18n.changeLanguage(newLang);
  };

  return (
    <button
      onClick={toggleLanguage}
      className="flex items-center gap-2 px-3 py-2 rounded-lg text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition-all"
      title={i18n.language === 'zh' ? 'Switch to English' : '切换到中文'}
    >
      <Languages className="w-4 h-4" />
      <span className="text-sm font-medium">
        {i18n.language === 'zh' ? 'EN' : '中文'}
      </span>
    </button>
  );
}
