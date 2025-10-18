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

      {/* Balance of powers */}
      <Card>
        <h3 className="cardTitle">Balance of Powers</h3>
        <Bars pct={pct} values={powers} />
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

function Bars({ pct, values }) {
  return (
    <div className="barsWrap">
      <div className="bar">
        <div className="fill" style={{width: `${pct.meta}%`, background: "linear-gradient(90deg,#ff7a00,#ffc266)"}} />
        <span className="label">MetaMask {pct.meta}% <small className="tiny">({values.meta})</small></span>
      </div>
      <div className="bar">
        <div className="fill" style={{width: `${pct.cast}%`, background: "linear-gradient(90deg,#8f4df1,#c79bff)"}} />
        <span className="label">Farcaster {pct.cast}% <small className="tiny">({values.cast})</small></span>
      </div>
      <div className="bar">
        <div className="fill" style={{width: `${pct.mon}%`, background: "linear-gradient(90deg,#00ffd5,#7dffe9)"}} />
        <span className="label">Monad {pct.mon}% <small className="tiny">({values.mon})</small></span>
      </div>
      <style>{barsCss}</style>
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

const barsCss = `
.barsWrap { display:flex; flex-direction:column; gap:10px; }
.bar { position:relative; background:#0f1216; border:1px solid #242833; border-radius:12px; overflow:hidden; height:36px; }
.bar .fill { position:absolute; left:0; top:0; bottom:0; border-radius:12px; transition: width .6s ease; }
.bar .label { position:relative; z-index:2; height:100%; display:flex; align-items:center; justify-content:center; font-weight:600; letter-spacing:.2px; }
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

// ===== Utils =====
function short(a){ return `${a.slice(0,6)}…${a.slice(-4)}`; }
function humanError(e){ return e?.shortMessage || e?.reason || e?.data?.message || e?.message || String(e); }
