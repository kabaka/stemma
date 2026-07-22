import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  SMART_ENDPOINTS_GENERATED_AT,
  SMART_PROVIDERS,
  type SmartProvider,
} from '@/data/smart-endpoints';

/** Cap on rendered matches — the directory is 1,243 entries; nothing about the UI or the
 * ARIA wiring below needs more than a first page shown at once, and rendering all matches
 * for a broad query (e.g. "health") would be needless DOM weight. */
const MAX_RESULTS = 50;

/** Must match `.epic-picker__listbox`'s `max-height` in components.css — used only to
 * decide whether to flip the popup upward (below), never to size anything itself. */
const LISTBOX_MAX_HEIGHT_PX = 280;

/** Precomputed once when this (lazily-loaded) module evaluates, not per keystroke: each
 * provider's lowercased "name city state" search key. Filtering 1,243 short strings per
 * keystroke is cheap; precomputing the key once avoids repeating the string-join/lowercase
 * work on every render too. */
const SEARCHABLE: { provider: SmartProvider; key: string }[] = SMART_PROVIDERS.map((p) => ({
  provider: p,
  key: `${p.name} ${p.city ?? ''} ${p.state ?? ''}`.toLowerCase(),
}));

/** A stable identity for a provider row that survives filtering (never the filtered array
 * index — see CLAUDE.md's list-key footgun) without requiring the generated data to carry
 * its own id field. */
function providerKey(p: SmartProvider): string {
  return `${p.name}|${p.fhirBaseUrl}|${p.city ?? ''}|${p.state ?? ''}`;
}

interface EpicBrandPickerProps {
  /** Fired when the user picks a provider — the caller (SmartFhirConnect) feeds
   * `provider.fhirBaseUrl` into the SAME `beginConnect` call the manual fallback uses. */
  onSelect: (provider: SmartProvider) => void;
}

/**
 * Searchable provider picker over Stemma's bundled, brand-level SMART-on-FHIR endpoint
 * directory (`src/data/smart-endpoints.ts`, generated from Epic's User-access Brands
 * bundle — DR-0016). This is the primary connect path in `SmartFhirConnect`; the manual
 * FHIR base URL field remains as an explicit fallback for anyone whose provider isn't
 * listed (or isn't Epic).
 *
 * A single-input ARIA combobox (WAI-ARIA "editable combobox with list autocomplete"):
 * the text input carries `role="combobox"` and never loses DOM focus, a sibling
 * `role="listbox"` holds the filtered matches, and `aria-activedescendant` tracks the
 * keyboard-highlighted option. Loaded via `React.lazy` by the caller so this component
 * AND the ~102 KB provider table ship in their own chunk, off the app's critical path.
 */
