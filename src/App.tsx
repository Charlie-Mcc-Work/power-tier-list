import { AppShell } from './components/layout/AppShell';
import { HomePage } from './components/home/HomePage';
import { PresentationView } from './components/tier-list/PresentationView';
import { useUIStore } from './stores/ui-store';

function App() {
  const page = useUIStore((s) => s.page);
  const presenting = useUIStore((s) => s.presenting);

  return (
    <>
      {page === 'home' ? <HomePage /> : <AppShell />}
      {presenting && <PresentationView />}
    </>
  );
}

export default App;
