/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/ui/Toast.tsx
 * Institutional toast notification system for DIMONEX Obsidian Iridium.
 */

import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
}

interface ToastContextType {
  showToast: (type: ToastType, title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback((type: ToastType, title: string, description?: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    setToasts(prev => [...prev.slice(-4), { id, type, title, description }]);

    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  }, []);

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm w-[calc(100%-2rem)] sm:w-full pointer-events-none">
        {toasts.map(toast => {
          const isSuccess = toast.type === 'success';
          const isError = toast.type === 'error';
          const isWarning = toast.type === 'warning';

          const borderAccent = isSuccess
            ? 'border-l-[#35B887]'
            : isError
            ? 'border-l-[#EA5B65]'
            : isWarning
            ? 'border-l-[#D6A85C]'
            : 'border-l-[#6D9FE8]';

          return (
            <div
              key={toast.id}
              role="status"
              className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-[10px] bg-[#17212B] border border-[#2B3944] border-l-2 ${borderAccent} shadow-xl transition-all duration-150`}
            >
              <div className="shrink-0 mt-0.5">
                {isSuccess && <CheckCircle2 className="w-4 h-4 text-[#35B887]" />}
                {isError && <AlertCircle className="w-4 h-4 text-[#EA5B65]" />}
                {isWarning && <AlertTriangle className="w-4 h-4 text-[#D6A85C]" />}
                {!isSuccess && !isError && !isWarning && <Info className="w-4 h-4 text-[#6D9FE8]" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-[#E4EBEF] leading-tight">{toast.title}</p>
                {toast.description && (
                  <p className="text-[11px] text-[#A1AFB8] mt-1 leading-snug break-words">{toast.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeToast(toast.id)}
                className="shrink-0 text-[#71818B] hover:text-[#E4EBEF] p-1 -mr-1 -mt-1 rounded transition-colors cursor-pointer"
                aria-label="Close notification"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    return {
      showToast: (type: ToastType, title: string, description?: string) => {
        console.log(`[Toast ${type}]: ${title} - ${description || ''}`);
      }
    };
  }
  return context;
};
