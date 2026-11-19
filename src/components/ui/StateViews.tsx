/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/ui/StateViews.tsx
 * EmptyState, ErrorState, and LoadingState for real API failure and blank states.
 */

import React from 'react';
import { AlertCircle, Inbox, Loader2, RefreshCw } from 'lucide-react';
import { Button } from './Button.js';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  className = '',
}) => (
  <div className={`flex flex-col items-center justify-center text-center py-10 px-4 ${className}`}>
    <div className="w-10 h-10 rounded-[10px] bg-[#17212B] border border-[#202B34] flex items-center justify-center text-[#71818B] mb-3">
      {icon || <Inbox className="w-5 h-5" />}
    </div>
    <p className="text-sm font-medium text-[#E4EBEF]">{title}</p>
    {description && <p className="text-xs text-[#71818B] mt-1 max-w-sm leading-relaxed">{description}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title = 'Failed to load data',
  message,
  onRetry,
  retryLabel = 'Retry',
  className = '',
}) => (
  <div
    className={`rounded-[10px] bg-[#401F27]/35 border border-[#EA5B65]/40 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${className}`}
    role="alert"
  >
    <div className="flex items-start gap-3">
      <AlertCircle className="w-4 h-4 text-[#EA5B65] shrink-0 mt-0.5" />
      <div>
        <p className="text-xs font-semibold text-[#E4EBEF]">{title}</p>
        <p className="text-xs text-[#A1AFB8] mt-0.5">{message}</p>
      </div>
    </div>
    {onRetry && (
      <Button
        variant="secondary"
        size="sm"
        onClick={onRetry}
        icon={<RefreshCw className="w-3.5 h-3.5" />}
      >
        {retryLabel}
      </Button>
    )}
  </div>
);

interface LoadingStateProps {
  label?: string;
  className?: string;
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  label = 'Loading data...',
  className = '',
}) => (
  <div className={`flex flex-col items-center justify-center py-10 px-4 text-[#71818B] ${className}`}>
    <Loader2 className="w-5 h-5 animate-spin text-[#8DA5B1] mb-2" />
    <span className="text-xs font-mono">{label}</span>
  </div>
);
