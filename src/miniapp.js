import { sdk } from '@farcaster/miniapp-sdk';

export function isMiniAppEnv() {
  try {
    return (
      typeof window !== 'undefined' &&
      (window.farcaster !== undefined ||
        /FarcasterMiniApp|Warpcast/i.test(navigator.userAgent))
    );
  } catch {
    return false;
  }
}

export async function tryReadyMiniApp() {
  try {
    await sdk.actions.ready(); 
    return true;
  } catch {
    return false;
  }
}

export { sdk };
