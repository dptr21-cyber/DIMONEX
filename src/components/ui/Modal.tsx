/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/ui/Modal.tsx
 * Institutional matte modal dialog with 12px radius, ESC isolation, and #141C24 surface.
 */

import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  maxWidth?: string;
  preventClose?: boolean;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = 'max-w-lg',
  preventClose = false,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !preventClose) {
        onClose();
      }
    };
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.body.style.overflow = 'unset';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, preventClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="fixed inset-0 bg-[#090D12]/80 backdrop-blur-[2px]"
            onClick={() => {
              if (!preventClose) onClose();
            }}
            aria-hidden="true"
          />

          {/* Modal Surface */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className={`relative w-full ${maxWidth} rounded-[12px] bg-[#141C24] border border-[#2B3944] shadow-2xl p-5 text-[#E4EBEF] z-10`}
            role="dialog"
            aria-modal="true"
          >
            {(title || subtitle) && (
              <div className="flex items-start justify-between gap-4 mb-4 pb-3 border-b border-[#202B34]">
                <div>
                  {title && <h3 className="text-base font-semibold tracking-tight text-[#E4EBEF]">{title}</h3>}
                  {subtitle && <p className="text-xs text-[#A1AFB8] mt-0.5">{subtitle}</p>}
                </div>
                {!preventClose && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="p-1.5 rounded-[7px] text-[#71818B] hover:text-[#E4EBEF] hover:bg-[#1D2832] transition-colors cursor-pointer"
                    aria-label="Close dialog"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}

            <div className="max-h-[82vh] overflow-y-auto pr-0.5">
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
