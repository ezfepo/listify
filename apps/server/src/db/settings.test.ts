import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './index.js';
import { deleteSetting, getSetting, setSetting } from './settings.js';

beforeEach(() => {
  db.exec('DELETE FROM settings;');
});

describe('settings', () => {
  it('returns undefined for a key that was never set', () => {
    expect(getSetting('missing')).toBeUndefined();
  });

  it('stores and reads back a value', () => {
    setSetting('main_playlist_id', 'abc');
    expect(getSetting('main_playlist_id')).toBe('abc');
  });

  it('overwrites an existing value instead of failing on the primary key', () => {
    setSetting('k', 'one');
    setSetting('k', 'two');
    expect(getSetting('k')).toBe('two');
    expect(db.prepare('SELECT COUNT(*) AS n FROM settings').get()).toEqual({ n: 1 });
  });

  it('deletes a value, and deleting a missing key is a no-op', () => {
    setSetting('k', 'v');
    deleteSetting('k');
    expect(getSetting('k')).toBeUndefined();
    expect(() => deleteSetting('k')).not.toThrow();
  });

  it('keeps keys independent', () => {
    setSetting('a', '1');
    setSetting('b', '2');
    deleteSetting('a');
    expect(getSetting('b')).toBe('2');
  });
});
