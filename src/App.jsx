import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { parseAbi } from "viem";
import {
  initSmartAccount,
  makeCalldata,
  sendCalls,
  userOpTrackUrl,
  monadAddressUrl,
} from "./smartAccount";
import { getEip1193Provider } from "./fcProvider";

const RPC = import.meta.env.VITE_MONAD_RPC;
const NFT_ADDR = import.meta.env.VITE_NFT;
const TRI_ADDR = import.meta.env.VITE_TRI;

// ABIs (viem для calldata)
const NFT_ABI_VIEM = parseAbi(["function mint(uint8 choice) external"]);
const TRI_ABI_VIEM = parseAbi(["function vote(uint8 choice) external"]);

// ABIs (ethers для чтения)
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
  const [provider, setProvider] = useState(null);
  const [eoa, setEoa] = useState(null);
  const [mmsa, setMmsa] = useState(null);
  const [smartAddr, setSmartAddr] = useState(null);
  const [lastOpHash, setLastOpHash] = useState(null);
  const [powers, setPowers] = useState({ meta: 0, cast: 0, mon: 0 });
  const [message, setMessage] = useState("");
  const [screen, setScreen] = useState("connect"); // connect -> createSA -> app
  const [loading, setLoading] = useState(false);

  // --- helpers ---
  async function getContracts(withSigner = true) {
    const signer = withSigner && provider ? await provider.getSigner() : null;
    const nft = new ethers.Contract(NFT_ADDR, NFT_ABI, signer || provider);
    const tri = new ethers.Contract(TRI_ADDR, TRI_ABI, signer || provider);
    return { nft, tri };
  }

  async function getOwnedChoice(addr) {
    // проверяем какой именно Proof уже есть у addr
    const { nft } = await getContracts(false);
    for (const c of CHOICES) {
      const bal = await nft.balanceOf(addr, c.id);
      if (bal && bal.toString() !== "0") return c.id;
    }
    return null; // ничего не заминчено
  }

  async function loadPowers() {
    try {
      const { tri } = await getContracts(false);
      const [m, c, n] = await tri.globalPowers();
      setPowers({ meta: Number(m), cast: Number(c), mon: Number(n) });
    } catch (e) {
      console.warn("loadPowers:", e);
    }
  }

  // Подключаем Farcaster Wallet (EOA)
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
      setMessage(e.message || String(e));
    }
  }

  // Создаём MetaMask Smart Account
  async function createSmartAccount() {
    try {
      setMessage("Creating Smart Account...");
      const ctx = await initSmartAccount(); // { smartAccount, bundler, paymaster, address }
      setMmsa(ctx);
      setSmartAddr(ctx.address);
      setMessage("✅ Smart Account created!");
      setScreen("app");
      await loadPowers();
    } catch (e) {
      setMessage(e.message || String(e));
    }
  }

  // === Минт строго по правилам ===
  async function handleMint(choice) {
    if (!mmsa) return setMessage("Create Smart Account first");
    setLoading(true);
    setMessage("");
    setLastOpHash(null);
    try {
      const owned = await getOwnedChoice(mmsa.address);
      if (owned !== null) {
        if (owned === choice) {
          setMessage("You already minted this Proof ✅");
        } else {
          setMessage(
            `Already minted another Proof (choice=${owned}). You can only vote with that Proof or use a new account.`
          );
        }
        return;
      }
      // ничего не минчено — делаем mint
      const data = makeCalldata(NFT_ABI_VIEM, "mint", [choice]);
      const { hash } = await sendCalls(mmsa, { to: NFT_ADDR, data });
      setLastOpHash(hash);
      setMessage("✅ NFT minted!");
    } catch (e) {
      setMessage(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  // === Голос строго по правилам ===
  async function handleVote(choice) {
    if (!mmsa) return setMessage("Create Smart Account first");
    setLoading(true);
    setMessage("");
    setLastOpHash(null);
    try {
      const owned = await getOwnedChoice(mmsa.address);

      if (owned === choice) {
        // уже есть нужный Proof — просто голосуем
        const data = makeCalldata(TRI_ABI_VIEM, "vote", [choice]);
        const { hash } = await sendCalls(mmsa, { to: TRI_ADDR, data });
        setLastOpHash(hash);
        setMessage("✅ Vote cast!");
        await loadPowers();
        return;
      }

      if (owned === null) {
        // нет никаких Proof — СНАЧАЛА mint, затем vote (2 отдельные userOps, чтобы не ловить общий реверт)
        const mintData = makeCalldata(NFT_ABI_VIEM, "mint", [choice]);
        const { hash: h1 } = await sendCalls(mmsa, { to: NFT_ADDR, data: mintData });
        setLastOpHash(h1);
        // после успешного минта — голосуем
        const voteData = makeCalldata(TRI_ABI_VIEM, "vote", [choice]);
        const { hash: h2 } = await sendCalls(mmsa, { to: TRI_ADDR, data: voteData });
        setLastOpHash(h2);
        setMessage("✅ Minted & Voted!");
        await loadPowers();
        return;
      }

      // owned != null и owned != choice — значит пытались голосовать не своим Proof
      setMessage(
        `This Smart Account owns a different Proof (choice=${owned}). You can only vote with that Proof.`
      );
    } catch (e) {
      setMessage(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPowers();
  }, []);

  // === UI ===
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
