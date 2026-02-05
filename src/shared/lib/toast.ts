import { create } from 'zustand';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
  duration?: number;
}

interface ToastState {
  toasts: ToastItem[];
  add: (toast: Omit<ToastItem, 'id'> & { id?: string }) => void;
  remove: (id: string) => void;
}

const createId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  add: (toast) => {
    const id = toast.id ?? createId();
    const duration = toast.duration ?? 3000;
    const entry: ToastItem = { ...toast, id, duration };

    set((state) => ({ toasts: [...state.toasts, entry] }));

    if (duration > 0) {
      window.setTimeout(() => {
        get().remove(id);
      }, duration);
    }
  },
  remove: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

export const toast = {
  success: (title: string, description?: string, duration?: number) =>
    useToastStore.getState().add({ title, description, duration, variant: 'success' }),
  error: (title: string, description?: string, duration?: number) =>
    useToastStore.getState().add({ title, description, duration, variant: 'error' }),
  info: (title: string, description?: string, duration?: number) =>
    useToastStore.getState().add({ title, description, duration, variant: 'info' }),
};
