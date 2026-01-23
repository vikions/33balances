import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WagmiProvider, useAccount, useConnect, useSwitchChain } from "wagmi";
import { base } from "wagmi/chains";
import { baseAccount } from "wagmi/connectors";
import { farcasterMiniApp } from "@farcaster/miniapp-wagmi-connector";
import { createConfig, http } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { sendCalls, getCapabilities, readContract } from "@wagmi/core";
import { parseAbi, encodeFunctionData } from "viem";

/** @typedef {import("./types").PolymarketMarket} PolymarketMarket */
/** @typedef {import("./types").ArenaStake} ArenaStake */
/** @typedef {import("./types").StakeSide} StakeSide */

// === ADDRESS / CHAIN ===
const CONTRACT_ADDRESS = "0x578D6936914d01a7d6225401715A4ee75C7D7602";
const CHAIN_ID = base.id; // 8453

// Paymaster (Coinbase Developer Platform)
const PAYMASTER_URL =
  "https://api.developer.coinbase.com/rpc/v1/base/mmo6mwwplQQx927oL1bz30eQZ33eEDOc";

// === ABI ===
const CONTRACT_ABI = parseAbi([
  "function getVotes() view returns (uint256 baseVotes, uint256 farcasterVotes, uint256 zoraVotes)",
  "function canVote(address user) view returns (bool)",
  "function timeUntilNextVote(address user) view returns (uint256)",
  "function vote(uint8 option)",
]);

// === CHOICES ===
const CHOICES = [
  {
    id: 0,
    key: "meta",
    label: "Base",
    emoji: "🔵",
    color: "#4b6bff",
    glow: "rgba(75,107,255,0.35)",
  },
  {
    id: 1,
    key: "cast",
    label: "Farcaster",
    emoji: "💜",
    color: "#a855f7",
    glow: "rgba(168,85,247,0.35)",
  },
  {
    id: 2,
    key: "mon",
    label: "Zora",
    emoji: "🌀",
    color: "#00ffd5",
    glow: "rgba(0,255,213,0.35)",
  },
];

// === ARENA CONSTANTS ===
const ENTRY_FLAG_KEY = "hasEnteredArena";
const IQ_STORAGE_KEY = "arenaIQ";
const STAKES_STORAGE_KEY = "arenaStakes";
const IQ_START = 100;
const STAKE_PRESETS = [1, 2, 5, 10];
const POLYMARKET_FEATURED_PATH = "/api/polymarket/featured";
const POLYMARKET_DIAGNOSTICS_PATH = "/api/polymarket/diagnostics";

// === WAGMI CONFIG ===
// СТРОГО как в доке: farcasterMiniApp() первым, baseAccount() вторым
const config = createConfig({
  chains: [base],
  transports: {
    [base.id]: http(),
  },
  connectors: [
    farcasterMiniApp(),
    baseAccount({
      appName: "TriBalance",
      appLogoUrl: "https://base.org/logo.png",
    }),
  ],
});

const queryClient = new QueryClient();

export default function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <TriBalanceApp />
      </QueryClientProvider>
    </WagmiProvider>
  );
}

