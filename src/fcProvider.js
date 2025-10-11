import { sdk } from "@farcaster/miniapp-sdk";

/**
 * Возвращает EIP-1193 провайдер из Farcaster Mini App SDK.
 * Ошибка, если Mini App запущена не внутри Farcaster.
 */
export async function getEip1193Provider() {
  if (!sdk?.wallet?.getEthereumProvider) {
    throw new Error("Not running inside Farcaster Mini App");
  }
  const provider = await sdk.wallet.getEthereumProvider();
  if (!provider) throw new Error("Farcaster Wallet provider not available");
  return provider;
}
