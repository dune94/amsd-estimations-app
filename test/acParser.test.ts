import { describe, expect, it } from 'vitest';
import { parseAcceptanceCriteria } from '../src/clients/acParser.js';

describe('parseAcceptanceCriteria', () => {
  it('returns empty array when no AC heading is found', () => {
    expect(parseAcceptanceCriteria('Just a plain description with no heading.')).toEqual([]);
  });

  it('extracts bullet lines under an "Acceptance Criteria:" heading', () => {
    const text = 'Some intro.\n\nAcceptance Criteria:\n- First AC\n- Second AC\n\nMore unrelated text.';
    expect(parseAcceptanceCriteria(text)).toEqual(['First AC', 'Second AC']);
  });

  it('is case-insensitive and tolerates "ACs" heading', () => {
    const text = 'ACs:\n- one\n- two';
    expect(parseAcceptanceCriteria(text)).toEqual(['one', 'two']);
  });

  it('returns empty array for empty input', () => {
    expect(parseAcceptanceCriteria('')).toEqual([]);
  });

  it('finds ACs under a numbered heading with trailing words (PRJ-2974)', () => {
    const text = [
      '4. Objective & User Story',
      'As a user I want …',
      '',
      '5. Acceptance Criteria & Expected Outcome',
      '- Given a user completes an action, when the message appears, then it is prominent',
      '',
      '- Given a screen reader user completes an action, then it is announced',
      '',
      '6. Designs & Assets',
    ].join('\n');
    expect(parseAcceptanceCriteria(text)).toHaveLength(2);
  });
});
