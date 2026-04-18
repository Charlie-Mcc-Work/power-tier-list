import { AppShell } from './components/layout/AppShell';
import { HomePage } from './components/home/HomePage';
import { useUIStore } from './stores/ui-store';

function App() {
  const page = useUIStore((s) => s.page);
  return page === 'home' ? <HomePage /> : <AppShell />;
}

export default App;
