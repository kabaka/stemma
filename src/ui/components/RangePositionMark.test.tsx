import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RangePositionMark } from './RangePositionMark';

/** Words a positional restatement must NEVER use — any of these would smuggle a clinical
 * interpretation (severity/normalcy judgement) back into what DR-0036 defines as a strictly
 * positional "above range"/"below range" comparison (guardrail #1). */
const FORBIDDEN_WORDS = ['high', 'low', 'abnormal', 'normal', 'critical', 'elevated'];

describe('RangePositionMark', () => {
  it('renders visible "above range" text for position="above"', () => {
    render(<RangePositionMark position="above" />);
    expect(screen.getByText(/above range/i)).toBeInTheDocument();
  });

  it('renders visible "below range" text for position="below"', () => {
    render(<RangePositionMark position="below" />);
    expect(screen.getByText(/below range/i)).toBeInTheDocument();
  });

  it('renders nothing for position="within" (the common case stays visually quiet)', () => {
    const { container } = render(<RangePositionMark position="within" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for position=undefined (no bounds to compare against)', () => {
    const { container } = render(<RangePositionMark position={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('never uses a forbidden clinical-interpretation word, for either rendered position (guardrail #1 regression guard)', () => {
    const above = render(<RangePositionMark position="above" />);
    const below = render(<RangePositionMark position="below" />);
    for (const text of [above.container.textContent, below.container.textContent]) {
      for (const word of FORBIDDEN_WORDS) {
        // Word-boundary match, not substring — "below" legitimately contains "low" as a
        // substring, but must never contain "low" as a standalone word.
        expect(text ?? '').not.toMatch(new RegExp(`\\b${word}\\b`, 'i'));
      }
    }
  });

  it('carries the positional word as real text, not styling/colour alone (WCAG 1.4.1)', () => {
    // getByText resolves only against actual DOM text content — if the label were conveyed
    // purely via a CSS class or inline colour with no text node, this query would fail.
    const { getByText } = render(<RangePositionMark position="above" />);
    const el = getByText(/above range/i);
    expect(el.textContent).toMatch(/above range/i);
  });
});
