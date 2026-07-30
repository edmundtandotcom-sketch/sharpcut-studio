import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { CaptionStyle } from '../../types';
import {
  applyCase,
  getCaptionRenderSpec,
  type CaptionRenderSpec,
} from '../../lib/captionLayout';
import {
  activeCueIndex,
  activeWordIndex,
  type CaptionCue,
  type CueWord,
} from '../../lib/captionTiming';

interface Props {
  cues: CaptionCue[];
  outputTime: number;
  style: CaptionStyle;
  /** Fraction of frame height used as the 100% caption base size (default 0.055). */
  baseFraction?: number;
  /** Pointer-down on the caption block (for drag-to-reposition). */
  onBlockPointerDown?: (e: ReactPointerEvent) => void;
}

// Keyframes injected once — Artifacts/preview safe (self-contained).
const KEYFRAMES = `
@keyframes sc-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes sc-pop { from { opacity: 0; transform: scale(.82) } 60% { transform: scale(1.04) } to { opacity: 1; transform: scale(1) } }
@keyframes sc-bounce { 0% { opacity: 0; transform: translateY(28%) scale(.9) } 55% { transform: translateY(-8%) scale(1.03) } 100% { opacity: 1; transform: translateY(0) scale(1) } }
@keyframes sc-slideUp { from { opacity: 0; transform: translateY(40%) } to { opacity: 1; transform: translateY(0) } }
@keyframes sc-bannerIn { from { opacity: 0; transform: translateX(-14%); clip-path: inset(0 100% 0 0) } to { opacity: 1; transform: translateX(0); clip-path: inset(0 0 0 0) } }
@keyframes sc-word { from { opacity: 0; transform: scale(.6) } to { opacity: 1; transform: scale(1) } }
`;

function animationCss(spec: CaptionRenderSpec): string | undefined {
  switch (spec.animation) {
    case 'fade':
      return 'sc-fade 200ms ease-out';
    case 'pop':
      return 'sc-pop 220ms cubic-bezier(.2,.9,.3,1.2)';
    case 'bounce':
      return 'sc-bounce 340ms cubic-bezier(.2,.8,.2,1)';
    case 'slideUp':
      return 'sc-slideUp 240ms ease-out';
    case 'bannerIn':
      return 'sc-bannerIn 260ms ease-out';
    default:
      return undefined;
  }
}

/** Vertical anchor (% of frame height) for a caption position. */
function anchorPct(style: CaptionStyle): number {
  switch (style.position) {
    case 'top':
      return 13;
    case 'center':
      return 50;
    case 'bottom':
      return 83;
    case 'custom':
    default:
      return Math.min(94, Math.max(6, style.customYPct));
  }
}

