import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useAppStore } from './store/useAppStore';
import { checkFeatures } from './lib/featureCheck';
import { Header } from './components/shared/Header';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { StudioBackBar } from './components/shared/StudioBackBar';
import { PersistenceController } from './components/shared/PersistenceController';
import { UploadScreen } from './components/upload';
import { AnalysisScreen } from './components/analysis';
import { ReviewScreen } from './components/review';
import { StudioScreen } from './components/studio';
import { ExportScreen } from './components/export';
import { ExportController } from './components/export/ExportController';

function UnsupportedBrowserBanner({ reasons }: { reasons: string[] }) {
  return (
    <div className="border-b border-danger/30 bg-danger/10 px-6 py-3">
      <div className="mx-auto flex max-w-6xl items-start gap-3 text-sm text-ink">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
        <div>
          <p className="font-semibold">This browser may not fully support SharpCut Studio.</p>
          <p className="mt-0.5 text-muted">
            SharpCut Studio is built for desktop Chrome or Edge. {reasons.join(' ')}
          </p>
        </div>
      </div>
    </div>
  );
}

function App() {
  const appState = useAppStore((s) => s.appState);
  const features = useMemo(() => checkFeatures(), []);

  return (
    <div className="min-h-screen bg-bg">
      {/* Accessibility: keyboard users can jump straight past the header. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>

      {/* Local Studio shell only — renders nothing on the deployed site. */}
      <StudioBackBar />
      <Header />
      {!features.supported && <UnsupportedBrowserBanner reasons={features.reasons} />}

      {/* Error boundary sits below Header so the wordmark, trust badge, and
       * Save-project control stay visible and usable even if a screen crashes. */}
      <ErrorBoundary>
        <main id="main-content">
          {appState === 'upload' && <UploadScreen />}
          {appState === 'analysis' && <AnalysisScreen />}
          {appState === 'review' && <ReviewScreen />}
          {appState === 'studio' && <StudioScreen />}
          {appState === 'complete' && <ExportScreen />}
        </main>

        {/* Drives the FFmpeg export engine + renders the export overlay over any state. */}
        <ExportController />
      </ErrorBoundary>

      {/* Autosaves the full project snapshot (SPEC "LOCAL PROJECT RECOVERY"). */}
      <PersistenceController />
    </div>
  );
}

export default App;
