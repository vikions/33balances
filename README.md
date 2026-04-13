<p align="center">
  <img src="public/icon.png" alt="3balance logo" width="140" />
</p>

<h1 align="center">3balance</h1>


3balance is an onchain mini app where players pick a crypto character, fight in a fast 1v1 arena, and record the result on Base.

The core idea is simple: every new match ends with a free onchain result action. Gameplay is offchain and instant, while match history stays transparent onchain.

## What It Does

- Sends an onchain `enterMatch(characterId, won)` transaction after battle resolution.
- Uses Base Account + OnchainKit MiniKit inside Base App.
- Supports sponsored gas flow through Coinbase Paymaster when available.
- Shows player profile from MiniKit context (`displayName`, `username`, avatar).
- Runs battle gameplay with character selection, lives, coin control, AI behavior, and win/lose states.
- Supports result sharing to feed via `composeCast`, with browser fallback (`navigator.share` or copy link).

## Game Flow

1. Open app.
2. Pick fighter.
3. Fight opponent in arena.
4. Sign the onchain result transaction on Base.
5. Share result.

## Tech Stack

- React 19 + Vite 7
- wagmi + viem
- `@coinbase/onchainkit`
- Base Mainnet
- Solidity (entry contract)

## Smart Contract

Contract source: `contracts/BattleArenaV3.sol`

Main entry function:

```solidity
function enterMatch(string calldata characterId, bool won) external
```

The contract stores:

- Total entries
- Unique players
- Entries per player and per character
- Wins, losses, and current win streak per player
- Last entry timestamp per player
- ERC721 reward mint when a player reaches a 3-win streak

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
- Current Base mainnet deployment: `0x918C7a5209449715CFd78BceF3C2BCBaaAd9CBB9`

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
- `contracts/BattleArenaV3.sol` - onchain match entry and streak reward contract

## Current Status

- Main gameplay and onchain result recording flow are live.
- Browser fallback is enabled if MiniKit is unavailable.
- UI is optimized for mobile mini app usage.

## License

MIT
