# Connecting a health record with SMART on FHIR

Stemma can pull your problem list and family-history data directly from your patient portal's
FHIR server, instead of you retyping it or downloading a C-CDA file first. It uses
**SMART App Launch** (the OAuth2 + PKCE standard most US EHR portals — Epic MyChart, Cerner/Oracle
Health Code, and others — already support for patient-facing apps), runs **entirely in your
browser**, and never touches a Stemma server, because there isn't one.

This guide covers: the privacy model, how to register Stemma as an app with your provider, the
exact values to enter, connecting and syncing, and what to do when something doesn't work.

> [!NOTE]
> This is one of three ways to bring existing data into Stemma. **GEDCOM** import seeds the family
> tree (structural only, no conditions); **C-CDA** import reads a downloaded patient-record file
> for conditions and family history; **SMART on FHIR** (this guide) does the same as C-CDA but
> live, without you having to find and download the file first. See
> [`README.md`](../README.md#standards--interoperability) for all three.

## Privacy model

- **Nothing routes through a Stemma server.** There isn't one. Once connected, syncing talks
  directly from your browser to the FHIR server you register below — the same server your
  provider's own patient-portal app talks to. No third party, no analytics, no Stemma-operated
  infrastructure sees your data in transit.
- **You choose the endpoint.** Stemma never bundles or defaults to a provider directory; you
  supply (or paste) the FHIR base URL yourself, so a connection only ever reaches a server you
  named.
- **Tokens and PHI stay in the browser.** The OAuth access token lives in `sessionStorage`
  (cleared when the tab/browser session ends). The refresh token — and only the refresh token —
  is written to `localStorage`, and **only** if you check "Stay connected on this device"; leaving
  it unchecked means nothing long-lived is ever persisted. Non-secret connection metadata
  (provider address, client ID, granted scopes, last-sync time) is always persisted to
  `localStorage` under its own `stemma-smart` key, separate from your record, so disconnecting can
  wipe it cleanly. As with the rest of Stemma's local storage, this is **unencrypted at rest** —
  the same trusted-device threat model the main record already carries (see
  [`README.md` § Data & privacy](../README.md#data--privacy)).
- **Nothing is written until you review it.** A sync fetches and parses your data, then hands it
  to the same staged-review screen the C-CDA importer uses — every condition and relative is a
  suggestion you individually accept or skip. Nothing already in your record is removed or
  silently overwritten.
- **This is a second, opt-in runtime network call**, on top of the optional ICD-10 vocabulary
  lookup Stemma already makes. It only ever fires when you click **Connect** or **Sync now**. See
  [ADR-010 in `ARCHITECTURE.md`](./ARCHITECTURE.md#adr-010--client-side-smart-on-fhir-import-supersedes-adr-009s-live-pull-deferral) for the full design rationale, including why the build's
  Content-Security-Policy had to relax to allow it.

## What gets imported — and what doesn't

| Imported | Not imported (yet) |
| --- | --- |
| Proband's problem list (`Condition`) | Observations, labs, vitals |
| Relatives + their conditions (`FamilyMemberHistory`) | Medications |
| — | Immunizations, procedures, documents |

Everything imported is treated exactly like a C-CDA import: coded facts (ICD-10-CM/SNOMED CT)
resolve to a catalog entry where possible, uncoded facts are surfaced narrative-only, a "no known
history" assertion is never turned into a positive condition, and an accepted item is recorded
with provenance `record` (records-confirmed, not self-reported). **Real-world `FamilyMemberHistory`
data is often sparse** — many EHRs record little more than "mother: none noted" — so don't expect
a sync to fully populate your pedigree; treat it as a starting draft to check and extend, the same
expectation the C-CDA importer sets.

## Registering Stemma as an app with your provider

SMART on FHIR requires you to register an app with each provider before you can connect. Stemma
is a **public client** — there is no client secret, because a static browser app can't keep one.
Registration is per-provider; you'll do this once for each portal you want to connect.

1. Find your provider's SMART/FHIR developer program. Most large US EHR vendors run one:
   [Epic on FHIR](https://fhir.epic.com), [Cerner Code](https://code.cerner.com), and similar
   programs for other EHR platforms. Smaller practices may point you at their EHR vendor's
   program instead of running their own.
2. Register a **public** (sometimes called "browser-based" or "SPA") app — **not** a confidential
   / backend client, since Stemma has no way to hold a secret. Request a **standalone patient
   launch** (Stemma always performs a standalone launch — you start it from inside Stemma, not
   from inside the portal — and never sends a `launch` parameter).
3. Register the **exact redirect URI** Stemma shows you in its connect panel — this is the app's
   own root URL, computed from wherever you're running it:

   | Deployment | Redirect URI to register |
   | --- | --- |
   | Hosted app (GitHub Pages) | `https://kabaka.github.io/stemma/` |
   | Local dev (`npm run dev`) | `http://localhost:5173/` |

   Registration requires an **exact match**, including the trailing slash. Stemma's connect panel
   always displays and lets you copy the exact value for wherever you're currently running it, so
   copy that instead of retyping it from this table.
4. Request these scopes:

   | Scope | Why Stemma needs it |
   | --- | --- |
   | `openid`, `fhirUser` | Identify who signed in, for the SMART launch context. |
   | `launch/patient` | Establish patient context for a standalone launch. |
   | `patient/Patient.read` | Read the proband's identity + birth date (for onset-age math only — Stemma never imports or overwrites your name/demographics from this). |
   | `patient/Condition.read` | Read the proband's problem list. |
   | `patient/FamilyMemberHistory.read` | Read relatives and their conditions. |
   | `offline_access` (optional) | Requested only if you check "Stay connected on this device" — lets Stemma refresh its access token later without asking you to sign in again, **when the server grants it** (see below). |

   These are the standard SMART v1 read-scope names; a SMART v2 server that only recognizes the
   newer granular (`.rs`) scope syntax should still honor the equivalent `.read` request, but
   confirm against your provider's own scope documentation if registration rejects them.
5. Save the registration and copy the **client ID** it issues — you'll paste this into Stemma's
   connect panel along with your provider's FHIR base URL. Stemma doesn't ship a client ID of its
   own; every install is a separate registration you control.

Stemma discovers the authorization and token endpoints itself from your provider's
`.well-known/smart-configuration` document (falling back to the `CapabilityStatement`
`/metadata` `oauth-uris` extension on older servers) — you only ever need the FHIR base URL and
the client ID, never the raw OAuth endpoints.

## Walkthrough: Epic's sandbox (a concrete example)

Epic is the largest US EHR vendor and a reasonable first target to validate against. This is a
**non-production sandbox** walkthrough — a safe way to try the flow with fake patient data before
pointing Stemma at your own real portal (if your provider runs Epic and enables patient-facing
SMART apps for their organization).

> [!IMPORTANT]
> Epic's developer-portal UI, checkbox wording, and sandbox test-patient credentials can change.
> Treat the steps and example values below as a starting point and verify each against Epic's own
> current documentation before relying on it.

1. Create a free account at [fhir.epic.com](https://fhir.epic.com) and start a new app
   registration.
2. Choose a **non-production** app (Epic issues a separate non-production client ID that only
   works against its sandbox, distinct from any production credential). Select the patient-facing
   / public-client option — confirm the exact label in Epic's current UI, since it has moved
   between "Backend Systems," "Patient," and "Provider" launch-type categories over time; you want
   the one that issues **no client secret**.
3. Request a standalone patient launch and register the redirect URI from the table above
   (`http://localhost:5173/` while developing locally, or your hosted URL).
4. Request the scopes listed above. Save the registration and copy the **non-production client
   ID**.
5. The R4 sandbox FHIR base URL is:

   ```text
   https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4/
   ```

   Epic serves `.well-known/smart-configuration` at this base, so Stemma's discovery step works
   against it without any extra configuration.
6. Get current sandbox **test-patient** login credentials from Epic's
   [test patients page](https://fhir.epic.com/Documentation?docId=testpatients) — do not hardcode
   a username/password from any other source, since Epic rotates and documents these itself. A
   commonly cited example is the patient "Camila Lopez" (username `fhircamila`), but confirm the
   current credentials on that page before use.
7. In Stemma, open **Connect a health record (SMART on FHIR)** from the pedigree view's import
   menu, paste the sandbox FHIR base URL and your non-production client ID, and click **Connect**.
   You're redirected to Epic's sandbox sign-in — sign in with the test-patient credentials from
   step 6 and approve the requested scopes.
8. Epic redirects back to Stemma, which completes the token exchange automatically and shows a
   connection card. Click **Sync now** to fetch and stage the sandbox patient's conditions and
   family history for review.

**For a real Epic organization** (not the sandbox): each health system runs its own FHIR endpoint,
and patients typically locate theirs through Epic's organization/endpoint directory rather than a
single shared URL — the sandbox base URL above will not work against a live hospital's data.
Whether a given organization has enabled patient-facing SMART app registration, what its exact
redirect-URI/CORS acceptance rules are, and which registration checkboxes apply are all
organization-specific; verify directly with that organization or Epic's live documentation rather
than assuming the sandbox steps transfer unchanged.

## Connecting, syncing, and disconnecting

1. From the pedigree view's import menu, choose **Connect a health record (SMART on FHIR)**.
2. Enter the **FHIR base URL** and **client ID** from your provider registration, optionally check
   **Stay connected on this device**, and click **Connect**. You're redirected to your provider's
   sign-in page.
3. Sign in and approve the requested scopes. You're redirected back to Stemma, which completes the
   exchange and shows a connection card (provider, patient, last-synced time, whether unattended
   sync is available).
4. Click **Sync now**. Stemma fetches your `Condition` and `FamilyMemberHistory` data (paging
   through the server's own result pages automatically) and opens the same staged-review screen
   the C-CDA importer uses — check the items you want, leave unchecked anything you don't, and
   confirm. This **merges** into your existing record; nothing already there is removed.
5. You can connect more than one provider — click **+ Connect another provider** — and sync each
   independently.
6. **Disconnect** on a connection card forgets it and wipes its tokens immediately (both the
   session-scoped access token and any persisted refresh token).

## Ongoing sync and refresh tokens — the honest limits

SMART allows a public (secret-less) client like Stemma to request `offline_access` and receive a
refresh token, so a later "Sync now" doesn't require signing in again. **Not every provider grants
this to a browser app**, and the difference matters:

- **Where a server does grant `offline_access`**, Stemma stores the refresh token (only if you
  checked "Stay connected") and uses it automatically — "Sync now" works without a re-login until
  the refresh token itself is revoked or expires.
- **Epic specifically ties refresh tokens to a confidential client secret.** Because Stemma
  registers as a public client with no secret, an Epic connection typically receives only a
  **short-lived access token (about one hour) and no refresh token**, even when `offline_access`
  is requested. When that access token expires, **Sync now** will ask you to sign in again — this
  is expected, not a bug, and the connection card's "Unattended sync: Not granted" badge tells you
  which of your connections work this way.
- There is currently **no unattended background sync** — every sync is a user-initiated click,
  refresh token or not. Don't rely on Stemma to silently pick up new records on a schedule.

A server-side broker that could hold a confidential client secret on your behalf would let more
providers grant real refresh tokens, but that requires a backend Stemma doesn't have (see
[ADR-010](./ARCHITECTURE.md#adr-010--client-side-smart-on-fhir-import-supersedes-adr-009s-live-pull-deferral) and the roadmap's Phase 5). This guide describes the client-side subset that's actually shipped today.

## Troubleshooting

| Symptom / message | What it means | What to do |
| --- | --- | --- |
| "Couldn't reach that server from your browser" | Either the FHIR base URL is wrong, or the provider hasn't enabled browser-based (CORS) access for SMART apps. Stemma has no server to route around this. | Double-check the URL; ask the provider/IT admin whether CORS is enabled for patient-facing SMART apps. |
| "This doesn't look like a SMART-on-FHIR server" | Neither `.well-known/smart-configuration` nor a `CapabilityStatement` `oauth-uris` fallback was found at that base URL. | Confirm the FHIR base URL is the R4 base your provider's developer docs give you, not a portal login page or a different API version. |
| "The sign-in could not be verified for safety and was cancelled" | The `state` value returned by the provider didn't match what Stemma sent (CSRF protection) — often caused by starting a second connect attempt in another tab, or the browser clearing session storage mid-flow. | Try connecting again from a single tab. |
| "Sign-in with this provider failed…" | The token exchange was rejected. | Confirm the redirect URI registered with your provider is *exactly* the one Stemma showed you, including the trailing slash, and that the client ID is correct. |
| "The server rejected the data request…" | A FHIR read failed, most often an expired access token. | Try **Sync now** again; if it keeps failing, disconnect and reconnect. |
| "This connection has expired and needs to be reauthorized." | No valid access token and no usable refresh token. | Click **Sync now** anyway to be prompted, or disconnect and reconnect — this is the expected shape for a provider (like Epic) that doesn't grant public-client refresh tokens. |
| "No conditions or family history were found for this patient." | The sync succeeded but the server returned nothing for either resource. | Real EHR `FamilyMemberHistory` is often empty or thin — this can be a genuinely empty record, not an error. |

## The clinical boundary

The connect panel and the review screen both carry Stemma's standing clinical-boundary notice:
**Stemma is decision-support, not a diagnostic device.** Anything a sync brings in is added to
your record exactly like data you typed by hand — it feeds the same pattern engine, under the
same rule that Stemma never manufactures a risk number and every flag cites the specific criterion
it met. Reviewing and confirming a synced item is not a substitute for your provider's own record
or a clinician's read of it.
