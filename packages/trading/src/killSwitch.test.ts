import { describe, expect, it } from 'vitest';
import { interpretKillSwitch } from './killSwitch';

describe('interpretKillSwitch', () => {
  it('is off when it was never set', () => {
    expect(interpretKillSwitch(null)).toEqual({ tripped: false, reason: null, malformed: false });
    expect(interpretKillSwitch(undefined).tripped).toBe(false);
  });
  it('follows the stored flag and carries the reason', () => {
    expect(interpretKillSwitch({ enabled: true, reason: 'rpc looks wrong', by: 'admin1' })).toEqual({ tripped: true, reason: 'rpc looks wrong', malformed: false });
    expect(interpretKillSwitch({ enabled: false }).tripped).toBe(false);
  });
  it('is TRIPPED when the stored value cannot be read, whatever it looks like', () => {
    for (const bad of [{}, { enabled: 'no' }, { enabled: false, surprise: 1 }, 'off', 0, [], { enabled: false, reason: 'x'.repeat(300) }]) {
      expect(interpretKillSwitch(bad), JSON.stringify(bad)).toMatchObject({ tripped: true, malformed: true });
    }
  });
});
