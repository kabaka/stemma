/**
 * Core domain types for Stemma.
 *
 * The atom of the model is the {@link Person}, not the proband. Everything the app
 * shows — pedigree, hereditary-pattern flags, timeline, screening — is a view over a
 * single graph of people, the typed relationship edges ({@link Union}) between them,
 * the {@link ConditionEntry | conditions} each person carries, and their
 * {@link TimelineEvent | timeline events}.
 *
 * See `docs/ARCHITECTURE.md` for the rationale behind modelling Person as the atom.
 */

/** Provenance of a recorded fact. Clinicians weight family history by its source. */
export type Provenance =
  /** Self-reported / family recollection. */
  | 'self'
  /** Confirmed by a medical record. */
  | 'record'
  /** Confirmed by a death certificate. */
  | 'death';

/**
 * Sex assigned at birth. Drives the genetics and the pedigree geometry — kept
 * separate from {@link Gender} per the 2022 NSGC gender-inclusive nomenclature.
 */
export type Sab = 'm' | 'f' | 'u';

/** Gender identity. Drives display (symbol, relationship label), never the genetics. */
export type Gender = 'man' | 'woman' | 'nb';

/** Organs whose presence drives screening recommendations. */
export type Organ = 'breasts' | 'ovaries' | 'uterus' | 'cervix' | 'prostate';

/** High-level clinical grouping for a condition. Drives colour and breakdowns. */
export type CategoryKey =
  | 'card'
  | 'canc'
  | 'endo'
  | 'neuro'
  | 'ment'
  | 'auto'
  | 'resp'
  | 'gi'
  | 'renal'
  | 'musc'
  | 'blood'
  | 'sens'
  | 'repro'
  /** Catch-all for long-tail / uncategorised codes (e.g. from vocabulary search). */
  | 'other';

/**
 * A condition in the catalog. The curated catalog carries the value-add metadata the
 * pattern engine reasons on; long-tail ICD-10 codes attached via live vocabulary
 * search resolve to a generic {@link Condition} (see {@link fallbackCondition}).
 */
export interface Condition {
  /** Stable id — a short curated slug (`'brca'`) or an ICD-10-CM code (`'C50.911'`). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Clinical category. */
  cat: CategoryKey;
  /**
   * Population prevalence as a percentage. Sourced to published epidemiology when
   * {@link prevSource} is set (roadmap §3); otherwise an illustrative starting value.
   */
  base: number;
  /**
   * Provenance for {@link base}: a short citation for the sourced figure (e.g.
   * `'CDC WONDER 2021'`, `'SEER lifetime risk'`, `'IHME GBD 2021'`). Absent means the
   * prevalence is still an illustrative placeholder, not bound to a source.
   */
  prevSource?: string;
  /**
   * Heritability — the proportion (0–1) of population variance attributable to genetics,
   * from twin/registry studies. A population statistic, never a personal-risk number.
   */
  herit?: number;
  /** Provenance for {@link herit}: a short citation for the heritability estimate. */
  heritSource?: string;
  /** Inheritance pattern, freeform (e.g. `'Autosomal dominant'`). Read by the engine. */
  pattern: string;
  /** Lay-term search synonyms. */
  syn?: string[];
  /** Curated ICD-10-CM code, baked in at authoring time. */
  icd10?: string;
  /** Curated SNOMED CT concept id, baked in at authoring time. */
  snomed?: string;
  /**
   * Human Phenotype Ontology term id (e.g. `'HP:0100013'`), for the genetics audience.
   * HPO is open and redistributable; it is the native vocabulary of the Phenopacket
   * export. Stored with the `HP:` prefix included.
   */
  hpo?: string;
}

/** A condition recorded against a specific person. */
export interface ConditionEntry {
  /** References a {@link Condition.id}. */
  id: string;
  /** Age of onset in years, if known. */
  onset: number | null;
  /** Where the fact came from. */
  prov: Provenance;
}

/**
 * A person in the family record. `sab` + `gender` + `organs` implement the 2022
 * gender-inclusive standard: `sab` for the genetics, `gender` for display, and the
 * organ inventory for screening (a trans man may still need cervical screening).
 */
export interface Person {
  id: string;
  name: string;
  /** Sex assigned at birth. */
  sab: Sab;
  /** Gender identity. */
  gender: Gender;
  /** Free-text pronouns, for display. */
  pronouns?: string;
  /**
   * Explicit organ inventory. When omitted, screening derives a default set from
   * `sab` (see {@link defaultOrgans}); set it explicitly to model surgical history
   * or a body that differs from the `sab` default.
   */
  organs?: Organ[];
  /** Generation index; lower is older. Used for layout and relationship labels. */
  gen: number;
  /** Horizontal layout hint within a generation row. */
  x: number;
  /** Whether the person is deceased. */
  dead: boolean;
  /** Birth year, if known. */
  birth: number | null;
  /** Death year, if known. */
  death: number | null;
  /** Conditions this person carries. */
  conds: ConditionEntry[];
  /** True for the record owner (the default vantage for risk/screening). */
  isProband?: boolean;
}

/**
 * A typed relationship edge: a union of `parents` producing `children`. Genetic
 * parentage is what the risk math walks; social-only relationships (adoption, donor)
 * are a future extension (roadmap §5).
 */
export interface Union {
  parents: string[];
  children: string[];
  /** Consanguineous union (blood-related partners) — changes recessive risk. */
  consanguineous?: boolean;
}

/** The kind of a {@link TimelineEvent}. */
export type EventType =
  | 'immunization'
  | 'visit'
  | 'lab'
  | 'diagnosis'
  | 'medication'
  | 'screening'
  | 'procedure'
  | 'genetic';

/** One dated event on a person's timeline. */
export interface TimelineEvent {
  id: string;
  /** Owning {@link Person.id}. */
  person: string;
  year: number;
  type: EventType;
  title: string;
  detail: string;
}

/** The complete family record — the single graph every view reads from. */
export interface FamilyRecord {
  people: Person[];
  unions: Union[];
  timeline: TimelineEvent[];
  /** Id of the record owner / default vantage. */
  probandId: string;
}
