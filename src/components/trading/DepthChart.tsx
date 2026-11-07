/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/components/trading/DepthChart.tsx
 * Order Book Depth Chart Visualization component powered by D3.js.
 */

import React from 'react';
import { TradingPairItem } from '../../types/index.js';
import { D3DepthChart } from './D3DepthChart.js';

interface Props {
  pair: TradingPairItem;
  depth: {
    bids: [string, string, string][]; // [price, qty, cumulativeQty]
    asks: [string, string, string][];
    spread: string;
  };
  myOpenOrderPrices?: Set<string>;
  onSelectPrice: (priceUnits: string) => void;
  height?: number;
}

export const DepthChart: React.FC<Props> = (props) => {
  return <D3DepthChart {...props} />;
};
