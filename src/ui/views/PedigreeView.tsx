import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useStore } from '@/store/useStore';
import { useSmartConnectionStore } from '@/store/useSmartConnectionStore';
import { useCatalog } from '../hooks';
import { computeLayout, offsetParallel, segments } from '@/domain/graph';
import { condIds, genderOf, hasCond, sabLabel, sabOf } from '@/domain/person';
import { CATEGORIES, categoryColor, legendCategories } from '@/data/categories';
import { PersonDrawer } from '../components/PersonDrawer';
import { GedcomImport } from '../components/GedcomImport';
import { CcdaImport } from '../components/CcdaImport';
import { SmartFhirConnect } from '../components/SmartFhirConnect';
import { PersonForm, type PersonFormState } from '../components/PersonForm';
import { HighlightBar, type HlMode } from '../components/PedigreeHighlight';
import { ClinicalBoundary } from '../components/ClinicalBoundary';
import type { Catalog } from '@/domain/catalog';
import type {
  CategoryKey,
  Condition,
  FamilyRecord,
  Gender,
  Person,
  Sab,
  TwinSet,
  Union,
} from '@/domain/types';
import type { Palette } from '@/data/categories';

/** Node glyph size, in px — natural (unscaled) size, matching the prototype's readable
 * scale. The canvas scrolls; it never shrinks nodes to fit the panel. Fed to the CSS box
 * size via the `--node-size` custom property set on `.pedigree-canvas` below, so the
 * position math here and the box size in components.css read from one number and can
 * never drift apart. */
const NODE = 44;

/** `CSSProperties` doesn't type custom properties — this narrows the cast to exactly
 * the variables the canvas sets. `--pedigree-scale` mirrors the current zoom `scale` as
 * an inherited custom property so a focus ring *inside* the scaled canvas (`.pedigree-
 * node:focus-visible`, see components.css) can divide it back out with `calc()` and stay
 * a constant on-screen width — a plain `outline-width` would otherwise shrink to ~0.6px
 * at `SCALE_MIN`. */
interface CanvasStyle extends CSSProperties {
  '--node-size': string;
  '--pedigree-scale': number;
}

/** Gap (px, on-screen) between the two parallel tracks of a consanguineous union's
 * doubled relationship line — small relative to the 44px node scale (`NODE`) so it
 * reads as one thickened/doubled bar rather than two visibly separate lines. */
const DOUBLE_LINE_GAP = 5;

/** App-driven pan/zoom transform applied to `.pedigree-canvas` as a single
 * `translate(x, y) scale(scale)` — transient view state, never persisted with the
 * record. */
interface ViewState {
  x: number;
  y: number;
  scale: number;
}

/** Never let zoom shrink so far the chart becomes unreadable, nor magnify past a
 * modest ceiling — the design deliberately keeps nodes at their natural, readable
 * size rather than treating zoom as a way to blow past it. */
const SCALE_MIN = 0.3;
const SCALE_MAX = 1.5;
const clampScale = (s: number): number => Math.min(SCALE_MAX, Math.max(SCALE_MIN, s));

/** Multiplicative step for the zoom in/out buttons and +/- keys (20% per press). */
const ZOOM_STEP = 1.2;
/** Wheel-to-zoom sensitivity for Ctrl/Cmd+wheel and trackpad pinch (which browsers report
 * as a ctrlKey wheel event) — tuned so one notch of a typical mouse wheel (~100 deltaY)
 * moves scale by roughly one `ZOOM_STEP`. */
const WHEEL_ZOOM_K = 0.0022;
/** Pixels panned per arrow-key press. */
const PAN_STEP = 60;
/** Duration of the eased transition on the Reset / Zoom to fit buttons; wheel/drag/keyboard
 * panning and zooming stay unanimated (immediate follow). Skipped entirely (snap, no
 * animation) under `prefers-reduced-motion` — see the `.pedigree-canvas--eased` CSS rule. */
const EASE_MS = 220;

/** Horizontal room left of the canvas's own x=0 reserved for the generation ▲/▼ labels
 * (`.pedigree-gen-label`, absolutely positioned at `left: -58px` relative to the canvas),
 * folded into the default view and the zoom-to-fit math so they're never panned or fitted
 * off the left edge. */
const LABEL_GUTTER = 64;

/** The view on first load and after "Reset": natural (unscaled) size, with just enough
 * left/top inset that the generation labels and the topmost node clear the viewport edge —
 * matching the old canvas's fixed padding before pan/zoom replaced native scroll. */
const DEFAULT_VIEW: ViewState = { x: LABEL_GUTTER, y: 24, scale: 1 };

/** Zoom-to-fit view: `scale = min(viewportW/contentW, viewportH/contentH)`, clamped to
 * never upscale past natural size (≤1) — per the design's "never scaled past readable
 * size" rule — then the scaled content is centred in the viewport. Pure function of the
 * measured viewport and canvas size, so it's also used for the automatic reset on record
 * swap. Falls back to {@link DEFAULT_VIEW} when either dimension isn't known yet (nothing
 * measured, or an empty canvas). */
function computeFitView(vw: number, vh: number, cw: number, ch: number): ViewState {
  const contentW = cw + LABEL_GUTTER;
  if (vw <= 0 || vh <= 0 || contentW <= 0 || ch <= 0) return DEFAULT_VIEW;
  const scale = clampScale(Math.min(vw / contentW, vh / ch, 1));
  const x = LABEL_GUTTER * scale + (vw - contentW * scale) / 2;
  const y = (vh - ch * scale) / 2;
  return { x, y, scale };
}

/** Minimal nudge (never a re-centre) that brings a node's on-screen position within the
 * viewport plus a small margin — used when a selection lands off-screen (e.g. a keyboard
 * user tabs to a node that's currently panned out of view), so they aren't left editing a
 * relative they can't see. Pure; returns `v` unchanged when the node is already visible. */
const NUDGE_MARGIN = 12;
function nudgeIntoView(
  v: ViewState,
  node: { x: number; cy: number },
  vw: number,
  vh: number,
): ViewState {
  const half = (NODE / 2) * v.scale + NUDGE_MARGIN;
  const sx = v.x + node.x * v.scale;
  const sy = v.y + node.cy * v.scale;
  let dx = 0;
  let dy = 0;
  if (sx - half < 0) dx = -(sx - half);
  else if (sx + half > vw) dx = vw - (sx + half);
  if (sy - half < 0) dy = -(sy - half);
  else if (sy + half > vh) dy = vh - (sy + half);
  return dx === 0 && dy === 0 ? v : { ...v, x: v.x + dx, y: v.y + dy };
}

const CONFIRM_LOAD_SAMPLE = 'Load the example family? This replaces your current record.';
const CONFIRM_IMPORT = 'Import this family tree? This replaces your current record.';
// Deliberately worded as an addition, not a replacement (unlike the two confirms above) —
// applyCcdaImport only ever merges onto the current record: it never removes an existing
// person or condition, so the risk being confirmed here is "adds data", not "loses data".
const CONFIRM_CCDA =
  'Import the selected items from this health record? This adds people and conditions to your current record — nothing already recorded is removed.';
// Same merge semantics and wording as CONFIRM_CCDA — the SMART-on-FHIR sync goes through the
// same staged-review merge engine (applyHealthRecordImport), it's just sourced from a live FHIR
// server instead of a downloaded C-CDA file.
const CONFIRM_SMART =
  'Import the selected items from this health record? This adds people and conditions to your current record — nothing already recorded is removed.';

