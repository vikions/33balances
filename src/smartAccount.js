// src/smartAccount.js
import {
  createPublicClient,
  createWalletClient,
  http,
  custom,
  encodeFunctionData,
} from "viem";
import { createBundlerClient } from "viem/account-abstraction";
import { monadTestnet, ENTRY_POINT_V06 } from "./chain";
import {
  Implementation,
  toMetaMaskSmartAccount,
} from "@metamask/delegation-toolkit";

// --- ENV ---
const RPC = import.meta.env.VITE_MONAD_RPC || "https://testnet-rpc.monad.xyz";

// Pimlico (рекомендуем)
const BUNDLER_URL = import.meta.env.VITE_BUNDLER_URL;          // напр. https://api.pimlico.io/v2/10143/rpc
const PIMLICO_API_KEY = import.meta.env.VITE_PIMLICO_API_KEY;  // ключ из Pimlico Dashboard

export function makePublicClient() {
  return createPublicClient({ chain: monadTestnet, transport: http(RPC) });
}

/**
 * ЯВНАЯ инициализация Smart Account.
 * Возвращает { smartAccount, bundler, address }
 */
export async function initSmartAccount() {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("MetaMask not found");
  }
  if (!BUNDLER_URL || !PIMLICO_API_KEY) {
    throw new Error("Missing VITE_BUNDLER_URL or VITE_PIMLICO_API_KEY");
  }

  // EOA из MetaMask
  const tmp = createWalletClient({
    chain: monadTestnet,
    transport: custom(window.ethereum),
  });
  const [owner] = await tmp.requestAddresses();

  // WalletClient c account для signer
  const walletClient = createWalletClient({
    account: owner,
    chain: monadTestnet,
    transport: custom(window.ethereum),
  });

  const publicClient = makePublicClient();

  // Smart Account (Delegation Toolkit)
  const smartAccount = await toMetaMaskSmartAccount({
    client: publicClient,
    implementation: Implementation.Hybrid,
    deployParams: [owner, [], [], []],
    deploySalt: "0x",
    signer: { walletClient },
    chain: monadTestnet,
  });

  // Bundler c Pimlico API key (заголовок x-api-key обязателен)
  const bundler = createBundlerClient({
    client: publicClient,
    entryPoint: ENTRY_POINT_V06,
    transport: http(BUNDLER_URL, {
      fetch: (url, init = {}) => {
        const headers = new Headers(init.headers || {});
        headers.set("x-api-key", PIMLICO_API_KEY);
        return fetch(url, { ...init, headers });
      },
    }),
  });

  return { smartAccount, bundler, address: smartAccount.address };
}

// helpers
export function makeCalldata(abi, functionName, args) {
  return encodeFunctionData({ abi, functionName, args });
}

/**
 * Отправляем userOp и ЖДЁМ квитанцию.
 * Возвращает { hash, receipt }
 */
export async function sendCalls(ctx, { to, data, value = 0n }) {
  const { bundler, smartAccount } = ctx;

  const hash = await bundler.sendUserOperation({
    account: smartAccount,
    calls: [{ to, data, value }],
  });

  // дождёмся выполнения
  const receipt = await bundler.waitForUserOperationReceipt({ hash });
  return { hash, receipt };
}

/** Удобная ссылка на трекинг userOp в Pimlico */
export function userOpTrackUrl(userOpHash) {
  return `https://dashboard.pimlico.io/track/${userOpHash}`;
}

/** Удобная ссылка на адрес в Monad Explorer */
export function monadAddressUrl(addr) {
  return `https://testnet.monadexplorer.com/address/${addr}`;
}