export function EpicBrandPicker({ onSelect }: EpicBrandPickerProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  // `null` means "not manually navigated" — the effective index (below) then defaults to
  // the top match, so Enter selects it without requiring an ArrowDown first (mirrors
  // ordinary browser/OS autocomplete). Deliberately plain derived state, not a `useEffect`
  // resetting a separate `activeIndex` on every keystroke: resetting on `onChange` below is
  // synchronous and exact, with no render lag and no dependency-array footgun to get wrong.
  const [manualIndex, setManualIndex] = useState<number | null>(null);
  // Whether the open listbox should render ABOVE the input instead of below it (a11y
  // finding, DR-0016): this picker sits inside `.pedigree-import-scroll` — a real,
  // viewport-bounded `overflow-y: auto` column, not just a short/zoomed edge case — and the
  // connect form's own content above the input (heading, description, clinical boundary,
  // "what this shares" disclaimer) commonly leaves less than the listbox's 280px `max-height`
  // of room below, clipping it against that ancestor's own bottom edge for a mouse/touch user
  // (keyboard nav self-heals via the `scrollIntoView` effect below, but nothing scrolls on
  // first open). Flipping upward when there's genuinely more room there is the minimal fix —
  // no bespoke measuring library, no changing the scroll container's shape for every render.
  const [openUpward, setOpenUpward] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const inputId = useId();
  const listboxId = useId();
  const helpId = useId();
  const statusId = useId();
  const optionIdBase = useId();

  const trimmed = query.trim().toLowerCase();
  const matches = useMemo(
    () => (trimmed ? SEARCHABLE.filter((s) => s.key.includes(trimmed)).map((s) => s.provider) : []),
    [trimmed],
  );
  const shown = matches.slice(0, MAX_RESULTS);
  const activeIndex =
    manualIndex !== null ? Math.min(manualIndex, shown.length - 1) : shown.length > 0 ? 0 : -1;

  // Keep the keyboard-highlighted option scrolled into view inside the listbox's own
  // overflow region (never the outer page — `block: 'nearest'` stays local to the listbox).
  useEffect(() => {
    if (activeIndex < 0) return;
    document
      .getElementById(`${optionIdBase}-${activeIndex}`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, optionIdBase]);

  // Re-measure whenever the listbox is (or becomes) open, and keep tracking while it stays
  // open — the surrounding column can scroll or the window can resize without the listbox
  // itself closing. `getBoundingClientRect` is viewport-relative, exactly what determines
  // real clipping against the `.pedigree-import-scroll` ancestor. Only flips when there's
  // BOTH too little room below AND genuinely more room above — never flips into an equally
  // cramped "above" that would just relocate the same clipping. In jsdom (component tests)
  // every rect is zeroed, so `spaceBelow` reads as the full (large) `window.innerHeight` and
  // this never flips — existing keyboard/pointer test assertions are unaffected.
  useEffect(() => {
    if (!open) {
      setOpenUpward(false);
      return;
    }
    const measure = (): void => {
      const el = inputRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setOpenUpward(spaceBelow < LISTBOX_MAX_HEIGHT_PX + 8 && spaceAbove > spaceBelow);
    };
    measure();
    window.addEventListener('resize', measure);
    // `capture: true` — scroll events don't bubble, but a scroll on the `.pedigree-import-
    // scroll` ancestor still reaches a capturing window listener on its way down to the
    // actual scroll target.
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open]);

  const select = (p: SmartProvider): void => {
    onSelect(p);
    setQuery(p.name);
    setOpen(false);
    setManualIndex(null);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (shown.length === 0) return;
      const next = e.key === 'ArrowDown' ? activeIndex + 1 : activeIndex - 1;
      setManualIndex(Math.min(Math.max(next, 0), shown.length - 1));
      return;
    }
    if (e.key === 'Enter') {
      if (open && activeIndex >= 0 && activeIndex < shown.length) {
        e.preventDefault();
        select(shown[activeIndex]);
      }
      return;
    }
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    }
  };

  const resultsMessage = !trimmed
    ? ''
    : matches.length === 0
      ? 'No matches — try the manual entry below.'
      : matches.length > shown.length
        ? `Showing ${shown.length} of ${matches.length} — keep typing to narrow.`
        : `${matches.length} match${matches.length === 1 ? '' : 'es'}.`;

  return (
    <div className="epic-picker">
      <label className="lbl" htmlFor={inputId}>
        Find your provider
      </label>
      <input
        ref={inputRef}
        id={inputId}
        className="field"
        type="text"
        role="combobox"
        autoComplete="off"
        aria-expanded={open && shown.length > 0}
        aria-controls={open && shown.length > 0 ? listboxId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={
          open && activeIndex >= 0 ? `${optionIdBase}-${activeIndex}` : undefined
        }
        aria-describedby={`${helpId} ${statusId}`}
        placeholder="Start typing your hospital or clinic's name…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setManualIndex(null);
        }}
        onFocus={() => {
          if (trimmed) setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {open && shown.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Matching providers"
          className={
            openUpward ? 'epic-picker__listbox epic-picker__listbox--above' : 'epic-picker__listbox'
          }
        >
          {shown.map((p, i) => (
            <li
              key={providerKey(p)}
              id={`${optionIdBase}-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              className={
                i === activeIndex
                  ? 'epic-picker__option epic-picker__option--active'
                  : 'epic-picker__option'
              }
              // Selecting via pointer must not blur the input first (that would close the
              // listbox before the click's onClick fires) — preventDefault on mousedown keeps
              // focus on the input the whole time, same trick PersonForm's popovers use.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => select(p)}
              onMouseEnter={() => setManualIndex(i)}
            >
              {p.name}
              {(p.city || p.state) && (
                <span className="mono-dim"> — {[p.city, p.state].filter(Boolean).join(', ')}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {/* Polite live region — announces the match count as the user types without moving
          focus (WCAG 4.1.3); also the visible "showing N of M" count the design calls for. */}
      <p id={statusId} role="status" className="mono-dim" style={{ marginTop: 6, minHeight: 16 }}>
        {resultsMessage}
      </p>
      <p id={helpId} className="mono-dim" style={{ margin: 0 }}>
        Provider directory as of {SMART_ENDPOINTS_GENERATED_AT} — a periodically-refreshed snapshot,
        not a live lookup.
      </p>
    </div>
  );
}
