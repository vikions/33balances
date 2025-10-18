// smartAccount.js
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
import { monadTestnet } from "./chain";
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

// === EntryPoint для Monad ===
export const ENTRY_POINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

export function makePublicClient() {
  return createPublicClient({
    chain: monadTestnet,
    transport: http(RPC),
  });
}

export async function initSmartAccount() {
  const eip1193 = await getEip1193Provider();

  // === EOA (Farcaster / MetaMask signer)
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

  // === создаём MetaMask Smart Account
  const smartAccount = await toMetaMaskSmartAccount({
    client: publicClient,
    implementation: Implementation.Hybrid,
    deployParams: [ownerAddress, [], [], []],
    deploySalt: "0x",
    signer: { walletClient },
    chain: monadTestnet,
  });

  // === ФИКС: если аккаунт уже задеплоен — убираем initCode
  const deployedCode = await publicClient.getCode({ address: smartAccount.address });
  if (deployedCode && deployedCode !== "0x") {
    console.log("Smart account already deployed, skipping initCode");
    smartAccount.initCode = "0x";
  }

  // === создаём Bundler и Paymaster (оба Pimlico)
  const bundler = createBundlerClient({
    client: publicClient,
    entryPoint: ENTRY_POINT_V07,
    transport: http(BUNDLER_URL),
  });

  const paymaster = createPaymasterClient({
    chain: monadTestnet,
    transport: http(BUNDLER_URL),
  });

  return { smartAccount, bundler, paymaster, address: smartAccount.address };
}

export function makeCalldata(abi, fn, args) {
  return encodeFunctionData({ abi, functionName: fn, args });
}

// === простой способ отправить AA-транзакцию
export async function sendCalls(ctx, { to, data, value = 0n }) {
  const { bundler, smartAccount, paymaster } = ctx;

  // минимальные значения, чтобы избежать бинарного поиска газа
  const maxFeePerGas = 1n;
  const maxPriorityFeePerGas = 1n;

  const hash = await bundler.sendUserOperation({
    account: smartAccount,
    calls: [{ to, data, value }],
    maxFeePerGas,
    maxPriorityFeePerGas,
    paymaster, // передаём paymasterClient
  });

  return { hash };
}

export function userOpTrackUrl(hash) {
  return `https://pimlico.io/explorer/userOp?hash=${hash}`;
}

export function monadAddressUrl(addr) {
  return `https://testnet.monadexplorer.com/address/${addr}`;
}
