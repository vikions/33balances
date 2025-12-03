import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { createBaseAccountSDK, base } from "@base-org/account";
import { baseSepolia } from "viem/chains";
import { userOpTrackUrl, monadAddressUrl } from "./smartAccount"; // используем только для ссылок

// === ADDRESS / CHAIN ===
const CONTRACT_ADDRESS = "0xA6e3b00f25569644b3e66D214585567872c94B8B";
const CHAIN_ID_HEX = "0x" + CHAIN_ID.toString(16); 
const CHAIN_ID = base.constants.CHAIN_IDS.baseSepolia; 
// === ABI ===
// Чтение: getVotes, canVote, timeUntilNextVote
const READ_ABI = [
  "function getVotes() view returns (uint256 baseVotes, uint256 farcasterVotes, uint256 zoraVotes)",
  "function canVote(address user) view returns (bool)",
  "function timeUntilNextVote(address user) view returns (uint256)",
];

// Запись: vote(option)
const WRITE_ABI = ["function vote(uint8 option)"];

// === CHOICES ===
// Ключи (meta/cast/mon) оставляем для совместимости с FlowRings, но по смыслу:
// meta = Base, cast = Farcaster, mon = Zora
const CHOICES = [
  { id: 0, key: "meta", label: "Base", emoji: "🔵", color: "#4b6bff", glow: "rgba(75,107,255,0.35)" },
  { id: 1, key: "cast", label: "Farcaster", emoji: "💜", color: "#a855f7", glow: "rgba(168,85,247,0.35)" },
  { id: 2, key: "mon",  label: "Zora", emoji: "🌀", color: "#00ffd5", glow: "rgba(0,255,213,0.35)" },
];

