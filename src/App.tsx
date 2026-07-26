import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useAppStore } from './store/useAppStore';
import { checkFeatures } from './lib/featureCheck';
import { Header } from './components/shared/Header';
import { UploadScreen } from './components/upload';
import { AnalysisScreen } from './components/analysis';
import { ReviewScreen } from './components/review';
import { StudioScreen } from './components/studio';
import { ExportScreen } from './components/export';

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
      <Header />
      {!features.supported && <UnsupportedBrowserBanner reasons={features.reasons} />}

      <main>
        {appState === 'upload' && <UploadScreen />}
        {appState === 'analysis' && <AnalysisScreen />}
        {appState === 'review' && <ReviewScreen />}
        {appState === 'studio' && <StudioScreen />}
        {appState === 'complete' && <ExportScreen />}
      </main>
    </div>
  );
}

export default App;