function TriBalanceApp() {
  const { address, chain } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { switchChain } = useSwitchChain();
  const { path, navigate } = useClientPath();

  const [powers, setPowers] = useState({ meta: 0, cast: 0, mon: 0 });
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldownSec, setCooldownSec] = useState(0);
  const [hasEnteredArena, setHasEnteredArena] = useState(() =>
    readSessionFlag(ENTRY_FLAG_KEY)
  );
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

  const enterArena = () => {
    writeSessionFlag(ENTRY_FLAG_KEY, true);
    setHasEnteredArena(true);
  };

  // Автоматическое переключение на Base при подключении
  useEffect(() => {
    if (connected && chain && chain.id !== 8453) {
      console.log(`Wrong chain detected: ${chain.id}, switching to Base (8453)...`);
      setMessage("⚠️ Switching to Base network...");
      switchChain?.({ chainId: 8453 });
      setTimeout(() => setMessage(""), 3000);
    }
  }, [connected, chain, switchChain]);

  const loadPowers = async (addr) => {
    try {
      const [baseVotes, farVotes, zoraVotes] = await readContract(config, {
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "getVotes",
        args: [],
        chainId: CHAIN_ID,
      });

      setPowers({
        meta: Number(baseVotes),
        cast: Number(farVotes),
        mon: Number(zoraVotes),
      });

      if (addr) {
        const cd = await readContract(config, {
          address: CONTRACT_ADDRESS,
          abi: CONTRACT_ABI,
          functionName: "timeUntilNextVote",
          args: [addr],
          chainId: CHAIN_ID,
        });
        setCooldownSec(Number(cd));
      }
    } catch (e) {
      console.warn("loadPowers:", e);
    }
  };

  useEffect(() => {
    if (!connected) return;
    loadPowers(address);
    const id = setInterval(() => loadPowers(address), 8000);
    return () => clearInterval(id);
  }, [connected, address]);

  const connectWallet = async () => {
    try {
      setMessage("");

      // В Base App farcasterMiniApp() auto-connect'ится к Base Account
      const connector = connectors[0];
      if (!connector) return setMessage("No wallet connectors available");

      await connect({ connector });
    } catch (e) {
      console.error(e);
      setMessage(humanError(e));
    }
  };

  const handleVote = async (choiceId) => {
    try {
      if (!connected || !address)
        return setMessage("Open inside Base App / connect first");

      setLoading(true);
      setMessage("");

      // ✅ На твоей версии wagmi это самый совместимый "account"
      const account = address;

      const can = await readContract(config, {
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "canVote",
        args: [account],
        chainId: CHAIN_ID,
      });

      if (!can) {
        const cd = await readContract(config, {
          address: CONTRACT_ADDRESS,
          abi: CONTRACT_ABI,
          functionName: "timeUntilNextVote",
          args: [account],
          chainId: CHAIN_ID,
        });
        const cdNum = Number(cd);
        setCooldownSec(cdNum);
        setMessage(`You can vote again in ~${Math.ceil(cdNum / 60)} minutes.`);
        setLoading(false);
        return;
      }

      const data = encodeFunctionData({
        abi: CONTRACT_ABI,
        functionName: "vote",
        args: [choiceId],
      });

      // 1) getCapabilities
      const capabilities = await getCapabilities(config, { account });

      // 2) Check Base mainnet chain ID capabilities
      const baseCapabilities = capabilities?.[8453];
      const supportsPaymaster = !!baseCapabilities?.paymasterService?.supported;

      // 3) sendCalls with optional paymaster capability
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

      setMessage(
        supportsPaymaster
          ? "✅ Vote sent (gas sponsored via paymaster)!"
          : "✅ Vote sent!"
      );

      await loadPowers(account);
    } catch (e) {
      console.error(e);
      setMessage(humanError(e));
    } finally {
      setLoading(false);
    }
  };

  // === UI ===


  if (!hasEnteredArena) {
    return (
      <Shell>
        <Header showNav={false} />
        <EntryScreen onEnter={enterArena} />
      </Shell>
    );
  }

  if (path === "/diagnostics") {
    return (
      <Shell>
        <Header activePath={path} onNavigate={navigate} />
        <DiagnosticsScreen onRefresh={() => showToast("Diagnostics refreshed.")} />
        {toast && <Toast message={toast} />}
      </Shell>
    );
  }

  const total = Math.max(1, powers.meta + powers.cast + powers.mon);
  const pct = {
    meta: Math.round((powers.meta / total) * 100),
    cast: Math.round((powers.cast / total) * 100),
    mon: Math.round((powers.mon / total) * 100),
  };

  return (
    <Shell>
      <Header activePath={path} onNavigate={navigate} />
      <Arena onToast={showToast} />

      {!connected ? (
        <Card>
          <p className="muted">Welcome to</p>
          <h1 className="title">TriBalance</h1>
          <p className="muted">
            Vote with a Base Account across Base, Farcaster &amp; Zora.
          </p>

          <Button
            primary
            onClick={connectWallet}
            disabled={isPending || loading}
          >
            {isPending ? "Connecting..." : "Connect Base Account"}
          </Button>

          {message && <p className="msg">{message}</p>}
        </Card>
      ) : (
        <>
          {/* Account block */}
          <Card glow>
            <div className="row">
              <span className="muted">Connected address</span>
              <a
                className="link"
                href={address ? "https://basescan.org/address/" + address : "#"}
                target="_blank"
                rel="noreferrer"
              >
                {address
                  ? address.slice(0, 6) + "..." + address.slice(-4)
                  : "-"}
              </a>
            </div>
            <div className="tiny muted" style={{ marginTop: 6 }}>
              Inside Base App, the Farcaster mini-app connector auto-connects to the
              user's Base Account.
            </div>
          </Card>

          {/* Balance of powers */}
          <Card>
            <h3 className="cardTitle">Balance of Powers</h3>
            <FlowRings pct={pct} values={powers} />
            <div className="chips">
              {CHOICES.map((c) => (
                <Chip key={c.id} active={false} color={c.color} glow={c.glow}>
                  <span style={{ fontSize: 18 }}>{c.emoji}</span> {c.label}
                </Chip>
              ))}
            </div>
          </Card>

          {/* Vote */}
          <SectionTitle>Vote</SectionTitle>
          {CHOICES.map((c) => (
            <ActionCard
              key={c.id}
              label={"Vote " + c.label}
              emoji={c.emoji}
              color={c.color}
              glow={c.glow}
              disabled={loading || !connected}
              onClick={() => handleVote(c.id)}
            />
          ))}

          {cooldownSec > 0 && (
            <p className="msg">
              Cooldown: you can vote again in ~{Math.ceil(cooldownSec / 60)} minutes.
            </p>
          )}

          {message && <p className="msg">{message}</p>}
        </>
      )}

      <Footer />
      {toast && <Toast message={toast} />}
    </Shell>
  );
}

