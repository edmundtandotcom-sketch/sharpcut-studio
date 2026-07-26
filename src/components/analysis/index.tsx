import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Loader2, RotateCcw, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { formatTime } from '../../lib/time';
import { runAnalysis, STAGE_LABELS } from '../../lib/pipeline';

function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? '');
  const name = err instanceof Error ? err.name : '';
  if (name === 'NoAudioError' || /no audio/i.test(message)) {
    return 'We couldn’t find an audio track to analyse. Please upload a video that contains speech.';
  }
  if (/memory|allocation|out of|quota/i.test(message)) {
    return 'Your browser ran out of memory while analysing this video. Try closing other tabs, or use a shorter clip.';
  }
  return 'Something went wrong while analysing this video. Your progress was saved — retry to resume where it left off.';
}

export function AnalysisScreen() {
  const file = useAppStore((s) => s.project.file);
  const meta = useAppStore((s) => s.project.meta);
  const pacing = useAppStore((s) => s.project.pacing);
  const progress = useAppStore((s) => s.analysis.progress);
  const error = useAppStore((s) => s.analysis.error);

  const setProgress = useAppStore((s) => s.setAnalysisProgress);
  const setWords = useAppStore((s) => s.setAnalysisWords);
  const setCaptionBlocks = useAppStore((s) => s.setCaptionBlocks);
  const setError = useAppStore((s) => s.setAnalysisError);
  const setCuts = useAppStore((s) => s.edits.setCuts);
  const setAppState = useAppStore((s) => s.setAppState);
  const resetProject = useAppStore((s) => s.resetProject);

  const startedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  // Raw underlying error, surfaced in a collapsible "Technical details" section
  // so failures aren't reduced to an opaque "Something went wrong".
  const [techDetail, setTechDetail] = useState<string | null>(null);

  // Mirror progress into the tab title so it's visible from the tab strip even
  // when this tab is in the background (BUG B). Restored on unmount.
  useEffect(() => {
    const original = document.title;
    return () => {
      document.title = original;
    };
  }, []);
  useEffect(() => {
    if (error) {
      document.title = 'Analysis failed — SharpCut';
      return;
    }
    const pct = Math.round(Math.max(0, Math.min(100, progress?.pct ?? 0)));
    document.title = `▶ ${pct}% — SharpCut`;
  }, [progress?.pct, error]);

  // Elapsed-second ticker (independent of pipeline progress posts).
  useEffect(() => {
    if (error) return;
    const timer = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => window.clearInterval(timer);
  }, [error, retryTick]);

  // Drive the pipeline.
  useEffect(() => {
    if (!file || !meta) {
      setAppState('upload');
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;

    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);

    runAnalysis({ file, meta, pacing, signal: controller.signal }, (p) => setProgress(p))
      .then((result) => {
        if (controller.signal.aborted) return;
        setWords(result.words);
        setCaptionBlocks(result.captionBlocks);
        setCuts(result.cuts);
        setAppState('review');
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const name = err instanceof Error ? err.name : '';
        const msg = err instanceof Error ? err.message : '';
        if (name === 'AbortError' || msg === 'cancelled') return;
        setTechDetail(msg || (err instanceof Error ? err.name : String(err ?? '')) || null);
        setError(friendlyError(err));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryTick]);

  const onCancel = () => {
    abortRef.current?.abort();
    setProgress(null);
    resetProject();
  };

  const onRetry = () => {
    setError(null);
    setTechDetail(null);
    setProgress(null);
    setElapsed(0);
    startedRef.current = false;
    setRetryTick((t) => t + 1);
  };

  const currentStage = progress?.stage ?? 1;
  const overallPct = progress?.pct ?? 0;
  const eta = progress?.etaRangeS;

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <div className="rounded-2xl border border-border bg-surface p-8 shadow-sm sm:p-10">
        {error ? (
          <div role="alert" className="text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-danger/10 text-danger">
              <AlertTriangle className="h-6 w-6" aria-hidden="true" />
            </span>
            <h2 className="mt-5 text-xl font-bold text-ink">Analysis didn&rsquo;t finish</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{error}</p>
            {techDetail && (
              <details className="mt-4 rounded-lg bg-bg px-3 py-2 text-left">
                <summary className="cursor-pointer text-xs font-semibold text-muted">
                  Technical details
                </summary>
                <p className="mt-2 break-words font-mono text-xs leading-relaxed text-muted">
                  {techDetail}
                </p>
              </details>
            )}
            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary/90"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Retry
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex items-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-semibold text-ink hover:bg-bg"
              >
                Start over
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="text-center">
              <h2 className="text-2xl font-black tracking-tight text-ink">
                Building your sharp first cut.
              </h2>
              <p className="mt-2 text-sm text-muted">
                {meta?.fileName ? `Analysing ${meta.fileName}` : 'Analysing your video'} &mdash;
                everything happens on this device.
              </p>
            </div>

            {/* Overall progress */}
            <div className="mt-8">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold text-ink">
                  {progress?.stageLabel ?? STAGE_LABELS[0]}
                </span>
                <span className="tabular-nums font-semibold text-primary">{overallPct}%</span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-border/60">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                  style={{ width: `${Math.min(100, Math.max(2, overallPct))}%` }}
                  role="progressbar"
                  aria-valuenow={overallPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-muted">
                <span className="tabular-nums">Elapsed {formatTime(elapsed)}</span>
                {eta && (
                  <span className="tabular-nums">
                    ~{formatTime(eta[0])}&ndash;{formatTime(eta[1])} remaining
                  </span>
                )}
              </div>
            </div>

            {/* Stage checklist */}
            <ol className="mt-8 space-y-3">
              {STAGE_LABELS.map((label, i) => {
                const stageNum = i + 1;
                const done = stageNum < currentStage;
                const active = stageNum === currentStage;
                return (
                  <li key={label} className="flex items-center gap-3">
                    <span
                      className={[
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                        done
                          ? 'bg-success text-white'
                          : active
                            ? 'bg-primarySoft text-primary'
                            : 'bg-border/50 text-muted',
                      ].join(' ')}
                    >
                      {done ? (
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : active ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        stageNum
                      )}
                    </span>
                    <span
                      className={[
                        'text-sm',
                        done ? 'text-muted line-through' : active ? 'font-semibold text-ink' : 'text-muted',
                      ].join(' ')}
                    >
                      {label}
                    </span>
                  </li>
                );
              })}
            </ol>

            {/* Model-download notice */}
            <p className="mt-8 rounded-lg bg-bg px-4 py-3 text-xs leading-relaxed text-muted">
              The first run downloads a private speech model to your browser (about 40&ndash;80 MB).
              It&rsquo;s cached, so later videos start faster.
            </p>

            <div className="mt-6 flex justify-center">
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex items-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-semibold text-ink hover:bg-bg"
              >
                <X className="h-4 w-4" aria-hidden="true" />
                Cancel analysis
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
