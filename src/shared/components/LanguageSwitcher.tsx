import { useTranslation } from 'react-i18next';

export default function LanguageSwitcher() {
  const { i18n } = useTranslation();

  const toggleLanguage = () => {
    const newLang = i18n.language === 'zh' ? 'en' : 'zh';
    i18n.changeLanguage(newLang);
  };

  const label = i18n.language === 'zh' ? 'EN' : '中';

  return (
    <button
      onClick={toggleLanguage}
      className="p-2 rounded-lg text-slate-400 hover:text-primary-600 hover:bg-primary-50 transition-all"
      title={i18n.language === 'zh' ? 'Switch to English' : '切换到中文'}
      aria-label={i18n.language === 'zh' ? 'Switch to English' : '切换到中文'}
    >
      <span className="w-4 h-4 flex items-center justify-center text-[10px] font-semibold leading-none">
        {label}
      </span>
    </button>
  );
}
