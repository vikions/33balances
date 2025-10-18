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

// EntryPoint v0.7 (Monad)
export const ENTRY_POINT_V07 =
  "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

export function makePublicClient() {
  return createPublicClient({
    chain: monadTestnet,
    transport: http(RPC),
  });
}

export async function initSmartAccount() {
  // 1) провайдер Farcaster (EIP-1193)
  const eip1193 = await getEip1193Provider();

  // 2) EOA/WalletClient из Farcaster
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

  // 3) Предсчитываем MetaMask Smart Account (адрес и initCode)
  const smartAccount = await toMetaMaskSmartAccount({
    client: publicClient,
    implementation: Implementation.Hybrid,
    deployParams: [ownerAddress, [], [], []],
    deploySalt: "0x",
    signer: { walletClient },
    chain: monadTestnet,
  });

  // 4) Проверяем — уже развернут ли контракт по этому адресу
  const code = await publicClient.getCode({ address: smartAccount.address });

  if (!code || code === "0x") {
    // 4a) НЕ развернут — разворачиваем ВРУЧНУЮ через factory
    const { factory, factoryData } = await smartAccount.getFactoryArgs();

    console.log(
      "[SA] Deploying smart account via factory:",
      factory,
      "address:",
      smartAccount.address
    );

    const txHash = await walletClient.sendTransaction({
      to: factory,
      data: factoryData,
    });

    // ждём майнинга
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new Error("Smart Account deployment failed");
    }
    console.log("[SA] Deployed at:", smartAccount.address);

    // после ручного деплоя никакого initCode нам больше не нужно
    smartAccount.initCode = "0x";
  } else {
    // уже развернут — защита от случайной повторной попытки деплоя
    smartAccount.initCode = "0x";
    console.log("[SA] Already deployed:", smartAccount.address);
  }

  // 5) Bundler & Paymaster (Pimlico, EP v0.7)
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

// Отправка одной AA-операции (спонсорит Pimlico Paymaster)
export async function sendCalls(ctx, { to, data, value = 0n }) {
  const { bundler, smartAccount, paymaster } = ctx;

  // минимальные фи, чтобы не триггерить бинарный поиск у бандлера
  const maxFeePerGas = 1n;
  const maxPriorityFeePerGas = 1n;

  const hash = await bundler.sendUserOperation({
    account: smartAccount,
    calls: [{ to, data, value }],
    maxFeePerGas,
    maxPriorityFeePerGas,
    paymaster, // используем sponsor от Pimlico
  });

  return { hash };
}

export function userOpTrackUrl(hash) {
  return `https://pimlico.io/explorer/userOp?hash=${hash}`;
}

export function monadAddressUrl(addr) {
  return `https://testnet.monadexplorer.com/address/${addr}`;
}
