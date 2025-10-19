import { sdk } from "@farcaster/miniapp-sdk";


export async function getEip1193Provider() {
  if (!sdk?.wallet?.getEthereumProvider) {
    throw new Error("Not running inside Farcaster Mini App");
  }
  const provider = await sdk.wallet.getEthereumProvider();
  if (!provider) throw new Error("Farcaster Wallet provider not available");
  return provider;
}
