import type { CSSProperties } from 'react';
import type { CaptionStyle } from '../../types';
import { applyCase, getCaptionRenderSpec } from '../../lib/captionLayout';

interface Props {
  style: CaptionStyle;
  text?: string;
  /** Height of the sample stage in px (drives base font size). */
  stageHeight?: number;
  activeWord?: number;
}

/**
 * Static, styled sample of a caption preset for preset/font cards. Mirrors the
 * live overlay's styling (same getCaptionRenderSpec source of truth) so cards
 * predict the real result.
 */
export function CaptionSample({ style, text = 'Your caption here', stageHeight = 56, activeWord = 1 }: Props) {
  const spec = getCaptionRenderSpec(style, stageHeight * 0.2);
  if (style.preset === 'none') {
    return (
      <div
        className="flex items-center justify-center rounded-lg bg-ink/90 text-[11px] font-medium text-white/60"
        style={{ height: stageHeight }}
      >
        No captions
      </div>
    );
  }

  const effectiveCase =
    style.case === 'original' && spec.preset.uppercaseDefault ? 'upper' : style.case;
  const words = text.split(' ');
  const blockBg = spec.boxMode === 'block' || spec.boxMode === 'banner' || spec.boxMode === 'lowerThird';

  const stage: CSSProperties = {
    height: stageHeight,
    background: 'linear-gradient(135deg,#334155,#0f172a)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: spec.align === 'left' ? 'flex-start' : 'center',
    padding: spec.align === 'left' ? '0 8px' : '0 6px',
    overflow: 'hidden',
  };

  const block: CSSProperties = {
    fontFamily: spec.fontFamily,
    fontWeight: spec.fontWeight,
    fontSize: `${spec.fontSizePx}px`,
    letterSpacing: spec.letterSpacing,
    lineHeight: 1.15,
    color: spec.textColor,
    display: 'inline-flex',
    flexWrap: 'wrap',
    gap: `${spec.fontSizePx * 0.28}px`,
    alignItems: 'center',
    justifyContent: spec.align === 'left' ? 'flex-start' : 'center',
    padding: blockBg ? `${spec.paddingY}px ${spec.paddingX}px` : 0,
    background: blockBg ? spec.backgroundColor : 'transparent',
    borderRadius: spec.borderRadius,
    borderLeft: spec.accentEdge
      ? `${Math.max(2, spec.fontSizePx * 0.16)}px solid ${spec.accentColor}`
      : undefined,
    maxWidth: '100%',
  };

  const shown = spec.preset.id === 'wordPop' ? [words[activeWord] ?? words[0]] : words;

  return (
    <div className="overflow-hidden rounded-lg" style={stage}>
      <div style={block}>
        {shown.map((w, i) => {
          const realIdx = spec.preset.id === 'wordPop' ? activeWord : i;
          const active = spec.activeWordHighlight && realIdx === activeWord;
          const ws: CSSProperties = {
            display: 'inline-block',
            color: active && spec.boxMode !== 'bar' ? spec.accentColor : spec.textColor,
            textShadow:
              spec.boxMode === 'none' || spec.boxMode === 'bar' || spec.boxMode === 'perWord'
                ? spec.textShadow
                : 'none',
          };
          if (spec.boxMode === 'perWord') {
            ws.background = spec.backgroundColor;
            ws.padding = `1px 4px`;
            ws.borderRadius = spec.borderRadius || 5;
          }
          if (spec.boxMode === 'bar' && active) {
            ws.background = spec.accentColor;
            ws.color = spec.textColor;
            ws.padding = '0 3px';
            ws.borderRadius = spec.borderRadius;
          }
          return (
            <span key={i} style={ws}>
              {applyCase(w, effectiveCase)}
            </span>
          );
        })}
      </div>
    </div>
  );
}
