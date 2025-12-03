import { sdk } from "@farcaster/miniapp-sdk";

export async function getEip1193Provider() {
  
  try {
    if (sdk?.wallet?.getEthereumProvider) {
      const provider = await sdk.wallet.getEthereumProvider();
      if (provider) return provider;
    }
  } catch (e) {
    console.warn("[fcProvider] Farcaster provider not available:", e);
  }

  
  if (typeof window !== "undefined" && window.ethereum) {
    return window.ethereum;
  }

  
  throw new Error(
    "EIP-1193 provider not found. Open the app inside Farcaster or use a wallet-compatible browser."
  );
}
