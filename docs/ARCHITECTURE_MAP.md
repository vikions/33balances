# Architecture Map

## Framework and routing
- Vite + React single-page app.
- Entry point: `src/main.jsx` renders `App` inside `MiniAppProvider`.
- No routing library found; view logic is conditional rendering inside `src/App.jsx`.

## Styling system
- Inline CSS strings injected via `<style>` in `src/App.jsx` for most UI.
- Global styles in `src/index.css`.
- `src/App.css` is the default Vite template and is not imported in the app.

## Wallet / transaction stack
- Libraries: wagmi v2, viem, ethers.
- Wallet connectors: `@farcaster/miniapp-wagmi-connector` + `baseAccount` (Base Account).
- Primary onchain flow lives in `src/App.jsx`:
  - `createConfig` from wagmi.
  - `readContract`, `getCapabilities`, `sendCalls` from `@wagmi/core`.
  - `encodeFunctionData` from viem.
- Alternate EIP-1193 helper utilities in `src/smartAccount.js` (custom `sendCalls`), currently unused by `App`.
- Mini-app environment helpers: `src/miniapp.js`, `src/MiniAppProvider.jsx`, `src/wagmiMini.js`, `src/fcProvider.js`.

## Current vote UI
- Vote section in `src/App.jsx` within `TriBalanceApp`.
- `ActionCard` list for `CHOICES` and `handleVote` for transaction submission.

## Server / API routes
- Vite dev/preview middleware exposes `/api/polymarket/markets` and `/api/polymarket/diagnostics` via `src/server/polymarketProxy.js`, wired in `vite.config.js`.

## Contracts / assets
- Solidity contract: `contracts/ProofOfTriBalance.sol`.
- Static assets: `public/`, `nft-metadata/`, and `src/assets/`.
