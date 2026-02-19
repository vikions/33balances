import React from 'react';
import ReactDOM from 'react-dom/client';
import { OnchainKitProvider } from '@coinbase/onchainkit';
import { base } from 'wagmi/chains';
import App from './App';

import '@coinbase/onchainkit/styles.css';

const root = document.getElementById('root');

const onchainKitApiKey = import.meta.env.VITE_PUBLIC_ONCHAINKIT_API_KEY;

ReactDOM.createRoot(root).render(
  <OnchainKitProvider
    apiKey={onchainKitApiKey}
    chain={base}
    miniKit={{ enabled: true }}
  >
    <App />
  </OnchainKitProvider>
);
