// ============================================================================
// lib/suggest.ts — merge filler + silence candidates into Cut[], build
// CaptionBlock[] from words, and merge per-chunk transcription output with
// deterministic overlap dedup. Pure + unit-testable.
// ============================================================================

import type { CaptionBlock, Cut, PacingPreset, WordStamp } from '../types';
import { coalesceCuts } from './cuts';
import { detectFillers, type FillerCandidate } from './fillerDetect';
import { detectSilence, type SilenceRange } from './silenceDetect';
import { clamp, id } from './time';

/** Pacing defaults (SPEC "Silence" + filler active thresholds). */
export const PACING_DEFAULTS: Record<
  PacingPreset,
  {
    minSilenceS: number;
    keepBeforeS: number;
    keepAfterS: number;
    fillerActiveThreshold: number;
  }
> = {
  youtube: { minSilenceS: 0.8, keepBeforeS: 0.25, keepAfterS: 0.2, fillerActiveThreshold: 0.6 },
  reels: { minSilenceS: 0.45, keepBeforeS: 0.12, keepAfterS: 0.08, fillerActiveThreshold: 0.5 },
};

const CAPTION_MAX_WORDS = 7;
const CAPTION_GAP_BREAK_S = 0.6;
const CONTEXT_WORDS = 4;

/** ±4 words of transcript context around a set of word indices. */
function contextAround(words: WordStamp[], indices: number[]): string {
  if (indices.length === 0) return '';
  const first = indices[0];
  const last = indices[indices.length - 1];
  const from = Math.max(0, first - CONTEXT_WORDS);
  const to = Math.min(words.length, last + CONTEXT_WORDS + 1);
  return words
    .slice(from, to)
    .map((w) => w.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface BuildSuggestionsInput {
  words: WordStamp[];
  silence: SilenceRange[];
  fillers: FillerCandidate[];
  duration: number;
}

export interface BuildSuggestionsResult {
  cuts: Cut[];
  captionBlocks: CaptionBlock[];
}

/** Build the suggested Cut[] (fillers + silence, overlaps resolved) + caption blocks. */
export function buildSuggestions(input: BuildSuggestionsInput): BuildSuggestionsResult {
  const { words, silence, fillers } = input;
  const raw: Cut[] = [];

  for (const f of fillers) {
    raw.push({
      id: id(),
      type: 'filler',
      start: f.start,
      end: f.end,
      reason: f.reason,
      active: f.active,
      confidence: Math.round(f.score * 100) / 100,
      transcriptContext: contextAround(words, f.wordIndices),
    });
  }

  for (const s of silence) {
    const dur = s.end - s.start;
    raw.push({
      id: id(),
      type: 'silence',
      start: s.start,
      end: s.end,
      reason: `Silence — ${dur.toFixed(1)}s pause`,
      active: true,
      confidence: clamp(0.5 + dur * 0.2, 0, 0.95),
      transcriptContext: '',
    });
  }

  const cuts = coalesceCuts(raw);
  const captionBlocks = buildCaptionBlocks(words);
  return { cuts, captionBlocks };
}

/**
 * Build caption blocks: ≤7 words each, breaking at gaps > 0.6s or sentence
 * punctuation. Each block carries its own words (for karaoke) + joined text.
 */
export function buildCaptionBlocks(words: WordStamp[]): CaptionBlock[] {
  const blocks: CaptionBlock[] = [];
  let cur: WordStamp[] = [];

  const flush = () => {
    if (cur.length === 0) return;
    const text = cur.map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim();
    blocks.push({
      id: id(),
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      words: [...cur],
      text,
    });
    cur = [];
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    cur.push(w);
    const next = words[i + 1];
    const endsSentence = /[.!?]$/.test(w.text.trim());
    const bigGap = next ? next.start - w.end > CAPTION_GAP_BREAK_S : false;
    if (cur.length >= CAPTION_MAX_WORDS || endsSentence || bigGap) flush();
  }
  flush();
  return blocks;
}

/**
 * Merge per-chunk word lists (each already offset to absolute source time) into
 * one drift-free list. In each 2s overlap the split point is
 * (laterChunkStart + overlap/2): earlier words before it are kept, later words
 * from it onward replace them — deterministic, no drift, no dupes.
 */
export function mergeChunkWords(
  perChunk: WordStamp[][],
  chunkStarts: number[],
  overlapS: number,
): WordStamp[] {
  const merged: WordStamp[] = [];
  for (let i = 0; i < perChunk.length; i++) {
    const ws = perChunk[i];
    if (i === 0) {
      merged.push(...ws);
      continue;
    }
    const boundary = chunkStarts[i] + overlapS / 2;
    while (merged.length && merged[merged.length - 1].start >= boundary) merged.pop();
    for (const w of ws) {
      if (w.start >= boundary) merged.push(w);
    }
  }
  merged.sort((a, b) => a.start - b.start);
  return merged;
}

// Re-export the detection helpers so the pipeline has a single import surface.
export { detectFillers, detectSilence };
