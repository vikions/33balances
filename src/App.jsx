import { useCallback, useEffect, useRef, useState } from "react";
import { WagmiProvider, useAccount, useConnect, useSwitchChain } from "wagmi";
import { base } from "wagmi/chains";
import { baseAccount } from "wagmi/connectors";
import { farcasterMiniApp } from "@farcaster/miniapp-wagmi-connector";
import { createConfig, http } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { sendCalls, getCapabilities } from "@wagmi/core";
import { parseAbi, encodeFunctionData } from "viem";
import BattleArenaScreen from "./BattleArena";

// === ADDRESS / CHAIN ===
const CONTRACT_ADDRESS =
  import.meta.env?.VITE_BATTLE_ENTRY_CONTRACT ??
  "0x7b62877EBe12d155F9bbC281fbDe8026F6a2Eccf";

// Paymaster (Coinbase Developer Platform)
const PAYMASTER_URL =
  "https://api.developer.coinbase.com/rpc/v1/base/mmo6mwwplQQx927oL1bz30eQZ33eEDOc";

// === ABI ===
const CONTRACT_ABI = parseAbi(["function enterMatch(string characterId)"]);

// === WAGMI CONFIG ===
// STRICT order: farcasterMiniApp() first, baseAccount() second
const config = createConfig({
  chains: [base],
  transports: {
    [base.id]: http(),
  },
  connectors: [
    farcasterMiniApp(),
    baseAccount({
      appName: "3balance",
      appLogoUrl: "https://base.org/logo.png",
    }),
  ],
});

const queryClient = new QueryClient();

export default function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ThreeBalanceApp />
      </QueryClientProvider>
    </WagmiProvider>
  );
}

function ThreeBalanceApp() {
  const { address, chain } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { switchChain } = useSwitchChain();

  const [statusMessage, setStatusMessage] = useState("");
  const [toast, setToast] = useState("");
  const toastTimerRef = useRef(null);

  const connected = !!address;

  const showToast = useCallback((nextMessage) => {
    setToast(nextMessage);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), 3200);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Auto-switch to Base when connected.
  useEffect(() => {
    if (connected && chain && chain.id !== 8453) {
      setStatusMessage("Switching to Base network...");
      switchChain?.({ chainId: 8453 });
      setTimeout(() => setStatusMessage(""), 3000);
    }
  }, [connected, chain, switchChain]);

  const connectWallet = async () => {
    try {
      setStatusMessage("");
      const connector = connectors[0];
      if (!connector) {
        setStatusMessage("No wallet connectors available");
        return;
      }
      await connect({ connector });
    } catch (e) {
      setStatusMessage(humanError(e));
    }
  };

  const enterMatch = useCallback(
    async (character) => {
      if (!connected || !address) {
        return {
          ok: false,
          message: "Connect your Base Account to enter the arena.",
        };
      }

      try {
        const account = address;
        const characterId =
          character?.id || character?.name || "unknown-character";

        const data = encodeFunctionData({
          abi: CONTRACT_ABI,
          functionName: "enterMatch",
          args: [characterId],
        });

        const capabilities = await getCapabilities(config, { account });
        const baseCapabilities = capabilities?.[8453];
        const supportsPaymaster = !!baseCapabilities?.paymasterService?.supported;

        await sendCalls(config, {
          account,
          calls: [{ to: CONTRACT_ADDRESS, data }],
          chainId: 8453,
          capabilities: supportsPaymaster
            ? {
                paymasterService: {
                  url: PAYMASTER_URL,
                },
              }
            : undefined,
        });

        showToast(
          supportsPaymaster
            ? "Entry confirmed (gas sponsored)!"
            : "Entry confirmed!"
        );

        return { ok: true };
      } catch (e) {
        return { ok: false, message: humanError(e) };
      }
    },
    [address, connected, showToast]
  );

  return (
    <Shell>
      <Header />
      <Hero />
      <WalletPanel
        connected={connected}
        address={address}
        isPending={isPending}
        statusMessage={statusMessage}
        onConnect={connectWallet}
      />
      <BattleArenaScreen onEnterMatch={enterMatch} />
      <Footer />
      {toast && <Toast message={toast} />}
    </Shell>
  );
}

// ====== UI ======

function Header() {
  return (
    <div className="header">
      <div className="brandMark" aria-hidden />
      <div className="brand">3balance</div>
      <style>{headerCss}</style>
    </div>
  );
}

function Hero() {
  return (
    <div className="hero">
      <div className="heroBadge">On-chain match entry</div>
      <div className="heroTitle">Enter the Arena</div>
      <div className="heroSubtitle">
        Choose your fighter, sign the entry transaction, and clash for the coin.
      </div>
      <div className="heroStats">
        <div className="heroStat">
          <div className="heroStatLabel">Mode</div>
          <div className="heroStatValue">1v1 Duel</div>
        </div>
        <div className="heroStat">
          <div className="heroStatLabel">Entry</div>
          <div className="heroStatValue">Base Mainnet</div>
        </div>
        <div className="heroStat">
          <div className="heroStatLabel">Status</div>
          <div className="heroStatValue">Live</div>
        </div>
      </div>
      <style>{heroCss}</style>
    </div>
  );
}

