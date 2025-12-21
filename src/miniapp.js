import { sdk } from '@farcaster/miniapp-sdk';

export function isMiniAppEnv() {
  try {
    const result = (
      typeof window !== 'undefined' &&
      (window.farcaster !== undefined ||
        /FarcasterMiniApp|Warpcast/i.test(navigator.userAgent))
    );
    console.log('🔍 isMiniAppEnv:', result);
    console.log('🔍 window.farcaster:', typeof window !== 'undefined' ? window.farcaster : 'N/A');
    console.log('🔍 navigator.userAgent:', typeof navigator !== 'undefined' ? navigator.userAgent : 'N/A');
    return result;
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