// ====== UI COMPONENTS (как у тебя было) ======

function Header({ activePath = "/", onNavigate, showNav = true }) {
  return (
    <div className="header">
      <div className="headerMain">
        <div className="logoPulse" />
        <div>
          <div className="brand">TriBalance</div>
          <div className="tagline">Base / Farcaster / Zora</div>
        </div>
      </div>
      {showNav && (
        <div className="nav">
          <button
            className="navBtn"
            data-active={activePath === "/" ? "1" : "0"}
            onClick={() => onNavigate?.("/")}
            type="button"
          >
            Arena
          </button>
          <button
            className="navBtn"
            data-active={activePath === "/diagnostics" ? "1" : "0"}
            onClick={() => onNavigate?.("/diagnostics")}
            type="button"
          >
            Diagnostics
          </button>
        </div>
      )}
      <style>{headerCss}</style>
    </div>
  );
}

function Footer() {
  return (
    <div
      style={{
        opacity: 0.6,
        fontSize: 12,
        marginTop: 20,
        textAlign: "center",
      }}
    >
      Now powered by Base Account on Base Mainnet
    </div>
  );
}

function Shell({ children }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(1200px 600px at 50% -10%, rgba(0,255,213,0.08), transparent), radial-gradient(900px 600px at -10% 10%, rgba(168,85,247,0.08), transparent), #0a0b0d",
        color: "#eaeef7",
        padding: 18,
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto",
        maxWidth: 440,
        margin: "0 auto",
      }}
    >
      {children}
      <style>{globalCss}</style>
    </div>
  );
}

function Card({ children, glow }) {
  return (
    <div className="card" data-glow={glow ? "1" : "0"}>
      {children}
      <style>{cardCss}</style>
    </div>
  );
}

const globalCss = `
.title { font-size: 38px; font-weight: 800; letter-spacing: .5px; margin: 6px 0 4px; }
.muted { opacity: .75 }
.msg { margin-top: 10px; opacity: .9 }
.link { color: #79b7ff; text-decoration: none; }
.tiny { font-size: 12px }
.row { display:flex; justify-content:space-between; align-items:center; gap:10px }
.addr { opacity:.75 }
`;

const headerCss = `
.header { display:flex; justify-content:space-between; gap:12px; align-items:center; margin: 8px 0 16px; flex-wrap:wrap; }
.headerMain { display:flex; gap:12px; align-items:center; }
.brand { font-weight: 800; font-size: 22px; letter-spacing: .3px; }
.tagline { opacity:.6; font-size:12px; margin-top:2px }
.nav { display:flex; gap:6px; align-items:center; }
.navBtn { font-size:11px; padding:6px 8px; border-radius:10px; background: rgba(20,22,27,.8); border:1px solid #2a2e36; color:#eaeef7; cursor:pointer; }
.navBtn[data-active="1"]{ border-color:#7fb1ff; box-shadow: 0 0 0 1px rgba(127,177,255,.2); }
.logoPulse{ width:14px; height:14px; border-radius:50%; background: radial-gradient(circle at 30% 30%, #00ffd5, #725bff); box-shadow: 0 0 18px rgba(0,255,213,.6), 0 0 30px rgba(114,91,255,.35); animation: pulse 2.2s ease-in-out infinite; }
@keyframes pulse { 0%,100%{ transform: scale(1); opacity: .9 } 50%{ transform: scale(1.25); opacity: 1 } }
`;

const cardCss = `
.card { background: rgba(19,22,28,.75); border: 1px solid #2a2e36; border-radius:16px; padding: 14px 14px; margin: 12px 0; backdrop-filter: blur(6px); }
.card[data-glow="1"]{ box-shadow: 0 0 0 1px rgba(124,132,255,.08), 0 0 30px rgba(124,132,255,.1) inset; }
.cardTitle { margin:0 0 8px; font-weight:700; }
.chips { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px }
`;

