import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import MiniAppProvider from './MiniAppProvider';
import { tryReadyMiniApp } from './miniapp';

const root = document.getElementById('root');

ReactDOM.createRoot(root).render(
  <MiniAppProvider>
    <App />
  </MiniAppProvider>
);

// скрываем сплэш, если это Mini App (безопасно и вне Mini App)
tryReadyMiniApp();
