/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/components/ui/Toast.tsx
 * Lightweight notification toast system for crypto exchange events.
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
    setToasts(prev => [...prev, { id, type, title, description }]);

    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Toast container */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map(toast => {
          const isSuccess = toast.type === 'success';
          const isError = toast.type === 'error';
          const isWarning = toast.type === 'warning';

          return (
            <div
              key={toast.id}
              className="pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl bg-[#15171F] border border-[#292C38] shadow-2xl backdrop-blur-md transition-all duration-200 animate-in slide-in-from-bottom-2"
            >
              <div className="shrink-0 mt-0.5">
                {isSuccess && <CheckCircle2 className="w-4 h-4 text-[#00C087]" />}
                {isError && <AlertCircle className="w-4 h-4 text-[#EB3458]" />}
                {isWarning && <AlertTriangle className="w-4 h-4 text-[#F5B942]" />}
                {!isSuccess && !isError && !isWarning && <Info className="w-4 h-4 text-[#5B9DFF]" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-[#F5F5F7] leading-tight">{toast.title}</p>
                {toast.description && (
                  <p className="text-[11px] text-[#969BA8] mt-0.5 leading-snug">{toast.description}</p>
                )}
              </div>
              <button
                onClick={() => removeToast(toast.id)}
                className="shrink-0 text-[#686D7A] hover:text-[#F5F5F7] p-1 -mr-1 -mt-1 transition-colors"
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
