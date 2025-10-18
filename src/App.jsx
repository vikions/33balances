import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { parseAbi, encodeFunctionData } from "viem";
import { initSmartAccount, userOpTrackUrl, monadAddressUrl } from "./smartAccount";
import { getEip1193Provider } from "./fcProvider";

// === ENV / ADDRS ===
const RPC = import.meta.env.VITE_MONAD_RPC;
const NFT_ADDR = ethers.getAddress(import.meta.env.VITE_NFT);
const TRI_ADDR = ethers.getAddress(import.meta.env.VITE_TRI);

// === ABIs ===
const MINT_SIG = "function mint(uint8 choice)";
const VOTE_SIG = "function vote(uint8 choice)";
const NFT_ABI_VIEM = parseAbi([MINT_SIG]);
const TRI_ABI_VIEM = parseAbi([VOTE_SIG]);

const NFT_ABI = [
  "function hasMinted(address) view returns (bool)",
  "function balanceOf(address,uint256) view returns (uint256)",
];
const TRI_ABI = [
  "function globalPowers() view returns (uint256,uint256,uint256)",
  "function lastVoteAt(address) view returns (uint64)",
  "function voteCooldown() view returns (uint256)",
];

const CHOICES = [
  { id: 0, label: "MetaMask", emoji: "🦊", color: "#ff7a00", glow: "rgba(255,122,0,0.35)" },
  { id: 1, label: "Farcaster", emoji: "💜", color: "#a855f7", glow: "rgba(168,85,247,0.35)" },
  { id: 2, label: "Monad", emoji: "🧬", color: "#00ffd5", glow: "rgba(0,255,213,0.35)" },
];

