// smartAccount.js
import {
  createPublicClient,
  createWalletClient,
  http,
  custom,
  encodeFunctionData,
} from "viem";
import { base } from "viem/chains";
import { getEip1193Provider } from "./fcProvider";

// === ENV ===
// Новый RPC под Base (можно изменить на Base Sepolia при желании)
const BASE_RPC =
  import.meta.env.VITE_BASE_RPC || "https://mainnet.base.org";

// Оставляем константу для совместимости, хотя она больше не используется
export const ENTRY_POINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

// === PUBLIC CLIENT ===

export function makePublicClient() {
  return createPublicClient({
    chain: base,
    transport: http(BASE_RPC),
  });
}

// === Проверка сети (мягкая) ===

async function ensureBaseChain(eip1193) {
  const targetHex = `0x${base.id.toString(16)}`; // 0x2105 (8453)
  try {
    const current = await eip1193.request({ method: "eth_chainId" });
    if (current === targetHex) return;

    // В обычных кошельках может сработать, в BaseApp может быть зафиксировано — тогда просто поймаем ошибку
    await eip1193.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: targetHex }],
    });
  } catch (err) {
    console.warn("[ensureBaseChain] Cannot switch network (maybe fixed to Base):", err);
  }
}

// === INIT: раньше создавался MetaMask Smart Account через Pimlico,
// теперь — просто обычный EOA на Base, но с тем же интерфейсом снаружи.

export async function initSmartAccount() {
  const eip1193 = await getEip1193Provider();

  await ensureBaseChain(eip1193).catch(() => {});

  const walletClient = createWalletClient({
    chain: base,
    transport: custom(eip1193),
  });

  const [address] = await walletClient.getAddresses();
  const publicClient = makePublicClient();

  // Для совместимости оставляем объект smartAccount с полем address,
  // чтобы старый код, который делает smartAccount.address, не сломался.
  const smartAccount = { address };

  return {
    walletClient,
    publicClient,
    smartAccount,
    address,
    // Для совместимости: раньше возвращались bundler и paymaster
    bundler: null,
    paymaster: null,
  };
}

// === calldata как и раньше ===

export function makeCalldata(abi, fn, args) {
  return encodeFunctionData({ abi, functionName: fn, args });
}

// === Отправка вызовов ===
// Было: через bundler.sendUserOperation + paymaster.
// Стало: обычный sendTransaction. Снаружи имя функции остаётся тем же.

export async function sendCalls(ctx, { to, data, value = 0n }) {
  const { walletClient } = ctx;
  if (!walletClient) {
    throw new Error("walletClient is missing in context passed to sendCalls");
  }

  const hash = await walletClient.sendTransaction({
    to,
    data,
    value,
  });

  return { hash };
}

// === Функции-утилиты для ссылок (обновляем под Base) ===

// Имя оставляем, но теперь это просто tx в BaseScan
export function userOpTrackUrl(hash) {
  return `https://basescan.org/tx/${hash}`;
}

// Имя оставляем ради совместимости, но ведёт на адрес в BaseScan
export function monadAddressUrl(addr) {
  return `https://basescan.org/address/${addr}`;
}

// Оставим заглушку getPimlicoGas на всякий случай, если вдруг где-то импортируется.
// Она больше не используется, но пусть возвращает какие-то значения.
export async function getPimlicoGas() {
  const HARD_MAX = 20_000_000_000n; // 20 gwei
  const HARD_TIP = 1_000_000_000n;  // 1 gwei
  return { maxFeePerGas: HARD_MAX, maxPriorityFeePerGas: HARD_TIP };
}
