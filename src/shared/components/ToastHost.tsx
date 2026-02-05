import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useToastStore } from '@/shared/lib/toast';
import { cn } from '@/shared/lib/cn';

const variantStyles = {
  success: {
    container: 'border-emerald-200/70 bg-emerald-50/90 text-emerald-900',
    icon: 'text-emerald-600',
  },
  error: {
    container: 'border-red-200/70 bg-red-50/90 text-red-900',
    icon: 'text-red-600',
  },
  info: {
    container: 'border-primary-200/70 bg-primary-50/90 text-primary-900',
    icon: 'text-primary-600',
  },
} as const;

const variantIcons = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
} as const;

export default function ToastHost() {
  const { toasts, remove } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => {
        const styles = variantStyles[toast.variant];
        const Icon = variantIcons[toast.variant];

        return (
          <div
            key={toast.id}
            className={cn(
              'w-80 rounded-xl border shadow-soft-lg backdrop-blur-md px-4 py-3',
              'animate-slide-in-right',
              'pointer-events-auto',
              styles.container
            )}
          >
            <div className="flex items-start gap-3">
              <Icon className={cn('w-5 h-5 mt-0.5', styles.icon)} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{toast.title}</p>
                {toast.description && (
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                    {toast.description}
                  </p>
                )}
              </div>
              <button
                onClick={() => remove(toast.id)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-white/60 transition"
                aria-label="Close"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
