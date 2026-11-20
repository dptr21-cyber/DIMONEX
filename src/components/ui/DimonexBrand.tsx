/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/ui/DimonexBrand.tsx
 * Centralized DIMONEX official logo icon and banner asset components.
 */

import React from 'react';

export const DIMONEX_ICON_SRC = '/assets/aistudio/logo-icon_16e0113c.png';
export const DIMONEX_HERO_BANNER_SRC = '/assets/aistudio/banner_116d9a8f.png';
export const DIMONEX_EXCHANGE_BANNER_SRC = '/assets/aistudio/banner2_d678902d.png';

type DimonexIconSize = 'xs' | 'sm' | 'md' | 'lg';

const ICON_SIZE_CLASSES: Record<DimonexIconSize, string> = {
  xs: 'w-4 h-4 rounded-[4px]',
  sm: 'w-6 h-6 rounded-[6px]',
  md: 'w-8 h-8 rounded-[8px]',
  lg: 'w-10 h-10 rounded-[10px]',
};

interface DimonexIconProps {
  size?: DimonexIconSize;
  className?: string;
}

/**
 * Renders the official DIMONEX metallic obsidian squircle icon cleanly cropped
 * to eliminate any outer corner margin from the source PNG.
 */
export const DimonexIcon: React.FC<DimonexIconProps> = ({
  size = 'md',
  className = '',
}) => {
  return (
    <div
      className={`relative overflow-hidden bg-[#090D12] border border-[#2B3944] shrink-0 select-none ${ICON_SIZE_CLASSES[size]} ${className}`}
    >
      <img
        src={DIMONEX_ICON_SRC}
        alt="DIMONEX"
        draggable={false}
        className="w-full h-full object-cover scale-[1.18] pointer-events-none"
      />
    </div>
  );
};
