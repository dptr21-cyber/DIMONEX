/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/admin/AssetManagementSection.tsx
 * Admin Console module for managing Cryptocurrency & Fiat Assets:
 * - Upload or link custom coin/token logo/icon (PNG, JPG, WebP, SVG) with live multi-size preview
 * - Edit asset details (Full Name, Asset Type, Category, Network, Contract Address, Description, Links)
 * - Edit asset decimals (0-18) with automatic synchronization across linked trading pairs
 * - Manage operational flags (Status, Deposit Enabled, Withdrawal Enabled)
 * - Register new crypto assets
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Search,
  Plus,
  Pencil,
  Upload,
  Trash2,
  RefreshCw,
  Image as ImageIcon,
  AlertTriangle,
  CheckCircle2,
  Globe,
  ExternalLink,
  Layers,
  Hash,
  ArrowDownLeft,
  ArrowUpRight
} from 'lucide-react';
import { AssetItem } from '../../types/index.js';
import { AssetIcon } from '../ui/AssetIcon.js';
import { Button } from '../ui/Button.js';
import { Modal } from '../ui/Modal.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { loadAssetRegistry, updateLocalAssetCache } from '../../lib/assetRegistry.js';

interface Props {
  onRefreshPairs: () => void;
  onNotify: (type: 'success' | 'error', text: string) => void;
}

type AssetFilter = 'ALL' | 'CUSTOM_LOGO' | 'NO_LOGO' | 'TOKEN' | 'NATIVE';

const CATEGORY_OPTIONS = [
  'Layer 1',
  'Layer 2',
  'Stablecoin',
  'DeFi',
  'Meme',
  'Utility',
  'Gaming',
  'AI',
  'RWA',
  'Token',
  'Fiat'
];

const NETWORK_SUGGESTIONS = [
  'BITCOIN',
  'ETHEREUM',
  'SOLANA',
  'TRON',
  'BSC',
  'POLYGON',
  'ARBITRUM',
  'OPTIMISM',
  'BASE',
  'TON',
  'DOGECOIN',
  'AVALANCHE',
  'FIAT'
];

interface AssetFormState {
  id?: string;
  symbol: string;
  name: string;
  logoUrl: string;
  assetType: 'NATIVE' | 'TOKEN';
  category: string;
  decimals: string;
  network: string;
  contractAddress: string;
  description: string;
  websiteUrl: string;
  explorerUrl: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'RETIRED';
  depositEnabled: boolean;
  withdrawalEnabled: boolean;
  linkedPairs: string[];
}

const EMPTY_FORM: AssetFormState = {
  symbol: '',
  name: '',
  logoUrl: '',
  assetType: 'TOKEN',
  category: 'Token',
  decimals: '8',
  network: 'ETHEREUM',
  contractAddress: '',
  description: '',
  websiteUrl: '',
  explorerUrl: '',
  status: 'ACTIVE',
  depositEnabled: true,
  withdrawalEnabled: true,
  linkedPairs: []
};

/**
 * Resize uploaded raster image to max 160x160 PNG/WebP data URI so icons stay ultra-sharp
 * across Market rows & headers while keeping server state lightweight.
 */
