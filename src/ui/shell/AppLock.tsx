import { useState } from 'react';
import { verifyPin } from '../../domain/privacy/pin';
import { useSession } from '../../stores/session';

/**
 * M5.3 full-screen lock (§12): shown on launch and via "Lock now"/panic key
 * whenever a PIN is set. The PIN never leaves this component — only its
 * salted PBKDF2 hash is stored (in the local database settings table).
 */
export function AppLock() {
  const pinRecord = useSession((s) => s.pinRecord);
  const setLockState = useSession((s) => s.setLockState);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const unlock = async () => {
    if (!pinRecord || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (await verifyPin(pin, pinRecord)) {
        setLockState('unlocked');
      } else {
        setError('Wrong PIN — try again.');
        setPin('');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-lock" role="dialog" aria-label="Hearth is locked">
      <div className="app-lock-card">
        <h1>Hearth is locked</h1>
        <p>Enter your PIN to continue.</p>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void unlock();
          }}
          aria-label="PIN"
        />
        {error && (
          <p className="app-lock-error" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          className="m3-button m3-button-filled"
          disabled={busy || !pin}
          onClick={() => void unlock()}
        >
          Unlock
        </button>
      </div>
    </div>
  );
}
