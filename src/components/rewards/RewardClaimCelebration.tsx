/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/rewards/RewardClaimCelebration.tsx
 * Institutional Reward Claim Celebration Animation Overlay powered by motion/react.
 * Triggered strictly on real backend-settled Task Claims, Voucher Redemptions,
 * and Referral Commission Payouts with GPU-composited particle burst, SVG seal draw,
 * and tabular-nums USDT count-up animation.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Copy, History, X } from 'lucide-react';
import { Button } from '../ui/Button.js';

export interface ClaimCelebrationPayload {
  type: 'TASK_REWARD' | 'VOUCHER_REDEMPTION' | 'REFERRAL_COMMISSION';
  title: string;
  code?: string | null;
  amountUsdt: number;
  amountDisplay: string;
  journalId: string;
  settledAt: number;
}

interface Props {
  celebration: ClaimCelebrationPayload | null;
  onClose: () => void;
  onViewHistory: () => void;
  onCopyJournalId: (journalId: string) => void;
}

interface BurstParticle {
  id: number;
  x: number;
  y: number;
  rotate: number;
  size: number;
  color: string;
  delay: number;
  shape: 'diamond' | 'bar' | 'dot';
}

const PARTICLE_COLORS = ['#16A879', '#35B887', '#D6A85C', '#8DA5B1', '#E4EBEF'];

const TYPE_HEADINGS: Record<ClaimCelebrationPayload['type'], string> = {
  TASK_REWARD: 'Milestone Reward Settled',
  VOUCHER_REDEMPTION: 'Voucher Credited to Wallet',
  REFERRAL_COMMISSION: 'Referral Commission Settled'
};

