import { useCallback, useRef, useState } from 'react';
import {
  AlertTriangle,
  Film,
  Loader2,
  Lock,
  UploadCloud,
  Youtube,
  Zap,
} from 'lucide-react';
import type { DragEvent } from 'react';
import { useAppStore } from '../../store/useAppStore';
import type { PacingPreset } from '../../types';
import { ACCEPT_ATTR, validateVideoFile } from './validation';
import { ProjectRecoveryPanel } from './ProjectRecoveryPanel';

type Phase = 'idle' | 'checking' | 'error';

interface PacingCard {
  id: PacingPreset;
  label: string;
  blurb: string;
  icon: typeof Youtube;
}

const PACING_CARDS: PacingCard[] = [
  {
    id: 'youtube',
    label: 'YouTube',
    blurb: 'Natural breathing room. Keeps a relaxed, conversational pace.',
    icon: Youtube,
  },
  {
    id: 'reels',
    label: 'Reels',
    blurb: 'Tighter, faster pacing. Trims aggressively for short-form.',
    icon: Zap,
  },
];

export function UploadScreen() {
  const setProjectFile = useAppStore((s) => s.setProjectFile);
  const setProjectMeta = useAppStore((s) => s.setProjectMeta);
  const setPacing = useAppStore((s) => s.setPacing);
  const setAppState = useAppStore((s) => s.setAppState);
  const pacing = useAppStore((s) => s.project.pacing);

  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState<{ error: string; recovery: string } | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setPhase('checking');
      setErrorMsg(null);
      const objectUrl = URL.createObjectURL(file);
      try {
        const result = await validateVideoFile(file, objectUrl);
        if (!result.ok) {
          URL.revokeObjectURL(objectUrl);
          setErrorMsg({ error: result.error, recovery: result.recovery });
          setPhase('error');
          return;
        }
        // Success: store file + object URL + meta, then start analysis.
        setProjectFile(file, objectUrl);
        setProjectMeta(result.meta);
        setAppState('analysis');
      } catch {
        URL.revokeObjectURL(objectUrl);
        setErrorMsg({
          error: 'Something went wrong while checking this video.',
          recovery: 'Please try a different file, or re-export this one as an H.264 MP4.',
        });
        setPhase('error');
      }
    },
    [setAppState, setProjectFile, setProjectMeta],
  );

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = '';
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    if (phase === 'checking') return;
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (phase !== 'checking') setDragActive(true);
  };
  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
  };

  const checking = phase === 'checking';

  return (
    <div className="mx-auto max-w-4xl px-6 py-12 sm:py-16">
      {/* Hero */}
      <div className="text-center">
        <h1 className="text-4xl font-black tracking-tight text-ink sm:text-5xl">
          Turn long takes into sharp cuts.
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
          Remove filler words, silence, and dead space. Reframe, caption, preview, and
          export&mdash;directly in your browser.
        </p>
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primarySoft px-3 py-1 text-xs font-semibold text-primary">
          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
          Processed locally. Your video stays on this device.
        </p>
      </div>

      {/* Project recovery: resume an autosaved project, or open a saved .json */}
      <div className="mt-8">
        <ProjectRecoveryPanel onModeChange={setRecovering} />
      </div>

      {/* Drop zone */}
      <div className={recovering ? 'hidden' : 'mt-10'}>
        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          role="button"
          tabIndex={0}
          aria-disabled={checking}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !checking) {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onClick={() => {
            if (!checking) inputRef.current?.click();
          }}
          className={[
            'group relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors',
            checking ? 'cursor-wait' : 'cursor-pointer',
            dragActive
              ? 'border-primary bg-primarySoft'
              : 'border-border bg-surface hover:border-primary/60 hover:bg-primarySoft/40',
          ].join(' ')}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_ATTR}
            className="sr-only"
            onChange={onInputChange}
            aria-label="Choose a video file"
          />

          {checking ? (
            <>
              <Loader2 className="h-10 w-10 animate-spin text-primary" aria-hidden="true" />
              <p className="mt-4 text-base font-semibold text-ink">Checking your video&hellip;</p>
              <p className="mt-1 text-sm text-muted">
                Reading duration, format, and audio track.
              </p>
            </>
          ) : (
            <>
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primarySoft text-primary">
                <UploadCloud className="h-7 w-7" aria-hidden="true" />
              </span>
              <p className="mt-4 text-lg font-semibold text-ink">
                Drag &amp; drop your video here
              </p>
              <p className="mt-1 text-sm text-muted">or</p>
              <span className="mt-3 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors group-hover:bg-primary/90">
                <Film className="h-4 w-4" aria-hidden="true" />
                Choose video
              </span>
              <p className="mt-5 text-xs text-muted">
                MP4, MOV, WebM, M4V, or MKV &middot; up to ~2 GB / ~60 minutes recommended
              </p>
            </>
          )}
        </div>

        {/* Validation error */}
        {phase === 'error' && errorMsg && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
            <div>
              <p className="font-semibold text-ink">{errorMsg.error}</p>
              <p className="mt-0.5 text-muted">{errorMsg.recovery}</p>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="mt-2 text-sm font-semibold text-primary hover:underline"
              >
                Choose a different video
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Pacing preset */}
      <div className={recovering ? 'hidden' : 'mt-12'}>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Pacing preset
        </h2>
        <p className="mt-1 text-sm text-muted">
          Sets how aggressively SharpCut trims silence and fillers. You can fine-tune every cut
          afterwards.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {PACING_CARDS.map((card) => {
            const selected = pacing === card.id;
            const Icon = card.icon;
            return (
              <button
                key={card.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setPacing(card.id)}
                className={[
                  'flex items-start gap-3 rounded-xl border p-4 text-left transition-colors',
                  selected
                    ? 'border-primary bg-primarySoft ring-1 ring-primary'
                    : 'border-border bg-surface hover:border-primary/50',
                ].join(' ')}
              >
                <span
                  className={[
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                    selected ? 'bg-primary text-white' : 'bg-primarySoft text-primary',
                  ].join(' ')}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span>
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{card.label}</span>
                    {card.id === 'youtube' && (
                      <span className="rounded-full bg-border/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                        Default
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted">
                    {card.blurb}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
