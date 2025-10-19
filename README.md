# ⚖️ TriBalance — The Three Forces of Web3

**TriBalance** explores the balance between the three emerging forces of Web3 — **MetaMask**, **Farcaster**, and **Monad**.  
Users create a **MetaMask Smart Account** directly inside **Farcaster**, mint an **ERC-1155 Proof NFT** representing their chosen side, and cast on-chain votes — fully **gasless**, powered by **Pimlico Account Abstraction**.

The result is a real-time visualization of how these three forces coexist, compete, and evolve — all rendered as a dynamic “balance of powers” interface.

---

## 🌌 Concept

TriBalance is built around the idea that Web3 is not just about technology stacks, but about **philosophical alignment** —  
**Wallets (MetaMask)**, **Social Graphs (Farcaster)**, and **New Infrastructure (Monad)** form a trinity that defines user experience, identity, and scalability.

By turning this concept into an interactive, gasless dApp, TriBalance invites users to pick a side and see the collective balance of the ecosystem evolve in real time.

---

## 🧠 Core Features

- 🦊 **MetaMask Smart Accounts** — deployed automatically inside the Farcaster browser context  
- 💸 **Gasless Experience** — powered by Pimlico Bundler + Paymaster on EntryPoint v0.7  
- 🪪 **ERC-1155 Proof NFTs** — mint one token per side (MetaMask / Farcaster / Monad)  
- 🗳️ **On-chain Voting** — cast a vote with cooldown protection and real-time updates  
- 📊 **Animated “Balance of Powers” Rings** — visual representation of live voting ratios  
- 🧩 **One-Click UX** — create → mint → vote, all inside one smooth flow  

---

## ⚙️ Architecture

| Layer | Stack |
|-------|-------|
| **Frontend** | React (Vite) + Tailwind + viem/ethers |
| **Smart Accounts** | MetaMask Delegation Toolkit (Hybrid Implementation) |
| **AA Infrastructure** | Pimlico Bundler & Paymaster (EntryPoint v0.7) |
| **Wallet Provider** | Farcaster EIP-1193 |
| **Contracts** | Solidity (ERC-1155 + Voting logic) |
| **Chain** | Monad Testnet |

---

## 🔗 Smart Contracts

| Contract | Description |
|-----------|--------------|
| **ProofOfTriBalanceNFT** | ERC-1155 collection — each ID represents a side (0=MetaMask, 1=Farcaster, 2=Monad) |
| **TriBalance** | Records votes, cooldown timers, and global power counts |

> **Deployed on:** Monad Testnet  

---

## 🚀 User Flow

1. **Connect Farcaster Wallet** (EIP-1193 provider).  
2. **Create Smart Account** — automatically deployed via `getFactoryArgs()`.  
3. **Mint Proof NFT** for your chosen side.  
4. **Vote** — send a sponsored `UserOperation` via Pimlico (no gas).  
5. **Watch the Balance Update** live through animated circular charts.

---

## 🧩 Account Abstraction Details

- Automatically switches wallet network to **Monad Testnet**  
- Deploys Smart Account on first interaction if not yet deployed  
- Fetches valid gas prices using `pimlico_getUserOperationGasPrice`  
- Sends sponsored userOps via **Pimlico Paymaster**  
- Fully compatible with **EntryPoint v0.7**

---
🌐 Live Demo

👉 https://farcaster.xyz/miniapps/naH7aj4qOSNb/3balances
👉 https://3balances.vercel.app/ (vercel link)

---

🧭 Future Directions

On-chain leaderboard for recurring “balance epochs”

Frame integration for Farcaster (native voting)

NFT badges for active participants

Shared “prediction” layer for user-driven governance models

---

🧾 License

MIT © 2025 TriBalance Team
Built during the spirit of Monad Mission 8, exploring the balance of Web3.