async function processUploadedLogoFile(file: File): Promise<string> {
  const allowedTypes = [
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/gif',
    'image/svg+xml'
  ];
  if (!allowedTypes.includes(file.type)) {
    throw new Error('Format file tidak didukung. Gunakan PNG, JPG, WebP, GIF, atau SVG.');
  }
  if (file.size > 4 * 1024 * 1024) {
    throw new Error('Ukuran file terlalu besar (maksimal 4 MB sebelum kompresi).');
  }

  // SVG: read directly as base64 data URI (keep vector crispness)
  if (file.type === 'image/svg+xml') {
    const text = await file.text();
    if (/<script[\s>]|on[a-z]+\s*=|javascript:/i.test(text)) {
      throw new Error('File SVG tidak boleh mengandung script atau event handler.');
    }
    if (text.length > 250_000) {
      throw new Error('File SVG terlalu besar (maksimal 250 KB).');
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Gagal membaca file SVG.'));
      reader.readAsDataURL(file);
    });
  }

  // Raster image: draw onto clean 160x160 square canvas (aspect-ratio preserved, centered)
  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('File gambar tidak dapat diproses.'));
    el.src = rawDataUrl;
  });

  const targetSize = 160;
  const canvas = document.createElement('canvas');
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) return rawDataUrl;

  ctx.clearRect(0, 0, targetSize, targetSize);
  const scale = Math.min(targetSize / img.width, targetSize / img.height);
  const drawW = img.width * scale;
  const drawH = img.height * scale;
  const offsetX = (targetSize - drawW) / 2;
  const offsetY = (targetSize - drawH) / 2;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, offsetX, offsetY, drawW, drawH);

  const webpData = canvas.toDataURL('image/webp', 0.9);
  const pngData = canvas.toDataURL('image/png');
  return webpData.startsWith('data:image/webp') && webpData.length < pngData.length
    ? webpData
    : pngData;
}

