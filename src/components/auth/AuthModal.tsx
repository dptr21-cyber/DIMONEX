/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/components/auth/AuthModal.tsx
 * Login and Registration modal with 2FA TOTP handling and instant demo account presets.
 */

import React, { useState } from 'react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: (token: string, user: any) => void;
}

export const AuthModal: React.FC<Props> = ({ isOpen, onClose, onAuthSuccess }) => {
  const [tab, setTab] = useState<'LOGIN' | 'REGISTER'>('LOGIN');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [requiresTotp, setRequiresTotp] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    const endpoint = tab === 'LOGIN' ? '/api/auth/login' : '/api/auth/register';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, totpCode: requiresTotp ? totpCode : undefined })
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
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#0b0e14] border border-[#1e2633] rounded-xl max-w-md w-full p-6 space-y-4">
        {/* Header */}
        <div className="flex justify-between items-center border-b border-[#1e2633] pb-3">
          <div className="flex gap-4">
            <button
              onClick={() => { setTab('LOGIN'); setRequiresTotp(false); setErrorMessage(null); }}
              className={`text-sm font-bold pb-1 border-b-2 transition-colors ${
                tab === 'LOGIN' ? 'text-blue-400 border-blue-500' : 'text-slate-400 border-transparent'
              }`}
            >
              Masuk
            </button>
            <button
              onClick={() => { setTab('REGISTER'); setRequiresTotp(false); setErrorMessage(null); }}
              className={`text-sm font-bold pb-1 border-b-2 transition-colors ${
                tab === 'REGISTER' ? 'text-blue-400 border-blue-500' : 'text-slate-400 border-transparent'
              }`}
            >
              Daftar Akun
            </button>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
        </div>

        {errorMessage && (
          <div className="p-3 bg-red-950/40 border border-red-800 text-red-300 text-xs rounded">
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          <div>
            <label htmlFor="auth-email" className="block text-slate-300 mb-1">Email:</label>
            <input
              id="auth-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="nama@email.com"
              className="w-full bg-[#141a23] border border-[#1e2633] rounded p-2.5 text-slate-100 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label htmlFor="auth-password" className="block text-slate-300 mb-1">Kata Sandi:</label>
            <input
              id="auth-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Minimal 8 karakter"
              className="w-full bg-[#141a23] border border-[#1e2633] rounded p-2.5 text-slate-100 focus:outline-none focus:border-blue-500"
            />
          </div>

          {requiresTotp && (
            <div className="p-3 bg-blue-950/30 border border-blue-800 rounded space-y-1">
              <label htmlFor="auth-totp" className="block font-semibold text-blue-300">Masukkan 6-Digit Kode 2FA TOTP:</label>
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
                className="w-full bg-[#0b0e14] border border-[#1e2633] rounded p-2 font-mono text-center text-lg text-slate-100 tracking-widest focus:outline-none"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded transition-colors"
          >
            {isLoading ? 'Memproses...' : tab === 'LOGIN' ? 'Masuk ke Platform' : 'Daftar Akun Baru'}
          </button>
        </form>

        {/* Demo Fast Account Presets — Full 8 Test Accounts */}
        <div className="pt-3 border-t border-[#1e2633] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-400 font-semibold flex items-center gap-1.5">
              <span>🔑</span> Akun Pengujian Resmi (Pilih Cepat & Otomatis):
            </span>
            <span className="text-[10px] text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/60 font-mono">
              8 Akun Aktif
            </span>
          </div>

          <div className="max-h-52 overflow-y-auto pr-1 space-y-1.5 custom-scrollbar text-[11px]">
            {/* 1. Super Admin */}
            <div className="p-2 bg-[#141a23] hover:bg-[#1a2230] rounded border border-[#1e2633] transition-colors flex items-center justify-between group">
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="text-amber-400 font-bold">🛡️ Super Admin</span>
                  <span className="text-[9px] bg-red-950/80 text-red-300 px-1 rounded font-mono border border-red-800/60">ADMIN</span>
                </div>
                <div className="text-[10px] text-slate-400 font-mono flex items-center gap-2 mt-0.5">
                  <span>admin@dimonex.id</span>
                  <span className="text-slate-500">|</span>
                  <span className="text-amber-300/80">AdminDimonex2026!</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleQuickLogin('admin@dimonex.id', 'AdminDimonex2026!')}
                className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium text-[10px] transition-colors"
              >
                Pilih
              </button>
            </div>

            {/* 2. Compliance Officer */}
            <div className="p-2 bg-[#141a23] hover:bg-[#1a2230] rounded border border-[#1e2633] transition-colors flex items-center justify-between group">
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="text-purple-400 font-bold">⚖️ Compliance Officer</span>
                  <span className="text-[9px] bg-purple-950/80 text-purple-300 px-1 rounded font-mono border border-purple-800/60">ADMIN</span>
                </div>
                <div className="text-[10px] text-slate-400 font-mono flex items-center gap-2 mt-0.5">
                  <span>compliance@dimonex.id</span>
                  <span className="text-slate-500">|</span>
                  <span className="text-purple-300/80">ComplianceDimonex2026!</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleQuickLogin('compliance@dimonex.id', 'ComplianceDimonex2026!')}
                className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium text-[10px] transition-colors"
              >
                Pilih
              </button>
            </div>

            {/* 3. Market Maker Operator */}
            <div className="p-2 bg-[#141a23] hover:bg-[#1a2230] rounded border border-[#1e2633] transition-colors flex items-center justify-between group">
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="text-cyan-400 font-bold">⚡ Market Maker Operator</span>
                  <span className="text-[9px] bg-cyan-950/80 text-cyan-300 px-1 rounded font-mono border border-cyan-800/60">MM</span>
                </div>
                <div className="text-[10px] text-slate-400 font-mono flex items-center gap-2 mt-0.5">
                  <span>mm@dimonex.id</span>
                  <span className="text-slate-500">|</span>
                  <span className="text-cyan-300/80">MarketMaker2026!</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleQuickLogin('mm@dimonex.id', 'MarketMaker2026!')}
                className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium text-[10px] transition-colors"
              >
                Pilih
              </button>
            </div>

            {/* 4. Trader Budi */}
            <div className="p-2 bg-[#141a23] hover:bg-[#1a2230] rounded border border-[#1e2633] transition-colors flex items-center justify-between group">
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="text-blue-300 font-bold">👤 Budi Santoso</span>
                  <span className="text-[9px] bg-blue-950/80 text-blue-300 px-1 rounded font-mono border border-blue-800/60">TRADER 1</span>
                </div>
                <div className="text-[10px] text-slate-400 font-mono flex items-center gap-2 mt-0.5">
                  <span>budi@dimonex.id</span>
                  <span className="text-slate-500">|</span>
                  <span className="text-slate-300">TraderDimonex123!</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleQuickLogin('budi@dimonex.id', 'TraderDimonex123!')}
                className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium text-[10px] transition-colors"
              >
                Pilih
              </button>
            </div>

            {/* 5. Trader Siti */}
            <div className="p-2 bg-[#141a23] hover:bg-[#1a2230] rounded border border-[#1e2633] transition-colors flex items-center justify-between group">
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="text-emerald-300 font-bold">👤 Siti Rahmawati</span>
                  <span className="text-[9px] bg-emerald-950/80 text-emerald-300 px-1 rounded font-mono border border-emerald-800/60">TRADER 2</span>
                </div>
                <div className="text-[10px] text-slate-400 font-mono flex items-center gap-2 mt-0.5">
                  <span>siti@dimonex.id</span>
                  <span className="text-slate-500">|</span>
                  <span className="text-slate-300">TraderDimonex123!</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleQuickLogin('siti@dimonex.id', 'TraderDimonex123!')}
                className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium text-[10px] transition-colors"
              >
                Pilih
              </button>
            </div>

            {/* 6. User 1 */}
            <div className="p-2 bg-[#141a23] hover:bg-[#1a2230] rounded border border-[#1e2633] transition-colors flex items-center justify-between group">
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-200 font-bold">👤 User Satu Trading</span>
                  <span className="text-[9px] bg-slate-800 text-slate-300 px-1 rounded font-mono">USER 1</span>
                </div>
                <div className="text-[10px] text-slate-400 font-mono flex items-center gap-2 mt-0.5">
                  <span>user1@dimonex.id</span>
                  <span className="text-slate-500">|</span>
                  <span className="text-slate-300">User1Dimonex2026!</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleQuickLogin('user1@dimonex.id', 'User1Dimonex2026!')}
                className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium text-[10px] transition-colors"
              >
                Pilih
              </button>
            </div>

            {/* 7. User 2 */}
            <div className="p-2 bg-[#141a23] hover:bg-[#1a2230] rounded border border-[#1e2633] transition-colors flex items-center justify-between group">
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-200 font-bold">👤 User Dua Trading</span>
                  <span className="text-[9px] bg-slate-800 text-slate-300 px-1 rounded font-mono">USER 2</span>
                </div>
                <div className="text-[10px] text-slate-400 font-mono flex items-center gap-2 mt-0.5">
                  <span>user2@dimonex.id</span>
                  <span className="text-slate-500">|</span>
                  <span className="text-slate-300">User2Dimonex2026!</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleQuickLogin('user2@dimonex.id', 'User2Dimonex2026!')}
                className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium text-[10px] transition-colors"
              >
                Pilih
              </button>
            </div>

            {/* 8. Fresh Test User */}
            <div className="p-2 bg-[#141a23] hover:bg-[#1a2230] rounded border border-[#1e2633] transition-colors flex items-center justify-between group">
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="text-indigo-300 font-bold">✨ Akun Pengujian Baru</span>
                  <span className="text-[9px] bg-indigo-950/80 text-indigo-300 px-1 rounded font-mono border border-indigo-800/60">FRESH</span>
                </div>
                <div className="text-[10px] text-slate-400 font-mono flex items-center gap-2 mt-0.5">
                  <span>test@dimonex.id</span>
                  <span className="text-slate-500">|</span>
                  <span className="text-indigo-300/80">TestDimonex2026!</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleQuickLogin('test@dimonex.id', 'TestDimonex2026!')}
                className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium text-[10px] transition-colors"
              >
                Pilih
              </button>
            </div>
          </div>

          <div className="text-[10px] text-slate-500 text-center pt-1 flex items-center justify-center gap-1">
            <span>📖 Seluruh akun terdokumentasi lengkap di file</span>
            <span className="text-blue-400 font-mono font-medium">README_AKUN_TEST.md</span>
          </div>
        </div>
      </div>
    </div>
  );
};
