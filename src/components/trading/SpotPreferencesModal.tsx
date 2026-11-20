/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/trading/SpotPreferencesModal.tsx
 * Spot Trading → Preferences → Layout Settings modal with 3 institutional
 * workspace presets (Classic, Pro Terminal, Chart Focus) and mini previews.
 */

import React, { useEffect, useState } from 'react';
import {
  Check,
  EyeOff,
  Eye,
  LayoutGrid,
  SlidersHorizontal,
  Database,
  HardDrive,
} from 'lucide-react';
import { SpotLayoutPreset } from '../../types/index.js';
import { Modal } from '../ui/Modal.js';
import { Button } from '../ui/Button.js';
import { StatusBadge } from '../ui/StatusBadge.js';

export const SPOT_LAYOUT_LABELS: Record<SpotLayoutPreset, string> = {
  CLASSIC: 'Classic',
  PRO_TERMINAL: 'Pro Terminal',
  CHART_FOCUS: 'Chart Focus',
};

interface PresetDefinition {
  id: SpotLayoutPreset;
  code: string;
  name: string;
  subtitle: string;
  isDefault?: boolean;
  highlights: string[];
  audience: string;
}

const LAYOUT_PRESETS: PresetDefinition[] = [
  {
    id: 'CLASSIC',
    code: '01',
    name: 'Classic',
    subtitle: 'Balanced trading workspace',
    isDefault: true,
    highlights: [
      'Chart di tengah',
      'Order Book di kanan',
      'Recent Trades di bawah Order Book',
      'Buy/Sell panel di bawah chart',
    ],
    audience: 'Cocok untuk pengguna spot trading sehari-hari.',
  },
  {
    id: 'PRO_TERMINAL',
    code: '02',
    name: 'Pro Terminal',
    subtitle: 'High-density professional workspace',
    highlights: [
      'Chart lebih lebar',
      'Order Book & Recent Trades di panel kanan',
      'Buy/Sell panel tetap terlihat sejajar',
      'Open Orders & Trade History di bagian bawah',
    ],
    audience: 'Cocok untuk trader aktif yang membutuhkan informasi padat.',
  },
  {
    id: 'CHART_FOCUS',
    code: '03',
    name: 'Chart Focus',
    subtitle: 'Maximize chart viewing area',
    highlights: [
      'Chart menjadi area utama',
      'Panel Order Book lebih ringkas',
      'Recent Trades dapat disembunyikan',
      'Buy/Sell form tetap mudah diakses',
    ],
    audience: 'Cocok untuk analisis teknikal & pergerakan harga.',
  },
];

interface SpotPreferencesModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeLayout: SpotLayoutPreset;
  hideRecentTradesInChartFocus: boolean;
  isAuthenticated: boolean;
  isSaving?: boolean;
  onApply: (layout: SpotLayoutPreset, hideRecentTradesInChartFocus: boolean) => Promise<void> | void;
}

/**
 * Miniature Obsidian Iridium architectural wireframe preview for each layout preset.
 */
