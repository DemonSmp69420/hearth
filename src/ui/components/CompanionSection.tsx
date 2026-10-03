import { useCallback, useEffect, useState } from 'react';
import { Card, FilledButton, Switch } from '../components/m3';
import { db } from '../../services/db/client';
import { transport } from '../../services/transport';

interface SessionInfo {
  id: string;
  created_at: number;
  last_seen: number;
}

interface ServerStatus {
  running: boolean;
  port?: number;
  url?: string;
  localUrl?: string;
  pairingToken?: string;
  sessions?: SessionInfo[];
}

interface CompanionConfig {
  enabled: boolean;
  port: number;
}

/**
 * Desktop-only settings for the companion web server (F18/D-021): start/stop,
 * pairing token + QR, session management, and boot auto-start.
 */
export function CompanionSection() {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [port, setPort] = useState('8770');
  const [config, setConfig] = useState<CompanionConfig>({ enabled: false, port: 8770 });
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await transport.invoke<ServerStatus>('server_status');
      setStatus(s);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    void (async () => {
      try {
        const rows = await db().select<{ value: string }>(
          "SELECT value FROM settings WHERE key = 'companion_server'",
        );
        if (rows[0]) {
          const cfg = JSON.parse(rows[0].value) as CompanionConfig;
          setConfig(cfg);
          setPort(String(cfg.port));
        }
      } catch {
        // first run — table may not exist yet; defaults apply
      }
    })();
  }, [refresh]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await transport.invoke<ServerStatus>('server_start', { port: Number(port) || 8770 });
      setStatus(s);
      if (s.running) {
        const next = { enabled: config.enabled, port: s.port ?? 8770 };
        setConfig(next);
        await saveConfig(next);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    setError(null);
    try {
      await transport.invoke('server_stop');
      await refresh();
      setQr(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const showQr = async () => {
    try {
      setQr(await transport.invoke<string>('server_pair_qr'));
    } catch (e) {
      setError(String(e));
    }
  };

  const saveConfig = async (cfg: CompanionConfig) => {
    await db().execute(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ['companion_server', JSON.stringify(cfg)],
    );
  };

  const setAutoStart = async (enabled: boolean) => {
    const next = { ...config, enabled, port: Number(port) || 8770 };
    setConfig(next);
    try {
      await saveConfig(next);
    } catch (e) {
      setError(String(e));
    }
  };

  const revoke = async (sessionId: string) => {
    try {
      await transport.invoke('server_revoke', { session_id: sessionId });
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const running = status?.running === true;

  return (
    <Card variant="filled" className="settings-section">
      <h2 style={{ font: 'var(--md-sys-typescale-title-md)', margin: 0 }}>Companion (phone access)</h2>
      <p style={{ font: 'var(--md-sys-typescale-body-md)', margin: 0, color: 'var(--md-sys-color-on-surface-variant)' }}>
        Serve Hearth over your home network so your phone can control the same
        chats and characters. Everything stays on this PC — no cloud, no accounts.
        API keys never leave the desktop.
      </p>

      <div className="settings-row" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>Port</span>
          <input
            type="text"
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ''))}
            disabled={running}
            aria-label="Companion server port"
            style={{ width: 80 }}
          />
        </label>
        {running ? (
          <FilledButton variant="tonal" onClick={stop} disabled={busy}>
            Stop server
          </FilledButton>
        ) : (
          <FilledButton variant="tonal" onClick={start} disabled={busy}>
            {busy ? 'Starting…' : 'Start server'}
          </FilledButton>
        )}
        <Switch checked={config.enabled} onChange={(v) => void setAutoStart(v)} label="Start automatically on launch" />
      </div>

      {running && status && (
        <div className="companion-status">
          <p style={{ margin: '8px 0' }}>
            Open on your phone:{' '}
            <strong>{status.url}</strong> ({status.localUrl} on this PC)
          </p>
          <p style={{ margin: '8px 0' }}>
            Pairing token: <code style={{ fontSize: '1.2em' }}>{status.pairingToken}</code>{' '}
            <FilledButton variant="text" onClick={showQr}>
              Show QR
            </FilledButton>
          </p>
          {qr && (
            <div
              className="companion-qr"
              style={{ width: 200, height: 200, background: '#fff', padding: 8, borderRadius: 8 }}
              // QR comes from our own Rust command as an SVG string.
              dangerouslySetInnerHTML={{ __html: qr }}
            />
          )}
          <h3 style={{ font: 'var(--md-sys-typescale-title-sm)', margin: '12px 0 4px' }}>
            Paired devices ({status.sessions?.length ?? 0})
          </h3>
          {(status.sessions ?? []).map((s) => (
            <div key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0' }}>
              <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{s.id.slice(0, 12)}…</span>
              <span style={{ color: 'var(--md-sys-color-on-surface-variant)', fontSize: 12 }}>
                last seen {new Date(s.last_seen).toLocaleTimeString()}
              </span>
              <FilledButton variant="text" onClick={() => void revoke(s.id)}>
                Revoke
              </FilledButton>
            </div>
          ))}
        </div>
      )}

      {error && (
        <p role="alert" style={{ color: 'var(--md-sys-color-error)' }}>
          {error}
        </p>
      )}
    </Card>
  );
}
