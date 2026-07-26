// ============================================================================
// lib/fillerDetect.ts — pure filler-word detection + scoring from transcript
// word stamps. Scoring follows SPEC "Filler words" signals.
// ============================================================================

import type { WordStamp } from '../types';
import { clamp } from './time';

export interface FillerCandidate {
  wordIndices: number[]; // indices into the words array
  start: number; // source seconds
  end: number;
  text: string; // normalized surface form, e.g. "you know"
  score: number; // 0..1
  active: boolean; // score >= threshold
  reason: string;
}

export interface FillerOptions {
  /** Active threshold: 0.6 for YouTube, 0.5 for Reels. */
  activeThreshold: number;
}

type FillerClass = 'sound' | 'hedge' | 'adverb';

// Non-word filler sounds (strongest signal).
const SOUNDS = new Set(['um', 'umm', 'uh', 'uhh', 'uhm', 'erm', 'err', 'ah', 'mm', 'hmm', 'mmm']);
// Single-word adverbs that are often (but not always) filler.
const ADVERBS = new Set(['basically', 'actually', 'literally']);
// Multi-word hedges (matched as consecutive words, longest first).
const MULTI_HEDGES: string[][] = [
  ['you', 'know'],
  ['sort', 'of'],
  ['kind', 'of'],
  ['i', 'mean'],
];

const BASE_SCORE: Record<FillerClass, number> = {
  sound: 0.9,
  hedge: 0.55,
  adverb: 0.45,
};

const PAUSE_GAP_S = 0.25; // gap that counts as an adjacent pause
const PAUSE_BONUS = 0.15;
const SEMANTIC_PENALTY = 0.2; // hedges/adverbs used meaningfully mid-sentence
const PROXIMITY_S = 1.5;
const PROXIMITY_PENALTY = 0.1;

/** lowercase, strip punctuation, keep apostrophes/letters/digits. */
function norm(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9']/g, '');
}

/** True when this word begins a sentence (index 0 or prev word ends with .!?). */
function isSentenceInitial(words: WordStamp[], index: number): boolean {
  if (index === 0) return true;
  const prev = words[index - 1]?.text?.trim() ?? '';
  return /[.!?]$/.test(prev);
}

export function detectFillers(words: WordStamp[], opts: FillerOptions): FillerCandidate[] {
  if (words.length === 0) return [];
  const normed = words.map((w) => norm(w.text));

  interface Raw {
    indices: number[];
    cls: FillerClass;
    base: number;
  }
  const raws: Raw[] = [];

  let i = 0;
  while (i < words.length) {
    let matched = false;
    for (const phrase of MULTI_HEDGES) {
      if (i + phrase.length <= words.length && phrase.every((p, k) => normed[i + k] === p)) {
        const indices = phrase.map((_, k) => i + k);
        raws.push({ indices, cls: 'hedge', base: BASE_SCORE.hedge });
        i += phrase.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    const w = normed[i];
    if (SOUNDS.has(w)) raws.push({ indices: [i], cls: 'sound', base: BASE_SCORE.sound });
    else if (ADVERBS.has(w)) raws.push({ indices: [i], cls: 'adverb', base: BASE_SCORE.adverb });
    i++;
  }

  // Center times for proximity check.
  const centers = raws.map((r) => {
    const first = words[r.indices[0]];
    const last = words[r.indices[r.indices.length - 1]];
    return (first.start + last.end) / 2;
  });

  const candidates: FillerCandidate[] = [];
  for (let idx = 0; idx < raws.length; idx++) {
    const r = raws[idx];
    const firstIdx = r.indices[0];
    const lastIdx = r.indices[r.indices.length - 1];
    const start = words[firstIdx].start;
    const end = words[lastIdx].end;

    const before = words[firstIdx - 1];
    const after = words[lastIdx + 1];
    const gapBefore = before ? start - before.end : Infinity; // edge = treated as pause
    const gapAfter = after ? after.start - end : Infinity;
    const hasPause = gapBefore >= PAUSE_GAP_S || gapAfter >= PAUSE_GAP_S;

    let score = r.base;
    if (hasPause) score += PAUSE_BONUS;

    // Semantic-meaning penalty: adverbs/hedges that are neither sentence-initial
    // nor surrounded by pauses are probably meaningful, not filler.
    if (r.cls !== 'sound' && !isSentenceInitial(words, firstIdx) && !hasPause) {
      score -= SEMANTIC_PENALTY;
    }

    // Proximity penalty: another candidate within 1.5s.
    const near = centers.some((c, j) => j !== idx && Math.abs(c - centers[idx]) < PROXIMITY_S);
    if (near) score -= PROXIMITY_PENALTY;

    score = clamp(score, 0, 1);
    const text = r.indices.map((k) => words[k].text).join(' ').replace(/\s+/g, ' ').trim();
    // Display label: normalise each word individually and re-join with spaces so
    // multi-word phrases keep their spaces (e.g. "you know", not "youknow").
    const label = r.indices.map((k) => normed[k]).filter(Boolean).join(' ') || text;
    const reason = `Filler — "${label}"${hasPause ? ' with pause' : ''}`;

    candidates.push({
      wordIndices: r.indices,
      start,
      end,
      text,
      score,
      active: score >= opts.activeThreshold,
      reason,
    });
  }

  return candidates;
}
