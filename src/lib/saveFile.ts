/**
 * "Save as…" — let the browser ask WHERE, instead of silently dropping every
 * export into the Downloads folder.
 *
 * `showSaveFilePicker` (File System Access API) is Chromium-only, so this is a
 * pure progressive enhancement: feature-detected at the call site, with the
 * anchor-download that shipped before as the fallback. Nothing here depends on
 * the origin — it behaves identically on the Cloudflare build and inside the
 * local Studio shell, because the API is gated on a secure context and a user
 * gesture, both of which hold in both places.
 *
 * Three outcomes have to stay distinct, and conflating any two of them is the
 * whole risk of this change:
 *
 *  - **picked** -> write the bytes there;
 *  - **cancelled** (`AbortError`) -> do nothing, report nothing. A cancel is a
 *    decision, not a failure, and an error toast for it teaches people to
 *    ignore error toasts;
 *  - **refused** (`SecurityError`, `NotAllowedError`, a sandboxed frame, no
 *    API at all) -> fall through to the anchor, which still works everywhere.
 */

function anchorDownload(url: string, suggestedName: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

type PickerFn = (opts: {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandle>;

function picker(): PickerFn | null {
  const fn = (window as unknown as { showSaveFilePicker?: PickerFn }).showSaveFilePicker;
  return typeof fn === 'function' ? fn.bind(window) : null;
}

/** Ask for a destination, returning null when there is no API or it refused,
 *  and `'cancelled'` when the user dismissed the dialog. */
async function askWhere(
  suggestedName: string,
  mime: string,
  description: string,
): Promise<FileSystemFileHandle | null | 'cancelled'> {
  const show = picker();
  if (!show) return null;
  const dot = suggestedName.lastIndexOf('.');
  const ext = dot > 0 ? suggestedName.slice(dot) : '';
  try {
    return await show({
      suggestedName,
      types: ext ? [{ description, accept: { [mime]: [ext] } }] : undefined,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
    return null;
  }
}

/** Save an in-memory blob, offering a destination picker where one exists. */
export async function saveBlobAs(
  blob: Blob,
  suggestedName: string,
  mime: string,
  description: string,
): Promise<void> {
  const handle = await askWhere(suggestedName, mime, description);
  if (handle === 'cancelled') return;
  if (handle) {
    const writable = await handle.createWritable();
    await blob.stream().pipeTo(writable);
    return;
  }
  const url = URL.createObjectURL(blob);
  anchorDownload(url, suggestedName);
  // Revoke shortly after the download starts, as the previous code did.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** True when a destination picker is worth offering at all. Callers use this
 *  to decide whether to intercept their own `<a download>` — a link that is
 *  never intercepted is the exact behaviour that shipped before. */
export function canPickDestination(): boolean {
  return picker() !== null;
}

/**
 * Save what a URL points at. Used for the export results, which are blob: URLs
 * for finished renders — streamed rather than buffered with `.blob()`, because
 * a long export is hundreds of megabytes and reading the whole thing into the
 * tab to write it straight back out is exactly what this API exists to avoid.
 *
 * The anchor fallback is built HERE, from a throwaway element, rather than by
 * re-clicking the caller's link: that link carries the interception handler,
 * so re-clicking it would ask the picker again, be refused again, and loop.
 */
export async function saveUrlAs(
  url: string,
  suggestedName: string,
  mime: string,
  description: string,
): Promise<void> {
  const handle = await askWhere(suggestedName, mime, description);
  if (handle === 'cancelled') return;
  if (!handle) {
    anchorDownload(url, suggestedName);
    return;
  }
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText}`);
  const writable = await handle.createWritable();
  await res.body.pipeTo(writable);
}