export const AssetManagementSection: React.FC<Props> = ({ onRefreshPairs, onNotify }) => {
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<AssetFilter>('ALL');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'CREATE' | 'EDIT'>('EDIT');
  const [form, setForm] = useState<AssetFormState>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchAssets = useCallback(async () => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;
    setIsLoading(true);
    try {
      const res = await fetch('/api/admin/assets', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.assets)) {
        setAssets(data.assets);
      } else {
        onNotify('error', data.error || 'Gagal memuat daftar aset kripto.');
      }
    } catch (err: any) {
      onNotify('error', err?.message || 'Koneksi ke server aset gagal.');
    } finally {
      setIsLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  const stats = useMemo(() => {
    const total = assets.length;
    const withLogo = assets.filter(a => Boolean(a.logoUrl && a.logoUrl.trim())).length;
    const active = assets.filter(a => a.status === 'ACTIVE').length;
    return {
      total,
      withLogo,
      withoutLogo: total - withLogo,
      active
    };
  }, [assets]);

  const filteredAssets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assets.filter(a => {
      if (filter === 'CUSTOM_LOGO' && !(a.logoUrl && a.logoUrl.trim())) return false;
      if (filter === 'NO_LOGO' && Boolean(a.logoUrl && a.logoUrl.trim())) return false;
      if (filter === 'TOKEN' && a.assetType !== 'TOKEN') return false;
      if (filter === 'NATIVE' && a.assetType !== 'NATIVE') return false;

      if (!q) return true;
      return (
        a.symbol.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.network.toLowerCase().includes(q) ||
        (a.category || '').toLowerCase().includes(q) ||
        (a.contractAddress || '').toLowerCase().includes(q)
      );
    });
  }, [assets, search, filter]);

  const openCreateModal = () => {
    setModalMode('CREATE');
    setForm(EMPTY_FORM);
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (asset: AssetItem) => {
    setModalMode('EDIT');
    setForm({
      id: asset.id,
      symbol: asset.symbol,
      name: asset.name,
      logoUrl: asset.logoUrl || '',
      assetType: asset.assetType,
      category: asset.category || (asset.network === 'FIAT' ? 'Fiat' : asset.assetType === 'NATIVE' ? 'Layer 1' : 'Token'),
      decimals: String(asset.decimals),
      network: asset.network,
      contractAddress: asset.contractAddress || '',
      description: asset.description || '',
      websiteUrl: asset.websiteUrl || '',
      explorerUrl: asset.explorerUrl || '',
      status: asset.status,
      depositEnabled: asset.depositEnabled,
      withdrawalEnabled: asset.withdrawalEnabled,
      linkedPairs: asset.linkedPairs || []
    });
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setFormError(null);
    setIsUploadingLogo(true);
    try {
      const processedDataUri = await processUploadedLogoFile(file);
      setForm(prev => ({ ...prev, logoUrl: processedDataUri }));
    } catch (err: any) {
      setFormError(err?.message || 'Gagal memproses file gambar.');
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const parsedDecimals = Number(form.decimals);
    if (!Number.isInteger(parsedDecimals) || parsedDecimals < 0 || parsedDecimals > 18) {
      setFormError('Desimal aset harus bilangan bulat antara 0 sampai 18.');
      return;
    }

    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) {
      setFormError('Sesi admin tidak valid. Silakan login kembali.');
      return;
    }

    setIsSaving(true);
    try {
      const endpoint =
        modalMode === 'EDIT' && form.id
          ? `/api/admin/assets/${encodeURIComponent(form.id)}`
          : '/api/admin/assets';
      const method = modalMode === 'EDIT' ? 'PUT' : 'POST';

      const payload = {
        symbol: form.symbol.trim().toUpperCase(),
        name: form.name.trim(),
        logoUrl: form.logoUrl.trim(),
        assetType: form.assetType,
        category: form.category.trim(),
        decimals: parsedDecimals,
        network: form.network.trim().toUpperCase(),
        contractAddress: form.contractAddress.trim(),
        description: form.description.trim(),
        websiteUrl: form.websiteUrl.trim(),
        explorerUrl: form.explorerUrl.trim(),
        status: form.status,
        depositEnabled: form.depositEnabled,
        withdrawalEnabled: form.withdrawalEnabled
      };

      const res = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (!res.ok) {
        setFormError(data.error || 'Gagal menyimpan perubahan aset.');
        return;
      }

      if (data.asset) {
        updateLocalAssetCache(data.asset);
      }
      await Promise.all([fetchAssets(), loadAssetRegistry(true)]);
      onRefreshPairs();
      setIsModalOpen(false);
      onNotify('success', data.message || `Aset ${payload.symbol} berhasil disimpan.`);
    } catch (err: any) {
      setFormError(err?.message || 'Terjadi kesalahan jaringan saat menyimpan aset.');
    } finally {
      setIsSaving(false);
    }
  };

  const statusTone = (status: AssetItem['status']) => {
    if (status === 'ACTIVE') return 'success';
    if (status === 'PENDING') return 'warning';
    if (status === 'SUSPENDED') return 'danger';
    return 'neutral';
  };

  return (
    <div className="space-y-5">
      {/* Header & Primary Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[#E4EBEF]">
            Manajemen Aset Kripto, Logo / Ikon &amp; Presisi Desimal
          </h3>
          <p className="text-xs text-[#A1AFB8]">
            Ubah logo koin/token, nama lengkap, jaringan, detail proyek, serta jumlah desimal agar tampilan di Pasar, Trading, Futures, dan Dompet menggunakan identitas asli aset.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Button
            variant="secondary"
            size="sm"
            onClick={fetchAssets}
            disabled={isLoading}
            icon={<RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />}
          >
            Muat Ulang
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={openCreateModal}
            icon={<Plus className="w-4 h-4" />}
          >
            Tambah Aset Baru
          </Button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-[10px] bg-[#141C24] border border-[#202B34]">
          <span className="text-[11px] text-[#A1AFB8] block">Total Aset Terdaftar</span>
          <span className="text-lg font-bold font-mono tabular-nums text-[#E4EBEF] mt-0.5 block">
            {stats.total} Aset
          </span>
        </div>
        <div className="p-3.5 rounded-[10px] bg-[#141C24] border border-[#202B34]">
          <span className="text-[11px] text-[#A1AFB8] block">Logo Kustom Aktif</span>
          <span className="text-lg font-bold font-mono tabular-nums text-[#35B887] mt-0.5 block">
            {stats.withLogo} / {stats.total}
          </span>
        </div>
        <div className="p-3.5 rounded-[10px] bg-[#141C24] border border-[#202B34]">
          <span className="text-[11px] text-[#A1AFB8] block">Masih Default Monogram</span>
          <span className={`text-lg font-bold font-mono tabular-nums mt-0.5 block ${stats.withoutLogo > 0 ? 'text-[#D6A85C]' : 'text-[#35B887]'}`}>
            {stats.withoutLogo} Aset
          </span>
        </div>
        <div className="p-3.5 rounded-[10px] bg-[#141C24] border border-[#202B34]">
          <span className="text-[11px] text-[#A1AFB8] block">Status Aset Aktif</span>
          <span className="text-lg font-bold font-mono tabular-nums text-[#6D9FE8] mt-0.5 block">
            {stats.active} Aktif
          </span>
        </div>
      </div>

      {/* Search & Filter Controls */}
      <div className="p-3.5 rounded-[10px] bg-[#141C24] border border-[#202B34] flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 text-[#71818B] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Cari simbol, nama koin, jaringan, atau contract address..."
            className="w-full h-9 pl-9 pr-3 rounded-[7px] bg-[#111820] border border-[#2B3944] text-xs text-[#E4EBEF] placeholder:text-[#71818B] focus:outline-none focus:border-[#8DA5B1]"
          />
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {(
            [
              { id: 'ALL', label: 'Semua' },
              { id: 'CUSTOM_LOGO', label: 'Ada Logo' },
              { id: 'NO_LOGO', label: 'Belum Ada Logo' },
              { id: 'NATIVE', label: 'Native Coin' },
              { id: 'TOKEN', label: 'Token' }
            ] as { id: AssetFilter; label: string }[]
          ).map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`px-2.5 py-1.5 rounded-[6px] text-xs font-semibold transition-colors cursor-pointer ${
                filter === tab.id
                  ? 'bg-[#1D2832] text-[#E4EBEF] border border-[#40515D]'
                  : 'bg-[#111820] text-[#A1AFB8] border border-transparent hover:text-[#E4EBEF] hover:bg-[#17212B]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Assets Directory Table */}
      <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#17212B] text-[11px] text-[#A1AFB8] border-b border-[#202B34]">
              <tr>
                <th className="px-4 py-3 font-semibold">Aset &amp; Logo</th>
                <th className="px-4 py-3 font-semibold">Jaringan &amp; Tipe</th>
                <th className="px-4 py-3 font-semibold">Desimal &amp; Pair Pasar</th>
                <th className="px-4 py-3 font-semibold">Deposit / Withdraw</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#202B34]">
              {filteredAssets.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-[#71818B]">
                    Tidak ada aset yang cocok dengan filter pencarian.
                  </td>
                </tr>
              ) : (
                filteredAssets.map(asset => {
                  const hasCustomLogo = Boolean(asset.logoUrl && asset.logoUrl.trim());
                  return (
                    <tr
                      key={asset.id}
                      className="hover:bg-[#17212B]/70 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <AssetIcon
                            symbol={asset.symbol}
                            logoUrl={asset.logoUrl || undefined}
                            size="md"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-[#E4EBEF] text-xs">
                                {asset.symbol}
                              </span>
                              <span className="text-[#A1AFB8] truncate max-w-[180px]">
                                {asset.name}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {hasCustomLogo ? (
                                <span className="inline-flex items-center gap-1 text-[10px] text-[#35B887] font-mono">
                                  <CheckCircle2 className="w-3 h-3" /> Logo Kustom
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] text-[#71818B] font-mono">
                                  <ImageIcon className="w-3 h-3" /> Default Monogram
                                </span>
                              )}
                              {asset.category && (
                                <span className="text-[10px] text-[#71818B]">
                                  · {asset.category}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3 font-mono">
                        <div className="text-[#E4EBEF] font-semibold">{asset.network}</div>
                        <div className="text-[10px] text-[#71818B] flex items-center gap-1.5 mt-0.5">
                          <span>{asset.assetType}</span>
                          {asset.contractAddress && (
                            <span
                              title={asset.contractAddress}
                              className="text-[#8DA5B1] truncate max-w-[130px]"
                            >
                              · {asset.contractAddress.slice(0, 8)}...{asset.contractAddress.slice(-4)}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-3 font-mono tabular-nums">
                        <div className="flex items-center gap-1.5">
                          <span className="px-2 py-0.5 rounded bg-[#111820] border border-[#2B3944] text-[#C1D0D6] font-semibold text-[11px]">
                            {asset.decimals} desimal
                          </span>
                        </div>
                        <div className="text-[10px] text-[#71818B] mt-1">
                          {asset.linkedPairs && asset.linkedPairs.length > 0 ? (
                            <span>Pair: {asset.linkedPairs.join(', ')}</span>
                          ) : (
                            <span>Belum ada pair aktif</span>
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-3 font-mono text-[11px]">
                        <div className="flex items-center gap-3">
                          <span
                            className={`inline-flex items-center gap-1 ${
                              asset.depositEnabled ? 'text-[#35B887]' : 'text-[#EA5B65]'
                            }`}
                          >
                            <ArrowDownLeft className="w-3 h-3" />
                            Dep: {asset.depositEnabled ? 'ON' : 'OFF'}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 ${
                              asset.withdrawalEnabled ? 'text-[#35B887]' : 'text-[#EA5B65]'
                            }`}
                          >
                            <ArrowUpRight className="w-3 h-3" />
                            WD: {asset.withdrawalEnabled ? 'ON' : 'OFF'}
                          </span>
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <StatusBadge tone={statusTone(asset.status)}>
                          {asset.status}
                        </StatusBadge>
                      </td>

                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => openEditModal(asset)}
                          icon={<Pencil className="w-3.5 h-3.5" />}
                        >
                          Edit Aset
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit / Create Asset Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => !isSaving && setIsModalOpen(false)}
        title={
          modalMode === 'EDIT'
            ? `Edit Aset Kripto — ${form.symbol}`
            : 'Tambah Aset Kripto Baru'
        }
        subtitle={
          modalMode === 'EDIT'
            ? 'Perubahan logo, detail aset, dan presisi desimal langsung diterapkan ke halaman Pasar, Trading, Futures, dan Dompet.'
            : 'Daftarkan koin atau token baru beserta logo kustom dan konfigurasi desimalnya.'
        }
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleSubmit} className="space-y-5">
          {formError && (
            <div className="p-3 rounded-[8px] bg-[#401F27]/70 border border-[#EA5B65]/50 text-xs text-[#E4EBEF] flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-[#EA5B65] shrink-0 mt-0.5" />
              <span>{formError}</span>
            </div>
          )}

          {/* SECTION 1: LOGO / ICON UPLOADER & LIVE PREVIEW */}
          <div className="p-4 rounded-[10px] bg-[#111820] border border-[#202B34] space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-[#8DA5B1]" />
                <span className="text-xs font-semibold text-[#E4EBEF]">
                  Logo / Ikon Aset Kripto
                </span>
              </div>
              {form.logoUrl && (
                <button
                  type="button"
                  onClick={() => setForm(prev => ({ ...prev, logoUrl: '' }))}
                  className="inline-flex items-center gap-1 text-[11px] text-[#EA5B65] hover:text-[#F16D76] cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" /> Hapus Logo (Kembali ke Default)
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
              {/* Live multi-size preview */}
              <div className="md:col-span-5 p-3 rounded-[8px] bg-[#141C24] border border-[#202B34] space-y-3">
                <div className="flex items-center gap-3">
                  <AssetIcon
                    symbol={form.symbol || 'NEW'}
                    logoUrl={form.logoUrl}
                    size="xl"
                  />
                  <div className="space-y-1">
                    <span className="text-[10px] text-[#71818B] block uppercase tracking-wider">
                      Pratinjau Pasar
                    </span>
                    <div className="flex items-center gap-2">
                      <AssetIcon symbol={form.symbol || 'NEW'} logoUrl={form.logoUrl} size="sm" />
                      <div>
                        <span className="text-xs font-mono font-bold text-[#E4EBEF] block leading-tight">
                          {(form.symbol || 'TOKEN').toUpperCase()}/IDR
                        </span>
                        <span className="text-[10px] text-[#71818B] block leading-tight">
                          {form.name || 'Nama Aset'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-2 border-t border-[#202B34] text-[10px] text-[#71818B] font-mono">
                  <span>Ukuran:</span>
                  <AssetIcon symbol={form.symbol || 'NEW'} logoUrl={form.logoUrl} size="md" />
                  <AssetIcon symbol={form.symbol || 'NEW'} logoUrl={form.logoUrl} size="sm" />
                  <AssetIcon symbol={form.symbol || 'NEW'} logoUrl={form.logoUrl} size="xs" />
                </div>
              </div>

              {/* Upload controls + URL input */}
              <div className="md:col-span-7 space-y-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
                  onChange={handleFileChange}
                  className="hidden"
                />

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={isUploadingLogo}
                    onClick={() => fileInputRef.current?.click()}
                    icon={<Upload className="w-3.5 h-3.5" />}
                  >
                    {isUploadingLogo ? 'Memproses Gambar...' : 'Upload Logo (PNG / SVG / WebP)'}
                  </Button>
                  <span className="text-[10px] text-[#71818B]">
                    Otomatis dioptimalkan ke 160×160 px
                  </span>
                </div>

                <div>
                  <label className="text-[11px] text-[#A1AFB8] block mb-1">
                    Atau masukkan URL Gambar Langsung (HTTPS)
                  </label>
                  <input
                    type="text"
                    value={form.logoUrl.startsWith('data:image/') ? '' : form.logoUrl}
                    onChange={e => setForm(prev => ({ ...prev, logoUrl: e.target.value }))}
                    placeholder={
                      form.logoUrl.startsWith('data:image/')
                        ? 'Logo file lokal terpasang (ketik URL https:// untuk mengganti)'
                        : 'https://assets.coingecko.com/coins/images/...'
                    }
                    className="w-full h-9 px-3 rounded-[7px] bg-[#141C24] border border-[#2B3944] text-xs font-mono text-[#E4EBEF] placeholder:text-[#71818B] focus:outline-none focus:border-[#8DA5B1]"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 2: IDENTITAS & DETAIL ASET */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#E4EBEF]">
              <Layers className="w-4 h-4 text-[#8DA5B1]" />
              <span>Detail Identitas Aset</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-[#A1AFB8] block mb-1">
                  Simbol Koin / Token *
                </label>
                <input
                  type="text"
                  required
                  disabled={modalMode === 'EDIT'}
                  value={form.symbol}
                  onChange={e =>
                    setForm(prev => ({
                      ...prev,
                      symbol: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
                    }))
                  }
                  placeholder="Contoh: BTC, SOL, PEPE"
                  className="w-full h-9 px-3 rounded-[7px] bg-[#111820] border border-[#2B3944] text-xs font-mono text-[#E4EBEF] disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:border-[#8DA5B1]"
                />
              </div>

              <div>
                <label className="text-[11px] text-[#A1AFB8] block mb-1">
                  Nama Lengkap Aset *
                </label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Contoh: Bitcoin, Solana, Tether USD"
                  className="w-full h-9 px-3 rounded-[7px] bg-[#111820] border border-[#2B3944] text-xs text-[#E4EBEF] focus:outline-none focus:border-[#8DA5B1]"
                />
              </div>

              <div>
                <label className="text-[11px] text-[#A1AFB8] block mb-1">Tipe Aset</label>
                <select
                  value={form.assetType}
                  onChange={e =>
                    setForm(prev => ({
                      ...prev,
                      assetType: e.target.value as 'NATIVE' | 'TOKEN'
                    }))
                  }
                  className="w-full h-9 px-3 rounded-[7px] bg-[#111820] border border-[#2B3944] text-xs text-[#E4EBEF] focus:outline-none focus:border-[#8DA5B1]"
                >
                  <option value="NATIVE">NATIVE (Coin Utama Jaringan)</option>
                  <option value="TOKEN">TOKEN (Smart Contract Token)</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] text-[#A1AFB8] block mb-1">Kategori</label>
                <select
                  value={form.category}
                  onChange={e => setForm(prev => ({ ...prev, category: e.target.value }))}
                  className="w-full h-9 px-3 rounded-[7px] bg-[#111820] border border-[#2B3944] text-xs text-[#E4EBEF] focus:outline-none focus:border-[#8DA5B1]"
                >
                  {CATEGORY_OPTIONS.map(cat => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] text-[#A1AFB8] block mb-1">Jaringan (Network) *</label>
                <input
                  type="text"
                  required
                  list="dimonex-network-list"
                  value={form.network}
                  onChange={e => setForm(prev => ({ ...prev, network: e.target.value.toUpperCase() }))}
                  placeholder="ETHEREUM / SOLANA / TRON / BSC"
                  className="w-full h-9 px-3 rounded-[7px] bg-[#111820] border border-[#2B3944] text-xs font-mono text-[#E4EBEF] focus:outline-none focus:border-[#8DA5B1]"
                />
                <datalist id="dimonex-network-list">
                  {NETWORK_SUGGESTIONS.map(n => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="text-[11px] text-[#A1AFB8] block mb-1">
                  Contract Address (Opsional)
                </label>
                <input
                  type="text"
                  value={form.contractAddress}
                  onChange={e => setForm(prev => ({ ...prev, contractAddress: e.target.value }))}
                  placeholder="0x... / TR7NHq... / SPL mint address"
                  className="w-full h-9 px-3 rounded-[7px] bg-[#111820] border border-[#2B3944] text-xs font-mono text-[#E4EBEF] focus:outline-none focus:border-[#8DA5B1]"
                />
              </div>

              <div>
                <label className="text-[11px] text-[#A1AFB8] flex items-center gap-1 mb-1">
                  <Globe className="w-3 h-3 text-[#71818B]" /> Website Resmi (Opsional)
                </label>
                <input
                  type="url"
                  value={form.websiteUrl}
                  onChange={e => setForm(prev => ({ ...prev, websiteUrl: e.target.value }))}
                  placeholder="https://bitcoin.org"
                  className="w-full h-9 px-3 rounded-[7px] bg-[#111820] border border-[#2B3944] text-xs font-mono text-[#E4EBEF] focus:outline-none focus:border-[#8DA5B1]"
                />
              </div>

              <div>
                <label className="text-[11px] text-[#A1AFB8] flex items-center gap-1 mb-1">
                  <ExternalLink className="w-3 h-3 text-[#71818B]" /> Block Explorer URL (Opsional)
                </label>
                <input
                  type="url"
                  value={form.explorerUrl}
                  onChange={e => setForm(prev => ({ ...prev, explorerUrl: e.target.value }))}
                  placeholder="https://etherscan.io/token/..."
                  className="w-full h-9 px-3 rounded-[7px] bg-[#111820] border border-[#2B3944] text-xs font-mono text-[#E4EBEF] focus:outline-none focus:border-[#8DA5B1]"
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] text-[#A1AFB8] block mb-1">
                Deskripsi Aset (Ditampilkan di detail pasar)
              </label>
              <textarea
                rows={2}
                value={form.description}
                onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Ringkasan singkat utilitas, jaringan, dan latar belakang koin/token..."
                className="w-full p-2.5 rounded-[7px] bg-[#111820] border border-[#2B3944] text-xs text-[#E4EBEF] placeholder:text-[#71818B] focus:outline-none focus:border-[#8DA5B1]"
              />
            </div>
          </div>

          {/* SECTION 3: DESIMAL & OPERASIONAL */}
          <div className="p-4 rounded-[10px] bg-[#111820] border border-[#202B34] space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#E4EBEF]">
              <Hash className="w-4 h-4 text-[#8DA5B1]" />
              <span>Presisi Desimal &amp; Status Operasional</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-[#A1AFB8] block mb-1">
                  Desimal Aset (0 – 18) *
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={18}
                    step={1}
                    required
                    value={form.decimals}
                    onChange={e => setForm(prev => ({ ...prev, decimals: e.target.value }))}
                    className="w-24 h-9 px-3 rounded-[7px] bg-[#141C24] border border-[#2B3944] text-xs font-mono tabular-nums text-[#E4EBEF] focus:outline-none focus:border-[#8DA5B1]"
                  />
                  <div className="flex items-center gap-1">
                    {[2, 4, 6, 8, 18].map(preset => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setForm(prev => ({ ...prev, decimals: String(preset) }))}
                        className={`px-2 py-1 rounded-[5px] text-[11px] font-mono cursor-pointer border ${
                          form.decimals === String(preset)
                            ? 'bg-[#1D2832] border-[#8DA5B1] text-[#E4EBEF]'
                            : 'bg-[#141C24] border-[#202B34] text-[#71818B] hover:text-[#E4EBEF]'
                        }`}
                      >
                        {preset}d
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="text-[11px] text-[#A1AFB8] block mb-1">Status Aset</label>
                <select
                  value={form.status}
                  onChange={e =>
                    setForm(prev => ({
                      ...prev,
                      status: e.target.value as AssetFormState['status']
                    }))
                  }
                  className="w-full h-9 px-3 rounded-[7px] bg-[#141C24] border border-[#2B3944] text-xs text-[#E4EBEF] focus:outline-none focus:border-[#8DA5B1]"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="PENDING">PENDING</option>
                  <option value="SUSPENDED">SUSPENDED</option>
                  <option value="RETIRED">RETIRED</option>
                </select>
              </div>
            </div>

            {modalMode === 'EDIT' && form.linkedPairs.length > 0 && (
              <div className="p-2.5 rounded-[7px] bg-[#2C2415]/60 border border-[#D6A85C]/30 text-[11px] text-[#E4EBEF] flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-[#D6A85C] shrink-0 mt-0.5" />
                <span>
                  Perubahan desimal aset <span className="font-mono font-semibold">{form.symbol}</span> akan otomatis disinkronkan ke pair:{' '}
                  <span className="font-mono text-[#D6A85C]">{form.linkedPairs.join(', ')}</span>.
                </span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-6 pt-1">
              <label className="inline-flex items-center gap-2 text-xs text-[#E4EBEF] cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.depositEnabled}
                  onChange={e => setForm(prev => ({ ...prev, depositEnabled: e.target.checked }))}
                  className="rounded border-[#40515D] bg-[#141C24] accent-[#16A879]"
                />
                <span>Deposit Aktif</span>
              </label>

              <label className="inline-flex items-center gap-2 text-xs text-[#E4EBEF] cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.withdrawalEnabled}
                  onChange={e => setForm(prev => ({ ...prev, withdrawalEnabled: e.target.checked }))}
                  className="rounded border-[#40515D] bg-[#141C24] accent-[#16A879]"
                />
                <span>Penarikan (Withdrawal) Aktif</span>
              </label>
            </div>
          </div>

          {/* Modal Footer Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#202B34]">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={isSaving}
              onClick={() => setIsModalOpen(false)}
            >
              Batal
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={isSaving || isUploadingLogo}
            >
              {isSaving
                ? 'Menyimpan...'
                : modalMode === 'EDIT'
                ? 'Simpan Perubahan Aset'
                : 'Daftarkan Aset Kripto'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