const chipCss = `
.chip { border:1px solid #39404f; padding:6px 10px; border-radius:999px; font-size:12px; display:inline-flex; align-items:center; gap:6px; transition: all .25s ease; }
.chip[data-active="1"]{ background: rgba(255,255,255,.03); transform: translateY(-1px); }
`;

const sectionCss = `
.section { margin: 16px 0 10px; font-weight:800; letter-spacing:.4px; }
`;

const buttonCss = `
.btn { border:none; border-radius:12px; padding: 12px 16px; font-weight:700; cursor:pointer; }
.btn[data-primary="1"]{ background: linear-gradient(90deg,#4666ff,#7fb1ff); color:white; box-shadow: 0 10px 30px rgba(70,102,255,.25); }
.btn[disabled]{ opacity:.6; cursor:not-allowed }
`;

const actionCss = `
.action { width:100%; text-align:left; display:flex; align-items:center; gap:10px; background: rgba(20,22,27,.8); border:1px solid #2a2e36; border-radius:14px; padding:14px 16px; margin-top:8px; color: #eaeef7; cursor:pointer; transition: transform .15s ease, background .2s, box-shadow .3s; }
.action .em { font-size:18px; }
.action:hover { transform: translateY(-1px); background: rgba(25,28,35,.85); }
.action:disabled{ opacity:.6; cursor:not-allowed; transform:none; }
`;

const flowCss = `
.flowWrap { display:flex; flex-direction:column; align-items:center; gap:12px; }
.flowSvg { width: 100%; max-width: 320px; height: auto; }
.ringStroke { transition: stroke-dasharray .6s ease; }
.halo { animation: spin 12s linear infinite; transform-origin: 120px 120px; }
.centerText text { paint-order: stroke fill; stroke: rgba(0,0,0,.2); stroke-width: .6px; }
@keyframes spin { from{transform: rotate(0deg);} to{transform: rotate(360deg);} }
.ringLabels { width:100%; display:flex; flex-direction:column; gap:6px; margin-top:4px; }
.labelRow { display:flex; align-items:center; gap:8px; font-size:13px; }
.labelRow .dot { width:10px; height:10px; border-radius:50%; }
.labelRow .lbl { opacity:.9 }
.labelRow .count { opacity:.6; font-size:12px; }
`;

const entryCss = `
.entryWrap { text-align:center; padding: 6px 4px 12px; }
.entryHalo { height:6px; border-radius:999px; background: linear-gradient(90deg, rgba(0,255,213,.45), rgba(127,177,255,.45)); margin-bottom:14px; }
.entryText { font-size:14px; line-height:1.6; letter-spacing:.2px; }
.entrySpacer { height:10px; }
.entryCta { margin-top:16px; }
`;

const arenaCss = `
.arenaHeader { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
.arenaTitle { font-size:20px; font-weight:800; letter-spacing:.4px; }
.arenaSub { font-size:12px; opacity:.6; margin-top:4px; }
.iqPanel { text-align:right; }
.iqValue { font-size:18px; font-weight:800; }
.iqRank { font-size:12px; opacity:.7; }
.iqLocked { font-size:11px; opacity:.6; margin-top:2px; }
.arenaCard { background: rgba(12,15,19,.7); border:1px solid #2a2e36; border-radius:16px; padding:14px; margin-top:12px; }
.featuredTag { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.6px; color:#7fb1ff; margin-bottom:6px; }
.arenaTop { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; }
.arenaQuestion { font-size:14px; font-weight:700; line-height:1.4; }
.arenaCountdownWrap { text-align:right; }
.arenaCountdownLabel { font-size:11px; opacity:.6; margin-bottom:2px; }
.arenaCountdown { font-size:12px; opacity:.85; white-space:nowrap; font-weight:600; }
.beliefRow { display:flex; gap:8px; margin:10px 0; }
.beliefPill { flex:1; display:flex; justify-content:space-between; padding:6px 10px; border-radius:999px; font-size:12px; border:1px solid #2a2e36; background: rgba(19,22,28,.8); }
.beliefPill[data-side="up"] { border-color: rgba(78,201,176,.5); }
.beliefPill[data-side="down"] { border-color: rgba(255,120,120,.4); }
.stakeRow { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:10px; }
.stakePresets { display:flex; gap:6px; flex-wrap:wrap; }
.stakePreset { border:1px solid #2a2e36; background: rgba(20,22,27,.8); color:#eaeef7; border-radius:10px; padding:6px 10px; font-size:12px; cursor:pointer; }
.stakePreset[data-active="1"] { border-color:#7fb1ff; box-shadow: 0 0 0 1px rgba(127,177,255,.2); }
.stakeInput { flex:1; min-width:90px; border:1px solid #2a2e36; background: rgba(10,12,16,.8); color:#eaeef7; padding:7px 10px; border-radius:10px; font-size:12px; }
.stakeActions { display:flex; gap:8px; }
.stakeAction { flex:1; border-radius:12px; padding:10px 12px; font-weight:700; cursor:pointer; border:1px solid transparent; }
.stakeAction[data-side="up"] { background: linear-gradient(90deg, rgba(60,186,153,.9), rgba(115,232,197,.9)); color:#0a0b0d; }
.stakeAction[data-side="down"] { background: linear-gradient(90deg, rgba(255,111,111,.85), rgba(255,166,166,.9)); color:#fff; }
.stakeAction:disabled { opacity:.6; cursor:not-allowed; }
`;

