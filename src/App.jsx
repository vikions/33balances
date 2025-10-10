import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { parseAbi } from "viem";
import {
  initSmartAccount,
  makeCalldata,
  sendCalls,
  userOpTrackUrl,
  monadAddressUrl,
} from "./smartAccount";

// 👉 Mini App helpers (добавлено)
import { isMiniAppEnv } from "./miniapp";
import MiniAccountTest from "./MiniAccountTest";

// === ENV ===
const RPC = import.meta.env.VITE_MONAD_RPC || "https://testnet-rpc.monad.xyz";
const CHAIN_ID = import.meta.env.VITE_CHAIN_ID_HEX || "0x279f";
const NFT_ADDR = import.meta.env.VITE_NFT;
const TRI_ADDR = import.meta.env.VITE_TRI;

// === ABIs (для viem-коллов Smart Account)
const NFT_ABI_VIEM = parseAbi(["function mint(uint8 choice) external"]);
const TRI_ABI_VIEM = parseAbi(["function vote(uint8 choice) external"]);

// === ABIs (чтение через ethers)
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
  { id: 0, label: "MetaMask", emoji: "🦊" },
  { id: 1, label: "Farcaster", emoji: "💜" },
  { id: 2, label: "Monad", emoji: "🧬" },
];

export default function App() {
  const [eoa, setEoa] = useState(null);                 // обычный адрес из MetaMask
  const [mmsa, setMmsa] = useState(null);               // { smartAccount, bundler, address }
  const [smartAddr, setSmartAddr] = useState(null);     // адрес смарт-аккаунта
  const [lastOpHash, setLastOpHash] = useState(null);   // последний userOp hash

  const [screen, setScreen] = useState("connect");      // connect -> createSA -> app
  const [powers, setPowers] = useState({ meta: 0, cast: 0, mon: 0 });
  const [cooldownInfo, setCooldownInfo] = useState({ ts: 0, cd: 0 });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  // 👉 Mini App detect (добавлено)
  const mini = isMiniAppEnv();

  const provider = useMemo(() => {
    if (window.ethereum) return new ethers.BrowserProvider(window.ethereum);
    return new ethers.JsonRpcProvider(RPC);
  }, []);

  async function ensureMonadChain() {
    const eth = window.ethereum;
    if (!eth) return;
    const current = await eth.request({ method: "eth_chainId" });
    if (current !== CHAIN_ID) {
      try {
        await eth.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: CHAIN_ID }],
        });
      } catch (e) {
        const code = e?.code || e?.data?.originalError?.code;
        if (code === 4902) {
          await eth.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: CHAIN_ID,
                chainName: "Monad Testnet",
                nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
                rpcUrls: [RPC],
              },
            ],
          });
        } else {
          throw e;
        }
      }
    }
  }

  // 1) Подключение EOA (без Smart Account!)
  async function connectEOA() {
    try {
      setMessage("");
      if (!window.ethereum) {
        setMessage("MetaMask не найден. Установи расширение.");
        return;
      }
      if (!NFT_ADDR || !TRI_ADDR) {
        setMessage("Проверь .env: VITE_NFT и VITE_TRI должны быть заданы.");
        return;
      }
      await ensureMonadChain();
      const accs = await window.ethereum.request({ method: "eth_requestAccounts" });
      const addr = ethers.getAddress(accs[0]);
      setEoa(addr);
      setScreen("createSA"); // теперь запросим создание смарт аккаунта отдельной кнопкой
    } catch (e) {
      setMessage(e.message || String(e));
    }
  }

  // 2) Явное создание Smart Account (по кнопке)
  async function createSmartAccount() {
    try {
      setMessage("");
      const ctx = await initSmartAccount();  // { smartAccount, bundler, address }
      setMmsa(ctx);
      setSmartAddr(ctx.address);
      setScreen("app");
      await loadPowers(ctx.address);
    } catch (e) {
      setMessage(e.message || String(e));
    }
  }

  async function getContracts(withSigner = true) {
    const signer = withSigner && eoa ? await provider.getSigner() : null;
    const nft = new ethers.Contract(NFT_ADDR, NFT_ABI, signer || provider);
    const tri = new ethers.Contract(TRI_ADDR, TRI_ABI, signer || provider);
    return { nft, tri };
  }

  async function loadPowers(addressToCheck) {
    try {
      if (!TRI_ADDR) return;
      const { tri } = await getContracts(false);
      const [m, c, n] = await tri.globalPowers();
      setPowers({ meta: Number(m), cast: Number(c), mon: Number(n) });

      const addr = addressToCheck || eoa;
      if (addr) {
        const ts = await tri.lastVoteAt(addr);
        const cd = await tri.voteCooldown();
        setCooldownInfo({ ts: Number(ts), cd: Number(cd) });
      }
    } catch (e) {
      console.warn("loadPowers:", e);
    }
  }

  // === операции через Smart Account ===
  async function mint(choice) {
    setLoading(true); setMessage(""); setLastOpHash(null);
    try {
      if (!mmsa) throw new Error("Сначала создай Smart Account");
      const data = makeCalldata(NFT_ABI_VIEM, "mint", [choice]);
      const { hash } = await sendCalls(mmsa, { to: NFT_ADDR, data });
      setLastOpHash(hash);
      setMessage("NFT minted ✅ (Smart Account)");
      await loadPowers(mmsa.address);
    } catch (e) {
      setMessage(e.shortMessage || e.message || String(e));
    } finally { setLoading(false); }
  }

  async function vote(choice) {
    setLoading(true); setMessage(""); setLastOpHash(null);
    try {
      if (!mmsa) throw new Error("Сначала создай Smart Account");
      const data = makeCalldata(TRI_ABI_VIEM, "vote", [choice]);
      const { hash } = await sendCalls(mmsa, { to: TRI_ADDR, data });
      setLastOpHash(hash);
      setMessage("Vote cast ✨ (Smart Account)");
      await loadPowers(mmsa.address);
    } catch (e) {
      setMessage(e.shortMessage || e.message || String(e));
    } finally { setLoading(false); }
  }

  useEffect(() => { loadPowers(); }, [eoa]);

  // ========= SCREENS =========
  if (screen === "connect") {
    return (
      <PhoneShell>
        {/* 👉 Mini App бейдж и статус кошелька (только в мини-режиме) */}
        {mini && <div style={{ fontSize: 12, opacity: .6 }}>Mini App mode (Farcaster)</div>}
        {mini && <MiniAccountTest />}

        <h1 className="title">TriBalance</h1>
        <p className="sub">1) Подключи MetaMask (EOA), затем 2) создай Smart Account и 3) действуй.</p>
        <button className="btn" onClick={connectEOA}>Connect MetaMask</button>
        {message && <p className="msg">{message}</p>}
      </PhoneShell>
    );
  }

  if (screen === "createSA") {
    return (
      <PhoneShell>
        {/* 👉 Mini App бейдж и статус кошелька (только в мини-режиме) */}
        {mini && <div style={{ fontSize: 12, opacity: .6 }}>Mini App mode (Farcaster)</div>}
        {mini && <MiniAccountTest />}

        <h1 className="title">Create Smart Account</h1>
        <p className="sub">EOA: <code>{eoa?.slice(0,6)}…{eoa?.slice(-4)}</code></p>
        <button className="btn" onClick={createSmartAccount}>Create Smart Account</button>
        {message && <p className="msg">{message}</p>}
      </PhoneShell>
    );
  }

  // === основной экран ===
  return (
    <PhoneShell>
      {/* 👉 Mini App бейдж и статус кошелька (только в мини-режиме) */}
      {mini && <div style={{ fontSize: 12, opacity: .6 }}>Mini App mode (Farcaster)</div>}
      {mini && <MiniAccountTest />}

      <h1 className="title">TriBalance</h1>

      {/* Блок адресов */}
      <div style={{border:"1px solid #23242a", borderRadius:16, padding:12, background:"#121317", marginBottom:12}}>
        <p style={{margin:0}}>EOA: <code>{eoa?.slice(0,6)}…{eoa?.slice(-4)}</code></p>
        <p style={{margin:"6px 0 0"}}>
          Smart Account: {smartAddr ? (
            <>
              <a className="link" href={monadAddressUrl(smartAddr)} target="_blank" rel="noreferrer">
                {smartAddr.slice(0,6)}…{smartAddr.slice(-4)}
              </a>
            </>
          ) : "—"}
        </p>
        {lastOpHash && (
          <p style={{margin:"6px 0 0"}}>
            Last userOp:{" "}
            <a className="link" href={userOpTrackUrl(lastOpHash)} target="_blank" rel="noreferrer">
              {lastOpHash.slice(0,10)}…
            </a>
          </p>
        )}
      </div>

      <Balance meta={powers.meta} cast={powers.cast} mon={powers.mon} />

      <div className="cards">
        {CHOICES.map(ch => (
          <button key={ch.id} className="card" disabled={loading || !mmsa} onClick={() => vote(ch.id)}>
            <span className="emoji">{ch.emoji}</span>
            <span>Vote {ch.label}</span>
          </button>
        ))}
      </div>

      <p className="muted">
        Cooldown: {cooldownInfo.cd ? `${Math.round(cooldownInfo.cd/60)}m` : "—"}
      </p>

      <div style={{height:8}} />
      <h3 style={{fontSize:14, margin:"0 0 6px"}}>Mint NFT</h3>
      <div className="cards">
        {CHOICES.map(ch => (
          <button key={ch.id} className="card" disabled={loading || !mmsa} onClick={() => mint(ch.id)}>
            <span className="emoji">{ch.emoji}</span>
            <span>Mint {ch.label} Proof</span>
          </button>
        ))}
      </div>

      {message && <p className="msg">{message}</p>}

      <p className="muted">* Для операций нужен созданный Smart Account.</p>
    </PhoneShell>
  );
}

