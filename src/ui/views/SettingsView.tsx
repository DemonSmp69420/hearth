import { useEffect, useState } from 'react';
import { Card, FilledButton, SegmentedButtons, Switch } from '../components/m3';
import { db } from '../../services/db/client';
import { transport } from '../../services/transport';
import { THEME_PRESETS } from '../../theme/presets';
import { schemeVars } from '../../theme/palette';
import { useSession, PIN_SETTING_KEY, type AvatarSize, type ChatStyle, type FontChoice, type ThemeMode } from '../../stores/session';
import { runDbSpike, type SpikeResult } from '../../services/db/spike';
import { isTauri, transportBackendLabel } from '../../services/transport';
import { makePinRecord, verifyPin } from '../../domain/privacy/pin';
import { deleteSetting, setSetting } from '../../services/db/queries';
import { CompanionSection } from '../components/CompanionSection';
import { PromptManagerSection } from '../components/PromptManagerSection';

const MODE_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'amoled', label: 'AMOLED' },
];

const PREVIEW_ROLES = [
  'primary',
  'onPrimary',
  'primaryContainer',
  'onPrimaryContainer',
  'secondaryContainer',
  'tertiaryContainer',
  'surface',
  'surfaceContainerHigh',
  'background',
] as const;

function ThemeCreator() {
  const themeSeed = useSession((s) => s.themeSeed);
  const setThemeSeed = useSession((s) => s.setThemeSeed);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const exportTheme = () => {
    const payload = { app: 'hearth', version: 1, kind: 'theme', seed: themeSeed };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hearth-theme.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importTheme = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as { seed?: unknown; kind?: unknown };
      if (
        data.kind === 'theme' &&
        typeof data.seed === 'string' &&
        /^#[0-9a-fA-F]{6}$/.test(data.seed)
      ) {
        setThemeSeed(data.seed.toLowerCase());
        setImportMsg(`Imported theme seed ${data.seed.toLowerCase()}.`);
      } else {
        setImportMsg('Not a Hearth theme file (expected a 6-digit hex seed).');
      }
    } catch {
      setImportMsg('Could not read that file as a theme.');
    }
  };

  return (
    <div className="settings-row theme-creator">
      <div className="theme-preview" aria-label="Theme preview">
        {(['Light', 'Dark'] as const).map((mode) => (
          <div key={mode} className="theme-preview-row">
            <span className="theme-preview-label">{mode}</span>
            {PREVIEW_ROLES.map((role) => (
              <span
                key={role}
                className="theme-preview-swatch"
                style={{ background: schemeVars(themeSeed, mode === 'Dark')[role] }}
                title={`${mode} · ${role}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="theme-io">
        <FilledButton variant="tonal" onClick={exportTheme}>
          Export theme
        </FilledButton>
        <label className="m3-button m3-button-tonal theme-import">
          Import theme
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importTheme(f);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {importMsg && (
        <p role="status" className="field-hint" style={{ margin: 0 }}>
          {importMsg}
        </p>
      )}
    </div>
  );
}

/** M5.3 app lock + privacy toggles (§12). */
function PrivacySection() {
  const privacy = useSession((s) => s.privacy);
  const setPrivacy = useSession((s) => s.setPrivacy);
  const pinRecord = useSession((s) => s.pinRecord);
  const setPinRecord = useSession((s) => s.setPinRecord);
  const setLockState = useSession((s) => s.setLockState);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const savePin = async () => {
    setError(null);
    if (pinRecord && !(await verifyPin(current, pinRecord))) {
      setError('Current PIN is incorrect.');
      return;
    }
    if (next.length < 4) {
      setError('Use at least 4 digits.');
      return;
    }
    if (next !== confirm) {
      setError('PINs do not match.');
      return;
    }
    const rec = await makePinRecord(next);
    await setSetting(PIN_SETTING_KEY, rec);
    setPinRecord(rec);
    setMsg('PIN saved — the app will ask for it on launch. Use “Lock now” to try it.');
    setCurrent('');
    setNext('');
    setConfirm('');
  };

  const removePin = async () => {
    setError(null);
    if (!pinRecord) return;
    if (!(await verifyPin(current, pinRecord))) {
      setError('Current PIN is incorrect.');
      return;
    }
    await deleteSetting(PIN_SETTING_KEY);
    setPinRecord(null);
    setMsg('PIN removed.');
    setCurrent('');
  };

  return (
    <Card variant="filled" className="settings-section">
      <h2 style={{ font: 'var(--md-sys-typescale-title-md)', margin: 0 }}>Privacy</h2>
      <div className="settings-row privacy-pin-row">
        {pinRecord ? (
          <label className="field">
            <span className="field-label">Current PIN</span>
            <input
              type="password"
              inputMode="numeric"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              aria-label="Current PIN"
            />
          </label>
        ) : null}
        <label className="field">
          <span className="field-label">{pinRecord ? 'New PIN' : 'PIN (min 4 digits)'}</span>
          <input
            type="password"
            inputMode="numeric"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            aria-label="New PIN"
          />
        </label>
        <label className="field">
          <span className="field-label">Repeat PIN</span>
          <input
            type="password"
            inputMode="numeric"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-label="Repeat PIN"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void savePin();
            }}
          />
        </label>
        <FilledButton variant="tonal" onClick={() => void savePin()} disabled={!next || next !== confirm}>
          {pinRecord ? 'Change PIN' : 'Set PIN'}
        </FilledButton>
        {pinRecord && (
          <FilledButton variant="text" onClick={() => void removePin()} disabled={!current}>
            Remove PIN
          </FilledButton>
        )}
      </div>
      {pinRecord && (
        <div className="settings-row">
          <FilledButton variant="filled" onClick={() => setLockState('locked')}>
            Lock now
          </FilledButton>
        </div>
      )}
      {error && (
        <p role="alert" className="field-hint" style={{ margin: 0, color: 'var(--md-sys-color-error)' }}>
          {error}
        </p>
      )}
      {msg && (
        <p role="status" className="field-hint" style={{ margin: 0 }}>
          {msg}
        </p>
      )}
      <p className="field-hint" style={{ margin: 0 }}>
        The PIN is stored only as a salted hash in the local database — never in backups or
        exports. With a PIN set, the app locks on launch and on the panic key.
      </p>
      <Switch
        checked={privacy.blurUntilHover}
        onChange={(v) => setPrivacy({ blurUntilHover: v })}
        label="Blur messages until hover"
      />
      <Switch
        checked={privacy.hideTitle}
        onChange={(v) => setPrivacy({ hideTitle: v })}
        label="Hide the window title (shows a neutral “Notes”)"
      />
      <Switch
        checked={privacy.panicKey}
        onChange={(v) => setPrivacy({ panicKey: v })}
        label="Panic key (Ctrl+Shift+H hides the window instantly)"
      />
      <Switch
        checked={privacy.lockOnPanic}
        onChange={(v) => setPrivacy({ lockOnPanic: v })}
        disabled={!pinRecord}
        label="Panic key also locks the app"
      />
    </Card>
  );
}

export function SettingsView() {
  const themeMode = useSession((s) => s.themeMode);
  const setThemeMode = useSession((s) => s.setThemeMode);
  const themeSeed = useSession((s) => s.themeSeed);
  const setThemeSeed = useSession((s) => s.setThemeSeed);
  const reading = useSession((s) => s.reading);
  const setReading = useSession((s) => s.setReading);

  const [spike, setSpike] = useState<SpikeResult | null>(null);
  const [spikeRunning, setSpikeRunning] = useState(false);

  const runSpike = async () => {
    setSpikeRunning(true);
    try {
      setSpike(await runDbSpike());
    } finally {
      setSpikeRunning(false);
    }
  };

  return (
    <section className="page">
      <h1>Settings</h1>

      <Card variant="filled" className="settings-section">
        <h2 style={{ font: 'var(--md-sys-typescale-title-md)', margin: 0 }}>Appearance</h2>
        <div className="settings-row">
          <SegmentedButtons
            ariaLabel="Theme mode"
            options={MODE_OPTIONS}
            value={themeMode}
            onChange={setThemeMode}
          />
        </div>
        <div className="settings-row swatch-grid">
          {THEME_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="swatch"
              style={{ background: p.seed }}
              title={p.name}
              aria-label={p.name}
              aria-pressed={themeSeed === p.seed}
              onClick={() => setThemeSeed(p.seed)}
            />
          ))}
          <label className="seed-input" title="Custom seed color">
            <input
              type="color"
              value={themeSeed}
              onChange={(e) => setThemeSeed(e.target.value)}
              aria-label="Custom seed color"
            />
            <input
              type="text"
              value={themeSeed}
              onChange={(e) => {
                const v = e.target.value.trim();
                if (/^#[0-9a-fA-F]{6}$/.test(v)) setThemeSeed(v.toLowerCase());
              }}
              aria-label="Seed hex"
            />
          </label>
        </div>
        <ThemeCreator />
      </Card>

      <Card variant="filled" className="settings-section">
        <h2 style={{ font: 'var(--md-sys-typescale-title-md)', margin: 0 }}>Reading</h2>
        <p style={{ font: 'var(--md-sys-typescale-body-md)', margin: 0, color: 'var(--md-sys-color-on-surface-variant)' }}>
          How chats look while you read. Applies everywhere immediately.
        </p>
        <div className="settings-row">
          <SegmentedButtons
            ariaLabel="Chat style"
            options={[
              { value: 'bubbles' as ChatStyle, label: 'Bubbles' },
              { value: 'flat' as ChatStyle, label: 'Flat' },
              { value: 'compact' as ChatStyle, label: 'Compact' },
            ]}
            value={reading.chatStyle}
            onChange={(v) => setReading({ chatStyle: v })}
          />
        </div>
        <div className="settings-row">
          <SegmentedButtons
            ariaLabel="Font"
            options={[
              { value: 'default' as FontChoice, label: 'Default' },
              { value: 'serif' as FontChoice, label: 'Serif' },
              { value: 'round' as FontChoice, label: 'Round' },
              { value: 'mono' as FontChoice, label: 'Mono' },
            ]}
            value={reading.fontChoice}
            onChange={(v) => setReading({ fontChoice: v })}
          />
          <SegmentedButtons
            ariaLabel="Avatar size"
            options={[
              { value: 'hidden' as AvatarSize, label: 'No avatars' },
              { value: 'sm' as AvatarSize, label: 'S' },
              { value: 'md' as AvatarSize, label: 'M' },
              { value: 'lg' as AvatarSize, label: 'L' },
            ]}
            value={reading.avatarSize}
            onChange={(v) => setReading({ avatarSize: v })}
          />
        </div>
        <label className="field">
          <span className="field-label">
            Text size <span className="field-tokens">{reading.fontSize}px</span>
          </span>
          <input
            type="range"
            min={13}
            max={22}
            step={1}
            value={reading.fontSize}
            onChange={(e) => setReading({ fontSize: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span className="field-label">
            Line height <span className="field-tokens">{reading.lineHeight}</span>
          </span>
          <input
            type="range"
            min={1.2}
            max={2}
            step={0.05}
            value={reading.lineHeight}
            onChange={(e) => setReading({ lineHeight: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span className="field-label">
            Column width <span className="field-tokens">{reading.chatWidth}px</span>
          </span>
          <input
            type="range"
            min={560}
            max={1200}
            step={20}
            value={reading.chatWidth}
            onChange={(e) => setReading({ chatWidth: Number(e.target.value) })}
          />
        </label>
        <div className="settings-row">
          <SegmentedButtons
            ariaLabel="Typewriter pacing"
            options={[
              { value: '0', label: 'Instant' },
              { value: '1', label: 'Gentle' },
              { value: '2', label: 'Slow' },
            ]}
            value={String(reading.typewriter)}
            onChange={(v) => setReading({ typewriter: Number(v) as 0 | 1 | 2 })}
          />
        </div>
      </Card>

      <PrivacySection />

      <Card variant="filled" className="settings-section">
        <h2 style={{ font: 'var(--md-sys-typescale-title-md)', margin: 0 }}>Advanced prompts</h2>
        <PromptManagerSection />
      </Card>

      <Card variant="filled" className="settings-section">
        <h2 style={{ font: 'var(--md-sys-typescale-title-md)', margin: 0 }}>Storage &amp; database</h2>
        <p style={{ font: 'var(--md-sys-typescale-body-md)', margin: 0, color: 'var(--md-sys-color-on-surface-variant)' }}>
          Backend mode: {transportBackendLabel()}.
          Schema migrations run automatically on first launch under Tauri.
        </p>
        <div className="settings-row">
          <FilledButton variant="tonal" onClick={runSpike} disabled={spikeRunning}>
            {spikeRunning ? 'Probing…' : 'Run DB spike (FTS5 + CTE)'}
          </FilledButton>
        </div>
        {spike && (
          <pre className="spike-result" role="status">
            {`FTS5: ${spike.fts5 ? 'yes' : 'no'}\nRecursive CTE: ${spike.recursiveCte ? 'yes' : 'no'}\n${spike.detail}`}
          </pre>
        )}
      </Card>

      {isTauri() && <CompanionSection />}

      {isTauri() && <BackupsSection />}

      <Card variant="outlined" className="settings-section">
        <h2 style={{ font: 'var(--md-sys-typescale-title-md)', margin: 0 }}>About</h2>
        <p style={{ font: 'var(--md-sys-typescale-body-md)', margin: 0 }}>
          Hearth 0.6.0 — M4 Polish & power. Roadmap and architecture in <code>docs/</code>.
        </p>
      </Card>
    </section>
  );
}

interface BackupConfig {
  enabled: boolean;
  interval_hours: number;
  keep: number;
}

const INTERVAL_OPTIONS = [
  { value: 6, label: 'Every 6 hours' },
  { value: 12, label: 'Every 12 hours' },
  { value: 24, label: 'Daily' },
  { value: 72, label: 'Every 3 days' },
  { value: 168, label: 'Weekly' },
];

/** M4.8: scheduled VACUUM INTO backups with rotation (F14). */
function BackupsSection() {
  const [cfg, setCfg] = useState<BackupConfig>({ enabled: false, interval_hours: 24, keep: 7 });
  const [last, setLast] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const rows = await db().select<{ key: string; value: string }>(
          "SELECT key, value FROM settings WHERE key IN ('backups', 'backups_last')",
        );
        for (const row of rows) {
          if (row.key === 'backups') {
            const parsed = JSON.parse(row.value) as Partial<BackupConfig>;
            setCfg({
              enabled: parsed.enabled ?? false,
              interval_hours: parsed.interval_hours ?? 24,
              keep: parsed.keep ?? 7,
            });
          } else if (row.key === 'backups_last') {
            setLast(JSON.parse(row.value) as number);
          }
        }
      } catch {
        // first run — defaults apply
      }
    })();
  }, []);

  const save = async (next: BackupConfig) => {
    setCfg(next);
    try {
      await db().execute(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        ['backups', JSON.stringify(next)],
      );
    } catch (e) {
      setError(String(e));
    }
  };

  const runNow = async () => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await transport.invoke<{ path: string; kept: number; removed: number }>('backup_now');
      setMsg(`Backup created (${r.kept} kept, ${r.removed} rotated out).`);
      setLast(Date.now());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card variant="filled" className="settings-section">
      <h2 style={{ font: 'var(--md-sys-typescale-title-md)', margin: 0 }}>Backups</h2>
      <p style={{ font: 'var(--md-sys-typescale-body-md)', margin: 0, color: 'var(--md-sys-color-on-surface-variant)' }}>
        Safe snapshots of the whole database (safe to take while the app is
        running). Oldest files rotate out automatically. Stored in a{' '}
        <code>backups</code> folder next to the database.
      </p>
      <div className="settings-row" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Switch
          checked={cfg.enabled}
          onChange={(v) => void save({ ...cfg, enabled: v })}
          label="Back up on a schedule"
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>Schedule</span>
          <select
            value={cfg.interval_hours}
            disabled={!cfg.enabled}
            onChange={(e) => void save({ ...cfg, interval_hours: Number(e.target.value) })}
            aria-label="Backup interval"
          >
            {INTERVAL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>Keep</span>
          <input
            type="number"
            min={1}
            max={60}
            value={cfg.keep}
            disabled={!cfg.enabled}
            onChange={(e) => void save({ ...cfg, keep: Math.max(1, Math.min(60, Number(e.target.value) || 7)) })}
            aria-label="Backups to keep"
            style={{ width: 64 }}
          />
        </label>
        <FilledButton variant="tonal" onClick={() => void runNow()} disabled={busy}>
          {busy ? 'Backing up…' : 'Back up now'}
        </FilledButton>
      </div>
      <p style={{ margin: 0, font: 'var(--md-sys-typescale-body-sm)', color: 'var(--md-sys-color-on-surface-variant)' }}>
        {last ? `Last backup: ${new Date(last).toLocaleString()}` : 'No backup yet.'}
      </p>
      {msg && (
        <p role="status" style={{ margin: 0, font: 'var(--md-sys-typescale-body-sm)' }}>
          {msg}
        </p>
      )}
      {error && (
        <p role="alert" style={{ color: 'var(--md-sys-color-error)' }}>
          {error}
        </p>
      )}
    </Card>
  );
}