const diagnosticsCss = `
.diagGrid { display:flex; flex-direction:column; gap:10px; }
.diagRow { display:flex; justify-content:space-between; gap:12px; font-size:12px; }
.diagLabel { opacity:.7; }
.diagValue { font-weight:600; text-align:right; }
.diagActions { margin-top:12px; }
`;

const toastCss = `
.toast { position:fixed; left:50%; bottom:16px; transform: translateX(-50%); background: rgba(20,22,27,.95); border:1px solid #2a2e36; padding:10px 14px; border-radius:12px; font-size:12px; max-width:420px; width: calc(100% - 32px); text-align:center; box-shadow: 0 10px 30px rgba(0,0,0,.35); z-index:50; animation: toastIn .2s ease-out; }
@keyframes toastIn { from { opacity:0; transform: translateX(-50%) translateY(6px); } to { opacity:1; transform: translateX(-50%) translateY(0); } }
`;

function EntryScreen({ onEnter }) {
  return (
    <Card glow>
      <div className="entryWrap">
        <div className="entryHalo" />
        <div className="entryText">
          <div>Opinions are cheap.</div>
          <div>Reality keeps score.</div>
          <div className="entrySpacer" />
          <div>Stake your IQ - not your money.</div>
        </div>
        <div className="entryCta">
          <Button primary onClick={onEnter}>
            Enter the Arena
          </Button>
        </div>
      </div>
      <style>{entryCss}</style>
    </Card>
  );
}