// ===== APP =====
export default function App() {
  // providers
  const [readProvider, setReadProvider] = useState(null); // только RPC для чтения
  const [provider, setProvider] = useState(null); // Farcaster BrowserProvider — только для подключения

  // state
  const [eoa, setEoa] = useState(null);
  const [mmsa, setMmsa] = useState(null);
  const [smartAddr, setSmartAddr] = useState(null);
  const [lastOpHash, setLastOpHash] = useState(null);

  const [powers, setPowers] = useState({ meta: 0, cast: 0, mon: 0 });
  const [ownedChoice, setOwnedChoice] = useState(null);

  const [message, setMessage] = useState("");
  const [screen, setScreen] = useState("connect");
  const [loading, setLoading] = useState(false);

  // init read provider
  useEffect(() => {
    setReadProvider(new ethers.JsonRpcProvider(RPC));
  }, []);

  // read-only contracts (всегда через RPC!)
  const readContracts = useMemo(() => {
    if (!readProvider) return null;
    const nft = new ethers.Contract(NFT_ADDR, NFT_ABI, readProvider);
    const tri = new ethers.Contract(TRI_ADDR, TRI_ABI, readProvider);
    return { nft, tri };
  }, [readProvider]);

  // helpers
  async function getOwnedChoice(addr) {
    if (!readContracts) return null;
    const { nft } = readContracts;
    for (const c of CHOICES) {
      const bal = await nft.balanceOf(addr, c.id);
      if (bal && bal !== 0n) return c.id;
    }
    return null;
  }

  async function getCooldownLeft(addr) {
    try {
      const { tri } = readContracts;
      const last = BigInt(await tri.lastVoteAt(addr));
      const cd = BigInt(await tri.voteCooldown());
      const now = BigInt(Math.floor(Date.now() / 1000));
      const next = last + cd;
      return next > now ? Number(next - now) : 0;
    } catch {
      return 0;
    }
  }

  async function loadPowers() {
    if (!readContracts) return;
    try {
      const { tri } = readContracts;
      const [m, c, n] = await tri.globalPowers();
      setPowers({ meta: Number(m), cast: Number(c), mon: Number(n) });
    } catch (e) {
      console.warn("loadPowers:", e);
    }
  }

  async function refreshOwnedChoice() {
    if (!mmsa) return;
    try {
      setOwnedChoice(await getOwnedChoice(mmsa.address));
    } catch {}
  }

  // polling: авто-обновление процентов
  useEffect(() => {
    if (!readProvider) return;
    const id = setInterval(loadPowers, 5000);
    return () => clearInterval(id);
  }, [readProvider]);

  // connect / create SA
  async function connectWallet() {
    try {
      setMessage("Connecting Farcaster Wallet…");
      const eip1193 = await getEip1193Provider();
      const eth = new ethers.BrowserProvider(eip1193);
      setProvider(eth);
      const accs = await eip1193.request({ method: "eth_requestAccounts" });
      const addr = ethers.getAddress(accs[0]);
      setEoa(addr);
      setScreen("createSA");
      setMessage("");
    } catch (e) {
      setMessage(humanError(e));
    }
  }

  async function createSmartAccount() {
    try {
      setMessage("Creating Smart Account…");
      const ctx = await initSmartAccount();
      setMmsa(ctx);
      setSmartAddr(ctx.address);
      setScreen("app");
      setMessage("✅ Smart Account created!");
      await Promise.all([loadPowers(), refreshOwnedChoice()]);
    } catch (e) {
      setMessage(humanError(e));
    }
  }

  // calldata
  function buildMintCalldata(choice) {
    return encodeFunctionData({
      abi: NFT_ABI_VIEM,
      functionName: "mint",
      args: [Number(choice)],
    });
  }
  function buildVoteCalldata(choice) {
    return encodeFunctionData({
      abi: TRI_ABI_VIEM,
      functionName: "vote",
      args: [Number(choice)],
    });
  }

  // AA send
  async function sendOne(to, data, value = 0n) {
    const { bundler, smartAccount, paymaster } = mmsa;
    const hash = await bundler.sendUserOperation({
      account: smartAccount,
      calls: [{ to, data, value }],
      paymaster,
    });
    return { hash };
  }

  // actions
  async function handleMint(choice) {
    if (!mmsa) return setMessage("Create Smart Account first");
    setLoading(true);
    setMessage("");
    setLastOpHash(null);
    try {
      const already = await getOwnedChoice(mmsa.address);
      if (already !== null) {
        if (already === choice) setMessage("You already minted this Proof ✅");
        else setMessage(`Already minted another Proof (choice=${already}).`);
        return;
      }
      const data = buildMintCalldata(choice);
      const { hash } = await sendOne(NFT_ADDR, data);
      setLastOpHash(hash);
      setMessage("✅ NFT minted!");
      await refreshOwnedChoice();
    } catch (e) {
      setMessage(humanError(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleVote(choice) {
    if (!mmsa) return setMessage("Create Smart Account first");
    setLoading(true);
    setMessage("");
    setLastOpHash(null);
    try {
      const left = await getCooldownLeft(mmsa.address);
      if (left > 0) {
        setMessage(`Cooldown: подождите ещё ${left}s.`);
        return;
      }
      const owned = await getOwnedChoice(mmsa.address);
      if (owned === choice) {
        const data = buildVoteCalldata(choice);
        const { hash } = await sendOne(TRI_ADDR, data);
        setLastOpHash(hash);
        setMessage("✅ Vote cast!");
        await loadPowers();
        return;
      }
      if (owned === null) {
        // автоматом: mint -> vote (две userOp подряд)
        const { hash: h1 } = await sendOne(NFT_ADDR, buildMintCalldata(choice));
        setLastOpHash(h1);
        const { hash: h2 } = await sendOne(TRI_ADDR, buildVoteCalldata(choice));
        setLastOpHash(h2);
        setMessage("✅ Minted & Voted!");
        await Promise.all([loadPowers(), refreshOwnedChoice()]);
        return;
      }
      setMessage(`This Smart Account owns a different Proof (choice=${owned}).`);
    } catch (e) {
      setMessage(humanError(e));
    } finally {
      setLoading(false);
    }
  }

  // UI
  if (screen === "connect") {
    return (
      <Shell>
        <Header />
        <Card>
          <p className="muted">Welcome to</p>
          <h1 className="title">TriBalance</h1>
          <p className="muted">Vote with a MetaMask Smart Account inside Farcaster.</p>
          <Button primary onClick={connectWallet}>Connect Farcaster Wallet</Button>
          {message && <p className="msg">{message}</p>}
        </Card>
      </Shell>
    );
  }

  if (screen === "createSA") {
    return (
      <Shell>
        <Header />
        <Card>
          <h2 className="cardTitle">Create Smart Account</h2>
          <p className="muted">EOA: <code>{eoa?.slice(0,6)}…{eoa?.slice(-4)}</code></p>
          <Button primary onClick={createSmartAccount}>Create Smart Account</Button>
          <p className="tiny muted" style={{marginTop:8}}>
            All actions will be executed by your Smart Account, not by your EOA.
          </p>
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
          <a className="link" href={monadAddressUrl(smartAddr)} target="_blank" rel="noreferrer">
            {smartAddr ? `${smartAddr.slice(0,6)}…${smartAddr.slice(-4)}` : "—"}
          </a>
        </div>
        {lastOpHash && (
          <div className="row" style={{marginTop:6}}>
            <span className="muted">Last userOp</span>
            <a className="link" href={userOpTrackUrl(lastOpHash)} target="_blank" rel="noreferrer">
              {lastOpHash.slice(0,10)}…
            </a>
          </div>
        )}
        <div className="row" style={{marginTop:6}}>
          <span className="muted">NFT (ERC1155)</span>
          <code className="addr">{short(NFT_ADDR)}</code>
        </div>
        <div className="row">
          <span className="muted">TriBalance</span>
          <code className="addr">{short(TRI_ADDR)}</code>
        </div>
      </Card>

      {/* Balance of powers — КРУГОВОЙ ВАРИАНТ */}
      <Card>
        <h3 className="cardTitle">Balance of Powers</h3>
        <FlowRings pct={pct} values={powers} />
        <div className="chips">
          {CHOICES.map((c) => (
            <Chip key={c.id} active={ownedChoice === c.id} color={c.color} glow={c.glow}>
              <span style={{fontSize:18}}>{c.emoji}</span> {c.label}
            </Chip>
          ))}
        </div>
      </Card>

      {/* Vote */}
      <SectionTitle>Vote</SectionTitle>
      {CHOICES.map((c) => (
        <ActionCard key={c.id} label={`Vote ${c.label}`} emoji={c.emoji} color={c.color} glow={c.glow}
          disabled={loading || !mmsa} onClick={()=>handleVote(c.id)} />
      ))}

      {/* Mint */}
      <SectionTitle>Mint NFT</SectionTitle>
      {CHOICES.map((c) => (
        <ActionCard key={c.id} label={`Mint ${c.label}`} emoji={c.emoji} color={c.color} glow={c.glow}
          disabled={loading || !mmsa} onClick={()=>handleMint(c.id)} />
      ))}

      {message && <p className="msg">{message}</p>}

      <Footer />
    </Shell>
  );
}

// ======== UI Primitives ========

function Header() {
  return (
    <div className="header">
      <div className="logoPulse" />
      <div>
        <div className="brand">TriBalance</div>
        <div className="tagline">MetaMask • Farcaster • Monad</div>
      </div>
      <style>{headerCss}</style>
    </div>
  );
}

function Footer() {
  return (
    <div style={{opacity:0.6, fontSize:12, marginTop:20, textAlign:"center"}}>
      Built for Monad Mission 8 — Smart Account Voting
    </div>
  );
}

function Shell({ children }) {
  return (
    <div style={{
      minHeight: "100vh",
      background: "radial-gradient(1200px 600px at 50% -10%, rgba(0,255,213,0.08), transparent), radial-gradient(900px 600px at -10% 10%, rgba(168,85,247,0.08), transparent), #0a0b0d",
      color: "#eaeef7",
      padding: 18,
      fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto",
      maxWidth: 440, margin: "0 auto"
    }}>
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

/* === НОВОЕ: Круговой “переливающийся” баланс === */
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
        mon:  from.mon  + (to.mon  - from.mon)  * e,
      });
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pct.meta, pct.cast, pct.mon]);

  const rings = [
    { key: 'meta', color1: '#ff7a00', color2: '#ffc266', radius: 88, width: 12, label: `MetaMask ${Math.round(anim.meta)}%`, value: values.meta },
    { key: 'cast', color1: '#8f4df1', color2: '#c79bff', radius: 68, width: 12, label: `Farcaster ${Math.round(anim.cast)}%`, value: values.cast },
    { key: 'mon',  color1: '#00ffd5', color2: '#7dffe9', radius: 48, width: 12, label: `Monad ${Math.round(anim.mon)}%`, value: values.mon  },
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
          <circle cx="120" cy="120" r="92" fill="none" stroke="url(#gradHalo)" strokeWidth="20" opacity="0.12" />
          <defs>
            <linearGradient id="gradHalo" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#00ffd5" />
              <stop offset="50%" stopColor="#a855f7" />
              <stop offset="100%" stopColor="#ff7a00" />
            </linearGradient>
          </defs>
        </g>

        {rings.map((r) => {
          const C = 2 * Math.PI * r.radius;
          const pctVal = Math.max(0, Math.min(100, anim[r.key]));
          const dash = (C * pctVal) / 100;
          const gap  = C - dash;
          return (
            <g key={r.key} filter="url(#glow)">
              <circle cx="120" cy="120" r={r.radius} fill="none" stroke="#101319" strokeWidth={r.width} />
              <circle
                cx="120" cy="120" r={r.radius} fill="none"
                stroke={`url(#grad-${r.key})`} strokeWidth={r.width}
                strokeLinecap="round" strokeDasharray={`${dash} ${gap}`}
                transform="rotate(-90 120 120)"
                className="ringStroke"
              />
              <defs>
                <linearGradient id={`grad-${r.key}`} x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor={r.color1} />
                  <stop offset="100%" stopColor={r.color2} />
                </linearGradient>
              </defs>
            </g>
          );
        })}

        <g className="centerText">
          <text x="120" y="110" textAnchor="middle" fontSize="22" fontWeight="800" fill="#eaeef7">
            {Math.max(pct.meta, pct.cast, pct.mon)}%
          </text>
          <text x="120" y="132" textAnchor="middle" fontSize="12" fill="#9aa4b2" letterSpacing=".3px">
            network balance
          </text>
        </g>
      </svg>

      <div className="ringLabels">
        {rings.map((r)=>(
          <div key={r.key} className="labelRow">
            <span className="dot" style={{background: r.color1, boxShadow:`0 0 10px ${r.color1}55`}} />
            <span className="lbl">{r.label} <span className="count">({r.value})</span></span>
          </div>
        ))}
      </div>

      <style>{flowCss}</style>
    </div>
  );
}

function Chip({ children, active, color, glow }) {
  return (
    <span className="chip" data-active={active ? "1" : "0"} style={{borderColor: color, boxShadow: active ? `0 0 24px ${glow}` : "none"}}>
      {children}
      <style>{chipCss}</style>
    </span>
  );
}

function SectionTitle({ children }) {
  return <h3 className="section">{children}<style>{sectionCss}</style></h3>;
}

function Button({ children, primary, onClick, disabled }) {
  return (
    <button className="btn" data-primary={primary ? "1" : "0"} onClick={onClick} disabled={disabled}>
      {children}
      <style>{buttonCss}</style>
    </button>
  );
}

function ActionCard({ label, emoji, color, glow, onClick, disabled }) {
  return (
    <button className="action" onClick={onClick} disabled={disabled} style={{borderColor: color, boxShadow: `inset 0 0 0 1px ${color}40, 0 0 24px ${glow}`}}>
      <span className="em">{emoji}</span>
      <span>{label}</span>
      <style>{actionCss}</style>
    </button>
  );
}

// ======== Styles ========

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

/* === НОВОЕ: стили для FlowRings === */
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

// ===== Utils =====
function short(a){ return `${a.slice(0,6)}…${a.slice(-4)}`; }
function humanError(e){ return e?.shortMessage || e?.reason || e?.data?.message || e?.message || String(e); }
