import { CoverageBanner } from './ui/CoverageBanner';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { Header } from './ui/Header';
import { Inspector } from './ui/Inspector';
import { ResultsTabs } from './ui/ResultsTabs';
import { ScenarioPanel } from './ui/ScenarioPanel';
import { AppProvider } from './ui/state';
import { ReasonerProvider } from './ui/useReasoner';
import { WorkflowCanvas } from './ui/WorkflowCanvas';

function Workspace() {
  return (
    <div className="workspace">
      <Header />
      <div className="workspace__left">
        <ScenarioPanel />
      </div>
      <main className="workspace__center">
        <CoverageBanner />
        <ErrorBoundary label="Workflow canvas">
          <WorkflowCanvas />
        </ErrorBoundary>
      </main>
      <div className="workspace__right">
        <ErrorBoundary label="Inspector">
          <Inspector />
        </ErrorBoundary>
      </div>
      <div className="workspace__bottom">
        <ErrorBoundary label="Results">
          <ResultsTabs />
        </ErrorBoundary>
      </div>
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <ReasonerProvider>
        <Workspace />
      </ReasonerProvider>
    </AppProvider>
  );
}
