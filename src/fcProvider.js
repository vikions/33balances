// fcProvider.js — универсальный EIP-1193 провайдер

import { sdk } from "@farcaster/miniapp-sdk";

export async function getEip1193Provider() {
  // 1) Если мы внутри Farcaster Mini App — используем его кошелёк
  try {
    if (sdk?.wallet?.getEthereumProvider) {
      const provider = await sdk.wallet.getEthereumProvider();
      if (provider) return provider;
    }
  } catch (e) {
    console.warn("[fcProvider] Farcaster provider not available:", e);
  }

  // 2) Иначе пробуем обычный window.ethereum (BaseApp / браузер)
  if (typeof window !== "undefined" && window.ethereum) {
    return window.ethereum;
  }

  // 3) Если ничего не нашли — кидаем явную ошибку
  throw new Error(
    "EIP-1193 provider not found. Open the app inside Farcaster or use a wallet-compatible browser."
  );
}
