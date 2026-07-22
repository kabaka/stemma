// Generate src/data/smart-endpoints.ts from Epic's User-access Brands FHIR R4 Bundle
// (https://open.epic.com/Endpoints/Brands, ~92 MB). Slims the bundle to a brand-level
// provider index — patient-recognizable name + FHIR base URL (+ city/state where an
// Organization carries it) — for the SMART-on-FHIR provider picker.
//
// Source provenance: `epic-brands` (Epic today). This deliberately carries NO
// multi-source infrastructure — there is only one source. When a second appears,
// extend the schema then, not now.
//
// The slim transform (`slimBrandsBundle`) is a PURE, EXPORTED function so it is
// unit-testable without the network (see scripts/gen-endpoints.test.ts). The wall
// clock is read only by the script (`main`) to stamp the generated-at date; the pure
// transform never touches it, keeping the committed file byte-stable across machines.
//
// DO NOT run against a stale cache before committing — the committed default is the
// live URL. A local cache path may be supplied (env `STEMMA_BRANDS_CACHE` or argv[2])
// to avoid re-downloading during development.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SOURCE_URL = 'https://open.epic.com/Endpoints/Brands';
const OUT_PATH = 'src/data/smart-endpoints.ts';

/**
 * Resolve an Organization `endpoint[0].reference` to the referenced Endpoint id.
 * Epic uses the `urn:uuid:<id>` form; we also tolerate a plain `Endpoint/<id>` form
 * by taking the last path segment.
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
 * @typedef {Object} SlimProvider
 * @property {string} name
 * @property {string} fhirBaseUrl
 * @property {string} [city]
 * @property {string} [state]
 */

/**
 * Slim a Brands FHIR Bundle to a deterministic, deduplicated, brand-level index.
 *
 * Entries come from two unioned sources:
 *   (a) every Endpoint that has an `address` → { name, fhirBaseUrl } (no location);
 *   (b) every Organization with a DIRECT `endpoint[0].reference` resolving to an
 *       Endpoint that has an `address` → { name, fhirBaseUrl, city?, state? }.
 * `partOf` chains are intentionally NOT resolved — brand-level only. Facility orgs
 * without a direct endpoint are excluded; they share the FHIR URLs the brands carry.
 *
 * Entries with a falsy name or URL are dropped. Dedup key is
 * `name.toLowerCase() + '|' + fhirBaseUrl`; on collision the location-bearing entry
 * (org-sourced) wins over the bare endpoint entry. Sort is a plain `<`/`>` string
 * comparison on lowercased name then URL (NOT localeCompare — ICU-dependent), so the
 * committed file is byte-stable across environments.
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
      collected.push({ name: endpoint.name, fhirBaseUrl: endpoint.address });
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
    });
  }

  // Drop falsy name / URL.
  const filtered = collected.filter((p) => p.name && p.fhirBaseUrl);

  // Deduplicate, preferring the location-bearing entry on collision.
  const byKey = new Map();
  for (const provider of filtered) {
    const key = `${provider.name.toLowerCase()}|${provider.fhirBaseUrl}`;
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
    const clean = { name: provider.name, fhirBaseUrl: provider.fhirBaseUrl };
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
 * Compact-encode providers into an interned URL table + index rows. URLs repeat
 * heavily across brands, so interning them keeps the committed file small.
 * @param {SlimProvider[]} providers
 * @returns {{ urls: string[], rows: Array<[string, number] | [string, number, string, string]> }}
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
    if (provider.city || provider.state) {
      return [provider.name, index, provider.city ?? '', provider.state ?? ''];
    }
    return [provider.name, index];
  });
  return { urls, rows };
}

/**
 * Decode the compact URL-table representation back to typed providers. Mirrors the
 * decode baked into the generated module; used by the test to prove round-trip fidelity.
 * @param {{ urls: string[], rows: Array<[string, number, string?, string?]> }} encoded
 * @returns {SlimProvider[]}
 */
export function decodeProviders({ urls, rows }) {
  return rows.map(([name, index, city, state]) => {
    /** @type {SlimProvider} */
    const provider = { name, fhirBaseUrl: urls[index] };
    if (city) provider.city = city;
    if (state) provider.state = state;
    return provider;
  });
}

/**
 * Render the generated TypeScript module source (unformatted — the script runs it
 * through prettier so the committed file passes `npm run format:check`).
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
 * DO NOT EDIT BY HAND — regenerate with \`npm run gen:endpoints\`, which re-derives it
 * from Epic's User-access Brands FHIR R4 Bundle (https://open.epic.com/Endpoints/Brands),
 * slimmed to brand-level. See \`docs/ARCHITECTURE.md\` and DR-0016.
 *
 * NOTE — source: 'epic-brands'. Epic is the only provenance today; there is deliberately
 * no multi-source infrastructure here. \`fhirBaseUrl\` is the FHIR R4 base URL to hand to
 * the SMART client (discovery runs from there); it is never asserted to be live — the
 * picker surfaces \`SMART_ENDPOINTS_GENERATED_AT\` as "provider list as of <date>".
 *
 * Compact url-table encoding: URLs repeat across brands, so they are interned into \`U\`
 * and each row references one by index. \`R\` rows are \`[name, urlIndex, city?, state?]\`;
 * \`SMART_PROVIDERS\` decodes them to the public typed array at module load.
 */

export interface SmartProvider {
  /** Patient-recognizable brand/organization name (search + display key). */
  name: string;
  /** FHIR R4 base URL to hand to beginConnect (SMART discovery runs from here). */
  fhirBaseUrl: string;
  city?: string;
  state?: string;
}

/** ISO date (YYYY-MM-DD) the generator last ran. Surfaced by the picker as
 *  "provider list as of <date>" — never asserted as live. */
export const SMART_ENDPOINTS_GENERATED_AT: string = ${JSON.stringify(generatedAt)};

// Interned URL table (see file header).
const U: string[] = [
${urlLines}
];

type EncodedRow = readonly [name: string, urlIndex: number, city?: string, state?: string];

// Provider rows referencing \`U\` by index.
const R: readonly EncodedRow[] = [
${rowLines}
];

/** Epic User-access Brands, slimmed to brand-level. Source provenance is Epic today. */
export const SMART_PROVIDERS: SmartProvider[] = R.map(([name, urlIndex, city, state]) => {
  const provider: SmartProvider = { name, fhirBaseUrl: U[urlIndex] };
  if (city) provider.city = city;
  if (state) provider.state = state;
  return provider;
});
`;
}

async function loadBundle() {
  const cachePath = process.env.STEMMA_BRANDS_CACHE || process.argv[2];
  if (cachePath) {
    console.log(`Reading Brands bundle from cache: ${cachePath}`);
    return JSON.parse(readFileSync(cachePath, 'utf8'));
  }
  console.log(`Fetching Brands bundle: ${SOURCE_URL} (~92 MB, this can take a while)…`);
  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function main() {
  const bundle = await loadBundle();
  const providers = slimBrandsBundle(bundle);
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
  console.log(`Wrote ${OUT_PATH} — ${providers.length} providers (as of ${generatedAt}).`);
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  await main();
}