// ===== APP =====
export default function App() {
  // Base Account SDK provider
  const [provider, setProvider] = useState(null);

  // Адреса
  const [universalAddress, setUniversalAddress] = useState(null);
  const [subAddress, setSubAddress] = useState(null);
  const [smartAddr, setSmartAddr] = useState(null); // для UI — показывает активный аккаунт

  // Статус/данные
  const [powers, setPowers] = useState({ meta: 0, cast: 0, mon: 0 });
  const [message, setMessage] = useState("");
  const [screen, setScreen] = useState("connect");
  const [loading, setLoading] = useState(false);
  const [lastOpHash, setLastOpHash] = useState(null);
  const [cooldownSec, setCooldownSec] = useState(0);

  const connected = subAddress || universalAddress;

  // Инициализация Base Account SDK
 useEffect(() => {
  const init = async () => {
    const sdk = createBaseAccountSDK({
      appName: "TriBalance",
      appLogoUrl: "https://base.org/logo.png",
      appChainIds: [CHAIN_ID], // вместо baseSepolia.id
      subAccounts: {
        creation: "on-connect",
        defaultAccount: "sub",
        funding: "spend-permissions",
      },
    });
    setProvider(sdk.getProvider());
  };
  init();
}, []);


  // ethers-провайдер и контракт для чтения
  const readContracts = useMemo(() => {
    if (!provider) return null;
    const ethersProvider = new ethers.BrowserProvider(provider);
    const readContract = new ethers.Contract(CONTRACT_ADDRESS, READ_ABI, ethersProvider);
    return { readContract, ethersProvider };
  }, [provider]);

  // Получить или создать sub-аккаунт для домена
  const ensureSubForDomain = async (univ) => {
    const res = await provider.request({
      method: "wallet_getSubAccounts",
      params: [{ account: univ, domain: window.location.origin }],
    });
    let sub = res?.subAccounts?.[0]?.address;
    if (!sub) {
      const created = await provider.request({
        method: "wallet_addSubAccount",
        params: [{ account: { type: "create" } }],
      });
      sub = created?.address;
    }
    return sub;
  };

  // Коннект кошелька (универсальный + sub-аккаунт)
  const connectWallet = async () => {
    try {
      if (!provider) return setMessage("Provider not ready yet");
      setMessage("Connecting Base Account…");

      const accounts = await provider.request({ method: "eth_requestAccounts" });
      const univ = accounts?.[0] || null;
      if (!univ) throw new Error("No account returned");

      setUniversalAddress(univ);
      const sub = await ensureSubForDomain(univ);
      setSubAddress(sub);
      setSmartAddr(sub || univ);
      setScreen("app");
      setMessage("");

      await loadPowers(univ, sub);
    } catch (e) {
      console.error(e);
      setMessage(humanError(e));
    }
  };

  // Загрузка голосов и кулдауна
  const loadPowers = async (univ, sub) => {
    try {
      if (!readContracts) return;
      const { readContract } = readContracts;

      const [baseVotes, farVotes, zoraVotes] = await readContract.getVotes();
      setPowers({
        meta: Number(baseVotes),
        cast: Number(farVotes),
        mon: Number(zoraVotes),
      });

      const addr = sub || univ || smartAddr;
      if (addr) {
        const cd = await readContract.timeUntilNextVote(addr);
        setCooldownSec(Number(cd));
      }
    } catch (e) {
      console.warn("loadPowers:", e);
    }
  };

  // Периодическое обновление круговой диаграммы
  useEffect(() => {
    if (!readContracts || !connected) return;
    const id = setInterval(() => {
      loadPowers(universalAddress, subAddress);
    }, 8000);
    return () => clearInterval(id);
  }, [readContracts, connected, universalAddress, subAddress]);

  // Голосование через Base smart account (wallet_sendCalls)
  const handleVote = async (choiceId) => {
    try {
      if (!provider) return setMessage("Provider not ready yet");
      if (!connected) return setMessage("Connect Base Account first");

      setLoading(true);
      setMessage("");
      setLastOpHash(null);

      const from = subAddress || universalAddress;

      // предварительная проверка кулдауна
      if (readContracts) {
        const { readContract } = readContracts;
        const can = await readContract.canVote(from);
        if (!can) {
          const cd = await readContract.timeUntilNextVote(from);
          setCooldownSec(Number(cd));
          setMessage(`You can vote again in ~${Math.ceil(Number(cd) / 60)} minutes.`);
          setLoading(false);
          return;
        }
      }

      const voteIface = new ethers.Interface(WRITE_ABI);
      const voteData = voteIface.encodeFunctionData("vote", [choiceId]);

      const res = await provider.request({
        method: "wallet_sendCalls",
        params: [
          {
            version: "2.0.0",
            atomicRequired: true,
            chainId: CHAIN_ID_HEX,
            from,
            calls: [{ to: CONTRACT_ADDRESS, data: voteData, value: "0x0" }],
          },
        ],
      });

      const id = res?.id || res;

      // ждём CONFIRMED через wallet_getCallsStatus
      let txHash = null;
      for (let i = 0; i < 15; i++) {
        try {
          const st = await provider.request({
            method: "wallet_getCallsStatus",
            params: [{ id }],
          });
          if (st?.status === "CONFIRMED") {
            txHash =
              st?.transactions?.[0]?.hash ||
              st?.txHash ||
              st?.transactionHash ||
              null;
            break;
          }
          if (st?.status === "FAILED" || st?.status === "REJECTED") {
            setMessage("Transaction failed / rejected");
            break;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 900));
      }

      if (txHash) {
        setLastOpHash(txHash);
        setMessage("✅ Vote cast!");
      }

      await loadPowers(universalAddress, subAddress);
    } catch (e) {
      console.error(e);
      setMessage(humanError(e));
    } finally {
      setLoading(false);
    }
  };

  // === UI ===

  if (screen === "connect") {
    return (
      <Shell>
        <Header />
        <Card>
          <p className="muted">Welcome to</p>
          <h1 className="title">TriBalance</h1>
          <p className="muted">
            Vote with a Base Smart Account across Base, Farcaster & Zora.
          </p>
          <Button primary onClick={connectWallet}>
            Connect Base Account
          </Button>
          {message && <p className="msg">{message}</p>}
        </Card>
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
      <Header />

      {/* Smart Account block */}
      <Card glow>
        <div className="row">
          <span className="muted">Smart Account</span>
          <a
            className="link"
            href={smartAddr ? monadAddressUrl(smartAddr) : "#"}
            target="_blank"
            rel="noreferrer"
          >
            {smartAddr ? `${smartAddr.slice(0, 6)}…${smartAddr.slice(-4)}` : "—"}
          </a>
        </div>
        {lastOpHash && (
          <div className="row" style={{ marginTop: 6 }}>
            <span className="muted">Last tx</span>
            <a
              className="link"
              href={userOpTrackUrl(lastOpHash)}
              target="_blank"
              rel="noreferrer"
            >
              {lastOpHash.slice(0, 10)}…
            </a>
          </div>
        )}
      </Card>

      {/* Balance of powers — КРУГОВОЙ ВАРИАНТ */}
      <Card>
        <h3 className="cardTitle">Balance of Powers</h3>
        <FlowRings pct={pct} values={powers} />
        <div className="chips">
          {CHOICES.map((c) => (
            <Chip
              key={c.id}
              active={false}
              color={c.color}
              glow={c.glow}
            >
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
          label={`Vote ${c.label}`}
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

      <Footer />
    </Shell>
  );
}

/* === остальной UI (Header, Footer, Shell, Card, FlowRings, Chip, SectionTitle, Button, ActionCard, CSS, helpers) оставляем БЕЗ ИЗМЕНЕНИЙ === */

function Header() {
  return (
    <div className="header">
      <div className="logoPulse" />
      <div>
        <div className="brand">TriBalance</div>
        <div className="tagline">Base • Farcaster • Zora</div>
      </div>
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
      Now powered by Base Smart Accounts
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

// FlowRings / Chip / SectionTitle / Button / ActionCard / CSS / helpers — используем твои же версии из файла:
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
.header { display:flex; gap:12px; align-items:center; margin: 8px 0 16px; }
.brand { font-weight: 800; font-size: 22px; letter-spacing: .3px; }
.tagline { opacity:.6; font-size:12px; margin-top:2px }
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
