/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/ui/ConfirmationDialog.tsx
 * Accessible Obsidian Iridium modal replacement for native confirm() and prompt().
 */

import React, { useState, useEffect } from 'react';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { Modal } from './Modal.js';
import { Button } from './Button.js';
import { Input } from './Input.js';

export interface DialogField {
  key: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  type?: 'text' | 'number' | 'password';
  required?: boolean;
}

interface ConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'brand' | 'danger' | 'warning' | 'buy';
  fields?: DialogField[];
  onConfirm: (values: Record<string, string>) => void | Promise<void>;
  isLoading?: boolean;
}

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  isOpen,
  onClose,
  title,
  description,
  confirmLabel = 'Konfirmasi',
  cancelLabel = 'Batal',
  tone = 'brand',
  fields,
  onConfirm,
  isLoading = false,
}) => {
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isOpen) {
      const init: Record<string, string> = {};
      (fields || []).forEach(f => {
        init[f.key] = f.defaultValue ?? '';
      });
      setValues(init);
    }
  }, [isOpen, fields]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onConfirm(values);
  };

  const buttonVariant =
    tone === 'danger' ? 'danger' : tone === 'buy' ? 'profit' : 'primary';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} maxWidth="max-w-md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div
          className={`flex items-start gap-3 p-3 rounded-[7px] border text-xs leading-relaxed ${
            tone === 'danger'
              ? 'bg-[#401F27]/40 border-[#EA5B65]/35 text-[#E4EBEF]'
              : tone === 'warning'
              ? 'bg-[#2C2415]/60 border-[#D6A85C]/35 text-[#E4EBEF]'
              : 'bg-[#17212B] border-[#202B34] text-[#A1AFB8]'
          }`}
        >
          {tone === 'danger' ? (
            <ShieldAlert className="w-4 h-4 text-[#EA5B65] shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-[#D6A85C] shrink-0 mt-0.5" />
          )}
          <p>{description}</p>
        </div>

        {fields && fields.length > 0 && (
          <div className="space-y-3">
            {fields.map(field => (
              <Input
                key={field.key}
                label={field.label}
                type={field.type || 'text'}
                placeholder={field.placeholder}
                required={field.required}
                value={values[field.key] ?? ''}
                onChange={e =>
                  setValues(prev => ({
                    ...prev,
                    [field.key]: e.target.value,
                  }))
                }
              />
            ))}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#202B34]">
          <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={isLoading}>
            {cancelLabel}
          </Button>
          <Button type="submit" variant={buttonVariant} size="sm" isLoading={isLoading}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
