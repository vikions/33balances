import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { parseAbi } from "viem";
import {
  initSmartAccount,
  makeCalldata,
  userOpTrackUrl,
  monadAddressUrl,
} from "./smartAccount";
import { getEip1193Provider } from "./fcProvider";

const RPC = import.meta.env.VITE_MONAD_RPC;
const NFT_ADDR = import.meta.env.VITE_NFT;
const TRI_ADDR = import.meta.env.VITE_TRI;

// ABIs
const NFT_ABI_VIEM = parseAbi(["function mint(uint8 choice) external"]);
const TRI_ABI_VIEM = parseAbi(["function vote(uint8 choice) external"]);
const NFT_ABI = [
  "function balanceOf(address,uint256) view returns (uint256)",
];
const TRI_ABI = [
  "function globalPowers() view returns (uint256,uint256,uint256)",
  "function lastVoteAt(address) view returns (uint64)",
  "function voteCooldown() view returns (uint256)",
  "function nft() view returns (address)",
];

const CHOICES = [
  { id: 0, label: "MetaMask", emoji: "🦊" },
  { id: 1, label: "Farcaster", emoji: "💜" },
  { id: 2, label: "Monad", emoji: "🧬" },
];

export default function App() {
  const [provider, setProvider] = useState(null);
  const [eoa, setEoa] = useState(null);
  const [mmsa, setMmsa] = useState(null);            // { smartAccount, bundler, address }
  const [smartAddr, setSmartAddr] = useState(null);
  const [lastOpHash, setLastOpHash] = useState(null);
  const [powers, setPowers] = useState({ meta: 0, cast: 0, mon: 0 });
  const [message, setMessage] = useState("");
  const [screen, setScreen] = useState("connect");
  const [loading, setLoading] = useState(false);
  const [syncWarning, setSyncWarning] = useState(""); // TriBalance.nft vs VITE_NFT

  // ===== Connect Farcaster Wallet (EIP-1193) =====
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

  // ===== Create MetaMask Smart Account =====
  async function createSmartAccount() {
    try {
      setMessage("Creating Smart Account...");
      const ctx = await initSmartAccount();
      setMmsa(ctx);
      setSmartAddr(ctx.address);
      setMessage("✅ Smart Account created!");
      setScreen("app");
      await Promise.all([loadPowers(), checkContractsSync()]);
    } catch (e) {
      setMessage(e.message || String(e));
    }
  }

  // ===== ethers Contracts =====
  async function getContracts(readonly = true) {
    const signer = !readonly && provider ? await provider.getSigner() : null;
    const nft = new ethers.Contract(NFT_ADDR, NFT_ABI, signer || provider);
    const tri = new ethers.Contract(TRI_ADDR, TRI_ABI, signer || provider);
    return { nft, tri };
  }

  // ===== Stats =====
  async function loadPowers() {
    try {
      const { tri } = await getContracts(true);
      const [m, c, n] = await tri.globalPowers();
      setPowers({ meta: Number(m), cast: Number(c), mon: Number(n) });
    } catch (e) {
      console.warn("loadPowers:", e);
    }
  }

  // ===== Sync check: TriBalance.nft() vs our VITE_NFT =====
  async function checkContractsSync() {
    try {
      const { tri } = await getContracts(true);
      const nftInTri = await tri.nft();
      if (!nftInTri || nftInTri.toLowerCase() !== NFT_ADDR.toLowerCase()) {
        setSyncWarning(
          `Contracts not synced: TriBalance.nft() = ${nftInTri}, but VITE_NFT = ${NFT_ADDR}`
        );
      } else {
        setSyncWarning("");
      }
    } catch (e) {
      console.warn("checkContractsSync:", e);
    }
  }

  // ===== Helper: does SA own the Proof for this choice? =====
  async function hasProof(choice) {
    if (!smartAddr) return false;
    const { nft } = await getContracts(true);
    try {
      const bal = await nft.balanceOf(smartAddr, choice);
      return Number(bal) > 0;
    } catch {
      return false;
    }
  }

  // ===== One-shot "Pledge" = mint + vote in a single userOp =====
  async function pledge(choice) {
    if (!mmsa) return setMessage("Create Smart Account first");
    setLoading(true); setMessage(""); setLastOpHash(null);
    try {
      const mintData = makeCalldata(NFT_ABI_VIEM, "mint", [choice]);
      const voteData = makeCalldata(TRI_ABI_VIEM, "vote", [choice]);

      const hash = await mmsa.bundler.sendUserOperation({
        account: mmsa.smartAccount,
        calls: [
          { to: NFT_ADDR, data: mintData, value: 0n },
          { to: TRI_ADDR, data: voteData, value: 0n },
        ],
      });

      setLastOpHash(hash);
      setMessage("✅ Pledge complete (Mint + Vote)");
      await loadPowers();
    } catch (e) {
      setMessage(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  // ===== Vote (auto-fixes by doing Pledge if no proof yet) =====
  async function vote(choice) {
    if (!mmsa) return setMessage("Create Smart Account first");
    setLoading(true); setMessage(""); setLastOpHash(null);
    try {
      const owns = await hasProof(choice);
      if (!owns) {
        // auto-fix: do mint+vote together
        await pledge(choice);
        return;
      }
      const voteData = makeCalldata(TRI_ABI_VIEM, "vote", [choice]);
      const hash = await mmsa.bundler.sendUserOperation({
        account: mmsa.smartAccount,
        calls: [{ to: TRI_ADDR, data: voteData, value: 0n }],
      });
      setLastOpHash(hash);
      setMessage("✅ Vote cast");
      await loadPowers();
    } catch (e) {
      setMessage(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  // ===== Mint (manual) =====
  async function mint(choice) {
    if (!mmsa) return setMessage("Create Smart Account first");
    setLoading(true); setMessage(""); setLastOpHash(null);
    try {
      const mintData = makeCalldata(NFT_ABI_VIEM, "mint", [choice]);
      const hash = await mmsa.bundler.sendUserOperation({
        account: mmsa.smartAccount,
        calls: [{ to: NFT_ADDR, data: mintData, value: 0n }],
      });
      setLastOpHash(hash);
      setMessage("✅ NFT minted");
    } catch (e) {
      setMessage(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  // initial stats refresh when SA appears
  useEffect(() => { if (smartAddr) loadPowers(); }, [smartAddr]);

  // ===== Screens =====
  if (screen === "connect") {
    return (
      <PhoneShell>
        <h1>TriBalance</h1>
        <p>Connect your Farcaster Wallet to continue.</p>
        <button className="btn" onClick={connectWallet}>Connect Wallet</button>
        {message && <p className="msg">{message}</p>}
      </PhoneShell>
    );
  }

  if (screen === "createSA") {
    return (
      <PhoneShell>
        <h1>Create Smart Account</h1>
        <p>EOA: <code>{eoa?.slice(0,6)}…{eoa?.slice(-4)}</code></p>
        <button className="btn" onClick={createSmartAccount}>Create Smart Account</button>
        {message && <p className="msg">{message}</p>}
      </PhoneShell>
    );
  }

  return (
    <PhoneShell>
      <h1>TriBalance</h1>

      <p>Smart Account: {smartAddr ? (
        <a className="link" href={monadAddressUrl(smartAddr)} target="_blank" rel="noreferrer">
          {smartAddr.slice(0,6)}…{smartAddr.slice(-4)}
        </a>
      ) : "—"}</p>

      {syncWarning && (
        <div className="warn">{syncWarning}</div>
      )}

      <Balance meta={powers.meta} cast={powers.cast} mon={powers.mon} />

      <h3 style={{marginTop:12}}>Pledge (Mint + Vote)</h3>
      {CHOICES.map(c => (
        <button key={c.id} className="card" disabled={loading || !mmsa} onClick={() => pledge(c.id)}>
          <span>{c.emoji}</span> Pledge {c.label}
        </button>
      ))}

      <h3 style={{marginTop:16}}>Vote</h3>
      {CHOICES.map(c => (
        <button key={c.id} className="card" disabled={loading || !mmsa} onClick={() => vote(c.id)}>
          <span>{c.emoji}</span> Vote {c.label}
        </button>
      ))}

      <h3 style={{marginTop:16}}>Mint NFT (manual)</h3>
      {CHOICES.map(c => (
        <button key={c.id} className="card" disabled={loading || !mmsa} onClick={() => mint(c.id)}>
          <span>{c.emoji}</span> Mint {c.label}
        </button>
      ))}

      {lastOpHash && (
        <p className="msg">
          userOp: <a className="link" href={userOpTrackUrl(lastOpHash)} target="_blank" rel="noreferrer">
            {lastOpHash.slice(0,10)}…
          </a>
        </p>
      )}

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
      maxWidth: 420,
      margin: "0 auto"
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
          text-align: left;
        }
        .link { color: #6ca8ff; text-decoration: none; }
        .msg { margin-top: 10px; opacity: 0.85; }
        .warn {
          background: #2b1f00;
          border: 1px solid #6b5200;
          color: #ffcf6b;
          padding: 10px 12px;
          border-radius: 10px;
          margin: 10px 0 14px;
          font-size: 12px;
        }
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
    <div style={{ border: "1px solid #23242a", padding: 12, borderRadius: 12, margin: "12px 0" }}>
      <p>MetaMask {pct.meta}% | Farcaster {pct.cast}% | Monad {pct.mon}%</p>
    </div>
  );
}
