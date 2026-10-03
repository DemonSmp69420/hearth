import { useState } from 'react';
import { pairWithToken } from '../../services/transport';

/**
 * Full-screen gate for unpaired companion devices (F18/D-021): the phone opens
 * the served URL, types the pairing token shown in desktop Settings, and gets
 * a bearer session stored locally.
 */
export function PairingGate() {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pair = async () => {
    setBusy(true);
    setError(null);
    try {
      await pairWithToken(token);
      location.reload();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setBusy(false);
    }
  };

  return (
    <div className="pairing-gate" role="dialog" aria-label="Pair this device">
      <div className="pairing-card">
        <h1>Hearth Companion</h1>
        <p>
          This device is not paired yet. Open Hearth on your desktop, go to
          <strong> Settings → Companion</strong>, start the server, and enter the
          pairing token it shows.
        </p>
        <label className="pairing-field">
          <span>Pairing token</span>
          <input
            value={token}
            onChange={(e) => setToken(e.target.value.toUpperCase())}
            placeholder="XXXX-XXXX"
            autoComplete="off"
            spellCheck={false}
            maxLength={9}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && token.trim()) void pair();
            }}
          />
        </label>
        {error && (
          <p className="pairing-error" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          className="m3-button-filled"
          disabled={busy || token.trim().length < 9}
          onClick={() => void pair()}
        >
          {busy ? 'Pairing…' : 'Pair device'}
        </button>
      </div>
    </div>
  );
}
