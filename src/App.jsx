import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { parseAbi, encodeFunctionData } from "viem";
import {
  initSmartAccount,
  userOpTrackUrl,
  monadAddressUrl,
} from "./smartAccount";
import { getEip1193Provider } from "./fcProvider";

const RPC = import.meta.env.VITE_MONAD_RPC;
const NFT_ADDR = ethers.getAddress(import.meta.env.VITE_NFT);
const TRI_ADDR = ethers.getAddress(import.meta.env.VITE_TRI);

// === Сигнатуры КАК В СОЛИДИТИ ===
const MINT_SIG = "function mint(uint8 choice)";
const VOTE_SIG = "function vote(uint8 choice)";

// viem ABI — ровно нужные методы
const NFT_ABI_VIEM = parseAbi([MINT_SIG]);
const TRI_ABI_VIEM = parseAbi([VOTE_SIG]);

// ethers ABI для чтения
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
  const [provider, setProvider] = useState(null);         // BrowserProvider (Farcaster) — ТОЛЬКО для SA
  const [readProvider, setReadProvider] = useState(null); // JsonRpcProvider (RPC) — ТОЛЬКО для чтения
  const [eoa, setEoa] = useState(null);
  const [mmsa, setMmsa] = useState(null);                 // { smartAccount, bundler, paymaster, address }
  const [smartAddr, setSmartAddr] = useState(null);
  const [lastOpHash, setLastOpHash] = useState(null);
  const [powers, setPowers] = useState({ meta: 0, cast: 0, mon: 0 });
  const [message, setMessage] = useState("");
  const [screen, setScreen] = useState("connect");        // connect -> createSA -> app
  const [loading, setLoading] = useState(false);

  // Инициализируем read RPC-провайдер один раз
  useEffect(() => {
    setReadProvider(new ethers.JsonRpcProvider(RPC));
  }, []);

  // ===== READ-ONLY КОНТРАКТЫ (всегда через RPC!) =====
  function getReadContracts() {
    const rp = readProvider ?? new ethers.JsonRpcProvider(RPC);
    const nft = new ethers.Contract(NFT_ADDR, NFT_ABI, rp);
    const tri = new ethers.Contract(TRI_ADDR, TRI_ABI, rp);
    return { nft, tri };
  }

  // ---------- helpers (только чтение через RPC) ----------
  async function getOwnedChoice(addr) {
    const { nft } = getReadContracts();
    for (const c of CHOICES) {
      const bal = await nft.balanceOf(addr, c.id);
      if (bal && bal !== 0n) return c.id;
    }
    return null;
  }

  async function hasMinted(addr) {
    try {
      const { nft } = getReadContracts();
      return await nft.hasMinted(addr);
    } catch {
      return false;
    }
  }

  async function getCooldownLeft(addr) {
    try {
      const { tri } = getReadContracts();
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
    try {
      if (!readProvider) return;
      const { tri } = getReadContracts();
      const [m, c, n] = await tri.globalPowers();
      setPowers({ meta: Number(m), cast: Number(c), mon: Number(n) });
    } catch (e) {
      console.warn("loadPowers:", e);
    }
  }

  // ---------- wallet / SA ----------
  async function connectWallet() {
    try {
      setMessage("Connecting Farcaster Wallet...");
      const eip1193 = await getEip1193Provider();
      const eth = new ethers.BrowserProvider(eip1193);
      setProvider(eth);

      const accs = await eip1193.request({ method: "eth_requestAccounts" });
      const addr = ethers.getAddress(accs[0]);
      setEoa(addr);
      setMessage("");
      setScreen("createSA");
    } catch (e) {
      setMessage(humanError(e));
    }
  }

  async function createSmartAccount() {
    try {
      setMessage("Creating Smart Account...");
      const ctx = await initSmartAccount();
      setMmsa(ctx);
      setSmartAddr(ctx.address);
      setMessage("✅ Smart Account created!");
      setScreen("app");
      // подождём пока readProvider инициализируется
      setTimeout(loadPowers, 100);
    } catch (e) {
      setMessage(humanError(e));
    }
  }

  // ---------- calldata builders ----------
  function buildMintCalldata(choice) {
    return encodeFunctionData({
      abi: NFT_ABI_VIEM,
      functionName: "mint",
      args: [Number(choice)], // uint8
    });
  }

  function buildVoteCalldata(choice) {
    return encodeFunctionData({
      abi: TRI_ABI_VIEM,
      functionName: "vote",
      args: [Number(choice)], // uint8
    });
  }

  async function sendOne(to, data, value = 0n) {
    const { bundler, smartAccount, paymaster } = mmsa;
    const hash = await bundler.sendUserOperation({
      account: smartAccount,
      calls: [{ to, data, value }],
      paymaster,
    });
    return { hash };
  }

  // ---------- actions ----------
  async function handleMint(choice) {
    if (!mmsa) return setMessage("Create Smart Account first");
    setLoading(true);
    setMessage("");
    setLastOpHash(null);
    try {
      // защита от повтора
      if (await hasMinted(mmsa.address)) {
        const owned = await getOwnedChoice(mmsa.address);
        if (owned === null) {
          setMessage("Этот Smart Account уже исчерпал право минта, но Proof не найден. Возможно, минтили другим адресом.");
        } else if (owned === choice) {
          setMessage("You already minted this Proof ✅");
        } else {
          setMessage(`Already minted another Proof (choice=${owned}). Use that Proof or new SA.`);
        }
        return;
      }

      const owned = await getOwnedChoice(mmsa.address);
      if (owned !== null) {
        if (owned === choice) {
          setMessage("You already minted this Proof ✅");
        } else {
          setMessage(`Already minted another Proof (choice=${owned}).`);
        }
        return;
      }

      const data = buildMintCalldata(choice);
      const { hash } = await sendOne(NFT_ADDR, data);
      setLastOpHash(hash);
      setMessage("✅ NFT minted!");
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
        setMessage(`Cooldown: подождите ещё ${left} сек.`);
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
        // нет Proof — сначала mint, затем vote (две отдельные userOps)
        const dataMint = buildMintCalldata(choice);
        const { hash: h1 } = await sendOne(NFT_ADDR, dataMint);
        setLastOpHash(h1);

        const dataVote = buildVoteCalldata(choice);
        const { hash: h2 } = await sendOne(TRI_ADDR, dataVote);
        setLastOpHash(h2);

        setMessage("✅ Minted & Voted!");
        await loadPowers();
        return;
      }

      setMessage(`This Smart Account owns a different Proof (choice=${owned}). Vote with that Proof.`);
    } catch (e) {
      setMessage(humanError(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (readProvider) loadPowers();
  }, [readProvider]);

  // ---------- UI ----------
  if (screen === "connect") {
    return (
      <PhoneShell>
        <h1>TriBalance</h1>
        <p>Connect your Farcaster Wallet to continue.</p>
        <button className="btn" onClick={connectWallet}>
          Connect Wallet
        </button>
        {message && <p className="msg">{message}</p>}
      </PhoneShell>
    );
  }

  if (screen === "createSA") {
    return (
      <PhoneShell>
        <h1>Create Smart Account</h1>
        <p>
          EOA: <code>{eoa?.slice(0, 6)}…{eoa?.slice(-4)}</code>
        </p>
        <button className="btn" onClick={createSmartAccount}>
          Create Smart Account
        </button>
        {message && <p className="msg">{message}</p>}
      </PhoneShell>
    );
  }

  return (
    <PhoneShell>
      <h1>TriBalance</h1>

      <div style={{border:"1px solid #23242a", borderRadius:12, padding:10, marginBottom:12}}>
        <div>Smart Account: {smartAddr ? (
          <a className="link" href={monadAddressUrl(smartAddr)} target="_blank" rel="noreferrer">
            {smartAddr.slice(0,6)}…{smartAddr.slice(-4)}
          </a>
        ) : "—"}</div>
        {lastOpHash && (
          <div style={{marginTop:6}}>
            Last userOp:{" "}
            <a className="link" href={userOpTrackUrl(lastOpHash)} target="_blank" rel="noreferrer">
              {lastOpHash.slice(0,10)}…
            </a>
          </div>
        )}
      </div>

      <Balance meta={powers.meta} cast={powers.cast} mon={powers.mon} />

      <h3 style={{marginTop:12}}>Vote</h3>
      {CHOICES.map((c) => (
        <button key={c.id} className="card" disabled={loading || !mmsa} onClick={() => handleVote(c.id)}>
          <span>{c.emoji}</span> Vote {c.label}
        </button>
      ))}

      <h3 style={{marginTop:16}}>Mint NFT</h3>
      {CHOICES.map((c) => (
        <button key={c.id} className="card" disabled={loading || !mmsa} onClick={() => handleMint(c.id)}>
          <span>{c.emoji}</span> Mint {c.label}
        </button>
      ))}

      {message && <p className="msg">{message}</p>}
    </PhoneShell>
  );
}

function PhoneShell({ children }) {
  return (
    <div style={{
      background: "#0b0b0c",
      color: "#f2f2f2",
      minHeight: "100vh",
      padding: 24,
      fontFamily: "Inter, system-ui, sans-serif",
      maxWidth: 420, margin: "0 auto"
    }}>
      {children}
      <style>{`
        .btn {
          background: #1f5eff;
          color: #fff;
          border: none;
          border-radius: 12px;
          padding: 14px 20px;
          font-weight: 600;
          margin-top: 12px;
        }
        .card {
          display: flex;
          align-items: center;
          gap: 10px;
          background: #16171b;
          border: 1px solid #2a2b30;
          border-radius: 12px;
          padding: 12px 16px;
          margin-top: 8px;
          color: #fff;
          width: 100%;
        }
        .link { color: #6ca8ff; text-decoration: none; }
        .msg { margin-top: 10px; opacity: 0.9; }
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
    <div style={{ border: "1px solid #23242a", padding: 12, borderRadius: 12, marginBottom: 16 }}>
      <p>MetaMask {pct.meta}% | Farcaster {pct.cast}% | Monad {pct.mon}%</p>
    </div>
  );
}

function humanError(e) {
  return e?.shortMessage || e?.reason || e?.data?.message || e?.message || String(e);
}
