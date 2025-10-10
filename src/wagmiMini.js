import { http, createConfig } from 'wagmi';
import { farcasterMiniApp as miniAppConnector } from '@farcaster/miniapp-wagmi-connector';

// Monad Testnet
export const monadTestnet = {
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: [import.meta.env.VITE_MONAD_RPC || 'https://testnet-rpc.monad.xyz'] },
  },
};

export const wagmiMiniConfig = createConfig({
  chains: [monadTestnet],
  transports: {
    [monadTestnet.id]: http(monadTestnet.rpcUrls.default.http[0]),
  },
  connectors: [miniAppConnector()],
});
