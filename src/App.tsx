import { useEffect, useRef } from 'react';
import { AppShell } from './components/layout/AppShell';
import { HomePage } from './components/home/HomePage';
import { PresentationView } from './components/tier-list/PresentationView';
import { SnapshotManager } from './components/layout/SnapshotManager';
import { HelpPanel } from './components/layout/HelpPanel';
import { SyncPanel } from './components/layout/SyncPanel';
import { useUIStore } from './stores/ui-store';
import { requestPersistentStorage } from './db/auto-backup';
import { initAutoSync } from './lib/sync';

function App() {
  const page = useUIStore((s) => s.page);
  const presenting = useUIStore((s) => s.presenting);
  const didInit = useRef(false);

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    // Ask the browser not to evict our IndexedDB if disk pressure gets high.
    // This is a one-shot permission request; no timers, no background work.
    requestPersistentStorage();
    // Register Dexie hooks + focus listeners so edits auto-push to the sync
    // server and the other devices auto-pull on focus. No-op if sync isn't
    // configured; recovers automatically once the user connects in SyncPanel.
    initAutoSync();
  }, []);

  return (
    <>
      {page === 'home' ? <HomePage /> : <AppShell />}
      {presenting && <PresentationView />}
      <SnapshotManager />
      <HelpPanel />
      <SyncPanel />
    </>
  );
}

export default App;