/** True only for the record's untouched default shape — a single proband still named
 * "You", with no birth year and no conditions recorded. The one case where swapping it
 * out for the example family is genuinely lossless, so the empty state's own load
 * button can skip the confirmation the header button always shows. `people.length ===
 * 1` alone isn't a safe stand-in for "nothing to lose": a user can add a relative, edit
 * their own proband record, then delete the relative and land right back at one
 * (edited) person. */
function isPristineRecord(record: FamilyRecord): boolean {
  if (record.people.length !== 1) return false;
  const [p] = record.people;
  return p.name === 'You' && p.birth == null && p.conds.length === 0;
}

/** Whether a person's sex assigned at birth differs from what their gender would imply
 * by default — the 2022 NSGC annotation trigger for both the node's visual "AFAB"/
 * "AMAB" tag and its accessible name (`nodeLabel`), computed once so the two can never
 * drift apart. Deliberately excludes 'u' (not recorded): that's the untouched default
 * proband's "nothing entered yet", not a meaningful difference to flag — so this view
 * suppresses the tag where the SVG export's equivalent `sabDiff` check (no 'u' gate,
 * see `src/export/pedigree-svg.ts`) would still show one for an explicitly-recorded
 * "Unknown" sab. That's an intentional, narrow divergence between the two surfaces. */
