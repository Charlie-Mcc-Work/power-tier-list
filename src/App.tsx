import { useEffect, useRef } from 'react';
import { AppShell } from './components/layout/AppShell';
import { HomePage } from './components/home/HomePage';
import { PresentationView } from './components/tier-list/PresentationView';
import { SnapshotManager } from './components/layout/SnapshotManager';
import { useUIStore } from './stores/ui-store';
import { autoSnapshotOnStart } from './db/export-import';

function App() {
  const page = useUIStore((s) => s.page);
  const presenting = useUIStore((s) => s.presenting);
  const didSnapshot = useRef(false);

  useEffect(() => {
    if (!didSnapshot.current) {
      didSnapshot.current = true;
      autoSnapshotOnStart();
    }
  }, []);

  return (
    <>
      {page === 'home' ? <HomePage /> : <AppShell />}
      {presenting && <PresentationView />}
      <SnapshotManager />
    </>
  );
}

export default App;
