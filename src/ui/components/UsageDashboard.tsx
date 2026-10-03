import { useQuery } from '@tanstack/react-query';
import { Card, FilledButton } from '../components/m3';
import { usageSummary } from '../../services/db/queries';
import { useSession } from '../../stores/session';

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function dayLabel(epochDay: number): string {
  const d = new Date(epochDay * 86400000);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** M4.9: token usage dashboard — totals, per-day bars, per-provider, per-chat. */
export function UsageDashboard() {
  const setView = useSession((s) => s.setView);
  const q = useQuery({ queryKey: ['usage'], queryFn: () => usageSummary(14) });
  const data = q.data;
  if (!data) return null;

  const totals = data.totals;
  const maxDay = Math.max(1, ...data.byDay.map((d) => d.prompt_tokens + d.completion_tokens));
  const byDayMap = new Map(data.byDay.map((d) => [Number(d.day), d]));
  const today = Math.floor(Date.now() / 86400000);
  const days: { day: number; total: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const day = today - i;
    const d = byDayMap.get(day);
    days.push({ day, total: d ? d.prompt_tokens + d.completion_tokens : 0 });
  }
  const topChat = data.byChat[0];

  return (
    <Card variant="elevated">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <h2 style={{ font: 'var(--md-sys-typescale-title-lg)', margin: 0 }}>Usage</h2>
        <span style={{ font: 'var(--md-sys-typescale-body-sm)', color: 'var(--md-sys-color-on-surface-variant)' }}>
          {totals.messages} replies · {fmt(totals.prompt_tokens)} in / {fmt(totals.completion_tokens)} out
        </span>
      </div>

      <div className="usage-bars" role="img" aria-label="Tokens per day, last 14 days">
        {days.map((d) => (
          <div
            key={d.day}
            className="usage-bar"
            style={{ height: `${Math.max(4, Math.round((d.total / maxDay) * 64))}px` }}
            title={`${dayLabel(d.day)}: ${d.total} tokens`}
          />
        ))}
      </div>
      <div className="usage-days" aria-hidden="true">
        <span>14d ago</span>
        <span>today</span>
      </div>

      {data.byProvider.length > 0 && (
        <div className="usage-table">
          <div className="usage-row usage-head">
            <span>Provider</span>
            <span>In</span>
            <span>Out</span>
          </div>
          {data.byProvider.slice(0, 5).map((p) => (
            <div key={p.provider} className="usage-row">
              <span>{p.provider}</span>
              <span>{fmt(p.prompt_tokens)}</span>
              <span>{fmt(p.completion_tokens)}</span>
            </div>
          ))}
        </div>
      )}

      {data.byChat.length > 0 && (
        <div className="usage-table">
          <div className="usage-row usage-head">
            <span>Top chats</span>
            <span>In</span>
            <span>Out</span>
          </div>
          {data.byChat.slice(0, 5).map((c) => (
            <div key={c.chat_id} className="usage-row">
              <span>
                {c.character_name} — {c.title}
              </span>
              <span>{fmt(c.prompt_tokens)}</span>
              <span>{fmt(c.completion_tokens)}</span>
            </div>
          ))}
        </div>
      )}

      {topChat && (
        <FilledButton variant="tonal" onClick={() => setView('chats')}>
          Open chats
        </FilledButton>
      )}
    </Card>
  );
}
