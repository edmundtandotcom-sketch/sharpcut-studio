// ============================================================================
// lib/captionTiming.ts — the SPEC "Caption timing formula".
//
// Maps caption words from SOURCE time into OUTPUT time (after cuts + speed) via
// the canonical mapping in lib/cuts.ts (sourceToOutput already divides by
// speed — see its signature), builds non-overlapping cues, and shows fewer
// words per cue at faster speeds. Also owns block re-tokenisation for the
// caption text editor (karaoke word timing).
//
// Pure module — NO React imports. Consumed by the preview overlay (P4) and,
// for word timing, by the ASS generator (P5).
// ============================================================================

import type { CaptionBlock, CaptionStyle, Segment, WordStamp } from '../types';
import { sourceToOutput } from './cuts';
import { clamp, id } from './time';
import { wordsPerCueForSize } from './captionLayout';
import { createCaptionLineFitter } from './textMeasure';

/** A word placed on the OUTPUT timeline (seconds), for karaoke highlighting. */
export interface CueWord {
  text: string;
  start: number; // output seconds
  end: number; // output seconds
}

/** A caption cue on the OUTPUT timeline. */
export interface CaptionCue {
  id: string;
  blockId: string;
  start: number; // output seconds
  end: number; // output seconds
  words: CueWord[];
  text: string;
  /**
   * Font-size multiplier for THIS cue only (1 = the style's normal size).
   *
   * Cues are grouped so the line fits the frame, so this is 1 almost always.
   * It drops below 1 in the one case grouping cannot solve: a SINGLE word that
   * is wider than the frame on its own (a long word at a large caption size in
   * a 9:16 frame). Shrinking that cue is the only way to keep it on screen —
   * the alternative is text running off the frame edge.
   */
  scale: number;
}

/**
 * Words shown simultaneously per cue, tightened at faster speeds so captions
 * never lag accelerated speech (SPEC: ≥1.25× → 5, ≥1.5× → 4).
 */
export function wordsPerCue(speed: number): number {
  if (speed >= 1.5) return 4;
  if (speed >= 1.25) return 5;
  return 6;
}

/** Options controlling single-line cue chunking (size + frame aspect). */
export interface CueSizingOptions {
  /** Caption size percentage (50..300). Larger -> fewer words per cue. */
  sizePct?: number;
  /** Output frame aspect (width / height). Narrower -> fewer words per cue. */
  frameAspect?: number;
  /**
   * Resolved caption style. When supplied (and canvas measurement is available)
   * the line is fitted by MEASURING the case-transformed text against the usable
   * frame width, instead of guessing from an average-word-length heuristic.
   * Preview and export must pass equivalent values so their cues match.
   */
  style?: CaptionStyle;
}

/**
 * Final words-per-cue: the tighter of the speed rule and the caption-size rule
 * (SPEC "Caption size": reduce words per line at larger sizes; the ≥1.25× speed
 * reduction composes with this — take the minimum). Always >= 1.
 *
 * This is the FALLBACK sizing model, used when real text measurement is not
 * available (see lib/textMeasure.ts).
 */
export function effectiveWordsPerCue(speed: number, opts: CueSizingOptions = {}): number {
  const bySpeed = wordsPerCue(speed);
  const bySize = wordsPerCueForSize(opts.sizePct ?? 100, opts.frameAspect);
  return Math.max(1, Math.min(bySpeed, bySize));
}

/**
 * Is a source instant inside a kept segment (i.e. not removed)?
 *
 * Binary search — `segments` is always the ordered, non-overlapping output of
 * keptSegments() (or a single explicit range), and this runs per word per
 * caption block, plus once per word in the caption editor's removal preview.
 */
export function isKept(t: number, segments: Segment[]): boolean {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = segments[mid];
    if (t < s.start) hi = mid - 1;
    else if (t >= s.end) lo = mid + 1;
    else return true;
  }
  return false;
}

