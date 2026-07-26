// ============================================================================
// lib/persist.ts — IndexedDB checkpoints so a cancelled/crashed/retried
// analysis resumes from completed chunks instead of restarting from zero
// (SPEC ">20 minute" requirement), PLUS (P6) full-project recovery: the
// complete edit-decision snapshot (never the video file itself — browsers
// cannot durably keep that) autosaved to IndexedDB and exportable as a
// `sharpcut-project.json` file. See SPEC "LOCAL PROJECT RECOVERY".
// ============================================================================

import { openDB, type IDBPDatabase } from 'idb';
import type { ProjectSnapshotV1, WordStamp } from '../types';

const DB_NAME = 'sharpcut-checkpoints';
const DB_VERSION = 2;
const CHUNKS = 'chunks'; // key: `${fpKey}#${index}` -> WordStamp[]
const META = 'meta'; // key: fpKey -> { lastStage }
const PROJECT = 'project'; // key: PROJECT_KEY -> ProjectSnapshotV1 (P6)
const PROJECT_KEY = 'current';

export interface ProjectFingerprint {
  fileName: string;
  size: number;
  mtime: number;
  duration: number;
}

/** Stable per-project key from file identity + duration. */
export function fingerprintKey(fp: ProjectFingerprint): string {
  return `${fp.fileName}|${fp.size}|${fp.mtime}|${Math.round(fp.duration)}`;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(CHUNKS)) db.createObjectStore(CHUNKS);
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
        if (!db.objectStoreNames.contains(PROJECT)) db.createObjectStore(PROJECT);
      },
    });
  }
  return dbPromise;
}

export interface Checkpoint {
  chunks: Map<number, WordStamp[]>;
  lastStage: number;
}

/**
 * Load any saved checkpoint for this project. Never throws — a storage failure
 * (private mode, quota) simply yields an empty checkpoint so analysis proceeds
 * from scratch.
 */
export async function loadCheckpoint(fpKey: string): Promise<Checkpoint> {
  const chunks = new Map<number, WordStamp[]>();
  try {
    const db = await getDb();
    const metaRec = (await db.get(META, fpKey)) as { lastStage?: number } | undefined;
    const prefix = `${fpKey}#`;
    let cursor = await db.transaction(CHUNKS).store.openCursor();
    while (cursor) {
      const key = cursor.key as string;
      if (typeof key === 'string' && key.startsWith(prefix)) {
        const idx = Number(key.slice(prefix.length));
        if (Number.isFinite(idx)) chunks.set(idx, cursor.value as WordStamp[]);
      }
      cursor = await cursor.continue();
    }
    return { chunks, lastStage: metaRec?.lastStage ?? 0 };
  } catch {
    return { chunks, lastStage: 0 };
  }
}

export async function saveChunk(fpKey: string, index: number, words: WordStamp[]): Promise<void> {
  try {
    const db = await getDb();
    await db.put(CHUNKS, words, `${fpKey}#${index}`);
  } catch {
    /* best-effort */
  }
}

export async function saveStage(fpKey: string, stage: number): Promise<void> {
  try {
    const db = await getDb();
    await db.put(META, { lastStage: stage }, fpKey);
  } catch {
    /* best-effort */
  }
}

// ============================================================================
// Full-project recovery (P6)
// ============================================================================

/** Narrow runtime check before trusting anything read from IndexedDB or a
 * user-supplied JSON file — never trust storage/disk blindly. */
export function isValidSnapshot(obj: unknown): obj is ProjectSnapshotV1 {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  const fp = o.fingerprint as Record<string, unknown> | undefined;
  const meta = o.projectMeta as Record<string, unknown> | undefined;
  return (
    o.v === 1 &&
    typeof o.savedAt === 'number' &&
    !!fp &&
    typeof fp.fileName === 'string' &&
    typeof fp.size === 'number' &&
    typeof fp.duration === 'number' &&
    !!meta &&
    typeof meta.fileName === 'string' &&
    Array.isArray(o.words) &&
    Array.isArray(o.captionBlocks) &&
    Array.isArray(o.cuts) &&
    !!o.studio &&
    typeof o.appState === 'string'
  );
}

/** Autosave the full project snapshot. Never throws — storage failure (quota,
 * private mode) just means recovery won't be available next time; it must
 * never interrupt the session. */
export async function saveProjectSnapshot(snapshot: ProjectSnapshotV1): Promise<void> {
  try {
    const db = await getDb();
    await db.put(PROJECT, snapshot, PROJECT_KEY);
  } catch {
    /* best-effort */
  }
}

/** Load the saved project snapshot, if any and if it looks well-formed. */
export async function loadProjectSnapshot(): Promise<ProjectSnapshotV1 | null> {
  try {
    const db = await getDb();
    const rec = await db.get(PROJECT, PROJECT_KEY);
    return isValidSnapshot(rec) ? rec : null;
  } catch {
    return null;
  }
}

/** Remove the saved project snapshot (called by "Start over" / after a fresh
 * upload replaces the in-progress project). */
export async function clearProjectSnapshot(): Promise<void> {
  try {
    const db = await getDb();
    await db.delete(PROJECT, PROJECT_KEY);
  } catch {
    /* best-effort */
  }
}

/** Trigger a browser download of the snapshot as `sharpcut-project.json`. */
export function downloadProjectSnapshot(snapshot: ProjectSnapshotV1, fileBaseName?: string): void {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileBaseName ? `${fileBaseName}-sharpcut-project.json` : 'sharpcut-project.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Parse + validate a user-opened project JSON file. Throws a plain-language
 * Error on anything that isn't a recognisable SharpCut project file. */
export async function parseProjectSnapshotFile(file: File): Promise<ProjectSnapshotV1> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new Error("Couldn't read that file.");
  }
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  if (!isValidSnapshot(obj)) {
    throw new Error("That doesn't look like a SharpCut Studio project file.");
  }
  return obj;
}

/** Remove all checkpoint data for a project. */
export async function clearProject(fpKey: string): Promise<void> {
  try {
    const db = await getDb();
    const prefix = `${fpKey}#`;
    const tx = db.transaction(CHUNKS, 'readwrite');
    const toDelete: IDBValidKey[] = [];
    let cursor = await tx.store.openCursor();
    while (cursor) {
      const key = cursor.key as string;
      if (typeof key === 'string' && key.startsWith(prefix)) toDelete.push(cursor.key);
      cursor = await cursor.continue();
    }
    for (const key of toDelete) await tx.store.delete(key);
    await tx.done;
    await db.delete(META, fpKey);
  } catch {
    /* best-effort */
  }
}
