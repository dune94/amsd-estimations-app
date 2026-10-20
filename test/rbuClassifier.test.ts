import { describe, expect, it } from 'vitest';
import { classifyRbu } from '../src/engine/rbuClassifier.js';
import { rbuConfig } from '../src/config/index.js';

const first = (cat: keyof typeof rbuConfig.categories): string => rbuConfig.categories[cat].rbuValues.find(v => v)!;

describe('classifyRbu', () => {
  it('maps a Marketing unit to the Marketing category', () => {
    expect(classifyRbu(first('Marketing')).category).toBe('Marketing');
  });

  it('maps a Community Engagement unit to its category', () => {
    expect(classifyRbu(first('Community Engagement')).category).toBe('Community Engagement');
  });

  it('maps an Operations unit to the Operations category', () => {
    expect(classifyRbu(first('Operations')).category).toBe('Operations');
  });

  it('defaults null/empty to Operations', () => {
    expect(classifyRbu(null).category).toBe('Operations');
    expect(classifyRbu('').category).toBe('Operations');
  });

  it('defaults an unrecognized value to Operations (fail-safe)', () => {
    const result = classifyRbu('Some Unknown Value');
    expect(result.category).toBe('Operations');
    expect(result.matchedValue).toBe('Some Unknown Value');
  });
});
