import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { WagmiProvider, useAccount, useConnect, useSwitchChain } from "wagmi";
import { base } from "wagmi/chains";
import { baseAccount } from "wagmi/connectors";
import { useComposeCast, useMiniKit } from "@coinbase/onchainkit/minikit";
import { createConfig, http } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { sendCalls, getCapabilities } from "@wagmi/core";
import { parseAbi, encodeFunctionData } from "viem";

const BattleArenaScreen = lazy(() => import("./BattleArena"));

// === ADDRESS / CHAIN ===
const CONTRACT_ADDRESS =
  import.meta.env?.VITE_BATTLE_ENTRY_CONTRACT ??
  "0x7b62877EBe12d155F9bbC281fbDe8026F6a2Eccf";

const APP_URL = import.meta.env?.VITE_APP_URL ?? "https://3balances.vercel.app";
const APP_LOGO_URL = `${APP_URL.replace(/\/$/, "")}/icon.png?v=2`;

// Paymaster (Coinbase Developer Platform)
const PAYMASTER_URL =
  "https://api.developer.coinbase.com/rpc/v1/base/mmo6mwwplQQx927oL1bz30eQZ33eEDOc";

// === ABI ===
const CONTRACT_ABI = parseAbi(["function enterMatch(string characterId)"]);

// === WAGMI CONFIG ===
const config = createConfig({
  chains: [base],
  transports: {
    [base.id]: http(),
  },
  connectors: [
    baseAccount({
      appName: "3balance",
      appLogoUrl: APP_LOGO_URL,
    }),
  ],
});

const queryClient = new QueryClient();

class MiniKitErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <MiniKitErrorBoundary fallback={<ThreeBalanceAppCore />}>
          <ThreeBalanceAppWithMiniKit />
        </MiniKitErrorBoundary>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

function ThreeBalanceAppWithMiniKit() {
  const miniKit = useMiniKit();
  const { composeCast } = useComposeCast();
  return <ThreeBalanceAppCore miniKit={miniKit} composeCast={composeCast} />;
}

function ThreeBalanceAppCore({ miniKit = null, composeCast = null }) {
  const { address, chain } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { switchChain } = useSwitchChain();
  const context = miniKit?.context;
  const setFrameReady = miniKit?.setFrameReady;
  const isFrameReady = miniKit?.isFrameReady;

  const [statusMessage, setStatusMessage] = useState("");
  const [toast, setToast] = useState("");
  const toastTimerRef = useRef(null);
  const connectAttemptedRef = useRef(false);
  const topRef = useRef(null);
  const profileRef = useRef(null);
  const arenaRef = useRef(null);

  const connected = !!address;
  const profile = context?.user ?? {};
  const displayName =
    profile.displayName ||
    profile.username ||
    "Base Player";
  const avatarUrl = profile.pfpUrl;

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

  useEffect(() => {
    if (typeof setFrameReady !== "function" || isFrameReady) return;
    setFrameReady();
  }, [isFrameReady, setFrameReady]);

  useEffect(() => {
    if (connected || isPending || connectAttemptedRef.current) return;
    const connector = connectors[0];
    if (!connector) return;
    connectAttemptedRef.current = true;
    connect({ connector }).catch(() => {
      setStatusMessage("Connect your Base Account to play.");
    });
  }, [connect, connected, connectors, isPending]);

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

  const handleShareResult = useCallback(
    async ({ winner, opponent }) => {
      const opponentName = opponent?.name || "my opponent";
      const resultLine =
        winner === "player"
          ? `Just defeated ${opponentName}. Try battling the crypto elite right now.`
          : `Just lost to ${opponentName}. Try battling the crypto elite right now.`;

      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      const shareUrl =
        origin ||
        (typeof window !== "undefined" ? window.location.href : "");

      if (!composeCast) {
        try {
          if (typeof navigator !== "undefined" && navigator.share) {
            await navigator.share({
              text: resultLine,
              url: shareUrl || undefined,
            });
            return;
          }
          if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(
              shareUrl ? `${resultLine}\n${shareUrl}` : resultLine
            );
            showToast("Result copied. Share it anywhere.");
            return;
          }
        } catch {
          // Intentionally ignored; fallback toast below.
        }

        showToast("Share is unavailable in this client.");
        return;
      }

      try {
        await composeCast({
          text: resultLine,
          embeds: shareUrl ? [shareUrl] : undefined,
        });
      } catch {
        showToast("Share failed. Try again.");
      }
    },
    [composeCast, showToast]
  );

  const scrollToRef = useCallback((ref) => {
    if (!ref?.current) return;
    ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <Shell>
      <main className="appContent">
        <div ref={topRef}>
          <Header />
          <Hero />
        </div>
        <div ref={profileRef}>
          <WalletPanel
            connected={connected}
            displayName={displayName}
            avatarUrl={avatarUrl}
            isPending={isPending}
            statusMessage={statusMessage}
            onConnect={connectWallet}
          />
        </div>
        <div ref={arenaRef}>
          <Suspense fallback={<LoadingCard />}>
            <BattleArenaScreen
              onEnterMatch={enterMatch}
              onShareResult={handleShareResult}
            />
          </Suspense>
        </div>
        <Footer />
      </main>
      <BottomNav
        onHome={() => scrollToRef(topRef)}
        onProfile={() => scrollToRef(profileRef)}
        onBattle={() => scrollToRef(arenaRef)}
      />
      {toast && <Toast message={toast} />}
    </Shell>
  );
}

