export interface FeatureSupport {
  webAssembly: boolean;
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  offscreenCanvas: boolean;
  supported: boolean;
  reasons: string[];
}

/**
 * Checks the runtime capabilities SharpCut Studio depends on: WebAssembly,
 * cross-origin isolation (required for SharedArrayBuffer / multithreaded
 * FFmpeg), and OffscreenCanvas (optional, used opportunistically).
 */
export function checkFeatures(): FeatureSupport {
  const reasons: string[] = [];

  const webAssembly = typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
  if (!webAssembly) reasons.push('WebAssembly is not available in this browser.');

  const crossOriginIsolated = typeof window !== 'undefined' && window.crossOriginIsolated === true;
  const sharedArrayBuffer = typeof SharedArrayBuffer === 'function';
  if (!crossOriginIsolated || !sharedArrayBuffer) {
    reasons.push('Cross-origin isolation (required for local video processing) is not active.');
  }

  const offscreenCanvas = typeof OffscreenCanvas !== 'undefined';

  return {
    webAssembly,
    crossOriginIsolated,
    sharedArrayBuffer,
    offscreenCanvas,
    supported: webAssembly && crossOriginIsolated && sharedArrayBuffer,
    reasons,
  };
}
