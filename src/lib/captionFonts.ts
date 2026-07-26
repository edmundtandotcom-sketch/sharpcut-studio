// ============================================================================
// lib/captionFonts.ts — maps each CaptionFontId onto the self-hosted .ttf that
// libass loads at export time. @fontsource ships woff2 (which libass cannot
// read), so P5 bundles one .ttf per family in public/fonts/ (see
// public/fonts/LICENSE.txt). Only the ONE font the caption style actually uses
// is fetched and written into the FFmpeg FS.
//
// The `assFamily` MUST equal the font's internal family name so libass matches
// it via fontsdir. Values come from CAPTION_FONTS[id].assFamily (single source
// of truth in captionLayout.ts).
//
// Pure module — NO React imports.
// ============================================================================

import type { CaptionFontId } from '../types';
import { CAPTION_FONTS } from './captionLayout';

export interface FontAsset {
  /** File name inside public/fonts and inside the FFmpeg FS /fonts dir. */
  fsName: string;
  /** Public URL to fetch the .ttf from (respects the deploy base path). */
  url: string;
  /** libass family name (must match the .ttf internal family). */
  assFamily: string;
}

/** assFamily -> bundled .ttf file name in public/fonts/. */
const FAMILY_FILE: Record<string, string> = {
  Inter: 'Inter-Bold.ttf',
  'Playfair Display': 'PlayfairDisplay-SemiBold.ttf',
  'Archivo Black': 'ArchivoBlack-Regular.ttf',
  Nunito: 'Nunito-ExtraBold.ttf',
  'Barlow Condensed': 'BarlowCondensed-SemiBold.ttf',
  'Courier Prime': 'CourierPrime-Bold.ttf',
  Montserrat: 'Montserrat-Bold.ttf',
  'Bebas Neue': 'BebasNeue-Regular.ttf',
  Poppins: 'Poppins-SemiBold.ttf',
  Oswald: 'Oswald-SemiBold.ttf',
};

const FALLBACK_FILE = 'Inter-Bold.ttf';

function base(): string {
  // Vite injects BASE_URL; default '/'. Guard for non-Vite (test) contexts.
  try {
    return import.meta.env?.BASE_URL ?? '/';
  } catch {
    return '/';
  }
}

/** Resolve the single font asset a caption style needs for burn-in. */
export function fontAssetFor(fontId: CaptionFontId): FontAsset {
  const spec = CAPTION_FONTS[fontId] ?? CAPTION_FONTS.modern;
  const fsName = FAMILY_FILE[spec.assFamily] ?? FALLBACK_FILE;
  const b = base();
  const prefix = b.endsWith('/') ? b : `${b}/`;
  return { fsName, url: `${prefix}fonts/${fsName}`, assFamily: spec.assFamily };
}