// === mini UI ===
function PhoneShell({ children }) {
  return (
    <div style={{
      minHeight: "100svh", display:"flex", flexDirection:"column",
      padding:"24px 18px", gap:16, background:"#0b0b0c", color:"#f2f2f2",
      maxWidth:420, margin:"0 auto", fontFamily: "Inter, system-ui, Arial"
    }}>
      {children}
      <style>{`
        .title{font-size:28px; font-weight:700; letter-spacing:.2px}
        .sub{opacity:.85; line-height:1.4}
        .btn{padding:14px 18px; border-radius:14px; background:#1f5eff; color:white; border:none; font-weight:600}
        .cards{display:flex; flex-direction:column; gap:12px; margin-top:8px}
        .card{display:flex; align-items:center; gap:12px; padding:14px 16px; border-radius:16px; background:#16171b; border:1px solid #23242a; color:#f2f2f2}
        .card:hover{border-color:#2f5bff}
        .emoji{font-size:20px}
        .msg{margin-top:8px; color:#9ad}
        .muted{opacity:.6; font-size:12px; margin-top:6px}
        .link{color:#8ab4ff; text-decoration:none}
        .link:hover{text-decoration:underline}
      `}</style>
    </div>
  );
}

function Balance({ meta, cast, mon }) {
  const total = Math.max(1, meta + cast + mon);
  const pct = {
    meta: Math.round((meta / total) * 100),
    cast: Math.round((cast / total) * 100),
    mon: Math.round((mon / total) * 100),
  };
  return (
    <div style={{padding:"16px", border:"1px solid #23242a", borderRadius:16, background:"#121317"}}>
      <div style={{display:"flex", gap:8, marginBottom:10, flexWrap:"wrap"}}>
        <Chip color="#E2761B" label={`MetaMask ${pct.meta}% (${meta})`} />
        <Chip color="#8B5CF6" label={`Farcaster ${pct.cast}% (${cast})`} />
        <Chip color="#00C2FF" label={`Monad ${pct.mon}% (${mon})`} />
      </div>
      <div style={{height:10, borderRadius:8, overflow:"hidden", background:"#1a1b20"}}>
        <div style={{height:"100%", width:`${pct.meta}%`, background:"#E2761B", float:"left"}}/>
        <div style={{height:"100%", width:`${pct.cast}%`, background:"#8B5CF6", float:"left"}}/>
        <div style={{height:"100%", width:`${pct.mon}%`, background:"#00C2FF", float:"left"}}/>
      </div>
    </div>
  );
}
function Chip({ color, label }) {
  return (
    <span style={{background:"#0f1014", border:`1px solid ${color}50`, color, padding:"6px 8px", borderRadius:12, fontSize:12}}>
      {label}
    </span>
  );
}
