import React from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiMiniConfig } from './wagmiMini';
import { isMiniAppEnv } from './miniapp';

const queryClient = new QueryClient();

export default function MiniAppProvider({ children }) {
  // Если НЕ в Mini App окружении, просто рендерим детей без провайдера
  // App.jsx сам предоставит свой WagmiProvider
  if (!isMiniAppEnv()) return <>{children}</>;
  
  // Если В Mini App окружении (Farcaster), используем старый config
  return (
    <WagmiProvider config={wagmiMiniConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
