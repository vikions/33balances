import React from 'react';
import ReactDOM from 'react-dom/client';
import { MiniKitProvider } from '@coinbase/onchainkit/minikit';
import { base } from 'wagmi/chains';
import App from './App';
import MiniAppProvider from './MiniAppProvider';
import { tryReadyMiniApp } from './miniapp';

import '@coinbase/onchainkit/styles.css';

const root = document.getElementById('root');

const onchainKitApiKey = import.meta.env.VITE_PUBLIC_ONCHAINKIT_API_KEY;

ReactDOM.createRoot(root).render(
  <MiniKitProvider apiKey={onchainKitApiKey} chain={base}>
    <MiniAppProvider>
      <App />
    </MiniAppProvider>
  </MiniKitProvider>
);


tryReadyMiniApp();
