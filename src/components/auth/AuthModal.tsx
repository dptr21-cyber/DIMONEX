/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/auth/AuthModal.tsx
 * Login and Registration modal with 2FA TOTP handling and instant demo account presets.
 */

import React, { useState } from 'react';
import { Shield, KeyRound, AlertCircle } from 'lucide-react';
import { Modal } from '../ui/Modal.js';
import { Input } from '../ui/Input.js';
import { Button } from '../ui/Button.js';
import { SegmentedTabs } from '../ui/Tabs.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { DimonexIcon, DIMONEX_HERO_BANNER_SRC } from '../ui/DimonexBrand.js';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: (token: string, user: any) => void;
}

const TEST_ACCOUNTS = [
  {
    label: 'Super Admin',
    role: 'ADMIN',
    tone: 'danger' as const,
    email: 'admin@dimonex.id',
    pass: 'AdminDimonex2026!',
  },
  {
    label: 'Compliance Officer',
    role: 'ADMIN',
    tone: 'info' as const,
    email: 'compliance@dimonex.id',
    pass: 'ComplianceDimonex2026!',
  },
  {
    label: 'Market Maker Operator',
    role: 'MM',
    tone: 'brand' as const,
    email: 'mm@dimonex.id',
    pass: 'MarketMaker2026!',
  },
  {
    label: 'Budi Santoso',
    role: 'TRADER 1',
    tone: 'success' as const,
    email: 'budi@dimonex.id',
    pass: 'TraderDimonex123!',
  },
  {
    label: 'Siti Rahmawati',
    role: 'TRADER 2',
    tone: 'success' as const,
    email: 'siti@dimonex.id',
    pass: 'TraderDimonex123!',
  },
  {
    label: 'User Satu Trading',
    role: 'USER 1',
    tone: 'neutral' as const,
    email: 'user1@dimonex.id',
    pass: 'User1Dimonex2026!',
  },
  {
    label: 'User Dua Trading',
    role: 'USER 2',
    tone: 'neutral' as const,
    email: 'user2@dimonex.id',
    pass: 'User2Dimonex2026!',
  },
  {
    label: 'Akun Pengujian Baru',
    role: 'FRESH',
    tone: 'warning' as const,
    email: 'test@dimonex.id',
    pass: 'TestDimonex2026!',
  },
];

