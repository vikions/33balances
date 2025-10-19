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


export const ENTRY_POINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

export function makePublicClient() {
  return createPublicClient({ chain: monadTestnet, transport: http(RPC) });
}

async function ensureMonadChain(eip1193) {
  const targetHex = `0x${monadTestnet.id.toString(16)}`; // 0x279f (10143)
  const current = await eip1193.request({ method: "eth_chainId" });
  if (current === targetHex) return;

  try {
    await eip1193.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: targetHex }],
    });
  } catch (err) {
    if (err?.code === 4902 /* Chain not added */) {
      await eip1193.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: targetHex,
          chainName: "Monad Testnet",
          rpcUrls: [RPC],
          nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
          blockExplorerUrls: ["https://testnet.monadexplorer.com/"],
        }],
      });
      await eip1193.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: targetHex }],
      });
    } else {
      throw err;
    }
  }
}

export async function initSmartAccount() {
 
  const eip1193 = await getEip1193Provider();

 
  await ensureMonadChain(eip1193);

  
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

  
  const smartAccount = await toMetaMaskSmartAccount({
    client: publicClient,
    implementation: Implementation.Hybrid,
    deployParams: [ownerAddress, [], [], []],
    deploySalt: "0x",
    signer: { walletClient },
    chain: monadTestnet,
  });


  const code = await publicClient.getCode({ address: smartAccount.address });

  if (!code || code === "0x") {
    const { factory, factoryData } = await smartAccount.getFactoryArgs();
    const txHash = await walletClient.sendTransaction({ to: factory, data: factoryData });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") throw new Error("Smart Account deployment failed");
    smartAccount.initCode = "0x";
  } else {
    smartAccount.initCode = "0x";
  }

  
  const bundler = createBundlerClient({
    client: publicClient,
    entryPoint: ENTRY_POINT_V07,
    transport: http(BUNDLER_URL),
  });

  const paymaster = createPaymasterClient({
    chain: monadTestnet,
    transport: http(
      `https://api.pimlico.io/v2/${PIMLICO_CHAIN}/rpc?apikey=${PIMLICO_API_KEY}`
    ),
  });

  return { smartAccount, bundler, paymaster, address: smartAccount.address };
}

export function makeCalldata(abi, fn, args) {
  return encodeFunctionData({ abi, functionName: fn, args });
}


async function getPimlicoGas(bundler) {
  try {
    if (typeof bundler.getUserOperationGasPrice === "function") {
      const res = await bundler.getUserOperationGasPrice();
      const pick = (obj) =>
        obj?.standard ?? obj?.fast ?? obj?.slow ?? obj; 
      const tier = pick(res);
      return {
        maxFeePerGas: BigInt(tier.maxFeePerGas),
        maxPriorityFeePerGas: BigInt(tier.maxPriorityFeePerGas),
      };
    }

    // raw RPC к Pimlico
    const rpc = await bundler.request({
      method: "pimlico_getUserOperationGasPrice",
      params: [],
    });
    const tier = rpc?.standard ?? rpc?.fast ?? rpc?.slow ?? rpc;
    return {
      maxFeePerGas: BigInt(tier.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(tier.maxPriorityFeePerGas),
    };
  } catch (e) {
    console.warn("[gas] fallback due to error:", e?.message || e);
    const HARD_MAX = 200_000_000_000n; // 200 gwei
    const HARD_TIP = 2_000_000_000n;   // 2 gwei
    return { maxFeePerGas: HARD_MAX, maxPriorityFeePerGas: HARD_TIP };
  }
}

export async function sendCalls(ctx, { to, data, value = 0n }) {
  const { bundler, smartAccount, paymaster } = ctx;


  const { maxFeePerGas, maxPriorityFeePerGas } = await getPimlicoGas(bundler);

  const hash = await bundler.sendUserOperation({
    account: smartAccount,
    calls: [{ to, data, value }],
    maxFeePerGas,
    maxPriorityFeePerGas,
    paymaster,
  });

  return { hash };
}

export function userOpTrackUrl(hash) {
  return `https://pimlico.io/explorer/userOp?hash=${hash}`;
}
export function monadAddressUrl(addr) {
  return `https://testnet.monadexplorer.com/address/${addr}`;
}
