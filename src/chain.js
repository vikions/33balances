import { defineChain } from "viem";


export const ENTRY_POINT_V06 = "0x5FF137D4b0FDCD49dcae6b3cD1eE8fB1f1A5aC00";
export const ENTRY_POINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032"; 

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: [import.meta.env.VITE_MONAD_RPC || "https://testnet-rpc.monad.xyz"] },
    public:  { http: [import.meta.env.VITE_MONAD_RPC || "https://testnet-rpc.monad.xyz"] },
  },
  
  accountAbstraction: {
    entryPoint: ENTRY_POINT_V07,
    version: "0.7",
  },
});
