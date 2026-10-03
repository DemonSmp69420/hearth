import { describe, expect, it } from 'vitest';
import {
  chatToJson,
  chatToMarkdown,
  chatToStJsonl,
  chatToText,
  parseChatFile,
  parseHearthChatJson,
  parseStChatLog,
  type ChatExportMeta,
} from './chatIO';

const meta: ChatExportMeta = {
  title: 'Moonlit harbor',
  characterName: 'Serena',
  personaName: 'Sam',
};

const msgs = [
  { role: 'assistant' as const, content: 'The tide is high tonight.' },
  { role: 'user' as const, content: 'Then we should stay off the pier.' },
  { role: 'narrator' as const, content: 'Rain begins to fall.' },
];

describe('chat export', () => {
  it('markdown includes both names and every message', () => {
    const md = chatToMarkdown(meta, msgs);
    expect(md).toContain('# Moonlit harbor');
    expect(md).toContain('**Serena**');
    expect(md).toContain('**Sam**');
    expect(md).toContain('The tide is high tonight.');
    expect(md).toContain('*Narrator:* Rain begins to fall.');
  });

  it('plain text exports label per turn', () => {
    const txt = chatToText(meta, msgs);
    expect(txt).toContain('Serena:\nThe tide is high tonight.');
    expect(txt).toContain('Sam:\nThen we should stay off the pier.');
  });

  it('ST jsonl has a header line and turns with is_user flags', () => {
    const jsonl = chatToStJsonl(meta, msgs);
    const lines = jsonl.trim().split('\n');
    expect(lines).toHaveLength(4);
    const header = JSON.parse(lines[0] ?? '{}') as { user_name: string; character_name: string };
    expect(header.user_name).toBe('Sam');
    expect(header.character_name).toBe('Serena');
    const turn1 = JSON.parse(lines[1] ?? '{}') as { is_user: boolean; mes: string };
    expect(turn1.is_user).toBe(false);
    expect(turn1.mes).toBe('The tide is high tonight.');
    const turn2 = JSON.parse(lines[2] ?? '{}') as { is_user: boolean };
    expect(turn2.is_user).toBe(true);
  });

  it('json export round-trips through the hearth parser preserving tree shape', () => {
    const json = chatToJson(meta, [
      {
        id: 'm1',
        parent_id: null,
        ord: 0,
        role: 'user',
        content: 'Hello',
        created_at: 100,
      },
      {
        id: 'm2',
        parent_id: 'm1',
        ord: 1,
        role: 'assistant',
        content: 'Hi there',
        created_at: 200,
      },
    ]);
    const parsed = parseHearthChatJson(json);
    expect(parsed.format).toBe('hearth-json');
    expect(parsed.title).toContain('Moonlit harbor');
    expect(parsed.turns).toHaveLength(2);
    expect(parsed.turns[1]?.parentRef).toBe('m1');
    expect(parsed.turns[1]?.ref).toBe('m2');
  });
});

describe('import parsers', () => {
  it('parses ST jsonl exports', () => {
    const jsonl = chatToStJsonl(meta, msgs);
    const parsed = parseStChatLog(jsonl);
    expect(parsed.format).toBe('st-jsonl');
    expect(parsed.characterName).toBe('Serena');
    expect(parsed.personaName).toBe('Sam');
    expect(parsed.turns.map((t) => t.role)).toEqual(['assistant', 'user', 'system']);
    expect(parsed.turns[2]?.content).toBe('Rain begins to fall.');
  });

  it('rejects garbage for both formats', () => {
    expect(() => parseChatFile('not json at all')).toThrow();
    expect(() => parseChatFile('{"app":"other","kind":"chat"}')).toThrow();
  });

  it('auto-detects hearth json vs st jsonl', () => {
    const hearth = parseChatFile(
      chatToJson(meta, [{ id: 'a', parent_id: null, ord: 0, role: 'user', content: 'x', created_at: 1 }]),
    );
    expect(hearth.format).toBe('hearth-json');
    const st = parseChatFile(chatToStJsonl(meta, msgs));
    expect(st.format).toBe('st-jsonl');
  });
});
