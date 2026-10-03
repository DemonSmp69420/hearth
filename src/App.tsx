import { useEffect } from 'react';
import { useTheme } from './hooks/useTheme';
import { isTauri, isCompanion, companionSession } from './services/transport';
import { getSetting } from './services/db/queries';
import { PIN_SETTING_KEY, useSession } from './stores/session';
import type { PinRecord } from './domain/privacy/pin';
import { AppShell } from './ui/shell/AppShell';
import { AppLock } from './ui/shell/AppLock';
import { PairingGate } from './ui/shell/PairingGate';

export default function App() {
  useTheme();
  const lockState = useSession((s) => s.lockState);
  const setPinRecord = useSession((s) => s.setPinRecord);
  const setLockState = useSession((s) => s.setLockState);
  const needsPairing = isCompanion() && !companionSession();

  // M5.3: load the app-lock PIN record before showing anything — a lock
  // screen that flashed the chat first would not be much of a lock.
  useEffect(() => {
    void (async () => {
      const rec = await getSetting<PinRecord>(PIN_SETTING_KEY).catch(() => null);
      setPinRecord(rec);
      setLockState(rec ? 'locked' : 'unlocked');
    })();
  }, [setPinRecord, setLockState]);

  let screen = <AppShell />;
  if (lockState === 'checking') screen = <></>;
  else if (lockState === 'locked') screen = <AppLock />;
  else if (needsPairing) screen = <PairingGate />;

  return (
    <>
      {!isTauri() && !isCompanion() && (
        <div className="dev-banner" role="note">
          Browser dev mode — SQLite, keychain, and providers require the Tauri shell
          (<code>npm run tauri dev</code>).
        </div>
      )}
      {screen}
    </>
  );
}
