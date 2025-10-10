import React from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiMiniConfig } from './wagmiMini';
import { isMiniAppEnv } from './miniapp';

const queryClient = new QueryClient();

export default function MiniAppProvider({ children }) {
  if (!isMiniAppEnv()) return <>{children}</>;
  return (
    <WagmiProvider config={wagmiMiniConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