export const AuthModal: React.FC<Props> = ({ isOpen, onClose, onAuthSuccess }) => {
  const [tab, setTab] = useState<'LOGIN' | 'REGISTER'>('LOGIN');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [requiresTotp, setRequiresTotp] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const BLOCKED_DOMAINS = ['forexzig.com'];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (tab === 'REGISTER') {
      const domain = email.trim().toLowerCase().split('@')[1]?.replace(/\.+$/, '') || '';
      const matchedBlocked = BLOCKED_DOMAINS.find(b => domain === b || domain.endsWith(`.${b}`));
      if (matchedBlocked) {
        setErrorMessage(`Pendaftaran dari domain ${matchedBlocked} diblokir untuk mencegah spam dan akun bot.`);
        return;
      }
    }

    setIsLoading(true);
    const endpoint = tab === 'LOGIN' ? '/api/auth/login' : '/api/auth/register';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, totpCode: requiresTotp ? totpCode : undefined }),
      });

      let data: any = {};
      if (res.headers.get('content-type')?.includes('application/json')) {
        data = await res.json();
      }
      if (!res.ok) throw new Error(data.error || `Gagal autentikasi (HTTP ${res.status})`);

      if (data.requiresTotp) {
        setRequiresTotp(true);
        setIsLoading(false);
        return;
      }

      localStorage.setItem('dimonex_auth_token', data.token);
      onAuthSuccess(data.token, data.user);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickLogin = (quickEmail: string, quickPass: string) => {
    setEmail(quickEmail);
    setPassword(quickPass);
    setRequiresTotp(false);
    setErrorMessage(null);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="DIMONEX Access Portal"
      subtitle="Precision in Every Trade · Double-Entry Exchange Session"
      maxWidth="max-w-md"
    >
      <div className="space-y-4">
        <div className="rounded-[8px] bg-[#070A0F] border border-[#202B34] px-3 py-2.5 overflow-hidden">
          <img
            src={DIMONEX_HERO_BANNER_SRC}
            alt="DIMONEX — Precision in Every Trade"
            className="w-full max-h-[76px] object-contain object-center mx-auto select-none"
            draggable={false}
          />
        </div>

        <SegmentedTabs
          fullWidth
          activeTab={tab}
          onChange={next => {
            setTab(next);
            setRequiresTotp(false);
            setErrorMessage(null);
          }}
          tabs={[
            { id: 'LOGIN', label: 'Masuk' },
            { id: 'REGISTER', label: 'Daftar Akun' },
          ]}
        />

        {errorMessage && (
          <div className="p-3 bg-[#401F27]/50 border border-[#EA5B65]/40 text-[#EA5B65] text-xs rounded-[7px] flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <Input
            id="auth-email"
            name="email"
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="nama@email.com"
          />

          <Input
            id="auth-password"
            name="password"
            label="Kata Sandi"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Minimal 8 karakter"
          />

          {requiresTotp && (
            <div className="p-3 bg-[#162436]/50 border border-[#6D9FE8]/40 rounded-[7px] space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#6D9FE8]">
                <Shield className="w-3.5 h-3.5" />
                <span>Masukkan 6-Digit Kode 2FA TOTP</span>
              </div>
              <input
                id="auth-totp"
                name="totpCode"
                type="text"
                autoComplete="one-time-code"
                required
                maxLength={6}
                value={totpCode}
                onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                className="w-full bg-[#090D12] border border-[#2B3944] rounded-[7px] p-2 font-mono text-center text-lg text-[#E4EBEF] tracking-widest focus:outline-none focus:border-[#8DA5B1]"
              />
            </div>
          )}

          <Button type="submit" variant="primary" size="md" isLoading={isLoading} className="w-full">
            {tab === 'LOGIN' ? 'Masuk ke Platform' : 'Daftar Akun Baru'}
          </Button>
        </form>

        {/* Demo Fast Account Presets — Full 8 Test Accounts */}
        <div className="pt-3 border-t border-[#202B34] space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-[#A1AFB8] font-medium flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-[#8DA5B1]" />
              Akun Pengujian Resmi (Isi Cepat):
            </span>
            <StatusBadge tone="success">8 Akun Aktif</StatusBadge>
          </div>

          <div className="max-h-52 overflow-y-auto pr-1 space-y-1.5 scrollbar-thin">
            {TEST_ACCOUNTS.map(acc => (
              <div
                key={acc.email}
                className="p-2.5 bg-[#111820] hover:bg-[#17212B] rounded-[7px] border border-[#202B34] hover:border-[#2B3944] transition-colors flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[#E4EBEF] truncate">{acc.label}</span>
                    <StatusBadge tone={acc.tone}>{acc.role}</StatusBadge>
                  </div>
                  <div className="text-[10px] text-[#71818B] font-mono truncate mt-0.5">
                    {acc.email} · {acc.pass}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleQuickLogin(acc.email, acc.pass)}
                  className="px-2.5 py-1 bg-[#1D2832] hover:bg-[#222F3A] text-[#E4EBEF] border border-[#2B3944] rounded-[5px] font-medium text-[10px] transition-colors shrink-0 cursor-pointer"
                >
                  Pilih
                </button>
              </div>
            ))}
          </div>

          <div className="text-[10px] text-[#71818B] text-center pt-1 flex items-center justify-center gap-1.5">
            <DimonexIcon size="xs" />
            <span>Seluruh akun terdokumentasi di</span>
            <span className="text-[#A5BAC4] font-mono font-medium">README_AKUN_TEST.md</span>
          </div>
        </div>
      </div>
    </Modal>
  );
};