// ====== UI ======

function Header() {
  return (
    <div className="header">
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

function LoadingCard() {
  return (
    <div className="loadingCard" role="status" aria-live="polite">
      Loading arena...
      <style>{loadingCss}</style>
    </div>
  );
}

function BottomNav({ onHome, onProfile, onBattle }) {
  return (
    <nav className="bottomNav" aria-label="Primary navigation">
      <button className="navBtn" type="button" onClick={onHome}>
        Home
      </button>
      <button className="navBtn" type="button" onClick={onProfile}>
        Profile
      </button>
      <button className="navBtn" type="button" onClick={onBattle}>
        Battle
      </button>
      <style>{bottomNavCss}</style>
    </nav>
  );
}

function WalletPanel({
  connected,
  displayName,
  avatarUrl,
  isPending,
  statusMessage,
  onConnect,
}) {
  return (
    <div className="walletCard">
      <div className="walletRow">
        <div className="walletIdentity">
          {avatarUrl ? (
            <img className="walletAvatar" src={avatarUrl} alt={displayName} />
          ) : (
            <div className="walletAvatar" data-fallback="1">
              {displayName?.slice(0, 1) || "?"}
            </div>
          )}
          <div>
            <div className="walletLabel">Player</div>
            <div className="walletValue">{displayName}</div>
            <div className="walletAddress">
              {connected ? "Base Account connected" : "Not connected"}
            </div>
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
  --page-fg: #e8ecff;
  --surface: rgba(11, 14, 22, 0.86);
  --surface-border: rgba(90, 110, 200, 0.3);
  --surface-soft: rgba(10, 13, 22, 0.8);
  --accent-1: #4666ff;
  --accent-2: #7fb1ff;
  --muted: rgba(232, 236, 255, 0.65);
  min-height: 100dvh;
  height: 100dvh;
  background: radial-gradient(1200px 600px at 50% -20%, rgba(74, 108, 255, 0.2), transparent),
    radial-gradient(900px 500px at 10% 10%, rgba(168, 85, 247, 0.18), transparent),
    #07080d;
  color: var(--page-fg);
  padding: 12px 12px 92px;
  font-family: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
  max-width: 560px;
  width: 100%;
  margin: 0 auto;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.appShell::before {
  content: "";
  position: absolute;
  inset: 0;
  background-image: linear-gradient(rgba(255, 255, 255, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.04) 1px, transparent 1px);
  background-size: 48px 48px;
  opacity: 0.18;
  pointer-events: none;
}

.appShell > * {
  position: relative;
}

.appContent {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: none;
}

.appContent::-webkit-scrollbar {
  display: none;
}

.footer {
  margin-top: 18px;
  text-align: center;
  font-size: 11px;
  opacity: 0.55;
  letter-spacing: 0.3px;
}

@media (prefers-color-scheme: light) {
  .appShell {
    --page-fg: #142033;
    --surface: rgba(244, 248, 255, 0.94);
    --surface-border: rgba(79, 106, 182, 0.28);
    --surface-soft: rgba(233, 240, 255, 0.92);
    --accent-1: #2f58e8;
    --accent-2: #4f79ff;
    --muted: rgba(20, 32, 51, 0.6);
    background: radial-gradient(1200px 600px at 50% -20%, rgba(100, 130, 255, 0.14), transparent),
      radial-gradient(900px 500px at 10% 10%, rgba(90, 113, 255, 0.12), transparent),
      #f4f7ff;
  }

  .appShell::before {
    background-image: linear-gradient(rgba(42, 64, 120, 0.08) 1px, transparent 1px),
      linear-gradient(90deg, rgba(42, 64, 120, 0.08) 1px, transparent 1px);
    opacity: 0.2;
  }
}
`;

const headerCss = `
.header {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 6px 0 16px;
  text-align: center;
}

.brand {
  font-weight: 900;
  font-size: 26px;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: #eef3ff;
  text-shadow: 0 6px 30px rgba(75, 107, 255, 0.45);
  animation: brandGlow 4s ease-in-out infinite;
}

@keyframes brandGlow {
  0%,
  100% {
    text-shadow: 0 6px 30px rgba(75, 107, 255, 0.35);
  }
  50% {
    text-shadow: 0 6px 40px rgba(127, 177, 255, 0.7);
  }
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
  position: relative;
  overflow: hidden;
  text-align: center;
}

.hero::before {
  content: "";
  position: absolute;
  inset: -60% -20%;
  background: radial-gradient(circle, rgba(127, 177, 255, 0.22), transparent 60%),
    radial-gradient(circle, rgba(168, 85, 247, 0.18), transparent 65%);
  opacity: 0.6;
  animation: heroGlow 8s ease-in-out infinite;
  pointer-events: none;
}

.hero > * {
  position: relative;
}

.heroBadge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #9ec4ff;
  animation: badgeFloat 3.2s ease-in-out infinite;
}

.heroTitle {
  font-size: 24px;
  font-weight: 800;
  margin-top: 6px;
  color: var(--page-fg);
}

.heroSubtitle {
  font-size: 12px;
  color: var(--muted);
  margin-top: 6px;
  line-height: 1.5;
}

.heroStats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 12px;
  justify-items: center;
}

.heroStat {
  background: var(--surface-soft);
  border: 1px solid rgba(123, 140, 255, 0.18);
  border-radius: 12px;
  padding: 8px 8px;
  text-align: center;
  animation: statFloat 4s ease-in-out infinite;
}

.heroStat:nth-child(2) {
  animation-delay: 0.3s;
}

.heroStat:nth-child(3) {
  animation-delay: 0.6s;
}

.heroStatLabel {
  font-size: 9px;
  color: var(--muted);
  letter-spacing: 0.8px;
  text-transform: uppercase;
}

.heroStatValue {
  margin-top: 4px;
  font-size: 12px;
  font-weight: 700;
  color: var(--page-fg);
}

@keyframes heroGlow {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-12px);
  }
}

