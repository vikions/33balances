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
import { getEip1193Provider } from "./fcProvider";

const RPC = import.meta.env.VITE_MONAD_RPC;
const BUNDLER_URL = import.meta.env.VITE_BUNDLER_URL;
const PAYMASTER_POLICY_ID = import.meta.env.VITE_PAYMASTER_POLICY_ID;

export function makePublicClient() {
  return createPublicClient({ chain: monadTestnet, transport: http(RPC) });
}

export async function initSmartAccount() {
  const eip1193 = await getEip1193Provider();

  if (!BUNDLER_URL) throw new Error("Missing VITE_BUNDLER_URL");
  if (!PAYMASTER_POLICY_ID) throw new Error("Missing VITE_PAYMASTER_POLICY_ID");

  // Получаем EOA (владелец смарт-аккаунта)
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

  // Создаём MetaMask Smart Account
  const smartAccount = await toMetaMaskSmartAccount({
    client: publicClient,
    implementation: Implementation.Hybrid,
    deployParams: [ownerAddress, [], [], []],
    deploySalt: "0x",
    signer: { walletClient },
    chain: monadTestnet,
  });

  // Pimlico Bundler + Paymaster
  const bundler = createBundlerClient({
    client: publicClient,
    entryPoint: ENTRY_POINT_V06,
    transport: http(BUNDLER_URL, {
      fetch: (url, init = {}) => {
        const headers = new Headers(init.headers || {});
        headers.set("X-Alchemy-Gas-Manager-Policy-Id", PAYMASTER_POLICY_ID);
        return fetch(url, { ...init, headers });
      },
    }),
  });

  return { smartAccount, bundler, address: smartAccount.address };
}

export function makeCalldata(abi, fn, args) {
  return encodeFunctionData({ abi, functionName: fn, args });
}

export async function sendCalls(ctx, { to, data, value = 0n }) {
  const { bundler, smartAccount } = ctx;
  const hash = await bundler.sendUserOperation({
    account: smartAccount,
    calls: [{ to, data, value }],
  });
  return { hash };
}

export function userOpTrackUrl(hash) {
  return `https://pimlico.io/explorer/userOp?hash=${hash}`;
}

export function monadAddressUrl(addr) {
  return `https://testnet.monadexplorer.com/address/${addr}`;
}
