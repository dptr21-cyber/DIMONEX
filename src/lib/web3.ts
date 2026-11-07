/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/lib/web3.ts
 * Enterprise-grade, fail-safe Web3 & MetaMask provider integration.
 * Designed to gracefully handle browser extension sandboxing, iframe restrictions,
 * and prevent unhandled promise rejections / inpage.js connection failures.
 */

export interface Web3WalletState {
  isAvailable: boolean;
  isConnected: boolean;
  account: string | null;
  chainId: string | null;
  networkName: string;
  error: string | null;
}

// Safely probe if ethereum provider exists without triggering auto-connection
export function getSafeEthereumProvider(): any {
  if (typeof window === 'undefined') return null;
  try {
    const win = window as any;
    if (win.ethereum) {
      return win.ethereum;
    }
  } catch (err) {
    console.debug('[Web3] Safe provider lookup suppressed error:', err);
  }
  return null;
}

/**
 * Check if MetaMask or an EVM-compatible wallet is detected in the browser
 */
export function isMetaMaskAvailable(): boolean {
  try {
    const provider = getSafeEthereumProvider();
    return Boolean(provider && (provider.isMetaMask || provider.request));
  } catch {
    return false;
  }
}

/**
 * Safely request account connection to MetaMask
 * Handles iframe restrictions, user rejections (code 4001), and extension state hiccups
 */
export async function connectMetaMaskWallet(): Promise<{
  success: boolean;
  account?: string;
  chainId?: string;
  error?: string;
}> {
  try {
    const provider = getSafeEthereumProvider();
    if (!provider) {
      return {
        success: false,
        error: 'Ekstensi MetaMask tidak terdeteksi. Silakan pasang MetaMask di browser atau gunakan alamat deposit unik.',
      };
    }

    // Try eth_requestAccounts safely
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    if (!accounts || accounts.length === 0) {
      return {
        success: false,
        error: 'Tidak ada akun Ethereum yang dipilih di MetaMask.',
      };
    }

    let chainId = '0x1';
    try {
      chainId = await provider.request({ method: 'eth_chainId' });
    } catch {
      // Chain ID lookup is non-fatal
    }

    return {
      success: true,
      account: accounts[0],
      chainId,
    };
  } catch (err: any) {
    const msg = err?.message || String(err || '');
    const code = err?.code;

    // Handle user rejected
    if (code === 4001 || msg.includes('User rejected') || msg.includes('user rejected')) {
      return {
        success: false,
        error: 'Koneksi dibatalkan oleh pengguna di MetaMask.',
      };
    }

    // Handle pending request
    if (code === -32002 || msg.includes('already pending')) {
      return {
        success: false,
        error: 'Permintaan koneksi MetaMask sudah aktif. Buka pop-up MetaMask di toolbar browser Anda.',
      };
    }

    // Handle iframe sandboxing or extension disconnect
    if (msg.includes('Failed to connect to MetaMask') || msg.includes('inpage.js')) {
      return {
        success: false,
        error: 'Koneksi MetaMask dibatasi oleh lingkungan iframe sandbox. Anda tetap dapat melakukan setoran manual melalui alamat deposit unik.',
      };
    }

    return {
      success: false,
      error: msg || 'Gagal menghubungkan ke dompet MetaMask.',
    };
  }
}

/**
 * Formats a 0x Ethereum address into short readable form (0x1234...5678)
 */
export function formatAddress(address: string | null | undefined): string {
  if (!address) return '';
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