function sabAnnotationDiffers(person: Person): boolean {
  const g = genderOf(person);
  const sab = sabOf(person);
  return (
    sab !== 'u' && ((g === 'man' && sab !== 'm') || (g === 'woman' && sab !== 'f') || g === 'nb')
  );
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance of a `#rrggbb` colour. */
function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `#rrggbb` colours. */
function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [lighter, darker] = la > lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

// Deliberately the true luminance extremes, not the theme's softer `#08121a`/`--text`
// ink tones used elsewhere: this is the one spot that must clear 4.5:1 against an
// arbitrary, unpredictable fill colour (any category × either palette), and the softer
// tones don't reliably get there. Worst case across all 14 categories × both palettes —
// the colorblind palette's "blood" fill (#C0407A) — is ~3.83:1 against `#08121a` alone
// and only ~4.09:1 against the better of `#08121a`/`--text`, both still short of 4.5:1;
// picking the better of the two true extremes clears it at ~4.94:1.
const INITIALS_DARK = '#000000';
const INITIALS_LIGHT = '#ffffff';

/** Initials colour for a filled (affected) node: whichever of black or white has
 * higher contrast against THIS fill, so every category clears 4.5:1 (WCAG 1.4.3) — a
 * single hardcoded tone didn't. */
function initialsColor(fill: string): string {
  if (!fill.startsWith('#')) return 'var(--text)';
  return contrastRatio(fill, INITIALS_DARK) >= contrastRatio(fill, INITIALS_LIGHT)
    ? INITIALS_DARK
    : INITIALS_LIGHT;
}

/** Opacity applied to a non-matching node's coloured glyph (fill + initials) under an
 * active highlight filter — never to its border or the name/years text outside the
 * button, which stay at full contrast regardless (WCAG 1.4.3). */
const DIM_OPACITY = 0.28;

/** The family pedigree: a natural-size, scrollable canvas (never scaled to fit) with a
 * Highlight control to spotlight a condition or category, plus an editing drawer for
 * the selected person. Glyphs follow 2022 NSGC notation: gender drives shape,
 * sex-assigned-at-birth is annotated when it differs. */
export function PedigreeView() {
  const record = useStore((s) => s.record);
  const palette = useStore((s) => s.palette);
  const selectedId = useStore((s) => s.selectedId);
  const selectPerson = useStore((s) => s.selectPerson);
  const loadSample = useStore((s) => s.loadSample);
  const resetRecord = useStore((s) => s.resetRecord);
  const replaceRecord = useStore((s) => s.replaceRecord);
  // Read only for the C-CDA merge below (see handleCcdaImport) — applyCcdaImport returns
  // just the newly-registered long-tail extensions from *this* import, so they must be
  // folded in alongside whatever the store already has, not swapped in wholesale (unlike
  // GEDCOM/native restore, this importer merges onto the current record rather than
  // replacing it, and the pre-existing record's own long-tail conditions still need their
  // catalog entries after the swap).
  const extensions = useStore((s) => s.extensions);
  const catalog = useCatalog();
  // Set by `completeCallbackIfPresent` (see App.tsx) when the OAuth redirect back from a
  // SMART-on-FHIR provider failed. The redirect is a full page reload, so this
  // persisted-in-store field is the only way that failure can reach the user — auto-open
  // the panel so `SmartFhirConnect`'s own callbackError rendering (role="alert") is
  // immediately visible rather than silently sitting in the store.
  const callbackError = useSmartConnectionStore((s) => s.callbackError);

  const [importing, setImporting] = useState(false);
  const [importingCcda, setImportingCcda] = useState(false);
  const [importingSmart, setImportingSmart] = useState(false);
  const [formState, setFormState] = useState<PersonFormState | null>(null);
  const [hlMode, setHlModeRaw] = useState<HlMode>('cond');
  // The active condition id (mode 'cond') or category key (mode 'cat'). The prototype
  // tracks these as two separate nullable fields, but they're never both set at
  // once — a single slot, reinterpreted by `hlMode`, makes that invariant structural
  // instead of something every setter has to remember to uphold.
  const [activeId, setActiveId] = useState<string | null>(null);

  // Auto-open the SMART-on-FHIR panel when a callback error is waiting to be shown —
  // covers both the common case (it's already set by the time this view first mounts,
  // since App.tsx resolves the callback before routing here) and the rarer case where
  // resolution finishes just after mount. Only reacts to callbackError itself flipping
  // from null to a message (dependency array), so it never fights a user who closes the
  // panel afterward while the same error is still sitting in the store.
  useEffect(() => {
    if (callbackError) setImportingSmart(true);
  }, [callbackError]);

  // A fresh install (and resetRecord()) now yields a record holding only the proband —
  // no fictional relatives. Show a friendly prompt instead of an empty tree.
  const isEmpty = record.people.length === 1;

  const titleRef = useRef<HTMLHeadingElement>(null);
  const prevIsEmpty = useRef(isEmpty);
  // Any import panel counts as "the import panel" for this focus-return purpose — only
  // one is ever open at a time (see openImporting/openImportingCcda/openImportingSmart below).
  const anyImporting = importing || importingCcda || importingSmart;
  const prevImporting = useRef(anyImporting);
  // loadSample()/resetRecord()/import swap the record without unmounting this view, so
  // whatever was focused — the header's own "Reset to empty"/"Load example family", or
  // the empty state's — can vanish out from under the user, dropping focus to <body>.
  // Same when the import panel closes (Cancel/Submit unmount it). Move focus to the stable
  // page heading on exactly those transitions: never on mount, and never when the panel
  // merely *opens* (its toggle button stays put). Add/edit doesn't need a case here —
  // PersonForm is a modal that manages its own open/close focus (see PersonForm.tsx).
  useEffect(() => {
    const emptyChanged = prevIsEmpty.current !== isEmpty;
    const importClosed = prevImporting.current && !anyImporting;
    if (emptyChanged || importClosed) titleRef.current?.focus();
    prevIsEmpty.current = isEmpty;
    prevImporting.current = anyImporting;
  }, [isEmpty, anyImporting]);

  // Deleting a person unmounts their pedigree node AND its drawer/modal in the same commit,
  // so the focus-return refs those layers captured now point at detached nodes — .focus()
  // is a no-op and focus falls to <body>. The ordinary close paths (Escape/✕/backdrop)
  // leave the node in place and hand focus back to it, so only deletion needs catching
  // here: when the prior selection clears AND that person is gone, pull focus to the
  // stable page heading (the same anchor the empty-state transition above uses).
  const prevSelectedId = useRef(selectedId);
  useEffect(() => {
    const prev = prevSelectedId.current;
    prevSelectedId.current = selectedId;
    if (prev && !selectedId && !record.people.some((p) => p.id === prev)) {
      titleRef.current?.focus();
    }
  }, [selectedId, record.people]);

  const layout = computeLayout(record.people, record.unions);
  const { pos, cw, ch, gens, minGen } = layout;
  const segs = segments(record.unions, layout.pos);
  const peopleCount = record.people.length;
  // Generation SPAN (max − min + 1), matching OverviewView's "Generations" stat — not
  // `gens.length` (the count of *occupied* generations), which diverges from Overview for
  // a disconnected graph (e.g. a GEDCOM import with isolated people), showing two
  // different "N generations" numbers for the same record on two screens.
  const genCount = layout.maxGen - layout.minGen + 1;

  // Tab order follows DOM order, not the absolute positioning below — sort by the
  // computed layout position (generation, then horizontal position) so keyboard users
  // move through the tree the way sighted users scan it, regardless of the order
  // relatives happen to sit in the underlying record (a newly-added relative is
  // appended to the array, not inserted by generation).
  const orderedPeople = [...record.people].sort(
    (a, b) => a.gen - b.gen || pos[a.id].x - pos[b.id].x,
  );

  const presentCategories = legendCategories(record.people, catalog);

  // Generation labels are anchored to the proband's own generation, not an absolute
  // "Gen 1/2/3" — the you-centric orientation the prototype used (▲ = ancestors above,
  // ▼ = descendants below). Falls back to the topmost layout generation if the proband
  // somehow isn't found, so the labels never crash on a malformed record.
  const probandGen = record.people.find((p) => p.id === record.probandId)?.gen ?? minGen;

  // Text alternative for the doubled-line/twin-diagonal notation (see `nodeLabel` and
  // `PersonPedigreeNotes`) — built once per unions/people change and handed to every
  // node, rather than each node re-scanning `record.unions` itself.
  const peopleById = new Map(record.people.map((p) => [p.id, p]));
  const pedigreeNotes = buildPedigreeNotes(record.unions, peopleById);

  // ---- Pan / zoom ----
  // Transient view state — deliberately not persisted with the record (see ViewState).
  // `scrollRef` is the fixed-size, clipped viewport (`.pedigree-scroll`, `overflow: clip`
  // — deliberately not a scroll container; see the rule's comment in components.css); the
  // transform below is applied to `.pedigree-canvas` inside it, so nodes and the SVG
  // connector overlay pan/zoom atomically in one coordinate space.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewState>(DEFAULT_VIEW);
  // Whether the *next* render should snap to an eased transition (Reset / Zoom to fit
  // buttons only — wheel/drag/keyboard panning stay unanimated so they track the input
  // 1:1). Cleared by a timeout matching `EASE_MS`; `prefers-reduced-motion` disables the
  // CSS transition entirely regardless (see `.pedigree-canvas--eased`).
  const [easing, setEasing] = useState(false);
  const easeTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (easeTimer.current != null) window.clearTimeout(easeTimer.current);
    },
    [],
  );
  const applyEasedView = (next: ViewState): void => {
    setEasing(true);
    setView(next);
    if (easeTimer.current != null) window.clearTimeout(easeTimer.current);
    easeTimer.current = window.setTimeout(() => setEasing(false), EASE_MS);
  };

  // Record swaps (load sample / reset / import) reset the view exactly like they reset
  // `activeId` et al. in `swapRecord` below — flagged here, applied by the effect after
  // the swapped record's own `cw`/`ch` have been recomputed (so the fit math below sees
  // the *new* layout, not the one being replaced). Also true on mount, so first paint
  // gets a sensible fit rather than an arbitrary 1:1 view for a large imported tree.
  const needsViewReset = useRef(true);
  useEffect(() => {
    if (!needsViewReset.current) return;
    const el = scrollRef.current;
    if (!el) return; // empty-state: no canvas mounted yet, nothing to fit against
    setView(computeFitView(el.clientWidth, el.clientHeight, cw, ch));
    needsViewReset.current = false;
  }, [cw, ch]);

  // Kept as useCallback (empty deps → stable identity): it's a dependency of the
  // non-passive native `wheel` listener effect below, so a fresh identity each render
  // would detach/reattach that listener. The compiler can't own effect-dep stability
  // the exhaustive-deps lint enforces, so this manual memo stays.
  const zoomAt = useCallback((clientX: number, clientY: number, factor: number): void => {
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    setView((v) => {
      const nextScale = clampScale(v.scale * factor);
      if (nextScale === v.scale) return v;
      // Keep the point under the cursor/centre fixed on screen across the scale change.
      const canvasX = (localX - v.x) / v.scale;
      const canvasY = (localY - v.y) / v.scale;
      return { x: localX - canvasX * nextScale, y: localY - canvasY * nextScale, scale: nextScale };
    });
  }, []);
  const zoomButton = (factor: number): void => {
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  };
  const zoomToFit = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    applyEasedView(computeFitView(el.clientWidth, el.clientHeight, cw, ch));
  };

  // Wheel: plain wheel pans, Ctrl/Cmd+wheel zooms (also how browsers report trackpad
  // pinch). Attached as a native, non-passive listener — React registers wheel handlers
  // as passive by default, which would silently swallow `preventDefault()` and let the
  // page/browser's own scroll or pinch-zoom fire alongside ours.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent): void => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * WHEEL_ZOOM_K));
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', onWheelNative);
    // `isEmpty` re-runs this when the viewport div mounts/unmounts across the empty ⇄
    // populated transition, so the listener attaches once a `scrollRef` element exists.
  }, [zoomAt, isEmpty]);

  // Pointer drag on empty canvas = pan; a drag starting on a node (or its name/years
  // label), or on the zoom-controls toolbar, is left alone so those controls' own
  // click/select behaviour keeps working undisturbed by an incidental pointer move.
  const dragRef = useRef<{ startX: number; startY: number; viewX: number; viewY: number } | null>(
    null,
  );
  const onCanvasPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('.pedigree-node-wrap') || target.closest('.pedigree-zoom-controls')) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, viewX: view.x, viewY: view.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onCanvasPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag) return;
    setView((v) => ({
      ...v,
      x: drag.viewX + (e.clientX - drag.startX),
      y: drag.viewY + (e.clientY - drag.startY),
    }));
  };
  const endCanvasDrag = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // Pan by a fixed delta — shared by the keyboard handler below and the D-pad buttons in
  // the zoom-controls toolbar, so both bindings can never drift apart.
  const panBy = (dx: number, dy: number): void => {
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };

  // Keyboard pan/zoom (WCAG 2.1.1): scoped to keydowns bubbling up through the viewport
  // (from the viewport itself or any focused node inside it), not a document-wide
  // listener — so it never fires while, say, a form field elsewhere has focus. Only the
  // keys below call preventDefault; everything else (notably Tab/Shift+Tab) passes
  // through untouched, so focus order over the pedigree nodes is unchanged. This is a
  // *supplement* to the D-pad/zoom buttons below, not the only way to reach this — a
  // screen reader in browse mode may switch Arrow keys off an interactive `role="group"`
  // before they ever reach this handler, which the button fallback covers.
  const onCanvasKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        panBy(0, PAN_STEP);
        break;
      case 'ArrowDown':
        e.preventDefault();
        panBy(0, -PAN_STEP);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        panBy(PAN_STEP, 0);
        break;
      case 'ArrowRight':
        e.preventDefault();
        panBy(-PAN_STEP, 0);
        break;
      case '+':
      case '=':
        e.preventDefault();
        zoomButton(ZOOM_STEP);
        break;
      case '-':
      case '_':
        e.preventDefault();
        zoomButton(1 / ZOOM_STEP);
        break;
      case '0':
        e.preventDefault();
        applyEasedView(DEFAULT_VIEW);
        break;
    }
  };

  // Nudge (never a re-centre) a person's node into view when it's off-screen — shared by
  // the selection effect below (covers a click/Enter select, and any future programmatic
  // selection) and `onNodeFocus` (covers plain Tab focus with no selection change, e.g. a
  // sighted keyboard user tabbing past a node that's currently panned out of the
  // clipped viewport with no visible focus indicator — WCAG 2.4.7). This is the sole
  // mechanism that reveals an off-screen focused node: the viewport is `overflow: clip`,
  // so the browser's own native scroll-into-view can't (and must not) do it. Reads `pos`
  // via a ref rather than a dependency, so callers don't re-create this every layout pass.
  const posRef = useRef(pos);
  useEffect(() => {
    posRef.current = pos;
  });
  // Kept as useCallback (empty deps → stable identity, reading `pos` via posRef): it's a
  // dependency of the selection-nudge effect below, so a fresh identity each render would
  // re-fire that effect on every render. Effect-dep stability the exhaustive-deps lint
  // enforces isn't something the compiler owns, so this manual memo stays.
  const nudgeToPerson = useCallback((id: string): void => {
    const node = posRef.current[id];
    const el = scrollRef.current;
    if (!node || !el) return;
    setView((v) => nudgeIntoView(v, node, el.clientWidth, el.clientHeight));
  }, []);
  // data-person-id (set on the node button, see PedigreeNode) lets this single delegated
  // handler identify which node focused without threading a per-node onFocus closure
  // through the memoized PedigreeNode's props.
  const onNodeFocus = (e: ReactFocusEvent<HTMLDivElement>): void => {
    const id = (e.target as HTMLElement).dataset.personId;
    if (id) nudgeToPerson(id);
  };

  useEffect(() => {
    if (!selectedId) return;
    nudgeToPerson(selectedId);
  }, [selectedId, nudgeToPerson]);

  // The payoff of category-highlight mode (restored from the prototype): a plain-language
  // breakdown of what the spotlit category actually contains — "N relatives · 2× Breast
  // cancer, 1× Colorectal cancer". Only meaningful with a category chip active.
  const catBreakdown =
    hlMode === 'cat' && activeId != null
      ? categoryBreakdown(record.people, catalog, activeId as CategoryKey)
      : null;

  const setHlMode = (m: HlMode): void => {
    setHlModeRaw(m);
    setActiveId(null);
  };
  const toggleChip = (id: string): void => {
    setActiveId((cur) => (cur === id ? null : id));
  };
  const highlightCondition = (id: string): void => {
    setHlModeRaw('cond');
    setActiveId(id);
  };
  const clearHighlight = (): void => setActiveId(null);

  const hlActive = activeId != null;
  let hlColor: string | null = null;
  if (activeId != null) {
    hlColor =
      hlMode === 'cat'
        ? categoryColor(activeId as CategoryKey, palette)
        : categoryColor(catalog.get(activeId).cat, palette);
  }
  const nodeMatches = (p: Person): boolean => {
    if (activeId == null) return false;
    if (hlMode === 'cat') return condIds(p).some((id) => catalog.get(id).cat === activeId);
    return hasCond(p, activeId);
  };

  // loadSample()/resetRecord()/import swap the whole record without unmounting this view,
  // so the local highlight/form/import state above must be cleared on every swap —
  // otherwise a stale `activeId` outlives the record it was computed against (nothing in
  // the new record matches it, so the whole tree dims with no chip showing as active), a
  // stale PersonForm `anchor`/`id` can mis-attach to or edit a person from the old record,
  // and the import panel would linger. Every record-swap entry point — the header buttons,
  // the empty state's own loader, and GEDCOM import — routes through this helper. The pan/
  // zoom view gets the same treatment: flag it for the fit-on-next-layout effect above
  // rather than resetting it here directly, since this record's new `cw`/`ch` haven't been
  // computed yet at this point in the swap.
  const swapRecord = (action: () => void): void => {
    action();
    setActiveId(null);
    setFormState(null);
    setImporting(false);
    setImportingCcda(false);
    setImportingSmart(false);
    needsViewReset.current = true;
  };

  // Toggle the import panel. Add/edit is a blocking modal (not a header panel), so there's
  // no sibling panel to close here. The three importers are mutually exclusive — opening one
  // closes the other two, so only one panel is ever visible in the header at a time.
  const openImporting = (): void => {
    setImporting((v) => !v);
    setImportingCcda(false);
    setImportingSmart(false);
  };
  const openImportingCcda = (): void => {
    setImportingCcda((v) => !v);
    setImporting(false);
    setImportingSmart(false);
  };
  const openImportingSmart = (): void => {
    setImportingSmart((v) => !v);
    setImporting(false);
    setImportingCcda(false);
  };

  const handleLoadSample = (): void => {
    if (window.confirm(CONFIRM_LOAD_SAMPLE)) swapRecord(loadSample);
  };
  const handleResetToEmpty = (): void => {
    if (window.confirm('Reset to empty? This removes everyone but you.')) {
      swapRecord(resetRecord);
    }
  };
  // `isEmpty` (people.length === 1) means "just the proband", not "nothing to lose" —
  // see isPristineRecord. Only skip the confirmation when the record is still the
  // untouched default; otherwise prompt exactly like the header button does.
  const handleEmptyLoadSample = (): void => {
    if (isPristineRecord(record) || window.confirm(CONFIRM_LOAD_SAMPLE)) swapRecord(loadSample);
  };
  // GEDCOM import replaces the whole record, so it gets the same destructive-swap guard as
  // "Load example family" — skipped only when the record is still the untouched default.
  const handleGedcomImport = (imported: FamilyRecord): void => {
    if (isPristineRecord(record) || window.confirm(CONFIRM_IMPORT)) {
      swapRecord(() => replaceRecord(imported));
    }
  };
  // C-CDA import MERGES onto the current record (see CcdaImport's doc comment) rather than
  // replacing it, so this never takes the isPristineRecord short-circuit the two swaps
  // above use — that guard exists to skip confirming a *lossless* replace, which isn't the
  // shape of the decision being confirmed here. The new extensions are folded in alongside
  // whatever the store already has (see the `extensions` selector above) so a pre-existing
  // long-tail condition elsewhere in the record keeps its catalog entry after the merge.
  const handleCcdaImport = (merged: FamilyRecord, newExtensions: Condition[]): void => {
    if (window.confirm(CONFIRM_CCDA)) {
      swapRecord(() =>
        replaceRecord(
          merged,
          [...extensions, ...newExtensions],
          'Imported from health record (C-CDA)',
        ),
      );
    }
  };
  // SMART-on-FHIR sync goes through the same source-agnostic merge engine as C-CDA (see
  // SmartFhirConnect's own doc comment) — same MERGE semantics, same extensions-folding
  // reasoning as handleCcdaImport above, just a different provenance label.
  const handleSmartImport = (merged: FamilyRecord, newExtensions: Condition[]): void => {
    if (window.confirm(CONFIRM_SMART)) {
      swapRecord(() =>
        replaceRecord(
          merged,
          [...extensions, ...newExtensions],
          'Imported from health record (SMART on FHIR)',
        ),
      );
    }
  };

  const canvasStyle: CanvasStyle = {
    width: cw,
    height: ch,
    '--node-size': `${NODE}px`,
    '--pedigree-scale': view.scale,
    // Single atomic transform — node divs and the SVG overlay are both children of this
    // element, so they pan/zoom together in one coordinate space (see ViewState).
    transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
    transformOrigin: '0 0',
  };
  const zoomPct = Math.round(view.scale * 100);

  return (
    // Plain positioning wrapper — App already renders <main className="main"> around every
    // view, so this must not carry the .main class too (that would stack two identical flex
    // containers). It still needs the .main layout properties inlined so the pinned header +
    // scrollable canvas below and the drawer's height:100% overlay behave exactly as before.
    <div
      style={{
        position: 'relative',
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div className="pedigree-header">
        <div className="page-head">
          <div className="page-head__main">
            <h1 className="page-title" tabIndex={-1} ref={titleRef}>
              Family Pedigree
            </h1>
            {!isEmpty && (
              <span className="mono-dim">
                {peopleCount} {peopleCount === 1 ? 'person' : 'people'} · {genCount}{' '}
                {genCount === 1 ? 'generation' : 'generations'}
              </span>
            )}
          </div>
          {/* The empty state below has its own, more prominent "+ Add relative" /
              "Load example family" affordances, so this cluster only adds value once
              there's a tree to manage — showing both here and there would be redundant. */}
          {!isEmpty && (
            <div className="page-head__actions">
              {/* The rarely-used trio (import / load sample / reset) collapses behind one
                  overflow control so "+ add relative" — the one action most people reach
                  for — reads as the row's actual primary, matching its .btn--primary
                  styling instead of competing visually with three equally-weighted peers. */}
              <RecordActionsMenu
                importing={importing}
                onToggleImport={openImporting}
                importingCcda={importingCcda}
                onToggleImportCcda={openImportingCcda}
                importingSmart={importingSmart}
                onToggleImportSmart={openImportingSmart}
                onLoadSample={handleLoadSample}
                onResetToEmpty={handleResetToEmpty}
              />
              <button
                type="button"
                className="btn btn--primary btn--sm"
                aria-haspopup="dialog"
                onClick={() =>
                  setFormState({ mode: 'add', anchor: record.probandId, relation: 'child' })
                }
              >
                + add relative
              </button>
            </div>
          )}
        </div>
        <ClinicalBoundary />

        {importing && (
          <GedcomImport onImport={handleGedcomImport} onCancel={() => setImporting(false)} />
        )}
        {importingCcda && (
          <CcdaImport
            record={record}
            catalog={catalog}
            onImport={handleCcdaImport}
            onCancel={() => setImportingCcda(false)}
          />
        )}
        {importingSmart && (
          <SmartFhirConnect
            record={record}
            catalog={catalog}
            onImport={handleSmartImport}
            onCancel={() => setImportingSmart(false)}
          />
        )}

        {/* The notation key and the Highlight controls share one row — two small pieces
            of chart chrome that both fit comfortably alongside each other, rather than
            each claiming a full-width row of their own before the canvas even starts. */}
        <div className="pedigree-toolbar">
          {!isEmpty && (
            <HighlightBar
              mode={hlMode}
              onSetMode={setHlMode}
              activeId={activeId}
              onToggleChip={toggleChip}
              onHighlightCondition={highlightCondition}
              onClear={clearHighlight}
              people={record.people}
              catalog={catalog}
              palette={palette}
            />
          )}
          {/* The notation key is reference material a frequent user already knows, so it
              sits in a disclosure collapsed by default rather than as a permanent
              paragraph — one small toggle instead of three lines of chrome, still one
              click away for anyone learning to read the chart. */}
          <details className="pedigree-guide" style={{ margin: 0 }}>
            <summary className="pedigree-guide__toggle">How to read this pedigree</summary>
            <p className="pedigree-guide__text">
              2022 gender-inclusive notation — circle = woman, square = man, diamond = nonbinary;
              sex assigned at birth is noted when it differs. Filled = affected, coloured by
              condition category; diagonal = deceased. A doubled line marks a consanguineous union;
              converging diagonal lines mark a twin/multiple-birth set, with a horizontal bar for
              identical (monozygotic) twins. Click any relative to view or edit their record.
            </p>
          </details>
        </div>
        {catBreakdown && (
          <p className="mono-dim" role="status" style={{ marginTop: 8, lineHeight: 1.5 }}>
            {catBreakdown}
          </p>
        )}
      </div>

      <div className="pedigree-body">
        {isEmpty ? (
          <EmptyState
            onAdd={() => setFormState({ mode: 'add', anchor: record.probandId, relation: 'child' })}
            onEditSelf={() => setFormState({ mode: 'edit', id: record.probandId })}
            importing={importing}
            onImport={openImporting}
            importingCcda={importingCcda}
            onImportCcda={openImportingCcda}
            importingSmart={importingSmart}
            onImportSmart={openImportingSmart}
            onLoadSample={handleEmptyLoadSample}
          />
        ) : (
          <div
            className="pedigree-scroll"
            ref={scrollRef}
            tabIndex={0}
            role="group"
            aria-label="Pedigree pan and zoom viewport. Drag or use arrow keys to pan; plus, minus, and 0 to zoom in, out, and reset."
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={endCanvasDrag}
            onPointerCancel={endCanvasDrag}
            onKeyDown={onCanvasKeyDown}
          >
            <div
              className="pedigree-zoom-controls"
              role="group"
              aria-label="Pedigree zoom controls"
            >
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => zoomButton(1 / ZOOM_STEP)}
              >
                <span aria-hidden="true">−</span>
                <span className="visually-hidden">Zoom out</span>
              </button>
              {/* Visible text readout (not colour/icon-only, WCAG 1.4.1) of the current zoom
                  level; not a live region — wheel/drag zooming fires this constantly, and
                  announcing every intermediate percentage would be noise for screen-reader
                  users. The buttons' own labels already say what each does. */}
              <span className="pedigree-zoom-readout">{zoomPct}%</span>
              <button type="button" className="btn btn--sm" onClick={() => zoomButton(ZOOM_STEP)}>
                <span aria-hidden="true">+</span>
                <span className="visually-hidden">Zoom in</span>
              </button>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => applyEasedView(DEFAULT_VIEW)}
              >
                Reset
              </button>
              <button type="button" className="btn btn--sm" onClick={zoomToFit}>
                Zoom to fit
              </button>
              {/* Button-operable pan fallback for the Arrow-key handler on the viewport
                  below: a screen reader in browse mode can switch Arrow keys off before
                  they ever reach a `role="group"` element's own keydown handler, so
                  panning needs a button-based path too (mirrors the zoom buttons already
                  covering +/-/0). Same `PAN_STEP` delta as the keyboard bindings, via the
                  shared `panBy`. */}
              <div className="pedigree-pan-dpad" role="group" aria-label="Pan pedigree">
                <button
                  type="button"
                  className="btn btn--sm pedigree-pan-dpad__btn pedigree-pan-dpad__btn--up"
                  onClick={() => panBy(0, PAN_STEP)}
                >
                  <span aria-hidden="true">▲</span>
                  <span className="visually-hidden">Pan up</span>
                </button>
                <button
                  type="button"
                  className="btn btn--sm pedigree-pan-dpad__btn pedigree-pan-dpad__btn--left"
                  onClick={() => panBy(PAN_STEP, 0)}
                >
                  <span aria-hidden="true">◀</span>
                  <span className="visually-hidden">Pan left</span>
                </button>
                <button
                  type="button"
                  className="btn btn--sm pedigree-pan-dpad__btn pedigree-pan-dpad__btn--right"
                  onClick={() => panBy(-PAN_STEP, 0)}
                >
                  <span aria-hidden="true">▶</span>
                  <span className="visually-hidden">Pan right</span>
                </button>
                <button
                  type="button"
                  className="btn btn--sm pedigree-pan-dpad__btn pedigree-pan-dpad__btn--down"
                  onClick={() => panBy(0, -PAN_STEP)}
                >
                  <span aria-hidden="true">▼</span>
                  <span className="visually-hidden">Pan down</span>
                </button>
              </div>
            </div>
            <div
              className={`pedigree-canvas${easing ? ' pedigree-canvas--eased' : ''}`}
              role="group"
              aria-label="Family pedigree chart"
              style={canvasStyle}
              onFocus={onNodeFocus}
            >
              <svg
                width={cw}
                height={ch}
                style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}
                aria-hidden="true"
                pointerEvents="none"
              >
                {segs.flatMap((s, i) => {
                  // A consanguineous union's relationship line draws doubled (two parallel
                  // tracks) per 2022 NSGC/Bennett notation; every other segment — sibship
                  // lines, lines of descent, and the twin diagonals/mono bar `segments()`
                  // already emits — renders exactly as before, unfiltered.
                  if (s.double) {
                    return offsetParallel(s, DOUBLE_LINE_GAP).map((ss, j) => (
                      <line
                        key={`${i}-${j}`}
                        x1={ss.x1}
                        y1={ss.y1}
                        x2={ss.x2}
                        y2={ss.y2}
                        stroke="#6b7280"
                        strokeWidth={1.3}
                      />
                    ));
                  }
                  return [
                    <line
                      key={i}
                      x1={s.x1}
                      y1={s.y1}
                      x2={s.x2}
                      y2={s.y2}
                      stroke="#6b7280"
                      strokeWidth={1.3}
                    />,
                  ];
                })}
              </svg>
              {gens.map((g) => {
                const rep = record.people.find((p) => p.gen === g);
                if (!rep) return null;
                const diff = g - probandGen;
                const label = diff === 0 ? 'YOU' : diff < 0 ? `▲ ${Math.abs(diff)}` : `▼ ${diff}`;
                return (
                  <div
                    key={g}
                    className="pedigree-gen-label"
                    aria-hidden="true"
                    style={{ top: pos[rep.id].y + 14 }}
                  >
                    {label}
                  </div>
                );
              })}
              {orderedPeople.map((p) => (
                <PedigreeNode
                  key={p.id}
                  person={p}
                  x={pos[p.id].x}
                  cy={pos[p.id].cy}
                  selected={p.id === selectedId}
                  proband={p.id === record.probandId}
                  probandGen={probandGen}
                  catalog={catalog}
                  palette={palette}
                  hlActive={hlActive}
                  matches={hlActive && nodeMatches(p)}
                  hlColor={hlColor}
                  notes={pedigreeNotes.get(p.id)}
                  onSelect={selectPerson}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {!isEmpty && presentCategories.length > 0 && (
        <div className="pedigree-footer">
          <h2 className="overline" style={{ display: 'block', marginBottom: 8 }}>
            Legend
          </h2>
          <CategoryLegend categories={presentCategories} palette={palette} />
        </div>
      )}

      {/* key remounts the drawer per person so its local edit/search state never bleeds across selections. */}
      {selectedId && (
        <PersonDrawer key={selectedId} personId={selectedId} onOpenForm={(s) => setFormState(s)} />
      )}

      {/* key remounts the modal per open request, so its local field state can never
          carry over from one add/edit into the next (see PersonForm's own mount-time
          initialization). */}
      {formState && (
        <PersonForm key={formKey(formState)} state={formState} onClose={() => setFormState(null)} />
      )}
    </div>
  );
}

/** Stable per-open-request key for {@link PersonForm} — see the render call site. */
function formKey(state: PersonFormState): string {
  return state.mode === 'edit' ? `edit:${state.id}` : `add:${state.anchor}:${state.relation}`;
}

/** Shown when the record holds only the proband — never auto-loads the fictional
 * example family; the user opts in explicitly. */
function EmptyState({
  onAdd,
  onEditSelf,
  importing,
  onImport,
  importingCcda,
  onImportCcda,
  importingSmart,
  onImportSmart,
  onLoadSample,
}: {
  onAdd: () => void;
  onEditSelf: () => void;
  /** Whether each import panel is currently open — mirrors the trio of `aria-expanded`
   * toggles `RecordActionsMenu` already gets right (see that component, below); these
   * three buttons open the exact same panels and were missing the same treatment
   * (WCAG 4.1.2). */
  importing: boolean;
  onImport: () => void;
  importingCcda: boolean;
  onImportCcda: () => void;
  importingSmart: boolean;
  onImportSmart: () => void;
  onLoadSample: () => void;
}) {
  return (
    <div className="pedigree-empty">
      <h2 style={{ fontSize: 17, fontWeight: 600 }}>Start your family history</h2>
      <p style={{ fontSize: 13, color: 'var(--text-dim)', maxWidth: 380, lineHeight: 1.5 }}>
        Add relatives one at a time — parents, siblings, children — fill in your own details first,
        import a family tree you already have (GEDCOM, e.g. from Ancestry), bring in your own
        conditions and family history from a health record (C-CDA, from your patient portal), or
        connect directly to your patient portal (SMART on FHIR). Stemma looks for hereditary
        patterns as the tree grows.
      </p>
      <div className="row wrap" style={{ gap: 10, marginTop: 6 }}>
        <button type="button" className="btn btn--primary" aria-haspopup="dialog" onClick={onAdd}>
          + Add relative
        </button>
        <button type="button" className="btn" aria-haspopup="dialog" onClick={onEditSelf}>
          Edit your details
        </button>
        <button type="button" className="btn" aria-expanded={importing} onClick={onImport}>
          Import GEDCOM
        </button>
        <button type="button" className="btn" aria-expanded={importingCcda} onClick={onImportCcda}>
          Import health record
        </button>
        <button
          type="button"
          className="btn"
          aria-expanded={importingSmart}
          onClick={onImportSmart}
        >
          Connect a health record (SMART on FHIR)
        </button>
        <button type="button" className="btn" onClick={onLoadSample}>
          Load example family
        </button>
      </div>
    </div>
  );
}

/**
 * Overflow menu for the header's rarely-used record-level actions (GEDCOM import, load
 * the example family, reset to empty) — collapsed behind one trigger so "+ add relative"
 * is the row's only immediately-visible action. Deliberately mirrors HighlightBar's own
 * popover discipline (focus the first item on open; outside pointerdown, Escape, or a
 * keyboard Tab out of the popover all close it; a selection closes and returns focus to
 * the trigger) rather than introducing a new interaction pattern or full ARIA-menu
 * semantics this codebase doesn't otherwise use.
 */
function RecordActionsMenu({
  importing,
  onToggleImport,
  importingCcda,
  onToggleImportCcda,
  importingSmart,
  onToggleImportSmart,
  onLoadSample,
  onResetToEmpty,
}: {
  importing: boolean;
  onToggleImport: () => void;
  importingCcda: boolean;
  onToggleImportCcda: () => void;
  importingSmart: boolean;
  onToggleImportSmart: () => void;
  onLoadSample: () => void;
  onResetToEmpty: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) firstItemRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const closeToTrigger = (): void => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const runAndClose = (action: () => void): void => {
    action();
    closeToTrigger();
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn--sm"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        More actions <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          className="pedigree-hl-search-popover"
          role="dialog"
          aria-label="More record actions"
          tabIndex={-1}
          style={{ width: 210, display: 'flex', flexDirection: 'column', gap: 4 }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              closeToTrigger();
            }
          }}
          onBlur={(e) => {
            // Tab out of the popover (not Escape, not a click on a row) — just close, since
            // focus is already moving on under the browser's own control; mirrors
            // HighlightPopover's onDismiss vs. onClose distinction.
            if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
          }}
        >
          <button
            ref={firstItemRef}
            type="button"
            className="btn btn--sm"
            style={{ justifyContent: 'flex-start' }}
            aria-expanded={importing}
            onClick={() => runAndClose(onToggleImport)}
          >
            {importing ? '✕ close import' : 'Import GEDCOM'}
          </button>
          <button
            type="button"
            className="btn btn--sm"
            style={{ justifyContent: 'flex-start' }}
            aria-expanded={importingCcda}
            onClick={() => runAndClose(onToggleImportCcda)}
          >
            {importingCcda ? '✕ close import' : 'Import health record'}
          </button>
          <button
            type="button"
            className="btn btn--sm"
            style={{ justifyContent: 'flex-start' }}
            aria-expanded={importingSmart}
            onClick={() => runAndClose(onToggleImportSmart)}
          >
            {importingSmart ? '✕ close connect' : 'Connect health record (FHIR)'}
          </button>
          <button
            type="button"
            className="btn btn--sm"
            style={{ justifyContent: 'flex-start' }}
            onClick={() => runAndClose(onLoadSample)}
          >
            Load example family
          </button>
          <button
            type="button"
            className="btn btn--sm btn--danger"
            style={{ justifyContent: 'flex-start' }}
            onClick={() => runAndClose(onResetToEmpty)}
          >
            Reset to empty
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Plain-language breakdown of one category across the family, e.g. "3 people · Breast
 * cancer (2), Colorectal cancer (1)" (restored from the prototype's `catBreakdown`). The
 * lead count is people with *any* condition in the category (deduped per person, so it
 * matches the highlight chip's count); each trailing `(n)` is the number of people
 * carrying that specific condition. Conditions are sorted most-common-first, then by name.
 * Returns null when the category isn't present (nothing to spell out).
 *
 * "people", not "relatives": this counts everyone in the record including the proband
 * (matching `categoryChipsFor`'s chip count, which the lead number must equal) — and in
 * this codebase "relative" specifically excludes the proband (see `OverviewView`'s
 * `relCount` and the domain engine's `blood` filter), so calling the proband a relative
 * would be wrong.
 *
 * The count is deliberately a trailing `(n)`, not the prototype's `n×` prefix: this is a
 * family-history headcount, and a leading `2×` on a condition name reads too close to a
 * "2× the risk" multiplier — the exact manufactured-number notation Stemma retired
 * (guardrail #1, ADR-004). The parenthetical keeps it unambiguously a count.
 */
function categoryBreakdown(people: Person[], catalog: Catalog, cat: CategoryKey): string | null {
  const per = new Map<string, number>();
  let count = 0;
  for (const p of people) {
    const ids = condIds(p).filter((id) => catalog.get(id).cat === cat);
    if (ids.length > 0) count += 1;
    for (const id of ids) per.set(id, (per.get(id) ?? 0) + 1);
  }
  if (per.size === 0) return null;
  const parts = [...per.entries()]
    .sort(
      ([aId, aCount], [bId, bCount]) =>
        bCount - aCount || catalog.get(aId).name.localeCompare(catalog.get(bId).name),
    )
    .map(([id, n]) => `${catalog.get(id).name} (${n})`);
  return `${count} ${count === 1 ? 'person' : 'people'} · ${parts.join(', ')}`;
}

/** Per-person text alternative for the two union-level pedigree-structure notations that
 * are otherwise drawn purely as connector geometry (a doubled relationship line, a
 * converging-diagonal/bar twin group) — folded into `nodeLabel`'s accessible name so
 * neither fact is colour/shape-only (WCAG 1.1.1). */
interface PersonPedigreeNotes {
  /** This person's twin/multiple-birth membership, if any. A person belongs to at most
   * one `TwinSet` (domain-enforced), so this is a single fact, not a list. */
  twin?: { zygosity: TwinSet['zygosity']; withNames: string[] };
  /** Names of every co-parent this person shares a *consanguineous* union with. Usually
   * empty or one name; more than one only if this person has multiple consanguineous
   * unions. */
  consanguineousWith: string[];
}

/** Builds {@link PersonPedigreeNotes} for every person with at least one fact to report,
 * from the record's unions — one pass, shared by every node's `nodeLabel` call rather
 * than each node re-scanning `unions` itself. Pure; a person absent from the map has
 * neither fact. */
function buildPedigreeNotes(
  unions: Union[],
  peopleById: Map<string, Person>,
): Map<string, PersonPedigreeNotes> {
  const notes = new Map<string, PersonPedigreeNotes>();
  const forPerson = (id: string): PersonPedigreeNotes => {
    let n = notes.get(id);
    if (!n) {
      n = { consanguineousWith: [] };
      notes.set(id, n);
    }
    return n;
  };
  for (const u of unions) {
    if (u.consanguineous === true) {
      for (const pid of u.parents) {
        for (const otherId of u.parents) {
          if (otherId === pid) continue;
          const name = peopleById.get(otherId)?.name;
          if (name) forPerson(pid).consanguineousWith.push(name);
        }
      }
    }
    for (const ts of u.twins ?? []) {
      for (const id of ts.members) {
        // Domain-enforced (member of at most one TwinSet); defensive first-wins guard so
        // a malformed record can't overwrite an already-assigned note.
        if (forPerson(id).twin) continue;
        const withNames = ts.members
          .filter((m) => m !== id)
          .map((m) => peopleById.get(m)?.name)
          .filter((n): n is string => n != null);
        forPerson(id).twin = { zygosity: ts.zygosity, withNames };
      }
    }
  }
  return notes;
}

/** Visible category-colour key so fill hue is never the only signal (WCAG 1.4.1). */
function CategoryLegend({ categories, palette }: { categories: CategoryKey[]; palette: Palette }) {
  if (categories.length === 0) return null;
  return (
    <ul className="pedigree-legend" role="list" aria-label="Condition category legend">
      {categories.map((cat) => (
        <li className="pedigree-legend__item" role="listitem" key={cat}>
          <span
            className="pedigree-legend__swatch"
            aria-hidden="true"
            style={{ background: categoryColor(cat, palette) }}
          />
          {CATEGORIES[cat].label}
        </li>
      ))}
    </ul>
  );
}

/** Accessible name for a pedigree node — everything a sighted user reads visually
 * (deceased/birth years, the sex-assigned-at-birth annotation, the proband's "you" tag,
 * every condition, and highlight-match state) folded into one sentence, since all of
 * that is otherwise conveyed only by `aria-hidden` glyphs/text or colour alone (WCAG
 * 1.1.1 / 1.4.1). Every condition is named, not just the first — an active highlight
 * can match on any of a person's conditions (e.g. their second), and naming only the
 * first would silently fail to say why a match lit up. The you-centric generation
 * orientation the ▲/▼ row labels give sighted users (aria-hidden decorative) is folded in
 * here too, so a screen-reader user gets the same "N generations above/below you" cue.
 * `notes` (see {@link PersonPedigreeNotes}) is the text alternative for the doubled
 * consanguineous-union line and the twin-diagonal/bar notation — both otherwise pure
 * connector geometry with no text equivalent (WCAG 1.1.1). */
function nodeLabel(
  person: Person,
  catalog: Catalog,
  hlActive: boolean,
  matches: boolean,
  proband: boolean,
  probandGen: number,
  notes: PersonPedigreeNotes | undefined,
): string {
  const parts: string[] = [person.name];
  if (proband) {
    parts.push('you');
  } else {
    // Same you-centric orientation as the ▲/▼ generation-row labels (which are
    // aria-hidden). Lower `gen` is older, so a negative diff is an ancestor generation.
    const diff = person.gen - probandGen;
    if (diff === 0) parts.push('your generation');
    else {
      const n = Math.abs(diff);
      parts.push(`${n} generation${n === 1 ? '' : 's'} ${diff < 0 ? 'above' : 'below'} you`);
    }
  }

  if (person.dead) {
    parts.push(`died ${person.death ?? 'unknown year'}`);
    if (person.birth != null) parts.push(`born ${person.birth}`);
  } else if (person.birth != null) {
    parts.push(`born ${person.birth}`);
  }

  if (sabAnnotationDiffers(person)) {
    parts.push(`sex assigned at birth ${sabLabel(sabOf(person))}`);
  }

  if (notes?.consanguineousWith.length) {
    parts.push(`consanguineous union with ${notes.consanguineousWith.join(', ')}`);
  }
  if (notes?.twin) {
    const zygosityWord = notes.twin.zygosity === 'mono' ? 'identical' : 'fraternal';
    const withClause = notes.twin.withNames.length
      ? ` with ${notes.twin.withNames.join(', ')}`
      : '';
    parts.push(`twin (${zygosityWord})${withClause}`);
  }

  const ids = condIds(person);
  if (ids.length === 0) {
    parts.push('unaffected');
  } else {
    // Every condition's category is folded in here, not just the first (i === 0 used to
    // gate this) — an active highlight can match on any one of a person's conditions, and
    // silently dropping the category for everything past the first would leave a screen
    // reader user unable to tell why a match on their second/third condition lit up.
    const names = ids.map((id) => {
      const meta = catalog.get(id);
      return `${meta.name} (${CATEGORIES[meta.cat].label.toLowerCase()})`;
    });
    parts.push(`affected: ${names.join(', ')}`);
  }

  const base = parts.join(', ');
  return hlActive && matches ? `${base}, highlighted` : base;
}

interface NodeProps {
  person: Person;
  x: number;
  cy: number;
  selected: boolean;
  proband: boolean;
  probandGen: number;
  catalog: Catalog;
  palette: Palette;
  hlActive: boolean;
  matches: boolean;
  hlColor: string | null;
  /** Text alternative for this person's consanguineous-union/twin membership, if any —
   * see {@link PersonPedigreeNotes}. */
  notes: PersonPedigreeNotes | undefined;
  onSelect: (id: string) => void;
}

/** A single pedigree glyph, absolutely positioned at natural size. `onSelect` is the
 * store's `selectPerson` action directly (already stable) rather than a per-node
 * closure — the React Compiler memoizes each node's props/render, so re-renders are
 * still skipped for nodes whose visual state didn't actually change. */
function PedigreeNode({
  person,
  x,
  cy,
  selected,
  proband,
  probandGen,
  catalog,
  palette,
  hlActive,
  matches,
  hlColor,
  notes,
  onSelect,
}: NodeProps) {
  const g: Gender = genderOf(person);
  const sab: Sab = sabOf(person);
  const shape: 'circle' | 'square' | 'diamond' =
    g === 'woman' ? 'circle' : g === 'nb' ? 'diamond' : 'square';
  const ids = condIds(person);
  const affected = ids.length > 0;

  // Affected = filled with the first condition's category colour; unaffected = outline
  // only. Condition dots (below) separately show every category the person carries.
  const fill = affected ? categoryColor(catalog.get(ids[0]).cat, palette) : 'transparent';
  const initColor = affected ? initialsColor(fill) : 'var(--text)';
  const border = selected ? 'var(--accent)' : proband ? 'var(--text)' : '#6b7280';
  const borderWidth = selected || proband ? 2.5 : 1.5;
  const ring = selected
    ? '0 0 0 3px rgba(111,168,255,0.35)'
    : matches && hlColor
      ? `0 0 0 3px ${hlColor}66`
      : proband
        ? '0 0 0 3px rgba(52,226,207,0.25)'
        : undefined;

  const sabDiffers = sabAnnotationDiffers(person);
  const years = person.dead
    ? `${person.birth ?? '?'}–${person.death ?? '?'}`
    : person.birth != null
      ? `b.${person.birth}`
      : '';
  const dots = ids.slice(0, 4).map((id) => categoryColor(catalog.get(id).cat, palette));
  const extraConditions = ids.length - dots.length;
  const dimmed = hlActive && !matches;
  const label = nodeLabel(person, catalog, hlActive, matches, proband, probandGen, notes);
  // Hover-only title cues so category is never colour-only at the glyph itself (WCAG
  // 1.4.1) — a supplementary channel alongside the always-visible footer legend and the
  // full accessible name above; the node is too small (44px) for permanent visible text
  // without real clutter, which is the opposite of this pass's goal. "Hover-only", not
  // "hover/focus": the spans carrying `title` below are aria-hidden with no tabindex, so
  // they're never in the focus order and a native title tooltip cannot appear on keyboard
  // focus — only a mouse hover (or touch long-press) reaches it.
  const fillTitle = affected ? CATEGORIES[catalog.get(ids[0]).cat].label : undefined;
  const dotsTitle =
    dots.length > 0
      ? [...new Set(ids.map((id) => catalog.get(id).cat))]
          .map((cat) => CATEGORIES[cat].label)
          .join(', ')
      : undefined;

  return (
    <div className="pedigree-node-wrap" style={{ left: x - NODE / 2, top: cy - NODE / 2 }}>
      <button
        type="button"
        className="pedigree-node"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={selected}
        // Read by the delegated `onNodeFocus` handler on `.pedigree-canvas` (see
        // PedigreeView) to nudge a Tab-focused, panned-out-of-view node back into the
        // viewport (WCAG 2.4.7) — cheaper than threading a per-node onFocus closure
        // through this memoized component's props.
        data-person-id={person.id}
        onClick={() => onSelect(person.id)}
        style={{
          borderRadius: shape === 'circle' ? '50%' : 7,
          transform: shape === 'diamond' ? 'rotate(45deg)' : undefined,
          border: `${borderWidth}px solid ${border}`,
          boxShadow: ring,
        }}
      >
        {/* Only the coloured glyph — fill + initials — de-emphasizes under a highlight
            filter (WCAG 1.4.3): the border above and the name/years below always stay
            full-contrast, so a dimmed relative's identity and shape stay legible; only
            "does this person match the current highlight" fades. */}
        <span
          aria-hidden="true"
          className="pedigree-node__fill"
          title={fillTitle}
          style={{
            borderRadius: shape === 'circle' ? '50%' : 7,
            background: fill,
            opacity: dimmed ? DIM_OPACITY : 1,
          }}
        />
        <span
          aria-hidden="true"
          className="pedigree-node__init"
          style={{
            color: initColor,
            opacity: dimmed ? DIM_OPACITY : 1,
            transform: shape === 'diamond' ? 'rotate(-45deg)' : undefined,
          }}
        >
          {person.name.slice(0, 2)}
        </span>
      </button>
      {person.dead && <span aria-hidden="true" className="pedigree-node__slash" />}
      {dots.length > 0 && (
        <span aria-hidden="true" className="pedigree-node__dots" title={dotsTitle}>
          {dots.map((c, i) => (
            <span key={i} className="pedigree-node__dot" style={{ background: c }} />
          ))}
          {extraConditions > 0 && (
            <span className="pedigree-node__dot-more">+{extraConditions}</span>
          )}
        </span>
      )}
      {proband && (
        <span aria-hidden="true" className="pedigree-node__you">
          YOU
        </span>
      )}
      {sabDiffers && (
        <span aria-hidden="true" className="pedigree-node__sab">
          {sabLabel(sab)}
        </span>
      )}
      <div aria-hidden="true" className="pedigree-node__name" title={person.name}>
        {person.name}
      </div>
      {years && (
        <div aria-hidden="true" className="pedigree-node__years">
          {years}
        </div>
      )}
    </div>
  );
}
