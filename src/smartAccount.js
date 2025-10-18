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
import { monadTestnet } from "./chain"; // <-- тут больше не нужен EP_v06
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

// EP v0.7 (Monad testnet, Pimlico)
export const ENTRY_POINT_V07 =
  "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

export function makePublicClient() {
  return createPublicClient({ chain: monadTestnet, transport: http(RPC) });
}

// консервативные, но рабочие подсказки по газу, чтобы бандлер не делал бинарный поиск
const GAS_HINTS = {
  // कॉल-газ на сам вызов контракта
  callGasLimit:          400_000n,
  // верификация подписи/аккаунта
  verificationGasLimit: 1_300_000n,
  // «наружные» расходы; лучше не ставить 0
  preVerificationGas:   110_000n,
};

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

  // Bundler (EP v0.7 — один единственный путь)
  const bundler = createBundlerClient({
    client: publicClient,
    entryPoint: ENTRY_POINT_V07,
    transport: http(BUNDLER_URL),
  });

  // Paymaster
  const paymaster = createPaymasterClient({
    chain: monadTestnet,
    transport: http(
      `https://api.pimlico.io/v2/${PIMLICO_CHAIN}/rpc?apikey=${PIMLICO_API_KEY}`
    ),
  });

  return {
    smartAccount,
    bundler,
    paymaster,
    address: smartAccount.address,
  };
}

export function makeCalldata(abi, fn, args) {
  return encodeFunctionData({ abi, functionName: fn, args });
}

/**
 * Отправка одиночного call как SPONSORED userOp для EP v0.7:
 * 1) готовим userOp c подсказками по газу,
 * 2) просим у paymaster спонсорство (sponsorUserOperation),
 * 3) отправляем готовый userOp в бандлер.
 */
export async function sendCalls(ctx, { to, data, value = 0n }) {
  const { smartAccount, paymaster, bundler } = ctx;

  // 1. Собираем userOp сами (ключевой фикс!) с газ-хинтами
  const uo = await smartAccount.prepareUserOperation({
    calls: [{ to, data, value }],
    ...GAS_HINTS,
  });

  // 2. Просим спонсорство ровно под EP v0.7
  const sponsorship = await paymaster.sponsorUserOperation({
    userOperation: uo,
    entryPoint: ENTRY_POINT_V07,
    // sponsorshipPolicyId: '...если хочешь привязать полиси явно...'
  });

  // 3. Отправляем готовый юзерОп
  const hash = await bundler.sendUserOperation({
    userOperation: { ...uo, ...sponsorship },
  });

  return { hash };
}

export function userOpTrackUrl(hash) {
  return `https://pimlico.io/explorer/userOp?hash=${hash}`;
}

export function monadAddressUrl(addr) {
  return `https://testnet.monadexplorer.com/address/${addr}`;
}
