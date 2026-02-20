<p align="center">
  <img src="public/icon.png" alt="3balance logo" width="140" />
</p>

<h1 align="center">3balance</h1>

3balance is an onchain mini app where players pick a crypto character, sign a match entry transaction on Base, and fight in a fast 1v1 arena.

The core idea is simple: every new match starts with an onchain action. Gameplay is offchain and instant, while entry analytics stay transparent onchain.

## What It Does

- Sends an onchain `enterMatch(characterId)` transaction before battle start.
- Uses Base Account + OnchainKit MiniKit inside Base App.
- Supports sponsored gas flow through Coinbase Paymaster when available.
- Shows player profile from MiniKit context (`displayName`, `username`, avatar).
- Runs battle gameplay with character selection, lives, coin control, AI behavior, and win/lose states.
- Supports result sharing to feed via `composeCast`, with browser fallback (`navigator.share` or copy link).

## Game Flow

1. Open app.
2. Pick fighter.
3. Sign entry transaction on Base.
4. Fight opponent in arena.
5. Share result.

## Tech Stack

- React 19 + Vite 7
- wagmi + viem
- `@coinbase/onchainkit`
- Base Mainnet
- Solidity (entry contract)

## Smart Contract

Contract source: `contracts/BattleArenaEntry.sol`

Main entry function:

```solidity
function enterMatch(string calldata characterId) external
```

The contract stores:

- Total entries
- Unique players
- Entries per player
- Entries per character (by hash)
- Last entry timestamp per player

## Environment Variables

Create `.env.local` and set:

```bash
VITE_PUBLIC_ONCHAINKIT_API_KEY=your_onchainkit_api_key
VITE_BATTLE_ENTRY_CONTRACT=0xYourBattleArenaEntryContract
VITE_APP_URL=https://3balances.vercel.app
```

Notes:

- `VITE_BATTLE_ENTRY_CONTRACT` has a default fallback in `src/App.jsx` if env is missing.
- Paymaster RPC URL is currently configured directly in `src/App.jsx`.

## Local Development

```bash
pnpm install
pnpm dev
```

Build and checks:

```bash
pnpm lint
pnpm build
pnpm preview
```

## Mini App Metadata

Metadata files:

- `public/.well-known/farcaster.json`
- `index.html` (`fc:miniapp` tag)

Screenshots and cover assets:

- `public/cover-1200x630.png`
- `public/screenshots/screenshot-1.png`
- `public/screenshots/screenshot-2.png`
- `public/screenshots/screenshot-3.png`

## Assets

Character images:

- `public/battle/characters/`

Coin icons:

- `public/battle/coins/`

## Project Structure

- `src/App.jsx` - app shell, wallet/profile, entry tx, share logic, navigation
- `src/BattleArena.jsx` - game screen and mechanics
- `src/main.jsx` - OnchainKit provider bootstrap
- `contracts/BattleArenaEntry.sol` - onchain match entry contract

## Current Status

- Main gameplay and onchain entry flow are live.
- Browser fallback is enabled if MiniKit is unavailable.
- UI is optimized for mobile mini app usage.

## License

MIT
