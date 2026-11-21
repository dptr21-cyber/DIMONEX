/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MediaLibrarySection.tsx
 * Admin Content Management — Validated Image Media Library.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Image as ImageIcon,
  Upload,
  Search,
  Copy,
  Check,
  Trash2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { MediaAssetItem } from '../../../types/index.js';
import { safeFetchJson } from '../../../lib/safeFetch.js';
import { useToast } from '../../ui/Toast.js';

interface MediaLibrarySectionProps {
  onSelectUrl?: (url: string) => void;
  compact?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const MediaLibrarySection: React.FC<MediaLibrarySectionProps> = ({
  onSelectUrl,
  compact = false,
}) => {
  const { showToast } = useToast();
  const [items, setItems] = useState<MediaAssetItem[]>([]);
  const [search, setSearch] = useState('');
  const [altText, setAltText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchMedia = useCallback(async () => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;
    setIsLoading(true);
    try {
      const qs = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
      const res = await safeFetchJson<{ items: MediaAssetItem[] }>(`/api/admin/media${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok && res.data?.items) {
        setItems(res.data.items);
      }
    } finally {
      setIsLoading(false);
    }
  }, [search]);

  useEffect(() => {
    fetchMedia();
  }, [fetchMedia]);

  const handleFileSelected = async (file: File | null) => {
    if (!file) return;
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;

    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.type)) {
      showToast('error', 'Unsupported File Type', 'Only PNG, JPEG, WebP, and GIF images are allowed.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('error', 'File Too Large', 'Maximum upload size is 5 MB.');
      return;
    }

    setIsUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });

      const res = await safeFetchJson<MediaAssetItem>('/api/admin/media/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          originalName: file.name,
          mimeType: file.type,
          base64Data: dataUrl,
          altText: altText.trim() || file.name,
        }),
      });

      if (res.ok && res.data) {
        showToast('success', 'Image Uploaded', `${file.name} passed signature validation and was added to Media Library.`);
        setAltText('');
        fetchMedia();
        if (onSelectUrl) onSelectUrl(res.data.url);
      } else {
        showToast('error', 'Upload Rejected', res.error || 'Image validation failed.');
      }
    } catch (err: any) {
      showToast('error', 'Upload Failed', err?.message || 'Unable to upload image.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (asset: MediaAssetItem) => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;
    const res = await safeFetchJson<{ success: boolean }>(`/api/admin/media/${asset.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      showToast('success', 'Asset Deleted', `${asset.originalName} removed from Media Library.`);
      setItems(prev => prev.filter(i => i.id !== asset.id));
    } else {
      showToast('error', 'Delete Failed', res.error || 'Could not remove media asset.');
    }
  };

  const handleCopy = async (asset: MediaAssetItem) => {
    try {
      await navigator.clipboard.writeText(asset.url);
      setCopiedId(asset.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {}
  };

  return (
    <div className="space-y-4">
      {/* Header & Upload Panel */}
      <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-[#E4EBEF] flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-[#8DA5B1]" />
              Media Library
            </h3>
            <p className="text-xs text-[#71818B] mt-0.5 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-[#16A879]" />
              MIME + binary signature verified · PNG, JPEG, WebP, GIF · Max 5 MB
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="Optional alt text..."
              value={altText}
              onChange={e => setAltText(e.target.value)}
              className="px-2.5 py-1.5 rounded-[7px] bg-[#111820] border border-[#2B3944] text-xs text-[#E4EBEF] placeholder-[#53616A] outline-none focus:border-[#8DA5B1] w-44"
            />
            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] bg-[#8DA5B1] hover:bg-[#A5BAC4] text-[#090D12] text-xs font-semibold cursor-pointer transition-colors">
              <Upload className="w-3.5 h-3.5" />
              <span>{isUploading ? 'Validating...' : 'Upload Image'}</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                disabled={isUploading}
                onChange={e => {
                  handleFileSelected(e.target.files?.[0] || null);
                  e.target.value = '';
                }}
                className="hidden"
              />
            </label>
          </div>
        </div>

        {/* Search & Refresh */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-3.5 h-3.5 text-[#71818B] absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Search uploaded images..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-[7px] bg-[#111820] border border-[#2B3944] text-xs text-[#E4EBEF] placeholder-[#53616A] outline-none focus:border-[#8DA5B1]"
            />
          </div>
          <button
            type="button"
            onClick={fetchMedia}
            className="px-2.5 py-1.5 rounded-[7px] bg-[#111820] border border-[#2B3944] hover:border-[#40515D] text-xs text-[#A1AFB8] hover:text-[#E4EBEF] inline-flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Media Grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(n => (
            <div key={n} className="h-44 rounded-[9px] bg-[#141C24] border border-[#202B34] animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] py-12 text-center space-y-2">
          <ImageIcon className="w-8 h-8 text-[#53616A] mx-auto" />
          <p className="text-sm font-medium text-[#A1AFB8]">No media assets uploaded yet</p>
          <p className="text-xs text-[#71818B]">
            Upload cover banners or announcement graphics above to reuse them across articles.
          </p>
        </div>
      ) : (
        <div className={`grid grid-cols-2 ${compact ? 'sm:grid-cols-3' : 'sm:grid-cols-3 lg:grid-cols-4'} gap-3`}>
          {items.map(asset => (
            <div
              key={asset.id}
              className="rounded-[9px] bg-[#141C24] border border-[#202B34] hover:border-[#40515D] overflow-hidden flex flex-col justify-between transition-colors"
            >
              <div className="h-32 bg-[#0B1016] border-b border-[#202B34] overflow-hidden">
                <img
                  src={asset.url}
                  alt={asset.altText || asset.originalName}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="p-2.5 space-y-2">
                <div>
                  <p className="text-xs font-medium text-[#E4EBEF] truncate" title={asset.originalName}>
                    {asset.originalName}
                  </p>
                  <p className="text-[10px] font-mono text-[#71818B]">
                    {asset.mimeType.replace('image/', '').toUpperCase()} · {formatBytes(asset.sizeBytes)}
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  {onSelectUrl && (
                    <button
                      type="button"
                      onClick={() => onSelectUrl(asset.url)}
                      className="flex-1 px-2 py-1 rounded-[5px] bg-[#8DA5B1] hover:bg-[#A5BAC4] text-[#090D12] text-[11px] font-semibold cursor-pointer"
                    >
                      Use Cover
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleCopy(asset)}
                    className="px-2 py-1 rounded-[5px] bg-[#111820] border border-[#2B3944] hover:border-[#8DA5B1] text-[#A1AFB8] hover:text-[#E4EBEF] text-[11px] inline-flex items-center gap-1 cursor-pointer"
                    title="Copy URL"
                  >
                    {copiedId === asset.id ? (
                      <Check className="w-3 h-3 text-[#16A879]" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    {!onSelectUrl && <span>Copy</span>}
                  </button>
                  {!onSelectUrl && (
                    <button
                      type="button"
                      onClick={() => handleDelete(asset)}
                      className="px-2 py-1 rounded-[5px] bg-[#111820] border border-[#2B3944] hover:border-[#EA5B65] text-[#71818B] hover:text-[#EA5B65] text-[11px] cursor-pointer"
                      title="Delete asset"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