function Arena({ onToast }) {
  const nowMs = useNow(1000);

  const initialStakes = useMemo(() => loadStoredStakes(), []);
  /** @type {[ArenaStake[], Function]} */
  const [stakes, setStakes] = useState(initialStakes);
  const [iq, setIq] = useState(() => getInitialIq(initialStakes));

  /** @type {[PolymarketMarket | null, Function]} */
  const [featured, setFeatured] = useState(null);
  const [featuredLoading, setFeaturedLoading] = useState(true);
  const [featuredError, setFeaturedError] = useState("");
  const [stakeInput, setStakeInput] = useState("");

  const lockedIq = useMemo(
    () =>
      stakes.reduce(
        (sum, stake) => (stake.status === "pending" ? sum + stake.stake : sum),
        0
      ),
    [stakes]
  );
  const availableIq = Math.max(0, iq - lockedIq);
  const rank = getRank(iq);

  const fetchFeatured = useCallback(async () => {
    setFeaturedLoading(true);
    setFeaturedError("");
    try {
      const response = await fetch(POLYMARKET_FEATURED_PATH);
      if (!response.ok) {
        throw new Error("Featured request failed (" + response.status + ")");
      }
      const data = await response.json();
      if (!data || typeof data !== "object") {
        throw new Error("Featured response was empty.");
      }
      setFeatured(data);
    } catch (error) {
      setFeaturedError(error?.message || "Failed to load featured market.");
    } finally {
      setFeaturedLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFeatured();
  }, [fetchFeatured]);

  // Keep IQ and stakes in localStorage for Phase 1 persistence.
  useEffect(() => {
    writeStoredNumber(IQ_STORAGE_KEY, iq);
  }, [iq]);

  useEffect(() => {
    writeStoredJson(STAKES_STORAGE_KEY, stakes);
  }, [stakes]);

  useEffect(() => {
    if (!stakes.length) return;
    const now = nowMs;
    let delta = 0;
    let updated = false;

    const nextStakes = stakes.map((stake) => {
      if (stake.status !== "pending") return stake;
      const endMs = Date.parse(stake.endTime || "");
      if (!Number.isFinite(endMs) || endMs > now) return stake;

      // Phase 1 demo: resolve outcomes randomly once the market ends.
      const resolvedSide = Math.random() < 0.5 ? "UP" : "DOWN";
      const win = resolvedSide === stake.side;
      delta += win ? stake.stake : -stake.stake;
      updated = true;

      return {
        ...stake,
        status: "resolved",
        resolvedSide,
        resolvedAt: now,
      };
    });

    if (updated) {
      setStakes(nextStakes);
      setIq((prev) => prev + delta);
    }
  }, [stakes, nowMs]);

  const handleQuickStake = useCallback((value) => {
    setStakeInput(String(value));
  }, []);

  const handleStake = useCallback(
    (side) => {
      if (!featured) {
        onToast?.("Featured market unavailable.");
        return;
      }

      const amount = Math.floor(Number(stakeInput));
      if (!amount || amount <= 0) {
        onToast?.("Enter a stake amount.");
        return;
      }
      if (amount > availableIq) {
        onToast?.("Not enough available IQ.");
        return;
      }

      const stake = {
        id: makeStakeId(featured.id),
        claimId: featured.id,
        question: featured.question,
        endTime: featured.endTime,
        side,
        stake: amount,
        timestamp: Date.now(),
        status: "pending",
      };

      setStakes((prev) => [stake, ...prev]);
      setStakeInput("");
      onToast?.("Staked " + amount + " IQ on " + side + ".");
    },
    [availableIq, featured, onToast, stakeInput]
  );

  const endTimeMs = featured ? Date.parse(featured.endTime || "") : Number.NaN;
  const isEnded = Number.isFinite(endTimeMs) && endTimeMs <= nowMs;

  return (
    <div>
      <Card>
        <div className="arenaHeader">
          <div>
            <div className="arenaTitle">The Arena</div>
            <div className="arenaSub">One market. One stance. One score.</div>
          </div>
          <div className="iqPanel">
            <div className="iqValue">Your IQ: {iq}</div>
            <div className="iqRank">Rank: {rank}</div>
            <div className="iqLocked">
              Locked: {lockedIq} IQ | Available: {availableIq}
            </div>
          </div>
        </div>
      </Card>

      {featuredLoading && !featured && (
        <Card>
          <p className="muted">Loading featured market...</p>
        </Card>
      )}

      {featuredError && (
        <Card>
          <p className="msg">{featuredError}</p>
        </Card>
      )}

      {featured && (
        <div className="arenaCard">
          <div className="featuredTag">Featured</div>
          <div className="arenaTop">
            <div className="arenaQuestion">{featured.question}</div>
            <div className="arenaCountdownWrap">
              <div className="arenaCountdownLabel">Countdown to resolve</div>
              <div className="arenaCountdown">
                {formatCountdown(featured.endTime, nowMs)}
              </div>
            </div>
          </div>
          <div className="tiny muted" style={{ marginTop: 10 }}>
            Market belief
          </div>
          <div className="beliefRow">
            <div className="beliefPill" data-side="up">
              <span>UP</span>
              <span>{featured.marketUpPct}%</span>
            </div>
            <div className="beliefPill" data-side="down">
              <span>DOWN</span>
              <span>{featured.marketDownPct}%</span>
            </div>
          </div>
          <div className="tiny muted" style={{ marginBottom: 6 }}>
            Stake your IQ
          </div>
          <div className="stakeRow">
            <div className="stakePresets">
              {STAKE_PRESETS.map((value) => (
                <button
                  key={value}
                  className="stakePreset"
                  data-active={Number(stakeInput) === value ? "1" : "0"}
                  onClick={() => handleQuickStake(value)}
                  type="button"
                >
                  {value}
                </button>
              ))}
            </div>
            <input
              className="stakeInput"
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              placeholder="Custom"
              value={stakeInput}
              onChange={(event) => setStakeInput(event.target.value)}
            />
          </div>
          <div className="stakeActions">
            <button
              className="stakeAction"
              data-side="up"
              onClick={() => handleStake("UP")}
              disabled={isEnded || availableIq <= 0}
              type="button"
            >
              UP
            </button>
            <button
              className="stakeAction"
              data-side="down"
              onClick={() => handleStake("DOWN")}
              disabled={isEnded || availableIq <= 0}
              type="button"
            >
              DOWN
            </button>
          </div>
        </div>
      )}
      <style>{arenaCss}</style>
    </div>
  );
}

function DiagnosticsScreen({ onRefresh }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadDiagnostics = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(POLYMARKET_DIAGNOSTICS_PATH);
      if (!response.ok) {
        throw new Error(`Diagnostics request failed (${response.status})`);
      }
      const payload = await response.json();
      setData(payload);
      return true;
    } catch (err) {
      setError(err?.message || "Failed to load diagnostics.");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDiagnostics();
  }, [loadDiagnostics]);

  const handleRefresh = async () => {
    const ok = await loadDiagnostics();
    if (ok) onRefresh?.();
  };

  const lastFetchLabel = formatTimestamp(data?.lastFetchTime);
  const latencyLabel =
    typeof data?.lastLatencyMs === "number" ? `${data.lastLatencyMs}ms` : "n/a";
  const cacheLabel =
    data?.lastCacheHit === null || data?.lastCacheHit === undefined
      ? "n/a"
      : data.lastCacheHit
        ? "hit"
        : "miss";
  const errorLabel = data?.lastError || "None";

  return (
    <Card>
      <h3 className="cardTitle">Diagnostics</h3>
      <div className="diagGrid">
        <div className="diagRow">
          <span className="diagLabel">Last fetch</span>
          <span className="diagValue">{lastFetchLabel}</span>
        </div>
        <div className="diagRow">
          <span className="diagLabel">Last latency</span>
          <span className="diagValue">{latencyLabel}</span>
        </div>
        <div className="diagRow">
          <span className="diagLabel">Cache</span>
          <span className="diagValue">{cacheLabel}</span>
        </div>
        <div className="diagRow">
          <span className="diagLabel">Last error</span>
          <span className="diagValue">{errorLabel}</span>
        </div>
      </div>
      <div className="diagActions">
        <Button primary onClick={handleRefresh} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>
      {error && <p className="msg">{error}</p>}
      <style>{diagnosticsCss}</style>
    </Card>
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

function FlowRings({ pct, values }) {
  const [anim, setAnim] = useState({ meta: 0, cast: 0, mon: 0 });

  useEffect(() => {
    let raf;
    const start = performance.now();
    const from = { ...anim };
    const to = { meta: pct.meta, cast: pct.cast, mon: pct.mon };
    const tick = (t) => {
      const k = Math.min(1, (t - start) / 600);
      const e = 1 - Math.pow(1 - k, 3);
      setAnim({
        meta: from.meta + (to.meta - from.meta) * e,
        cast: from.cast + (to.cast - from.cast) * e,
        mon: from.mon + (to.mon - from.mon) * e,
      });
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pct.meta, pct.cast, pct.mon]);

  const rings = [
    {
      key: "meta",
      color1: "#4b6bff",
      color2: "#7fb1ff",
      radius: 88,
      width: 12,
      label: `Base ${Math.round(anim.meta)}%`,
      value: values.meta,
    },
    {
      key: "cast",
      color1: "#8f4df1",
      color2: "#c79bff",
      radius: 68,
      width: 12,
      label: `Farcaster ${Math.round(anim.cast)}%`,
      value: values.cast,
    },
    {
      key: "mon",
      color1: "#00ffd5",
      color2: "#7dffe9",
      radius: 48,
      width: 12,
      label: `Zora ${Math.round(anim.mon)}%`,
      value: values.mon,
    },
  ];

  return (
    <div className="flowWrap">
      <svg viewBox="0 0 240 240" className="flowSvg" aria-hidden>
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g className="halo">
          <circle
            cx="120"
            cy="120"
            r="92"
            fill="none"
            stroke="url(#gradHalo)"
            strokeWidth="20"
            opacity="0.12"
          />
          <defs>
            <linearGradient id="gradHalo" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#00ffd5" />
              <stop offset="50%" stopColor="#a855f7" />
              <stop offset="100%" stopColor="#4b6bff" />
            </linearGradient>
          </defs>
        </g>

        {rings.map((r) => {
          const C = 2 * Math.PI * r.radius;
          const pctVal = Math.max(0, Math.min(100, anim[r.key]));
          const dash = (C * pctVal) / 100;
          const gap = C - dash;
          return (
            <g key={r.key} filter="url(#glow)">
              <circle
                cx="120"
                cy="120"
                r={r.radius}
                fill="none"
                stroke="#101319"
                strokeWidth={r.width}
              />
              <circle
                cx="120"
                cy="120"
                r={r.radius}
                fill="none"
                stroke={`url(#grad-${r.key})`}
                strokeWidth={r.width}
                strokeLinecap="round"
                strokeDasharray={`${dash} ${gap}`}
                transform="rotate(-90 120 120)"
                className="ringStroke"
              />
              <defs>
                <linearGradient
                  id={`grad-${r.key}`}
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="0%"
                >
                  <stop offset="0%" stopColor={r.color1} />
                  <stop offset="100%" stopColor={r.color2} />
                </linearGradient>
              </defs>
            </g>
          );
        })}

        <g className="centerText">
          <text
            x="120"
            y="110"
            textAnchor="middle"
            fontSize="22"
            fontWeight="800"
            fill="#eaeef7"
          >
            {Math.max(pct.meta, pct.cast, pct.mon)}%
          </text>
          <text
            x="120"
            y="132"
            textAnchor="middle"
            fontSize="12"
            fill="#9aa4b2"
            letterSpacing=".3px"
          >
            network balance
          </text>
        </g>
      </svg>

      <div className="ringLabels">
        {rings.map((r) => (
          <div key={r.key} className="labelRow">
            <span
              className="dot"
              style={{
                background: r.color1,
                boxShadow: `0 0 10px ${r.color1}55`,
              }}
            />
            <span className="lbl">
              {r.label} <span className="count">({r.value})</span>
            </span>
          </div>
        ))}
      </div>

      <style>{flowCss}</style>
    </div>
  );
}

function Chip({ children, active, color, glow }) {
  return (
    <span
      className="chip"
      data-active={active ? "1" : "0"}
      style={{
        borderColor: color,
        boxShadow: active ? `0 0 24px ${glow}` : "none",
      }}
    >
      {children}
      <style>{chipCss}</style>
    </span>
  );
}

function SectionTitle({ children }) {
  return (
    <h3 className="section">
      {children}
      <style>{sectionCss}</style>
    </h3>
  );
}

function Button({ children, primary, onClick, disabled }) {
  return (
    <button
      className="btn"
      data-primary={primary ? "1" : "0"}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
      <style>{buttonCss}</style>
    </button>
  );
}

function ActionCard({ label, emoji, color, glow, onClick, disabled }) {
  return (
    <button
      className="action"
      onClick={onClick}
      disabled={disabled}
      style={{
        borderColor: color,
        boxShadow: `inset 0 0 0 1px ${color}40, 0 0 24px ${glow}`,
      }}
    >
      <span className="em">{emoji}</span>
      <span>{label}</span>
      <style>{actionCss}</style>
    </button>
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

// Simple path state avoids adding a routing dependency for this phase.
function useClientPath() {
  const [path, setPath] = useState(() =>
    typeof window === "undefined" ? "/" : window.location.pathname || "/"
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handlePop = () => setPath(window.location.pathname || "/");
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

  const navigate = useCallback((nextPath) => {
    if (typeof window === "undefined") return;
    if (window.location.pathname === nextPath) return;
    window.history.pushState({}, "", nextPath);
    setPath(nextPath);
  }, []);

  return { path, navigate };
}

function useNow(intervalMs) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}

function readSessionFlag(key) {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(key) === "1";
}

function writeSessionFlag(key, value) {
  if (typeof window === "undefined") return;
  if (value) {
    window.sessionStorage.setItem(key, "1");
  } else {
    window.sessionStorage.removeItem(key);
  }
}

function getInitialIq(stakes) {
  if (typeof window === "undefined") return IQ_START;
  const raw = window.localStorage.getItem(IQ_STORAGE_KEY);
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return IQ_START;
  if (value === 0) {
    const hasResolved = Array.isArray(stakes)
      ? stakes.some((stake) => stake.status === "resolved")
      : false;
    if (!hasResolved) return IQ_START;
  }
  return value;
}

/** @returns {ArenaStake[]} */
function loadStoredStakes() {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(STAKES_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((stake) => ({
        ...stake,
        status:
          stake.status === "resolved" || stake.resolvedSide
            ? "resolved"
            : "pending",
      }))
      .filter((stake) => stake.side === "UP" || stake.side === "DOWN");
  } catch {
    return [];
  }
}

function writeStoredNumber(key, value) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, String(value));
}

function writeStoredJson(key, value) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function formatCountdown(endTime, nowMs) {
  const endMs = Date.parse(endTime || "");
  if (!Number.isFinite(endMs)) return "TBD";
  const delta = endMs - nowMs;
  if (delta <= 0) return "Resolved";
  const totalSeconds = Math.floor(delta / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function formatTimestamp(value) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}

function getRank(iq) {
  if (iq >= 160) return "Galaxy Brain";
  if (iq >= 120) return "Big Brain";
  return "Average Human";
}

function makeStakeId(claimId) {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${claimId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
