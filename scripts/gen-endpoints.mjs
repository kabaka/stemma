// Generate src/data/smart-endpoints.ts from two SMART-on-FHIR provider directories —
// Epic's User-access Brands FHIR R4 Bundle (https://open.epic.com/Endpoints/Brands,
// ~92 MB) and Oracle Health / Cerner's Ignite endpoints Bundle
// (millennium_patient_r4_endpoints.json, ~1,300 orgs). Each is slimmed to a
// provider index — patient-recognizable name + FHIR base URL (+ city/state where an
// Organization carries it) — then tagged with its vendor `source`, merged, deduped,
// and sorted into one unified list for the SMART-on-FHIR provider picker.
//
// Source provenance: two vendors, `epic` and `cerner`. Every entry is tagged with the
// `SmartVendor` that published it so the picker can pick the right build-time client id
// and optionally show a system label.
//
// The slim transforms (`slimBrandsBundle`, `slimCernerBundle`) and the merge
// (`mergeProviders`) are PURE, EXPORTED functions so they are unit-testable without the
// network (see scripts/gen-endpoints.test.ts). The wall clock is read only by the script
// (`main`) to stamp the generated-at date; the pure transforms never touch it, keeping the
// committed file byte-stable across machines.
//
// DO NOT run against a stale cache before committing — the committed default is the live
// URL for both sources. A local cache path may be supplied per source (env
// `STEMMA_BRANDS_CACHE` / argv[2] for Epic, `STEMMA_CERNER_CACHE` / argv[3] for Cerner) to
// avoid re-downloading during development.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const EPIC_SOURCE_URL = 'https://open.epic.com/Endpoints/Brands';
const CERNER_SOURCE_URL =
  'https://raw.githubusercontent.com/oracle-samples/ignite-endpoints/refs/heads/main/oracle_health_fhir_endpoints/millennium_patient_r4_endpoints.json';
// Oracle Health's public sandbox tenant — every non-production test endpoint shares this
// tenant id in its address. Excluded so patients never see the sandbox in the picker.
const CERNER_SANDBOX_TENANT = 'ec2458f2-1e24-41c8-b71b-0e701af7583d';
const OUT_PATH = 'src/data/smart-endpoints.ts';

// Compact source encoding, mirrored by the generated module's decode. The row's source
// element is one of these numeric codes; index into VENDORS to recover the string.
const VENDORS = ['epic', 'cerner'];
const SOURCE_CODE = { epic: 0, cerner: 1 };

/**
 * Resolve an Organization `endpoint[0].reference` to the referenced Endpoint id.
 * Epic uses the `urn:uuid:<id>` form; Cerner uses the plain `Endpoint/<id>` form. We
 * tolerate both — `urn:uuid:` is stripped, otherwise we take the last path segment.
 * @param {unknown} ref
 * @returns {string | undefined}
 */
function refToEndpointId(ref) {
  if (typeof ref !== 'string' || ref.length === 0) return undefined;
  if (ref.startsWith('urn:uuid:')) return ref.slice('urn:uuid:'.length);
  const segments = ref.split('/');
  return segments[segments.length - 1] || undefined;
}

/**
 * @typedef {'epic' | 'cerner'} SmartVendor
 */

/**
 * @typedef {Object} SlimProvider
 * @property {string} name
 * @property {string} fhirBaseUrl
 * @property {SmartVendor} source
 * @property {string} [city]
 * @property {string} [state]
 */

/**
 * Drop falsy name/URL, deduplicate, and deterministically sort a collected list of
 * providers. Shared by both slim transforms and the cross-source merge so the dedup and
 * sort rules are identical everywhere.
 *
 * Dedup key is `name.toLowerCase() + '|' + fhirBaseUrl + '|' + source`; on collision the
 * location-bearing entry wins over one with no city/state (cross-source collisions are
 * essentially impossible, but the rule is applied uniformly). `source` is part of the key so
 * a hypothetical cross-vendor name+URL collision can never silently collapse into (and flip
 * the vendor of) a single entry — both survive as distinct rows instead. Sort is a plain
 * `<`/`>` string comparison on lowercased name then URL (NOT localeCompare — ICU-dependent),
 * so the committed file is byte-stable across environments and Epic + Cerner entries
 * interleave by name.
 *
 * @param {SlimProvider[]} collected
 * @returns {SlimProvider[]}
 */
