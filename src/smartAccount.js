import {
  createPublicClient,
  createWalletClient,
  http,
  custom,
  encodeFunctionData,
} from "viem";
import {
  createBundlerClient,
  createPaymasterClient,
} from "viem/account-abstraction";
import { monadTestnet, ENTRY_POINT_V06 } from "./chain";
import {
  Implementation,
  toMetaMaskSmartAccount,
} from "@metamask/delegation-toolkit";
import { getEip1193Provider } from "./fcProvider";

// === ENV ===
const RPC = import.meta.env.VITE_MONAD_RPC;
const PIMLICO_CHAIN = import.meta.env.VITE_PIMLICO_CHAIN || "monad-testnet";
const PIMLICO_API_KEY = import.meta.env.VITE_PIMLICO_API_KEY;
const BUNDLER_URL =
  import.meta.env.VITE_BUNDLER_URL ||
  `https://api.pimlico.io/v2/${PIMLICO_CHAIN}/rpc?apikey=${PIMLICO_API_KEY}`;

if (!PIMLICO_API_KEY) throw new Error("Missing VITE_PIMLICO_API_KEY");

// EP v0.7 на Monad (Pimlico)
export const ENTRY_POINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

export function makePublicClient() {
  return createPublicClient({ chain: monadTestnet, transport: http(RPC) });
}

export async function initSmartAccount() {
  const eip1193 = await getEip1193Provider();

  // EOA
  const tmpClient = createWalletClient({
    chain: monadTestnet,
    transport: custom(eip1193),
  });
  const [ownerAddress] = await tmpClient.requestAddresses();

  const walletClient = createWalletClient({
    account: ownerAddress,
    chain: monadTestnet,
    transport: custom(eip1193),
  });

  const publicClient = makePublicClient();

  // MetaMask Smart Account
  const smartAccount = await toMetaMaskSmartAccount({
    client: publicClient,
    implementation: Implementation.Hybrid,
    deployParams: [ownerAddress, [], [], []],
    deploySalt: "0x",
    signer: { walletClient },
    chain: monadTestnet,
  });

  // ДВА бандлера: v0.7 и v0.6
  const bundlerV07 = createBundlerClient({
    client: publicClient,
    entryPoint: ENTRY_POINT_V07,
    transport: http(BUNDLER_URL),
  });

  const bundlerV06 = createBundlerClient({
    client: publicClient,
    entryPoint: ENTRY_POINT_V06,
    transport: http(BUNDLER_URL),
  });

  // Paymaster Pimlico (тут EP не указываем — он проставится в sponsorUserOperation)
  const paymaster = createPaymasterClient({
    chain: monadTestnet,
    transport: http(
      `https://api.pimlico.io/v2/${PIMLICO_CHAIN}/rpc?apikey=${PIMLICO_API_KEY}`
    ),
  });

  return {
    smartAccount,
    bundlerV07,
    bundlerV06,
    paymaster,
    address: smartAccount.address,
  };
}

export function makeCalldata(abi, fn, args) {
  return encodeFunctionData({ abi, functionName: fn, args });
}

// Умная отправка: сначала EP v0.7 → если реверт на симуляции, пробуем EP v0.6
export async function sendCalls(ctx, { to, data, value = 0n }) {
  const { smartAccount, paymaster, bundlerV07, bundlerV06 } = ctx;

  // вспомогательная обёртка
  async function trySend(bundler, label) {
    try {
      const hash = await bundler.sendUserOperation({
        account: smartAccount,
        calls: [{ to, data, value }],
        paymaster,
      });
      // для отладки — видно, через какой EP полетело
      console.info(`userOp sent via ${label}:`, hash);
      return { hash };
    } catch (e) {
      const msg =
        e?.shortMessage ||
        e?.message ||
        e?.data?.message ||
        e?.details ||
        String(e);
      console.warn(`send via ${label} failed:`, msg, e);
      throw e;
    }
  }

  // 1) пробуем v0.7
  try {
    return await trySend(bundlerV07, "EP v0.7");
  } catch (e) {
    const m = (e?.message || e?.shortMessage || "").toLowerCase();
    // признаки проблем симуляции/бинарного поиска/AA-кодов — ретраим на v0.6
    if (
      m.includes("simulatevalidation") ||
      m.includes("binarysearchcallgas") ||
      m.includes("call_exception") ||
      m.includes("reverted during simulation") ||
      m.includes("aa")
    ) {
      console.info("Retrying with EP v0.6…");
      return await trySend(bundlerV06, "EP v0.6");
    }
    throw e;
  }
}

export function userOpTrackUrl(hash) {
  return `https://pimlico.io/explorer/userOp?hash=${hash}`;
}

export function monadAddressUrl(addr) {
  return `https://testnet.monadexplorer.com/address/${addr}`;
}