@keyframes badgeFloat {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-4px);
  }
}

@keyframes statFloat {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-6px);
  }
}

@media (prefers-color-scheme: light) {
  .hero {
    background: linear-gradient(140deg, rgba(250, 252, 255, 0.95), rgba(235, 242, 255, 0.95));
    border-color: rgba(79, 106, 182, 0.25);
    box-shadow: 0 12px 32px rgba(54, 73, 125, 0.16);
  }

  .heroBadge {
    color: #3858cc;
  }
}
`;

const walletCss = `
.walletCard {
  background: var(--surface);
  border: 1px solid var(--surface-border);
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

.walletIdentity {
  display: flex;
  align-items: center;
  gap: 10px;
}

.walletAvatar {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid rgba(123, 140, 255, 0.35);
  background: rgba(16, 20, 30, 0.9);
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 14px;
  text-transform: uppercase;
}

.walletAvatar[data-fallback="1"] {
  color: #d7e2ff;
}

.walletLabel {
  font-size: 11px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.6px;
}

.walletValue {
  font-size: 14px;
  font-weight: 700;
  margin-top: 2px;
}

.walletAddress {
  font-size: 11px;
  color: var(--muted);
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
  color: var(--page-fg);
  padding: 10px 14px;
  min-height: 44px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}

.btn[data-primary="1"] {
  background: linear-gradient(90deg, var(--accent-1), var(--accent-2));
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

@media (prefers-color-scheme: light) {
  .btn {
    background: rgba(245, 249, 255, 0.95);
    border-color: rgba(79, 106, 182, 0.3);
  }
}
`;

const loadingCss = `
.loadingCard {
  background: var(--surface);
  border: 1px solid var(--surface-border);
  border-radius: 16px;
  min-height: 84px;
  display: grid;
  place-items: center;
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 14px;
}
`;

const bottomNavCss = `
.bottomNav {
  position: fixed;
  left: 50%;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 12px);
  transform: translateX(-50%);
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  width: min(440px, calc(100vw - 24px));
  padding: 8px;
  border-radius: 16px;
  border: 1px solid var(--surface-border);
  background: color-mix(in srgb, var(--surface), #000 8%);
  backdrop-filter: blur(10px);
  z-index: 50;
}

.navBtn {
  min-height: 44px;
  border-radius: 12px;
  border: 1px solid rgba(123, 140, 255, 0.35);
  background: rgba(14, 17, 25, 0.92);
  color: var(--page-fg);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

@media (prefers-color-scheme: light) {
  .navBtn {
    background: rgba(245, 249, 255, 0.98);
    border-color: rgba(79, 106, 182, 0.35);
  }
}
`;

const toastCss = `
.toast {
  position: fixed;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 80px);
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