const LayoutMiniPreview: React.FC<{
  preset: SpotLayoutPreset;
  selected: boolean;
  hideTradesInFocus: boolean;
}> = ({ preset, selected, hideTradesInFocus }) => {
  const frameBorder = selected ? 'border-[#8DA5B1]/70' : 'border-[#2B3944]';
  const chartBlock = 'rounded-[3px] bg-[#141C24] border border-[#2B3944] relative overflow-hidden';
  const sideBlock = 'rounded-[3px] bg-[#111820] border border-[#202B34] p-1 flex flex-col justify-between';

  const renderMiniCandles = (bars: number[]) => (
    <div className="absolute inset-0 flex items-end justify-between px-1.5 pb-1.5 pt-2.5 gap-[2px] opacity-85">
      {bars.map((h, i) => {
        const up = i % 3 !== 1;
        return (
          <div
            key={i}
            className={`flex-1 rounded-[1px] ${up ? 'bg-[#16A879]/75' : 'bg-[#EA5B65]/75'}`}
            style={{ height: `${h}%` }}
          />
        );
      })}
    </div>
  );

  const renderMiniBook = (compact?: boolean) => (
    <div className="space-y-[2px]">
      {(compact ? [70, 45] : [80, 60, 40]).map((w, i) => (
        <div
          key={`a-${i}`}
          className="h-[3px] rounded-[1px] bg-[#EA5B65]/55 ml-auto"
          style={{ width: `${w}%` }}
        />
      ))}
      <div className="h-[1px] bg-[#2B3944] my-[2px]" />
      {(compact ? [55, 75] : [50, 72, 88]).map((w, i) => (
        <div
          key={`b-${i}`}
          className="h-[3px] rounded-[1px] bg-[#16A879]/55 ml-auto"
          style={{ width: `${w}%` }}
        />
      ))}
    </div>
  );

  const renderMiniOrderForm = (horizontal?: boolean) => (
    <div className={horizontal ? 'flex items-center gap-1.5 h-full' : 'space-y-1'}>
      <div className={horizontal ? 'flex-1 flex gap-1' : 'grid grid-cols-2 gap-1'}>
        <div className="h-2.5 flex-1 rounded-[2px] bg-[#16A879]/75" />
        <div className="h-2.5 flex-1 rounded-[2px] bg-[#EA5B65]/40" />
      </div>
      {!horizontal && (
        <div className="space-y-1">
          <div className="h-2 rounded-[2px] bg-[#1D2832]" />
          <div className="h-2 rounded-[2px] bg-[#1D2832]" />
        </div>
      )}
      {horizontal && <div className="h-2.5 w-10 rounded-[2px] bg-[#1D2832]" />}
    </div>
  );

  return (
    <div className={`w-full h-[108px] rounded-[7px] bg-[#090D12] border ${frameBorder} p-1.5 flex flex-col gap-1 transition-colors`}>
      {preset === 'CLASSIC' && (
        <>
          <div className="flex-1 grid grid-cols-12 gap-1 min-h-0">
            {/* Center Chart + Below Buy/Sell */}
            <div className="col-span-8 flex flex-col gap-1 min-h-0">
              <div className={`${chartBlock} flex-[1.5]`}>
                <span className="absolute top-0.5 left-1 text-[7px] font-mono text-[#71818B] z-10">CHART</span>
                {renderMiniCandles([35, 48, 42, 60, 52, 74, 68, 82])}
              </div>
              <div className={`${sideBlock} h-[22px] justify-center`}>
                {renderMiniOrderForm(true)}
              </div>
            </div>
            {/* Right Order Book + Below Recent Trades */}
            <div className="col-span-4 flex flex-col gap-1 min-h-0">
              <div className={`${sideBlock} flex-[1.3]`}>
                {renderMiniBook(true)}
              </div>
              <div className={`${sideBlock} flex-1`}>
                <div className="space-y-[2px]">
                  <div className="h-[2.5px] w-4/5 rounded bg-[#16A879]/45" />
                  <div className="h-[2.5px] w-3/5 rounded bg-[#EA5B65]/45" />
                  <div className="h-[2.5px] w-2/3 rounded bg-[#16A879]/45" />
                </div>
              </div>
            </div>
          </div>
          <div className="h-[11px] rounded-[2px] bg-[#111820] border border-[#202B34] flex items-center px-1 gap-1.5">
            <span className="h-[3px] w-8 rounded bg-[#8DA5B1]/50" />
            <span className="h-[3px] w-6 rounded bg-[#2B3944]" />
          </div>
        </>
      )}

      {preset === 'PRO_TERMINAL' && (
        <>
          <div className="flex-1 grid grid-cols-12 gap-1 min-h-0">
            {/* Wider Chart */}
            <div className={`${chartBlock} col-span-6`}>
              <span className="absolute top-0.5 left-1 text-[7px] font-mono text-[#71818B] z-10">WIDE CHART</span>
              {renderMiniCandles([40, 52, 46, 65, 58, 72, 66, 85, 78, 92])}
            </div>
            {/* Middle-Right Book + Trades */}
            <div className="col-span-3 flex flex-col gap-1 min-h-0">
              <div className={`${sideBlock} flex-[1.35]`}>
                {renderMiniBook(true)}
              </div>
              <div className={`${sideBlock} flex-1`}>
                <div className="space-y-[2px]">
                  <div className="h-[2.5px] w-4/5 rounded bg-[#16A879]/45" />
                  <div className="h-[2.5px] w-3/5 rounded bg-[#EA5B65]/45" />
                </div>
              </div>
            </div>
            {/* Far-Right Buy/Sell Always Visible */}
            <div className={`${sideBlock} col-span-3`}>
              <span className="text-[6.5px] font-mono text-[#71818B]">ORDER</span>
              {renderMiniOrderForm(false)}
              <div className="h-2.5 rounded-[2px] bg-[#16A879]/80" />
            </div>
          </div>
          <div className="h-[13px] rounded-[2px] bg-[#111820] border border-[#202B34] flex items-center px-1.5 gap-2">
            <span className="h-[3px] w-10 rounded bg-[#8DA5B1]/60" />
            <span className="h-[3px] w-8 rounded bg-[#40515D]" />
            <span className="h-[3px] w-8 rounded bg-[#2B3944]" />
          </div>
        </>
      )}

      {preset === 'CHART_FOCUS' && (
        <>
          <div className="flex-1 grid grid-cols-12 gap-1 min-h-0">
            {/* Dominant Chart Area */}
            <div className={`${chartBlock} col-span-9`}>
              <span className="absolute top-0.5 left-1 text-[7px] font-mono text-[#A5BAC4] z-10">PRIMARY CHART</span>
              {renderMiniCandles([30, 44, 38, 55, 50, 68, 62, 76, 70, 88, 82, 94])}
            </div>
            {/* Slim Right Rail: Compact Order Book + Accessible Buy/Sell */}
            <div className="col-span-3 flex flex-col gap-1 min-h-0">
              <div className={`${sideBlock} flex-1`}>
                {renderMiniBook(true)}
              </div>
              <div className={`${sideBlock} flex-1`}>
                {renderMiniOrderForm(false)}
              </div>
              {!hideTradesInFocus && (
                <div className="h-[10px] rounded-[2px] bg-[#111820] border border-[#202B34] px-1 flex items-center">
                  <div className="h-[2px] w-full rounded bg-[#16A879]/40" />
                </div>
              )}
            </div>
          </div>
          <div className="h-[10px] rounded-[2px] bg-[#111820] border border-[#202B34] flex items-center justify-between px-1.5">
            <span className="h-[3px] w-10 rounded bg-[#40515D]" />
            {hideTradesInFocus && (
              <span className="text-[6.5px] font-mono text-[#71818B]">TRADES HIDDEN</span>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export const SpotPreferencesModal: React.FC<SpotPreferencesModalProps> = ({
  isOpen,
  onClose,
  activeLayout,
  hideRecentTradesInChartFocus,
  isAuthenticated,
  isSaving = false,
  onApply,
}) => {
  const [draftLayout, setDraftLayout] = useState<SpotLayoutPreset>(activeLayout);
  const [draftHideTrades, setDraftHideTrades] = useState<boolean>(hideRecentTradesInChartFocus);

  useEffect(() => {
    if (isOpen) {
      setDraftLayout(activeLayout);
      setDraftHideTrades(hideRecentTradesInChartFocus);
    }
  }, [isOpen, activeLayout, hideRecentTradesInChartFocus]);

  const handleConfirm = async () => {
    await onApply(draftLayout, draftHideTrades);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Spot Trading Preferences"
      subtitle="Layout Settings · Choose your preferred trading workspace"
      maxWidth="max-w-3xl"
    >
      <div className="space-y-4">
        {/* Section Intro */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#202B34]">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-[6px] bg-[#17212B] border border-[#2B3944] flex items-center justify-center text-[#8DA5B1]">
              <SlidersHorizontal className="w-3.5 h-3.5" />
            </div>
            <div>
              <h4 className="text-xs font-semibold text-[#E4EBEF]">Layout Settings</h4>
              <p className="text-[11px] text-[#71818B]">
                Choose your preferred trading workspace. Switching presets rearranges panels without resetting chart data or active feeds.
              </p>
            </div>
          </div>
          <StatusBadge tone="brand">
            Active: {SPOT_LAYOUT_LABELS[activeLayout]}
          </StatusBadge>
        </div>

        {/* 3 Preset Cards with Mini Previews */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {LAYOUT_PRESETS.map(preset => {
            const isSelected = draftLayout === preset.id;
            const isActive = activeLayout === preset.id;

            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => setDraftLayout(preset.id)}
                className={`group text-left rounded-[10px] p-3.5 border transition-colors flex flex-col gap-3 cursor-pointer ${
                  isSelected
                    ? 'bg-[#17212B] border-[#8DA5B1] ring-1 ring-[#8DA5B1]/35'
                    : 'bg-[#111820] border-[#202B34] hover:border-[#40515D] hover:bg-[#141C24]'
                }`}
              >
                {/* Top Row: Code + Title + Selected / Default Badge */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-mono font-semibold text-[#8DA5B1]">
                        {preset.code}
                      </span>
                      <span className="text-xs font-semibold text-[#E4EBEF] truncate">
                        {preset.name}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#A1AFB8] mt-0.5 leading-snug">
                      {preset.subtitle}
                    </p>
                  </div>

                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {isSelected ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#8DA5B1] text-[#090D12] text-[10px] font-mono font-semibold">
                        <Check className="w-2.5 h-2.5" strokeWidth={3} />
                        Selected
                      </span>
                    ) : preset.isDefault ? (
                      <StatusBadge tone="neutral">Default</StatusBadge>
                    ) : isActive ? (
                      <StatusBadge tone="brand">Current</StatusBadge>
                    ) : null}
                  </div>
                </div>

                {/* Mini Wireframe Preview */}
                <LayoutMiniPreview
                  preset={preset.id}
                  selected={isSelected}
                  hideTradesInFocus={draftHideTrades}
                />

                {/* Feature Breakdown */}
                <ul className="space-y-1 text-[11px] text-[#A1AFB8] flex-1">
                  {preset.highlights.map(item => (
                    <li key={item} className="flex items-start gap-1.5 leading-snug">
                      <span
                        className={`w-1 h-1 rounded-full mt-1.5 shrink-0 ${
                          isSelected ? 'bg-[#8DA5B1]' : 'bg-[#53616A]'
                        }`}
                      />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>

                <p className="text-[10px] text-[#71818B] pt-2 border-t border-[#202B34] leading-relaxed">
                  {preset.audience}
                </p>
              </button>
            );
          })}
        </div>

        {/* Chart Focus Contextual Visibility Control */}
        {draftLayout === 'CHART_FOCUS' && (
          <div className="rounded-[8px] bg-[#111820] border border-[#2B3944] p-3.5 flex items-center justify-between gap-4">
            <div className="flex items-start gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-[6px] bg-[#17212B] border border-[#2B3944] flex items-center justify-center text-[#8DA5B1] shrink-0">
                {draftHideTrades ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[#E4EBEF]">
                  Sembunyikan Panel Recent Trades di Chart Focus
                </div>
                <p className="text-[11px] text-[#71818B] mt-0.5 leading-relaxed">
                  Memaksimalkan area chart dan order book ringkas. Data transaksi pasar tetap aktif dan tidak hilang saat panel disembunyikan.
                </p>
              </div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={draftHideTrades}
              onClick={() => setDraftHideTrades(prev => !prev)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors cursor-pointer ${
                draftHideTrades
                  ? 'bg-[#8DA5B1] border-[#C1D0D6]/40'
                  : 'bg-[#1D2832] border-[#2B3944]'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                  draftHideTrades
                    ? 'translate-x-5.5 bg-[#090D12]'
                    : 'translate-x-1 bg-[#71818B]'
                }`}
              />
            </button>
          </div>
        )}

        {/* Modal Footer Action Bar */}
        <div className="pt-4 border-t border-[#202B34] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[11px] text-[#71818B]">
            {isAuthenticated ? (
              <>
                <Database className="w-3.5 h-3.5 text-[#35B887] shrink-0" />
                <span>Saved per-user to your DIMONEX account and restored on sign-in.</span>
              </>
            ) : (
              <>
                <HardDrive className="w-3.5 h-3.5 text-[#8DA5B1] shrink-0" />
                <span>Saved in this browser. Sign in to sync workspace layout across sessions.</span>
              </>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 shrink-0">
            <Button variant="ghost" size="md" onClick={onClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={handleConfirm}
              isLoading={isSaving}
              icon={<LayoutGrid className="w-3.5 h-3.5" />}
            >
              Use selected layout
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