/**
 * Does a caption word survive the current cuts (i.e. will it produce a cue)?
 *
 * THE single definition of "this word is still visible", shared by cue building
 * and by the caption editor's removed-text indicators — so the editor can never
 * disagree with what preview and export actually render.
 */
export function wordSurvives(w: { start: number; end: number }, segments: Segment[]): boolean {
  const mid = (w.start + w.end) / 2;
  return isKept(mid, segments) || isKept(w.start, segments) || isKept(w.end, segments);
}

const MIN_CUE_S = 0.35; // never flash a cue shorter than this on the output timeline
const GAP_BREAK_OUTPUT_S = 0.5; // start a new cue after a noticeable output-time gap
/**
 * Readability floor for the per-cue shrink, expressed as an EFFECTIVE caption
 * size percentage rather than a flat multiplier. A flat floor is wrong at both
 * ends: at 300% a 0.3× cue is still huge, while at 50% it would be unreadable.
 * Shrinking is therefore allowed down to this effective size and no further.
 */
const MIN_EFFECTIVE_SIZE_PCT = 40;

/**
 * Build OUTPUT-timeline caption cues from source-time caption blocks.
 *
 * For each block:
 *   1. Drop words whose source range is fully removed by active cuts.
 *   2. Map each remaining word's start/end into output time via sourceToOutput
 *      (which already applies the /speed step).
 *   3. Split the block into single-line cues: words are added greedily while the
 *      MEASURED width of the case-transformed line still fits inside the usable
 *      frame width (lib/textMeasure), never exceeding the speed-based word
 *      ceiling wordsPerCue(speed), and always breaking on large output-time
 *      gaps. Without canvas measurement it falls back to effectiveWordsPerCue.
 *   4. Clamp cues so they never overlap and each lasts >= MIN_CUE_S.
 */
export function buildCaptionCues(
  blocks: CaptionBlock[],
  segments: Segment[],
  speed: number,
  sizing: CueSizingOptions = {},
): CaptionCue[] {
  if (segments.length === 0) return [];
  // Real width fitting when we can measure; otherwise the legacy heuristic.
  const fitter = sizing.style ? createCaptionLineFitter(sizing.style, sizing.frameAspect) : null;
  // Hard ceiling: the speed rule still applies even when more words would fit.
  const cap = fitter ? wordsPerCue(speed) : effectiveWordsPerCue(speed, sizing);
  const sizePct = sizing.style?.sizePct ?? sizing.sizePct ?? 100;
  const minScale = Math.min(1, MIN_EFFECTIVE_SIZE_PCT / Math.max(1, sizePct));
  const cues: CaptionCue[] = [];

  for (const block of blocks) {
    // Map + keep only words that survive the cuts.
    const mapped: CueWord[] = [];
    for (const w of block.words) {
      if (!wordSurvives(w, segments)) continue;
      const start = sourceToOutput(w.start, segments, speed);
      const end = Math.max(start, sourceToOutput(w.end, segments, speed));
      mapped.push({ text: w.text, start, end });
    }
    if (mapped.length === 0) continue;
    mapped.sort((a, b) => a.start - b.start);

    // Group into cues by measured width (or word cap) + output-time gap breaks.
    let group: CueWord[] = [];
    let lineWidth = 0;
    const flush = () => {
      if (group.length === 0) return;
      const start = group[0].start;
      const end = Math.max(group[group.length - 1].end, start + MIN_CUE_S);
      // Grouping keeps the line inside the frame; the only thing it cannot fix
      // is one word that is wider than the frame by itself. Shrink just that cue.
      const scale =
        fitter && lineWidth > fitter.usableWidthPx
          ? Math.max(minScale, fitter.usableWidthPx / lineWidth)
          : 1;
      cues.push({
        id: id(),
        blockId: block.id,
        start,
        end,
        words: group,
        text: group.map((w) => w.text).join(' '),
        scale,
      });
      group = [];
      lineWidth = 0;
    };

    for (let i = 0; i < mapped.length; i++) {
      const w = mapped[i];
      const prev = group[group.length - 1];
      const bigGap = prev ? w.start - prev.end > GAP_BREAK_OUTPUT_S : false;
      if (bigGap || group.length >= cap) {
        flush();
      } else if (fitter && group.length > 0) {
        const add = fitter.gapPx + fitter.wordWidthPx(w.text);
        // A first word always goes in — an over-wide single word has nowhere
        // else to go, and a 0-word cue would drop the text entirely.
        if (Number.isFinite(add) && lineWidth + add > fitter.usableWidthPx) flush();
      }
      if (fitter) {
        const ww = fitter.wordWidthPx(w.text);
        lineWidth +=
          (group.length > 0 ? fitter.gapPx : 0) + (Number.isFinite(ww) ? ww : 0);
      }
      group.push(w);
    }
    flush();
  }

  // Global sort + clamp so cues never overlap on the output timeline.
  cues.sort((a, b) => a.start - b.start);
  for (let i = 0; i < cues.length - 1; i++) {
    const next = cues[i + 1];
    if (cues[i].end > next.start) {
      cues[i].end = Math.max(cues[i].start + MIN_CUE_S * 0.5, next.start - 0.01);
    }
  }
  return cues;
}

