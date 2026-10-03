import { describe, expect, it } from 'vitest';
import { isCharacterLink, uuidFromLink } from './linkImport';

describe('uuidFromLink', () => {
  it('extracts the uuid from janitorai and jannyai links', () => {
    const id = '1189be00-cce5-4ae3-8ad4-0a072e5b7cd2';
    expect(uuidFromLink(`https://janitorai.com/characters/${id}_some-bot-name`)).toBe(id);
    expect(uuidFromLink(`https://jannyai.com/characters/${id}_some-bot-name`)).toBe(id);
    expect(uuidFromLink(`https://www.janitorai.com/characters/${id}`)).toBe(id);
  });

  it('returns null for non-links', () => {
    expect(uuidFromLink('https://example.com/characters/hello')).toBeNull();
    expect(uuidFromLink('not a link at all')).toBeNull();
  });
});

describe('isCharacterLink', () => {
  it('accepts janitor/janny links with a uuid', () => {
    const id = '02570a16-2666-4ff4-ad1a-226f736e7c60';
    expect(isCharacterLink(`https://janitorai.com/characters/${id}`)).toBe(true);
    expect(isCharacterLink(`https://jannyai.com/characters/${id}_x`)).toBe(true);
  });

  it('rejects other sites even with a uuid-shaped id', () => {
    expect(isCharacterLink('https://example.com/02570a16-2666-4ff4-ad1a-226f736e7c60')).toBe(false);
    expect(isCharacterLink('https://janitorai.com/characters/no-uuid-here')).toBe(false);
  });
});
