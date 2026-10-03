import { useQuery } from '@tanstack/react-query';
import { getStats } from '../../services/db/queries';
import { Card } from '../components/m3';

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

/** M5.8: library + token-usage overview (reads only — no writes). */
export function StatsView() {
  const stats = useQuery({ queryKey: ['stats'], queryFn: getStats });

  if (stats.isLoading) {
    return (
      <section className="page">
        <h1>Stats</h1>
        <p role="status">Counting…</p>
      </section>
    );
  }
  if (stats.isError || !stats.data) {
    return (
      <section className="page">
        <h1>Stats</h1>
        <p role="alert">Could not load statistics — is the database available?</p>
      </section>
    );
  }

  const s = stats.data;
  const maxDay = Math.max(1, ...s.tokensByDay.map((d) => d.tokens));

  return (
    <section className="page">
      <h1>Stats</h1>
      <div className="stat-grid">
        <Card variant="filled" className="stat-card">
          <span className="stat-value">{fmt(s.totalChats)}</span>
          <span className="stat-label">Chats</span>
        </Card>
        <Card variant="filled" className="stat-card">
          <span className="stat-value">{fmt(s.totalMessages)}</span>
          <span className="stat-label">Messages</span>
        </Card>
        <Card variant="filled" className="stat-card">
          <span className="stat-value">{fmt(s.totalCharacters)}</span>
          <span className="stat-label">Characters</span>
        </Card>
        <Card variant="filled" className="stat-card">
          <span className="stat-value">{fmt(s.totalPersonas)}</span>
          <span className="stat-label">Personas</span>
        </Card>
        <Card variant="filled" className="stat-card">
          <span className="stat-value">{fmt(s.totalTokensIn)}</span>
          <span className="stat-label">Tokens sent</span>
        </Card>
        <Card variant="filled" className="stat-card">
          <span className="stat-value">{fmt(s.totalTokensOut)}</span>
          <span className="stat-label">Tokens received</span>
        </Card>
      </div>

      <Card variant="filled" className="settings-section">
        <h2 style={{ font: 'var(--md-sys-typescale-title-md)', margin: 0 }}>Tokens per day (last 14 days)</h2>
        {s.tokensByDay.length === 0 ? (
          <p className="field-hint" style={{ margin: 0 }}>
            No usage recorded in the last two weeks.
          </p>
        ) : (
          <div className="stat-bars" role="img" aria-label="Tokens used per day over the last two weeks">
            {s.tokensByDay.map((d) => (
              <div key={d.day} className="stat-bar-col" title={`${d.day}: ${fmt(d.tokens)} tokens`}>
                <div className="stat-bar" style={{ height: `${Math.max(4, (d.tokens / maxDay) * 100)}%` }} />
                <span className="stat-bar-day">{d.day.slice(5)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card variant="filled" className="settings-section">
        <h2 style={{ font: 'var(--md-sys-typescale-title-md)', margin: 0 }}>By purpose</h2>
        {s.byPurpose.length === 0 ? (
          <p className="field-hint" style={{ margin: 0 }}>
            Nothing yet.
          </p>
        ) : (
          <table className="stat-table">
            <thead>
              <tr>
                <th scope="col">Purpose</th>
                <th scope="col">Calls</th>
                <th scope="col">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {s.byPurpose.map((p) => (
                <tr key={p.purpose}>
                  <td>{p.purpose}</td>
                  <td>{fmt(p.calls)}</td>
                  <td>{fmt(p.tokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card variant="filled" className="settings-section">
        <h2 style={{ font: 'var(--md-sys-typescale-title-md)', margin: 0 }}>Longest chats</h2>
        {s.topChats.length === 0 ? (
          <p className="field-hint" style={{ margin: 0 }}>
            No chats yet.
          </p>
        ) : (
          <table className="stat-table">
            <thead>
              <tr>
                <th scope="col">Chat</th>
                <th scope="col">Messages</th>
              </tr>
            </thead>
            <tbody>
              {s.topChats.map((c) => (
                <tr key={c.title}>
                  <td>{c.title}</td>
                  <td>{fmt(c.messages)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </section>
  );
}
