// HighlightBar — pedigree highlight toolbar. Main visual axis is `mode`: 'cond' vs 'cat'.
// Seed the family record for realistic chip data; derive catalog from buildCatalog([]).
// No active highlight (activeId=null) and with an active highlight are both shown.
import { HighlightBar, seedRecord, buildCatalog } from 'stemma';

const record = seedRecord();
const catalog = buildCatalog([]);
const noop = () => {};

// Mode: Condition, no active highlight — shows the "Choose a condition…" dashed trigger.
export const ConditionModeIdle = () => (
  <HighlightBar
    mode="cond"
    onSetMode={noop}
    activeId={null}
    onToggleChip={noop}
    onHighlightCondition={noop}
    onClear={noop}
    people={record.people}
    catalog={catalog}
    palette="default"
  />
);

// Mode: Category, no active highlight — toggle shows "category" noun.
export const CategoryModeIdle = () => (
  <HighlightBar
    mode="cat"
    onSetMode={noop}
    activeId={null}
    onToggleChip={noop}
    onHighlightCondition={noop}
    onClear={noop}
    people={record.people}
    catalog={catalog}
    palette="default"
  />
);

// Mode: Condition, with an active highlight (BRCA) — shows the active summary chip with X.
export const ConditionModeActive = () => (
  <HighlightBar
    mode="cond"
    onSetMode={noop}
    activeId="brca"
    onToggleChip={noop}
    onHighlightCondition={noop}
    onClear={noop}
    people={record.people}
    catalog={catalog}
    palette="default"
  />
);

// Mode: Category, with an active category highlight — shows category active chip.
export const CategoryModeActive = () => (
  <HighlightBar
    mode="cat"
    onSetMode={noop}
    activeId="cardio"
    onToggleChip={noop}
    onHighlightCondition={noop}
    onClear={noop}
    people={record.people}
    catalog={catalog}
    palette="default"
  />
);
