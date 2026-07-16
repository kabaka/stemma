import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FlagCard } from './FlagCard';
import type { PatternFlag } from '@/domain/patterns';

const FLAG: PatternFlag = {
  severity: 'referral',
  cat: 'canc',
  title: 'Hereditary breast/ovarian cancer',
  criterion: 'Meets common criteria to discuss BRCA1/2 testing.',
  rec: 'Consider a genetics referral.',
  relatives: [],
};

describe('FlagCard (regression)', () => {
  it('marks the severity-colour dot decorative (aria-hidden), never the sole channel for severity', () => {
    const { container } = render(<FlagCard flag={FLAG} />);
    const dot = container.querySelector('.row > span[aria-hidden="true"]');
    expect(dot).not.toBeNull();
    // The real, non-colour channel: a visible text badge carrying the same information.
    expect(screen.getByText('Referral criteria')).toBeInTheDocument();
  });
});
