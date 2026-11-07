import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Install defensive guard against browser extension injection errors (MetaMask inpage.js)
if (typeof window !== 'undefined') {
  const isExtensionError = (err: any) => {
    const text = `${err?.message || ''} ${err?.stack || ''} ${String(err || '')}`;
    return (
      text.includes('Failed to connect to MetaMask') ||
      text.includes('chrome-extension://') ||
      text.includes('moz-extension://') ||
      text.includes('inpage.js')
    );
  };

  window.addEventListener('unhandledrejection', (event) => {
    if (isExtensionError(event.reason)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  window.addEventListener('error', (event) => {
    if (isExtensionError(event.error)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
}

createRoot(document.getElementById('root')!).render(<App />);
