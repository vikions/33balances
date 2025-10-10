import React from 'react';
import { useAccount, useConnect } from 'wagmi';

export default function MiniAccountTest() {
  const { isConnected, address } = useAccount();
  const { connect, connectors, isPending } = useConnect();

  if (isConnected) {
    return (
      <div style={{ fontSize: 12, opacity: 0.8, margin: '8px 0' }}>
        Mini App wallet:&nbsp;
        <code>{address?.slice(0, 6)}…{address?.slice(-4)}</code>
      </div>
    );
  }

  return (
    <button
      onClick={() => connect({ connector: connectors?.[0] })}
      disabled={isPending}
      style={{
        padding: '8px 12px',
        borderRadius: 10,
        background: '#16171b',
        color: '#fff',
        border: '1px solid #2a2b31'
      }}
    >
      {isPending ? 'Connecting…' : 'Connect Mini App Wallet'}
    </button>
  );
}
