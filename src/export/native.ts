/**
 * Native lossless backup — the no-lock-in escape hatch (roadmap §3, guardrail #5).
 *
 * The standards serialisers in this layer are deliberately *lossy clinical projections*:
 * FHIR/Phenopacket drop genealogy and provenance nuance, GEDCOM drops every condition.
 * None of them round-trips the whole graph. This one does: it serialises the complete
 * {@link FamilyRecord} plus the long-tail catalog {@link Condition | extensions} verbatim,
 * so a user can take their entire record out of the app and put it back — the record
 * outlives the app.
 *
 * The envelope is versioned so a future schema change can be migrated on import rather
 * than rejected. Pure and deterministic given its `now` argument (the sanctioned
 * wall-clock boundary is the caller, per the domain-purity rule).
 */
import type { Condition, FamilyRecord } from '@/domain/types';

/** Discriminator identifying a Stemma native backup blob. */
export const NATIVE_BACKUP_KIND = 'stemma.backup' as const;

/** Current backup schema version. Bump when the envelope shape changes. */
export const NATIVE_BACKUP_VERSION = 1 as const;

export interface NativeBackupOptions {
  /** ISO-8601 timestamp for the backup's generation time (injected, never read here). */
  now?: string;
  /** App version string to stamp, for provenance. */
  appVersion?: string;
}

/** The on-disk backup envelope. */
export interface NativeBackup {
  kind: typeof NATIVE_BACKUP_KIND;
  version: number;
  /** When the backup was taken (informational). */
  generatedAt?: string;
  /** App version that produced it (informational). */
  appVersion?: string;
  /** The complete family graph. */
  record: FamilyRecord;
  /** Long-tail conditions the user attached via vocabulary search. */
  extensions: Condition[];
}

/**
 * Build a complete, restorable backup of the record and its catalog extensions.
 * Returns pretty-printed JSON text ready to download.
 */
export function buildNativeBackup(
  record: FamilyRecord,
  extensions: Condition[] = [],
  opts: NativeBackupOptions = {},
): string {
  const envelope: NativeBackup = {
    kind: NATIVE_BACKUP_KIND,
    version: NATIVE_BACKUP_VERSION,
    ...(opts.now ? { generatedAt: opts.now } : {}),
    ...(opts.appVersion ? { appVersion: opts.appVersion } : {}),
    record,
    extensions,
  };
  return JSON.stringify(envelope, null, 2);
}