export function dedupeAndSort(collected) {
  // Drop falsy name / URL.
  const filtered = collected.filter((p) => p.name && p.fhirBaseUrl);

  // Deduplicate, preferring the location-bearing entry on collision.
  const byKey = new Map();
  for (const provider of filtered) {
    const key = `${provider.name.toLowerCase()}|${provider.fhirBaseUrl}|${provider.source}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, provider);
      continue;
    }
    const existingHasLocation = Boolean(existing.city || existing.state);
    const providerHasLocation = Boolean(provider.city || provider.state);
    if (!existingHasLocation && providerHasLocation) byKey.set(key, provider);
  }

  // Emit clean provider objects (omit falsy city/state so the field is truly optional).
  const providers = [...byKey.values()].map((provider) => {
    /** @type {SlimProvider} */
    const clean = {
      name: provider.name,
      fhirBaseUrl: provider.fhirBaseUrl,
      source: provider.source,
    };
    if (provider.city) clean.city = provider.city;
    if (provider.state) clean.state = provider.state;
    return clean;
  });

  // Deterministic sort — plain string comparison, no locale, no clock.
  providers.sort((a, b) => {
    const an = a.name.toLowerCase();
    const bn = b.name.toLowerCase();
    if (an < bn) return -1;
    if (an > bn) return 1;
    if (a.fhirBaseUrl < b.fhirBaseUrl) return -1;
    if (a.fhirBaseUrl > b.fhirBaseUrl) return 1;
    return 0;
  });

  return providers;
}

/**
 * Slim an Epic Brands FHIR Bundle to a deterministic, deduplicated, brand-level index,
 * tagging every entry `source: 'epic'`.
 *
 * Entries come from two unioned sources:
 *   (a) every Endpoint that has an `address` → { name, fhirBaseUrl } (no location);
 *   (b) every Organization with a DIRECT `endpoint[0].reference` resolving to an
 *       Endpoint that has an `address` → { name, fhirBaseUrl, city?, state? }.
 * `partOf` chains are intentionally NOT resolved — brand-level only. Facility orgs
 * without a direct endpoint are excluded; they share the FHIR URLs the brands carry.
 *
 * @param {any} bundle
 * @returns {SlimProvider[]}
 */
export function slimBrandsBundle(bundle) {
  const entries = Array.isArray(bundle?.entry) ? bundle.entry : [];

  // Collect Endpoints by id.
  const endpoints = new Map();
  for (const entry of entries) {
    const resource = entry?.resource;
    if (resource?.resourceType === 'Endpoint' && resource.id != null) {
      endpoints.set(String(resource.id), { name: resource.name, address: resource.address });
    }
  }

  /** @type {SlimProvider[]} */
  const collected = [];

  // (a) Every Endpoint with an address.
  for (const endpoint of endpoints.values()) {
    if (endpoint.address) {
      collected.push({ name: endpoint.name, fhirBaseUrl: endpoint.address, source: 'epic' });
    }
  }

  // (b) Every Organization with a direct endpoint reference to an addressed Endpoint.
  for (const entry of entries) {
    const resource = entry?.resource;
    if (resource?.resourceType !== 'Organization') continue;
    const id = refToEndpointId(resource.endpoint?.[0]?.reference);
    const endpoint = id != null ? endpoints.get(id) : undefined;
    if (!endpoint?.address) continue;
    collected.push({
      name: resource.name,
      fhirBaseUrl: endpoint.address,
      city: resource.address?.[0]?.city,
      state: resource.address?.[0]?.state,
      source: 'epic',
    });
  }

  return dedupeAndSort(collected);
}

/**
 * Slim an Oracle Health / Cerner Ignite FHIR Bundle to a deterministic, deduplicated
 * index, tagging every entry `source: 'cerner'`.
 *
 * Cerner's bundle is 1:1 paired Organization + Endpoint resources, so there is no
 * brand-level collapsing to do (unlike Epic). For every Organization with a DIRECT
 * `endpoint[0].reference` (Cerner uses the plain `Endpoint/<id>` form) resolving to an
 * addressed Endpoint, emit { name, fhirBaseUrl, city?, state?, source: 'cerner' }.
 * Endpoints whose address carries the public sandbox tenant are dropped so patients never
 * see the sandbox. Entries with a falsy name/URL are dropped by `dedupeAndSort`.
 *
 * @param {any} bundle
 * @returns {SlimProvider[]}
 */
export function slimCernerBundle(bundle) {
  const entries = Array.isArray(bundle?.entry) ? bundle.entry : [];

  // Collect Endpoints by id.
  const endpoints = new Map();
  for (const entry of entries) {
    const resource = entry?.resource;
    if (resource?.resourceType === 'Endpoint' && resource.id != null) {
      endpoints.set(String(resource.id), { name: resource.name, address: resource.address });
    }
  }

  /** @type {SlimProvider[]} */
  const collected = [];

  for (const entry of entries) {
    const resource = entry?.resource;
    if (resource?.resourceType !== 'Organization') continue;
    const id = refToEndpointId(resource.endpoint?.[0]?.reference);
    const endpoint = id != null ? endpoints.get(id) : undefined;
    if (!endpoint?.address) continue;
    // Drop the public sandbox tenant — non-production, never shown to patients.
    if (endpoint.address.includes(CERNER_SANDBOX_TENANT)) continue;
    collected.push({
      name: resource.name,
      fhirBaseUrl: endpoint.address,
      city: resource.address?.[0]?.city,
      state: resource.address?.[0]?.state,
      source: 'cerner',
    });
  }

  return dedupeAndSort(collected);
}

/**
 * Merge already-slimmed per-source provider lists into one unified, deduplicated, sorted
 * index. Sources interleave by name (never one vendor's block before the other) so the
 * picker's search is unified.
 * @param {...SlimProvider[]} lists
 * @returns {SlimProvider[]}
 */
export function mergeProviders(...lists) {
  return dedupeAndSort(lists.flat());
}

/**
 * Compact-encode providers into an interned URL table + index rows. URLs repeat heavily
 * across Epic brands, so interning them keeps the committed file small. Each row carries a
 * numeric source code (0 = epic, 1 = cerner) at a fixed position so the vendor survives the
 * round-trip.
 * @param {SlimProvider[]} providers
 * @returns {{ urls: string[], rows: Array<[string, number, number] | [string, number, number, string, string]> }}
 */
export function encodeProviders(providers) {
  const urls = [];
  const urlIndex = new Map();
  const rows = providers.map((provider) => {
    let index = urlIndex.get(provider.fhirBaseUrl);
    if (index === undefined) {
      index = urls.length;
      urls.push(provider.fhirBaseUrl);
      urlIndex.set(provider.fhirBaseUrl, index);
    }
    const source = SOURCE_CODE[provider.source] ?? 0;
    if (provider.city || provider.state) {
      return [provider.name, index, source, provider.city ?? '', provider.state ?? ''];
    }
    return [provider.name, index, source];
  });
  return { urls, rows };
}

/**
 * Decode the compact URL-table representation back to typed providers. Mirrors the decode
 * baked into the generated module; used by the test to prove round-trip fidelity.
 * @param {{ urls: string[], rows: Array<[string, number, number, string?, string?]> }} encoded
 * @returns {SlimProvider[]}
 */
export function decodeProviders({ urls, rows }) {
  return rows.map(([name, index, source, city, state]) => {
    /** @type {SlimProvider} */
    const provider = { name, fhirBaseUrl: urls[index], source: VENDORS[source] ?? 'epic' };
    if (city) provider.city = city;
    if (state) provider.state = state;
    return provider;
  });
}

/**
 * Render the generated TypeScript module source (unformatted — the script runs it through
 * prettier so the committed file passes `npm run format:check`).
 * @param {SlimProvider[]} providers
 * @param {string} generatedAt ISO date (YYYY-MM-DD), supplied by the caller
 * @returns {string}
 */
function renderModule(providers, generatedAt) {
  const { urls, rows } = encodeProviders(providers);
  const urlLines = urls.map((url) => `  ${JSON.stringify(url)},`).join('\n');
  const rowLines = rows.map((row) => `  ${JSON.stringify(row)},`).join('\n');

  return `/**
 * SMART-on-FHIR provider endpoints — the patient-facing brand/organization index the
 * provider picker searches to start a connection.
 *
 * DO NOT EDIT BY HAND — regenerate with \`npm run gen:endpoints\`, which re-derives it from
 * two SMART-on-FHIR provider directories and merges them: Epic's User-access Brands FHIR R4
 * Bundle (https://open.epic.com/Endpoints/Brands, slimmed to brand-level) and Oracle Health
 * / Cerner's Ignite endpoints Bundle (millennium_patient_r4_endpoints.json, per-facility).
 * See \`docs/ARCHITECTURE.md\` and DR-0016.
 *
 * NOTE — every entry is tagged with the \`SmartVendor\` (\`'epic'\` | \`'cerner'\`) that
 * published it. \`fhirBaseUrl\` is the FHIR R4 base URL to hand to the SMART client
 * (discovery runs from there); it is never asserted to be live — the picker surfaces
 * \`SMART_ENDPOINTS_GENERATED_AT\` as "provider list as of <date>".
 *
 * Compact url-table encoding: URLs repeat across brands, so they are interned into \`U\` and
 * each row references one by index. \`R\` rows are \`[name, urlIndex, source, city?, state?]\`,
 * where \`source\` is \`0\` (epic) or \`1\` (cerner); \`SMART_PROVIDERS\` decodes them to the
 * public typed array at module load.
 */

export type SmartVendor = 'epic' | 'cerner';

export interface SmartProvider {
  /** Patient-recognizable brand/organization name (search + display key). */
  name: string;
  /** FHIR R4 base URL to hand to beginConnect (SMART discovery runs from here). */
  fhirBaseUrl: string;
  city?: string;
  state?: string;
  /** Which EHR vendor published this endpoint — drives the per-vendor build-time
   *  client id and an optional system label in the picker. */
  source: SmartVendor;
}

/** ISO date (YYYY-MM-DD) the generator last ran. Surfaced by the picker as
 *  "provider list as of <date>" — never asserted as live. */
export const SMART_ENDPOINTS_GENERATED_AT: string = ${JSON.stringify(generatedAt)};

// Interned URL table (see file header).
const U: string[] = [
${urlLines}
];

type EncodedRow = readonly [
  name: string,
  urlIndex: number,
  source: number,
  city?: string,
  state?: string,
];

// Vendor codes, indexed by the row's \`source\` element (0 = epic, 1 = cerner).
const V: readonly SmartVendor[] = ['epic', 'cerner'];

// Provider rows referencing \`U\` by index.
const R: readonly EncodedRow[] = [
${rowLines}
];

/** Epic User-access Brands (brand-level) + Oracle Health / Cerner (per-facility), merged
 *  and sorted by name. Each entry carries its \`source\` vendor. */
export const SMART_PROVIDERS: SmartProvider[] = R.map(([name, urlIndex, source, city, state]) => {
  const provider: SmartProvider = { name, fhirBaseUrl: U[urlIndex], source: V[source] };
  if (city) provider.city = city;
  if (state) provider.state = state;
  return provider;
});
`;
}

/**
 * Load one source bundle, preferring a local cache path if supplied.
 * @param {{ label: string, url: string, cachePath: string | undefined, sizeNote?: string }} opts
 */
async function loadBundle({ label, url, cachePath, sizeNote }) {
  if (cachePath) {
    console.log(`Reading ${label} bundle from cache: ${cachePath}`);
    return JSON.parse(readFileSync(cachePath, 'utf8'));
  }
  // Security note: there is no runtime/CI integrity check on these fetches — no pinned hash,
  // no signature — by design (neither vendor publishes a checksum to pin against, and these
  // are build-time/dev-machine fetches, never runtime ones). The generated
  // `src/data/smart-endpoints.ts` diff this produces MUST be eyeballed by a human reviewer
  // before commit, same as any other third-party data pulled into the repo.
  console.log(`Fetching ${label} bundle: ${url}${sizeNote ? ` (${sizeNote})` : ''}…`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Fetch failed for ${label}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function main() {
  const epicBundle = await loadBundle({
    label: 'Epic Brands',
    url: EPIC_SOURCE_URL,
    cachePath: process.env.STEMMA_BRANDS_CACHE || process.argv[2],
    sizeNote: '~92 MB, this can take a while',
  });
  const cernerBundle = await loadBundle({
    label: 'Oracle Health / Cerner',
    url: CERNER_SOURCE_URL,
    cachePath: process.env.STEMMA_CERNER_CACHE || process.argv[3],
  });

  const epic = slimBrandsBundle(epicBundle);
  const cerner = slimCernerBundle(cernerBundle);
  const providers = mergeProviders(epic, cerner);
  if (providers.length === 0) {
    throw new Error('Slim produced 0 providers — refusing to write an empty index.');
  }

  const generatedAt = new Date().toISOString().slice(0, 10);
  const source = renderModule(providers, generatedAt);

  // Format through prettier so the committed file passes `npm run format:check`.
  const prettier = await import('prettier');
  const options = await prettier.resolveConfig(OUT_PATH);
  const formatted = await prettier.format(source, { ...options, parser: 'typescript' });

  writeFileSync(OUT_PATH, formatted);
  const epicCount = providers.filter((p) => p.source === 'epic').length;
  const cernerCount = providers.filter((p) => p.source === 'cerner').length;
  console.log(
    `Wrote ${OUT_PATH} — ${providers.length} providers ` +
      `(${epicCount} epic + ${cernerCount} cerner, as of ${generatedAt}).`,
  );
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  await main();
}
