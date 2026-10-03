import { useQuery } from '@tanstack/react-query';
import { Card, FilledButton } from '../components/m3';
import { listChats } from '../../services/db/queries';
import { useSession } from '../../stores/session';
import { UsageDashboard } from '../components/UsageDashboard';

export function HomeView() {
  const setView = useSession((s) => s.setView);
  const chats = useQuery({ queryKey: ['chats'], queryFn: listChats });
  const recent = chats.data?.filter((c) => c.archived !== 1).slice(0, 3) ?? [];

  return (
    <section className="page">
      <h1>Home</h1>
      {recent.length > 0 && (
        <Card variant="elevated">
          <h2 style={{ font: 'var(--md-sys-typescale-title-lg)', margin: '0 0 12px' }}>
            Continue where you left off
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recent.map((c) => (
              <FilledButton key={c.id} variant="tonal" onClick={() => setView('chats')}>
                {c.character_name} — {c.title}
              </FilledButton>
            ))}
          </div>
        </Card>
      )}
      {recent.length === 0 && (
        <Card variant="elevated">
          <h2 style={{ font: 'var(--md-sys-typescale-title-lg)', margin: '0 0 8px' }}>
            Welcome to Hearth
          </h2>
          <p style={{ font: 'var(--md-sys-typescale-body-lg)', margin: '0 0 16px' }}>
            Pick a character to start your first branching chat.
          </p>
          <FilledButton onClick={() => setView('characters')}>New chat</FilledButton>
        </Card>
      )}
      <UsageDashboard />
    </section>
  );
}