export function CaptionOverlay({
  cues,
  outputTime,
  style,
  baseFraction = 0.055,
  onBlockPointerDown,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [frameH, setFrameH] = useState(400);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (h && h > 0) setFrameH(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const baseFontPx = Math.max(10, frameH * baseFraction);
  const spec = useMemo(() => getCaptionRenderSpec(style, baseFontPx), [style, baseFontPx]);

  const cueIdx = activeCueIndex(cues, outputTime);
  const cue: CaptionCue | undefined = cueIdx >= 0 ? cues[cueIdx] : undefined;

  if (style.preset === 'none') {
    return <div ref={ref} className="pointer-events-none absolute inset-0" aria-hidden="true" />;
  }

  const effectiveCase =
    style.case === 'original' && spec.preset.uppercaseDefault ? 'upper' : style.case;

  const wordIdx = cue ? activeWordIndex(cue, outputTime) : -1;
  const top = anchorPct(style);
  const isLeft = spec.align === 'left';

  const containerStyle: CSSProperties = {
    position: 'absolute',
    left: isLeft ? '5%' : '50%',
    top: `${top}%`,
    transform: isLeft ? 'translateY(-50%)' : 'translate(-50%, -50%)',
    maxWidth: '90%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: isLeft ? 'flex-start' : 'center',
    gap: `${Math.round(baseFontPx * 0.12)}px`,
    pointerEvents: onBlockPointerDown ? 'auto' : 'none',
    cursor: onBlockPointerDown ? 'grab' : 'default',
  };

  // Per-cue shrink for a single word too wide for the frame (lib/captionTiming).
  // Everything sized off the font must scale with it or the box stops hugging
  // the text — and the ASS export applies the same factor via \fscx/\fscy.
  const cueScale = cue && Number.isFinite(cue.scale) && cue.scale > 0 ? cue.scale : 1;
  const fontPx = spec.fontSizePx * cueScale;

  // Block-level background (block / banner / lowerThird).
  const blockBg = spec.boxMode === 'block' || spec.boxMode === 'banner' || spec.boxMode === 'lowerThird';
  const blockStyle: CSSProperties = {
    fontFamily: spec.fontFamily,
    fontWeight: spec.fontWeight,
    fontSize: `${fontPx}px`,
    letterSpacing: spec.letterSpacing,
    lineHeight: spec.lineHeight,
    textAlign: spec.align,
    color: spec.textColor,
    display: 'inline-flex',
    flexDirection: 'column',
    alignItems: isLeft ? 'flex-start' : 'center',
    padding: blockBg ? `${spec.paddingY * cueScale}px ${spec.paddingX * cueScale}px` : 0,
    background: blockBg ? spec.backgroundColor : 'transparent',
    borderRadius: `${spec.borderRadius}px`,
    borderLeft: spec.accentEdge ? `${Math.max(3, Math.round(fontPx * 0.16))}px solid ${spec.accentColor}` : undefined,
    boxShadow: blockBg ? '0 2px 10px rgba(0,0,0,0.25)' : undefined,
    maxWidth: '100%',
  };

  const renderWord = (w: CueWord, gi: number) => {
    const active = spec.activeWordHighlight && gi === wordIdx;
    const text = applyCase(w.text, effectiveCase);
    const wStyle: CSSProperties = {
      display: 'inline-block',
      textShadow: spec.boxMode === 'none' || spec.boxMode === 'bar' || spec.boxMode === 'perWord'
        ? spec.textShadow
        : 'none',
      color: active && spec.boxMode !== 'bar' ? spec.accentColor : spec.textColor,
      transition: 'color 90ms linear',
    };
    if (spec.boxMode === 'perWord') {
      wStyle.background = spec.backgroundColor;
      wStyle.padding = `${Math.round(spec.paddingY * cueScale * 0.5)}px ${Math.round(spec.paddingX * cueScale * 0.5)}px`;
      wStyle.borderRadius = `${spec.borderRadius || 6}px`;
    }
    if (spec.boxMode === 'bar' && active) {
      wStyle.background = spec.accentColor;
      wStyle.color = spec.textColor;
      wStyle.padding = `0 ${Math.round(fontPx * 0.14)}px`;
      wStyle.borderRadius = `${spec.borderRadius}px`;
    }
    if (active && spec.animation === 'wordByWord') {
      wStyle.animation = 'sc-word 140ms ease-out';
    }
    return (
      <span key={gi} style={wStyle}>
        {text}
      </span>
    );
  };

  let body: ReactNode = null;
  if (cue) {
    if (spec.preset.id === 'wordPop') {
      // One word at a time — show the active word (or first if none active yet).
      const idx = wordIdx >= 0 ? wordIdx : 0;
      const w = cue.words[idx];
      body = (
        <div key={`${cue.id}-${idx}`} style={blockStyle}>
          <div style={{ display: 'flex' }}>{w ? renderWord(w, idx) : null}</div>
        </div>
      );
    } else {
      // Captions are ALWAYS a single line — the cue word count is already
      // chosen (lib/captionTiming) to fit the frame width at the current size,
      // so we render one non-wrapping row (SPEC "Caption size": single line,
      // fewer words at larger sizes; never shrink letters independently).
      body = (
        <div key={cue.id} style={{ ...blockStyle, animation: animationCss(spec) }}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'nowrap',
              whiteSpace: 'nowrap',
              justifyContent: isLeft ? 'flex-start' : 'center',
              gap: `${Math.round(fontPx * 0.28)}px`,
            }}
          >
            {cue.words.map((w, i) => renderWord(w, i))}
          </div>
        </div>
      );
    }
  }

  return (
    <div ref={ref} className="absolute inset-0 overflow-hidden" aria-hidden="true">
      <style>{KEYFRAMES}</style>
      {body && (
        <div style={containerStyle} onPointerDown={onBlockPointerDown}>
          {body}
        </div>
      )}
    </div>
  );
}