function WalletPanel({ connected, address, isPending, statusMessage, onConnect }) {
  return (
    <div className="walletCard">
      <div className="walletRow">
        <div>
          <div className="walletLabel">Wallet</div>
          <div className="walletValue">
            {connected ? formatAddress(address) : "Not connected"}
          </div>
        </div>
        {connected && <span className="walletTag">Ready</span>}
      </div>

      {!connected && (
        <button
          className="btn"
          data-primary="1"
          onClick={onConnect}
          disabled={isPending}
          type="button"
        >
          {isPending ? "Connecting..." : "Connect Base Account"}
        </button>
      )}

      {statusMessage && <div className="statusText">{statusMessage}</div>}
      <style>{walletCss}</style>
      <style>{buttonCss}</style>
    </div>
  );
}

function Footer() {
  return <div className="footer">Powered by Base Account</div>;
}

function Shell({ children }) {
  return (
    <div className="appShell">
      {children}
      <style>{globalCss}</style>
    </div>
  );
}

function Toast({ message }) {
  return (
    <div className="toast" role="status">
      {message}
      <style>{toastCss}</style>
    </div>
  );
}

function formatAddress(address) {
  if (!address) return "-";
  return address.slice(0, 6) + "..." + address.slice(-4);
}

function humanError(e) {
  return (
    e?.shortMessage ||
    e?.reason ||
    e?.data?.message ||
    e?.message ||
    String(e)
  );
}

const globalCss = `
.appShell {
  min-height: 100vh;
  background: radial-gradient(1200px 600px at 50% -20%, rgba(74, 108, 255, 0.2), transparent),
    radial-gradient(900px 500px at 10% 10%, rgba(168, 85, 247, 0.18), transparent),
    #07080d;
  color: #e8ecff;
  padding: 20px 16px 40px;
  font-family: "Inter", "Segoe UI", system-ui, sans-serif;
  max-width: 480px;
  margin: 0 auto;
  position: relative;
}

.appShell::before {
  content: "";
  position: absolute;
  inset: 0;
  background-image: linear-gradient(rgba(255, 255, 255, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.04) 1px, transparent 1px);
  background-size: 48px 48px;
  opacity: 0.2;
  pointer-events: none;
}

.appShell > * {
  position: relative;
}

.footer {
  margin-top: 18px;
  text-align: center;
  font-size: 11px;
  opacity: 0.55;
  letter-spacing: 0.3px;
}
`;

const headerCss = `
.header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.brandMark {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, #7fb1ff, #4b6bff 60%, #1b1f2b 100%);
  box-shadow: 0 0 14px rgba(75, 107, 255, 0.7);
}

.brand {
  font-weight: 900;
  font-size: 24px;
  letter-spacing: 0.6px;
  text-transform: lowercase;
}
`;

const heroCss = `
.hero {
  background: linear-gradient(140deg, rgba(19, 24, 40, 0.95), rgba(9, 11, 18, 0.95));
  border: 1px solid rgba(123, 140, 255, 0.4);
  border-radius: 18px;
  padding: 16px 16px 14px;
  box-shadow: 0 18px 40px rgba(7, 10, 20, 0.6);
  margin-bottom: 14px;
}

.heroBadge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #9ec4ff;
}

.heroTitle {
  font-size: 24px;
  font-weight: 800;
  margin-top: 6px;
}

.heroSubtitle {
  font-size: 12px;
  opacity: 0.7;
  margin-top: 6px;
  line-height: 1.5;
}

.heroStats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 12px;
}

.heroStat {
  background: rgba(10, 13, 22, 0.8);
  border: 1px solid rgba(123, 140, 255, 0.18);
  border-radius: 12px;
  padding: 8px 8px;
  text-align: center;
}

.heroStatLabel {
  font-size: 9px;
  opacity: 0.6;
  letter-spacing: 0.8px;
  text-transform: uppercase;
}

.heroStatValue {
  margin-top: 4px;
  font-size: 12px;
  font-weight: 700;
}
`;

const walletCss = `
.walletCard {
  background: rgba(11, 14, 22, 0.86);
  border: 1px solid rgba(90, 110, 200, 0.3);
  border-radius: 16px;
  padding: 14px;
  display: grid;
  gap: 10px;
  margin-bottom: 16px;
}

.walletRow {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}

.walletLabel {
  font-size: 11px;
  opacity: 0.65;
  text-transform: uppercase;
  letter-spacing: 0.6px;
}

.walletValue {
  font-size: 14px;
  font-weight: 700;
  margin-top: 2px;
}

.walletTag {
  background: rgba(34, 197, 94, 0.18);
  color: #7ef2a4;
  border: 1px solid rgba(34, 197, 94, 0.3);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
}

.statusText {
  font-size: 11px;
  color: #ffd27a;
}
`;

const buttonCss = `
.btn {
  border-radius: 12px;
  border: 1px solid rgba(123, 140, 255, 0.4);
  background: rgba(14, 17, 25, 0.9);
  color: #e8ecff;
  padding: 10px 14px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}

.btn[data-primary="1"] {
  background: linear-gradient(90deg, #4666ff, #7fb1ff);
  border-color: transparent;
  box-shadow: 0 10px 28px rgba(70, 102, 255, 0.35);
  color: #fff;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn:not(:disabled):hover {
  transform: translateY(-1px);
}
`;

const toastCss = `
.toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(15, 18, 26, 0.95);
  border: 1px solid rgba(123, 140, 255, 0.4);
  color: #e8ecff;
  padding: 10px 16px;
  border-radius: 12px;
  font-size: 12px;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
  z-index: 999;
}
`;
