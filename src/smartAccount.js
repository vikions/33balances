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

const BASE_RPC =
  import.meta.env.VITE_BASE_RPC || "https://mainnet.base.org";


export const ENTRY_POINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";



export function makePublicClient() {
  return createPublicClient({
    chain: base,
    transport: http(BASE_RPC),
  });
}



async function ensureBaseChain(eip1193) {
  const targetHex = `0x${base.id.toString(16)}`; 
  try {
    const current = await eip1193.request({ method: "eth_chainId" });
    if (current === targetHex) return;

    
    await eip1193.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: targetHex }],
    });
  } catch (err) {
    console.warn("[ensureBaseChain] Cannot switch network (maybe fixed to Base):", err);
  }
}



export async function initSmartAccount() {
  const eip1193 = await getEip1193Provider();

  await ensureBaseChain(eip1193).catch(() => {});

  const walletClient = createWalletClient({
    chain: base,
    transport: custom(eip1193),
  });

  const [address] = await walletClient.getAddresses();
  const publicClient = makePublicClient();

 
  const smartAccount = { address };

  return {
    walletClient,
    publicClient,
    smartAccount,
    address,
    
    bundler: null,
    paymaster: null,
  };
}



export function makeCalldata(abi, fn, args) {
  return encodeFunctionData({ abi, functionName: fn, args });
}


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




export function userOpTrackUrl(hash) {
  return `https://basescan.org/tx/${hash}`;
}


export function monadAddressUrl(addr) {
  return `https://basescan.org/address/${addr}`;
}


export async function getPimlicoGas() {
  const HARD_MAX = 20_000_000_000n; 
  const HARD_TIP = 1_000_000_000n;  
  return { maxFeePerGas: HARD_MAX, maxPriorityFeePerGas: HARD_TIP };
}