export const RewardClaimCelebration: React.FC<Props> = ({
  celebration,
  onClose,
  onViewHistory,
  onCopyJournalId
}) => {
  const prefersReducedMotion = useReducedMotion();
  const [displayAmount, setDisplayAmount] = useState(0);

  // Deterministic geometric particle burst radiated symmetrically around the seal
  const particles = useMemo<BurstParticle[]>(() => {
    const count = 20;
    return Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2 + (i % 2 === 0 ? 0.08 : -0.08);
      const radius = 84 + (i % 3) * 30;
      return {
        id: i,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        rotate: Math.round((angle * 180) / Math.PI) + 45,
        size: i % 3 === 0 ? 7 : i % 3 === 1 ? 5 : 4,
        color: PARTICLE_COLORS[i % PARTICLE_COLORS.length],
        delay: (i % 4) * 0.035,
        shape: i % 3 === 0 ? 'diamond' : i % 3 === 1 ? 'bar' : 'dot'
      };
    });
  }, []);

  // Smooth ease-out-expo count-up for the credited USDT payout
  useEffect(() => {
    if (!celebration) {
      setDisplayAmount(0);
      return;
    }

    const target = Math.max(0, celebration.amountUsdt);
    if (prefersReducedMotion || target === 0) {
      setDisplayAmount(target);
      return;
    }

    let rafId = 0;
    const durationMs = 780;
    const start = performance.now();

    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / durationMs);
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      setDisplayAmount(target * eased);
      if (t < 1) {
        rafId = requestAnimationFrame(tick);
      } else {
        setDisplayAmount(target);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [celebration, prefersReducedMotion]);

  // Close cleanly on Escape
  useEffect(() => {
    if (!celebration) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [celebration, onClose]);

  const decimals = celebration && celebration.amountUsdt < 1 ? 4 : 2;

  return (
    <AnimatePresence>
      {celebration && (
        <motion.div
          key="reward-claim-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={TYPE_HEADINGS[celebration.type]}
          className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-[#06090D]/80 backdrop-blur-sm"
        >
          <motion.div
            key="reward-claim-card"
            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.88, y: 18 }}
            animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 10 }}
            transition={{ type: 'spring', stiffness: 360, damping: 26 }}
            onClick={e => e.stopPropagation()}
            className="relative w-full max-w-md rounded-[12px] bg-[#141C24] border border-[#2B3944] shadow-2xl overflow-hidden"
          >
            {/* Subtle top metallic sheen bar */}
            <motion.div
              initial={prefersReducedMotion ? { scaleX: 1 } : { scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="h-[2px] w-full origin-left bg-gradient-to-r from-[#16A879] via-[#D6A85C] to-[#8DA5B1]"
            />

            <button
              type="button"
              onClick={onClose}
              aria-label="Close settlement confirmation"
              className="absolute top-3.5 right-3.5 w-8 h-8 rounded-[7px] bg-[#111820] border border-[#202B34] hover:border-[#40515D] text-[#71818B] hover:text-[#E4EBEF] flex items-center justify-center transition-colors cursor-pointer z-10"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="px-6 pt-8 pb-6 flex flex-col items-center text-center">
              {/* Animated Emblem + Radial Particle Burst */}
              <div className="relative w-24 h-24 flex items-center justify-center mb-4">
                {!prefersReducedMotion && (
                  <>
                    {/* Expanding Halo Ring 1 */}
                    <motion.span
                      initial={{ scale: 0.65, opacity: 0.7 }}
                      animate={{ scale: 1.85, opacity: 0 }}
                      transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                      className="absolute inset-0 rounded-full border border-[#16A879]/70 pointer-events-none"
                    />
                    {/* Expanding Halo Ring 2 */}
                    <motion.span
                      initial={{ scale: 0.65, opacity: 0.45 }}
                      animate={{ scale: 2.2, opacity: 0 }}
                      transition={{ duration: 1.15, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
                      className="absolute inset-0 rounded-full border border-[#D6A85C]/45 pointer-events-none"
                    />

                    {/* Precision Radial Particle Burst */}
                    {particles.map(p => (
                      <motion.span
                        key={p.id}
                        initial={{ x: 0, y: 0, scale: 0, opacity: 0, rotate: 0 }}
                        animate={{
                          x: p.x,
                          y: p.y,
                          scale: [0, 1.15, 0.4],
                          opacity: [0, 1, 0],
                          rotate: p.rotate
                        }}
                        transition={{
                          duration: 0.95,
                          delay: 0.08 + p.delay,
                          ease: [0.16, 1, 0.3, 1]
                        }}
                        style={{
                          width: p.shape === 'bar' ? p.size * 2.1 : p.size,
                          height: p.shape === 'bar' ? 2.5 : p.size,
                          backgroundColor: p.color,
                          borderRadius: p.shape === 'dot' ? '9999px' : '1.5px'
                        }}
                        className="absolute pointer-events-none"
                      />
                    ))}
                  </>
                )}

                {/* Central Settlement Seal */}
                <motion.div
                  initial={prefersReducedMotion ? { scale: 1 } : { scale: 0.4, rotate: -18 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 20, delay: 0.05 }}
                  className="relative w-20 h-20 rounded-full bg-[#111820] border border-[#16A879]/60 flex items-center justify-center shadow-[0_0_32px_rgba(22,168,121,0.22)]"
                >
                  <svg
                    viewBox="0 0 48 48"
                    className="w-11 h-11"
                    fill="none"
                    aria-hidden="true"
                  >
                    <motion.circle
                      cx="24"
                      cy="24"
                      r="20"
                      stroke="#16A879"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      initial={prefersReducedMotion ? { pathLength: 1 } : { pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 0.48, ease: [0.16, 1, 0.3, 1], delay: 0.08 }}
                    />
                    <motion.path
                      d="M15.5 24.5L21.5 30.5L33 18.5"
                      stroke="#35B887"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      initial={prefersReducedMotion ? { pathLength: 1 } : { pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1], delay: 0.32 }}
                    />
                  </svg>
                </motion.div>
              </div>

              {/* Settlement Title & Metadata */}
              <motion.div
                initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.16 }}
                className="space-y-1"
              >
                <p className="text-xs font-medium text-[#16A879]">
                  {TYPE_HEADINGS[celebration.type]}
                </p>
                <h3 className="text-base font-semibold text-[#E4EBEF] px-2">
                  {celebration.title}
                </h3>
              </motion.div>

              {/* Animated Count-Up USDT Payout */}
              <motion.div
                initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: 'spring', stiffness: 320, damping: 24, delay: 0.22 }}
                className="mt-4 mb-5"
              >
                <div className="font-mono tabular-nums text-3xl font-semibold tracking-tight text-[#16A879]">
                  +{displayAmount.toLocaleString('en-US', {
                    minimumFractionDigits: decimals,
                    maximumFractionDigits: decimals
                  })}{' '}
                  <span className="text-lg text-[#A1AFB8] font-medium">USDT</span>
                </div>
                <p className="text-xs text-[#71818B] mt-1">
                  Credited atomically to your DIMONEX Spot Wallet
                </p>
              </motion.div>

              {/* Verified Ledger Receipt Strip */}
              <motion.div
                initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.3 }}
                className="w-full rounded-[8px] bg-[#111820] border border-[#202B34] p-3.5 text-left space-y-2 text-xs font-mono tabular-nums"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-sans text-[#71818B]">Settlement Status</span>
                  <span className="text-[#16A879] font-semibold">SETTLED</span>
                </div>
                {celebration.code && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-sans text-[#71818B]">Reference Code</span>
                    <span className="text-[#E4EBEF]">{celebration.code}</span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-3 pt-1.5 border-t border-[#202B34]">
                  <span className="font-sans text-[#71818B]">Ledger Journal</span>
                  <button
                    type="button"
                    onClick={() => onCopyJournalId(celebration.journalId)}
                    className="inline-flex items-center gap-1.5 text-[#A1AFB8] hover:text-[#E4EBEF] transition-colors cursor-pointer"
                    title="Copy full Ledger Journal ID"
                  >
                    <span>{celebration.journalId.slice(0, 16)}…</span>
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
              </motion.div>

              {/* Actions */}
              <motion.div
                initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: 0.36 }}
                className="w-full mt-5 flex items-center gap-2.5"
              >
                <Button
                  variant="secondary"
                  size="md"
                  icon={<History className="w-3.5 h-3.5" />}
                  onClick={onViewHistory}
                  className="flex-1"
                >
                  Rewards History
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  onClick={onClose}
                  className="flex-1"
                >
                  Done
                </Button>
              </motion.div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
