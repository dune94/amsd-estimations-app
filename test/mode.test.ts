import { describe, expect, it } from 'vitest';
import { resolveMode } from '../src/config/mode.js';

describe('resolveMode', () => {
  it('defaults to legacy', () => {
    expect(resolveMode(undefined, {})).toBe('legacy');
  });

  it('uses ESTIMATION_MODE from the environment', () => {
    expect(resolveMode(undefined, { ESTIMATION_MODE: 'formula' })).toBe('formula');
  });

  it('lets the request override the environment', () => {
    expect(resolveMode('legacy', { ESTIMATION_MODE: 'formula' })).toBe('legacy');
  });

  it('treats an empty value as unset', () => {
    expect(resolveMode('', { ESTIMATION_MODE: '' })).toBe('legacy');
  });

  it('throws on an invalid value', () => {
    expect(() => resolveMode('turbo', {})).toThrow('invalid mode: turbo');
    expect(() => resolveMode(undefined, { ESTIMATION_MODE: 'nope' })).toThrow('invalid mode: nope');
  });
});
