/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/kyc/KycView.tsx
 * Indonesian Identity Verification (KYC) Wizard in Obsidian Iridium matte theme.
 */

import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { UserProfile } from '../../types/index.js';
import { PageHeader } from '../ui/PanelHeader.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { Button } from '../ui/Button.js';
import { Input } from '../ui/Input.js';

interface Props {
  user: UserProfile | null;
  onKycUpdated: () => void;
  onOpenAuthModal: () => void;
}

export const KycView: React.FC<Props> = ({ user, onKycUpdated, onOpenAuthModal }) => {
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [nik, setNik] = useState('');
  const [birthDate, setBirthDate] = useState('1995-05-15');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!user) {
    return (
      <div className="flex-1 p-6 bg-[#090D12] flex items-center justify-center">
        <div className="max-w-md w-full p-8 text-center bg-[#141C24] border border-[#202B34] rounded-[10px]">
          <h2 className="text-base font-semibold text-[#E4EBEF] mb-2">Verifikasi Identitas KYC</h2>
          <p className="text-xs text-[#71818B] mb-5">Silakan masuk ke akun Anda terlebih dahulu.</p>
          <Button variant="primary" size="md" onClick={onOpenAuthModal}>
            Masuk Akun
          </Button>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (nik.trim().length !== 16) {
      setErrorMessage('Nomor Induk Kependudukan (NIK) harus tepat 16 digit angka');
      return;
    }

    setIsSubmitting(true);
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/kyc/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          fullName: fullName.trim(),
          nik: nik.trim(),
          birthDate
        })
      });

      let data: any = {};
      if (res.headers.get('content-type')?.includes('application/json')) {
        data = await res.json();
      }
      if (!res.ok) throw new Error(data.error || `Gagal mengajukan KYC (HTTP ${res.status})`);

      setSuccessMessage(data.message);
      onKycUpdated();
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex-1 bg-[#090D12] p-4 lg:p-6 overflow-y-auto">
      <div className="max-w-2xl mx-auto space-y-6">
        <PageHeader
          title="Verifikasi Identitas Resmi (KYC)"
          subtitle="Standar kepatuhan Bappebti & OJK untuk verifikasi data kependudukan Indonesia."
          badge={
            <StatusBadge tone={user.kycStatus === 'approved' ? 'buy' : 'warning'}>
              {user.kycStatus === 'approved' ? 'Terverifikasi (Tier 1)' : 'Belum Diverifikasi'}
            </StatusBadge>
          }
        />

        <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6 text-xs">
            <div className="bg-[#111820] border border-[#202B34] p-3.5 rounded-[7px]">
              <span className="text-[#71818B] block mb-1">Batas Transaksi Harian (Tier 1)</span>
              <span className="font-mono tabular-nums font-semibold text-[#E4EBEF]">Rp 25.000.000 / hari</span>
            </div>
            <div className="bg-[#111820] border border-[#202B34] p-3.5 rounded-[7px]">
              <span className="text-[#71818B] block mb-1">Batas Transaksi Lanjutan (Tier 2)</span>
              <span className="font-mono tabular-nums font-semibold text-[#E4EBEF]">Rp 500.000.000 / hari</span>
            </div>
          </div>

          {user.kycStatus === 'approved' ? (
            <div className="bg-[#12392F] border border-[#16A879]/40 p-4 rounded-[7px] text-xs text-[#E4EBEF] space-y-1.5">
              <div className="font-semibold text-sm text-[#16A879] flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" />
                Akun Anda Telah Terverifikasi
              </div>
              <div>
                Nama Lengkap: <span className="font-semibold text-[#E4EBEF]">{user.fullName || 'Terdaftar'}</span>
              </div>
              <div className="text-[#A1AFB8]">Tingkat Limit: Tier 1 (Maksimal Rp 25.000.000 / hari)</div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              {errorMessage && (
                <div className="p-3 bg-[#401F27] border border-[#EA5B65]/40 text-[#EA5B65] rounded-[7px]">
                  {errorMessage}
                </div>
              )}
              {successMessage && (
                <div className="p-3 bg-[#12392F] border border-[#16A879]/40 text-[#16A879] rounded-[7px]">
                  {successMessage}
                </div>
              )}

              <Input
                label="Nama Lengkap (Sesuai KTP)"
                type="text"
                required
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="Contoh: Budi Santoso"
              />

              <Input
                label="Nomor Induk Kependudukan (NIK - 16 Digit)"
                type="text"
                required
                maxLength={16}
                value={nik}
                onChange={e => setNik(e.target.value.replace(/\D/g, ''))}
                placeholder="3273012908850003"
                className="font-mono tabular-nums"
              />

              <Input
                label="Tanggal Lahir"
                type="date"
                required
                value={birthDate}
                onChange={e => setBirthDate(e.target.value)}
              />

              <div className="grid grid-cols-2 gap-4 pt-1">
                <div className="border border-dashed border-[#2B3944] p-4 rounded-[7px] text-center bg-[#111820]">
                  <span className="text-[#A1AFB8] block mb-1">Foto KTP Fisik</span>
                  <span className="text-[11px] text-[#16A879]">Dokumen KTP Terlampir</span>
                </div>
                <div className="border border-dashed border-[#2B3944] p-4 rounded-[7px] text-center bg-[#111820]">
                  <span className="text-[#A1AFB8] block mb-1">Foto Selfie + Liveness</span>
                  <span className="text-[11px] text-[#16A879]">Liveness Check Siap</span>
                </div>
              </div>

              <Button type="submit" variant="primary" size="lg" className="w-full" isLoading={isSubmitting}>
                {isSubmitting ? 'Memverifikasi Data Dukcapil...' : 'Kirim Verifikasi Identitas'}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
