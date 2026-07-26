// ============================================================================
// lib/persist.ts — IndexedDB checkpoints so a cancelled/crashed/retried
// analysis resumes from completed chunks instead of restarting from zero
// (SPEC ">20 minute" requirement). Full project save/load JSON is P6; this
// file provides only the checkpoint plumbing P2 needs.
// ============================================================================

import { openDB, type IDBPDatabase } from 'idb';
import type { WordStamp } from '../types';

const DB_NAME = 'sharpcut-checkpoints';
const DB_VERSION = 1;
const CHUNKS = 'chunks'; // key: `${fpKey}#${index}` -> WordStamp[]
const META = 'meta'; // key: fpKey -> { lastStage }

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