/** Find the active cue index for an output-time instant, or -1. */
export function activeCueIndex(cues: CaptionCue[], outputTime: number): number {
  // Linear scan is fine — cue counts are modest and this runs per rAF only for
  // the visible cue window in practice.
  for (let i = 0; i < cues.length; i++) {
    if (outputTime >= cues[i].start && outputTime < cues[i].end) return i;
  }
  return -1;
}

/** Active word index within a cue for an output-time instant, or -1. */
export function activeWordIndex(cue: CaptionCue, outputTime: number): number {
  for (let i = 0; i < cue.words.length; i++) {
    const w = cue.words[i];
    const next = cue.words[i + 1];
    const end = next ? next.start : w.end;
    if (outputTime >= w.start && outputTime < Math.max(end, w.end)) return i;
  }
  // Past the last word but still within the cue → keep last word lit.
  if (cue.words.length && outputTime >= cue.words[cue.words.length - 1].start) {
    return cue.words.length - 1;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Re-tokenisation for the caption text editor.
// ---------------------------------------------------------------------------

/**
 * Re-tokenise a caption block after its text was edited. Preserves the block's
 * [start,end] span. Where an edited token matches an original word (case-
 * insensitive), that word's timing is reused; otherwise the block span is
 * distributed across tokens proportionally to token character length so
 * karaoke stays smooth (SPEC: "proportional timing across the block when
 * word-level timing is unavailable").
 */
export function retokenizeBlock(block: CaptionBlock, newText: string): CaptionBlock {
  const text = newText.replace(/\s+/g, ' ').trim();
  const tokens = text.length ? text.split(' ') : [];

  if (tokens.length === 0) {
    return { ...block, text: '', words: [] };
  }

  const span = Math.max(0.001, block.end - block.start);
  const totalChars = tokens.reduce((n, t) => n + Math.max(1, t.length), 0);

  // Index original words by normalised text for reuse (first-match, consumed).
  const pool = new Map<string, WordStamp[]>();
  for (const w of block.words) {
    const key = w.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    if (!key) continue;
    const arr = pool.get(key) ?? [];
    arr.push(w);
    pool.set(key, arr);
  }

  const words: WordStamp[] = [];
  let cursor = block.start;
  for (const tok of tokens) {
    const key = tok.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const reuse = key ? pool.get(key)?.shift() : undefined;
    const share = (Math.max(1, tok.length) / totalChars) * span;
    if (reuse && reuse.start >= block.start - 0.001 && reuse.end <= block.end + 0.001) {
      words.push({ text: tok, start: reuse.start, end: reuse.end, confidence: reuse.confidence });
      cursor = Math.max(cursor, reuse.end);
    } else {
      const start = clamp(cursor, block.start, block.end);
      const end = clamp(start + share, start, block.end);
      words.push({ text: tok, start, end });
      cursor = end;
    }
  }

  return { ...block, text, words };
}
