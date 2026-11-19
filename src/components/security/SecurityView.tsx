/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/security/SecurityView.tsx
 * Security panel: RFC-6238 2FA TOTP, API Key issuance with HMAC signing, and device sessions.
 * Uses ConfirmationDialog & useToast (zero native alert/confirm/prompt).
 */

import React, { useState, useEffect } from 'react';
import { ShieldCheck, KeyRound, Laptop } from 'lucide-react';
import { UserProfile } from '../../types/index.js';
import { formatDateTime } from '../../lib/formatters.js';
import { PageHeader } from '../ui/PanelHeader.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { Button } from '../ui/Button.js';
import { Input } from '../ui/Input.js';
import { CopyButton } from '../ui/Controls.js';
import { ConfirmationDialog } from '../ui/ConfirmationDialog.js';
import { useToast } from '../ui/Toast.js';

interface Props {
  user: UserProfile | null;
  onUserUpdated: () => void;
  onOpenAuthModal: () => void;
}

export const SecurityView: React.FC<Props> = ({ user, onUserUpdated, onOpenAuthModal }) => {
  const { showToast } = useToast();

  // 2FA state
  const [totpSecretData, setTotpSecretData] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [totpInputCode, setTotpInputCode] = useState('');
  const [totpMessage, setTotpMessage] = useState<string | null>(null);
  const [totpError, setTotpError] = useState<string | null>(null);
  const [isDisable2faDialogOpen, setIsDisable2faDialogOpen] = useState(false);

  // API Keys state
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [newKeyLabel, setNewKeyLabel] = useState('Trading Bot Alpha');
  const [newKeyIp, setNewKeyIp] = useState('');
  const [issuedSecret, setIssuedSecret] = useState<any>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [revokeKeyId, setRevokeKeyId] = useState<string | null>(null);

  // Sessions state
  const [sessions, setSessions] = useState<any[]>([]);

  useEffect(() => {
    if (user) {
      loadApiKeys();
      loadSessions();
    }
  }, [user]);

  const loadApiKeys = async () => {
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/api-keys/list', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json();
        setApiKeys(data);
      }
    } catch {}
  };

  const loadSessions = async () => {
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/auth/sessions', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json();
        setSessions(data);
      }
    } catch {}
  };

  const handleGenerate2fa = async () => {
    setTotpError(null);
    setTotpMessage(null);
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/auth/2fa/generate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      let data: any = {};
      if (res.headers.get('content-type')?.includes('application/json')) {
        data = await res.json();
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setTotpSecretData(data);
    } catch (err: any) {
      setTotpError(err.message);
    }
  };

  const handleEnable2fa = async () => {
    setTotpError(null);
    setTotpMessage(null);
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/auth/2fa/enable', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ code: totpInputCode })
      });
      let data: any = {};
      if (res.headers.get('content-type')?.includes('application/json')) {
        data = await res.json();
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setTotpMessage('2FA TOTP berhasil diaktifkan untuk akun Anda!');
      setTotpSecretData(null);
      setTotpInputCode('');
      onUserUpdated();
    } catch (err: any) {
      setTotpError(err.message);
    }
  };

  const handleConfirmDisable2fa = async (values: Record<string, string>) => {
    const code = (values.code || '').trim();
    if (!code) return;
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/auth/2fa/disable', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ code })
      });
      let data: any = {};
      if (res.headers.get('content-type')?.includes('application/json')) {
        data = await res.json();
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setIsDisable2faDialogOpen(false);
      showToast('success', '2FA Dinonaktifkan', 'Autentikasi dua faktor telah dinonaktifkan.');
      onUserUpdated();
    } catch (err: any) {
      showToast('error', 'Gagal Menonaktifkan 2FA', err.message || 'Kode TOTP tidak valid.');
    }
  };

  const handleCreateApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setKeyError(null);
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/api-keys/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          label: newKeyLabel,
          permissions: ['read', 'trade'],
          ipWhitelist: newKeyIp
        })
      });
      let data: any = {};
      if (res.headers.get('content-type')?.includes('application/json')) {
        data = await res.json();
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setIssuedSecret(data);
      loadApiKeys();
      showToast('success', 'API Key Dibuat', 'Simpan API Secret Anda sekarang.');
    } catch (err: any) {
      setKeyError(err.message);
    }
  };

  const handleConfirmRevokeKey = async () => {
    if (!revokeKeyId) return;
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      await fetch('/api/api-keys/revoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ id: revokeKeyId })
      });
      setRevokeKeyId(null);
      loadApiKeys();
      showToast('info', 'API Key Dicabut', 'Kunci akses API telah dinonaktifkan secara permanen.');
    } catch (err: any) {
      showToast('error', 'Gagal Mencabut Kunci', err?.message || 'Terjadi kesalahan.');
    }
  };

  if (!user) {
    return (
      <div className="flex-1 p-6 bg-[#090D12] flex items-center justify-center">
        <div className="max-w-md w-full p-8 text-center bg-[#141C24] border border-[#202B34] rounded-[10px]">
          <h2 className="text-base font-semibold text-[#E4EBEF] mb-2">Pengaturan Keamanan</h2>
          <p className="text-xs text-[#71818B] mb-5">Masuk untuk mengelola 2FA TOTP dan Kunci API akun Anda.</p>
          <Button variant="primary" size="md" onClick={onOpenAuthModal}>
            Masuk Akun
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-[#090D12] p-4 lg:p-6 overflow-y-auto">
      <div className="max-w-4xl mx-auto space-y-6">
        <PageHeader
          title="Security & Access Control"
          subtitle="Kelola proteksi RFC-6238 TOTP, API Key HMAC-SHA256, dan daftar sesi perangkat aktif."
        />

        {/* 2FA Card */}
        <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-5 lg:p-6">
          <div className="flex items-center justify-between border-b border-[#202B34] pb-4 mb-4">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="w-4 h-4 text-[#8DA5B1]" />
              <div>
                <h3 className="text-sm font-semibold text-[#E4EBEF]">Autentikasi Dua Faktor (2FA TOTP)</h3>
                <p className="text-xs text-[#71818B] mt-0.5">
                  Lindungi akun dengan Google Authenticator atau aplikasi TOTP standar.
                </p>
              </div>
            </div>
            <StatusBadge tone={user.isTotpEnabled ? 'buy' : 'neutral'}>
              {user.isTotpEnabled ? 'Aktif' : 'Tidak Aktif'}
            </StatusBadge>
          </div>

          {totpError && (
            <div className="p-3 mb-3 bg-[#401F27] border border-[#EA5B65]/40 text-[#EA5B65] text-xs rounded-[7px]">
              {totpError}
            </div>
          )}
          {totpMessage && (
            <div className="p-3 mb-3 bg-[#12392F] border border-[#16A879]/40 text-[#16A879] text-xs rounded-[7px]">
              {totpMessage}
            </div>
          )}

          {!user.isTotpEnabled ? (
            <div>
              {!totpSecretData ? (
                <Button variant="primary" size="sm" onClick={handleGenerate2fa}>
                  Aktifkan 2FA Sekarang
                </Button>
              ) : (
                <div className="space-y-4 text-xs">
                  <div className="p-4 bg-[#111820] border border-[#202B34] rounded-[7px] space-y-2">
                    <span className="text-[#A1AFB8] block font-medium">
                      1. Masukkan Secret Key ini ke Aplikasi Authenticator:
                    </span>
                    <div className="flex items-center justify-between gap-2 p-2.5 bg-[#141C24] border border-[#2B3944] rounded-[7px]">
                      <span className="font-mono text-[#C1D0D6] font-semibold tracking-wider text-sm select-all">
                        {totpSecretData.secret}
                      </span>
                      <CopyButton text={totpSecretData.secret} label="Salin" />
                    </div>
                    <span className="text-[#71818B] text-[11px] block font-mono break-all">
                      URI: {totpSecretData.otpauthUrl}
                    </span>
                  </div>

                  <div className="space-y-2">
                    <span className="text-[#E4EBEF] block font-medium">
                      2. Masukkan 6 Digit Kode dari Authenticator:
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="text"
                        maxLength={6}
                        value={totpInputCode}
                        onChange={e => setTotpInputCode(e.target.value.replace(/\D/g, ''))}
                        placeholder="123456"
                        className="w-44 bg-[#111820] border border-[#2B3944] rounded-[7px] px-3 py-2 font-mono text-center text-base text-[#E4EBEF] tracking-widest focus:outline-none focus:border-[#8DA5B1]"
                      />
                      <Button variant="profit" size="md" onClick={handleEnable2fa}>
                        Verifikasi &amp; Aktifkan
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Button variant="danger" size="sm" onClick={() => setIsDisable2faDialogOpen(true)}>
              Nonaktifkan 2FA
            </Button>
          )}
        </div>

        {/* API Keys Card */}
        <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-5 lg:p-6">
          <div className="border-b border-[#202B34] pb-4 mb-4 flex items-center gap-2.5">
            <KeyRound className="w-4 h-4 text-[#8DA5B1]" />
            <div>
              <h3 className="text-sm font-semibold text-[#E4EBEF]">Kunci API Publik (HMAC-SHA256)</h3>
              <p className="text-xs text-[#71818B] mt-0.5">
                Digunakan oleh bot trading algo. Penarikan dana via API dinonaktifkan demi perlindungan modal.
              </p>
            </div>
          </div>

          {issuedSecret && (
            <div className="p-4 mb-4 bg-[#12392F]/70 border border-[#16A879]/40 rounded-[7px] text-xs space-y-2">
              <div className="font-semibold text-[#16A879]">KUNCI API BERHASIL DIBUAT (SIMPAN SEKARANG):</div>
              <div>
                <span className="text-[#A1AFB8]">API Key:</span>
                <div className="flex items-center justify-between gap-2 p-2 bg-[#111820] border border-[#202B34] font-mono text-[#E4EBEF] rounded-[5px] mt-0.5">
                  <span className="select-all truncate">{issuedSecret.apiKey}</span>
                  <CopyButton text={issuedSecret.apiKey} />
                </div>
              </div>
              <div>
                <span className="text-[#A1AFB8]">API Secret (Hanya tampil satu kali ini):</span>
                <div className="flex items-center justify-between gap-2 p-2 bg-[#111820] border border-[#202B34] font-mono text-[#16A879] font-semibold rounded-[5px] mt-0.5">
                  <span className="select-all truncate">{issuedSecret.apiSecret}</span>
                  <CopyButton text={issuedSecret.apiSecret} />
                </div>
              </div>
            </div>
          )}

          {keyError && (
            <div className="p-3 mb-3 bg-[#401F27] border border-[#EA5B65]/40 text-[#EA5B65] text-xs rounded-[7px]">
              {keyError}
            </div>
          )}

          <form onSubmit={handleCreateApiKey} className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6 text-xs">
            <Input
              label="Label Kunci"
              value={newKeyLabel}
              onChange={e => setNewKeyLabel(e.target.value)}
            />
            <Input
              label="IP Whitelist (Opsional)"
              value={newKeyIp}
              onChange={e => setNewKeyIp(e.target.value)}
              placeholder="e.g. 103.24.12.5"
            />
            <div className="flex items-end">
              <Button type="submit" variant="primary" size="md" className="w-full">
                Generate API Key
              </Button>
            </div>
          </form>

          <div className="space-y-2">
            {apiKeys.length === 0 ? (
              <div className="text-xs text-[#71818B] py-4 text-center">Belum ada Kunci API yang aktif</div>
            ) : (
              apiKeys.map(k => (
                <div
                  key={k.id}
                  className="flex items-center justify-between p-3 bg-[#111820] border border-[#202B34] rounded-[7px] text-xs font-mono"
                >
                  <div>
                    <span className="font-sans font-semibold text-[#E4EBEF] block">{k.label}</span>
                    <span className="text-[#A1AFB8] text-[11px]">{k.keyId}</span>
                    <span className="text-[#71818B] text-[11px] block mt-0.5">Izin: {k.permissions.join(', ')}</span>
                  </div>
                  <Button variant="danger" size="sm" onClick={() => setRevokeKeyId(k.id)}>
                    Cabut Kunci
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Active Sessions */}
        <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-5 lg:p-6">
          <div className="flex items-center gap-2.5 mb-4">
            <Laptop className="w-4 h-4 text-[#8DA5B1]" />
            <h3 className="text-sm font-semibold text-[#E4EBEF]">Daftar Sesi &amp; Perangkat Aktif</h3>
          </div>
          <div className="space-y-2">
            {sessions.map((s, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-3 bg-[#111820] border border-[#202B34] rounded-[7px] text-xs"
              >
                <div>
                  <span className="font-semibold text-[#E4EBEF] block">{s.device}</span>
                  <span className="text-[#71818B] font-mono text-[11px]">
                    IP: {s.ip} · Kedaluwarsa: {formatDateTime(s.expiresAt)}
                  </span>
                </div>
                {s.isCurrent && <StatusBadge tone="buy">Perangkat Ini</StatusBadge>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Disable 2FA Dialog */}
      <ConfirmationDialog
        isOpen={isDisable2faDialogOpen}
        onClose={() => setIsDisable2faDialogOpen(false)}
        title="Nonaktifkan Autentikasi 2FA"
        description="Masukkan kode 6-digit TOTP dari aplikasi Authenticator Anda untuk menonaktifkan proteksi 2FA."
        confirmLabel="Nonaktifkan 2FA"
        tone="danger"
        fields={[
          {
            key: 'code',
            label: 'Kode 6-Digit TOTP',
            placeholder: '123456',
            required: true,
          },
        ]}
        onConfirm={handleConfirmDisable2fa}
      />

      {/* Revoke API Key Dialog */}
      <ConfirmationDialog
        isOpen={Boolean(revokeKeyId)}
        onClose={() => setRevokeKeyId(null)}
        title="Cabut Kunci API"
        description="Bot atau sistem eksternal yang menggunakan kunci API ini akan langsung kehilangan akses perdagangan."
        confirmLabel="Ya, Cabut Kunci"
        tone="danger"
        onConfirm={handleConfirmRevokeKey}
      />
    </div>
  );
};
