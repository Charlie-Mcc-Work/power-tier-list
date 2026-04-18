import { useCallback, useEffect, useRef } from 'react';
import { NavBar } from './NavBar';
import { useUIStore } from '../../stores/ui-store';
import { TierListView } from '../tier-list/TierListView';
import { RelationshipsView } from '../relationships/RelationshipsView';
import { EvidenceView } from '../evidence/EvidenceView';
import { CharacterDetail } from '../character/CharacterDetail';
import { setActiveTierListId, ensureTierList } from '../../hooks/use-tier-list';

function RightPaneTabs() {
  const { rightPaneTab, setRightPaneTab } = useUIStore();
  return (
    <div className="flex border-b border-gray-700 shrink-0">
      <button
        onClick={() => setRightPaneTab('relationships')}
        className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
          rightPaneTab === 'relationships'
            ? 'text-white border-b-2 border-amber-400'
            : 'text-gray-400 hover:text-gray-200'
        }`}
      >
        Relationships
      </button>
      <button
        onClick={() => setRightPaneTab('evidence')}
        className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
          rightPaneTab === 'evidence'
            ? 'text-white border-b-2 border-amber-400'
            : 'text-gray-400 hover:text-gray-200'
        }`}
      >
        Evidence
      </button>
    </div>
  );
}

function DragHandle({ containerRef }: { containerRef: React.RefObject<HTMLDivElement | null> }) {
  const setSplitPercent = useUIStore((s) => s.setSplitPercent);
  const isDragging = useRef(false);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMouseMove = (ev: MouseEvent) => {
        if (!isDragging.current || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const pct = ((ev.clientX - rect.left) / rect.width) * 100;
        setSplitPercent(pct);
      };

      const onMouseUp = () => {
        isDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [containerRef, setSplitPercent],
  );

  return (
    <div
      onMouseDown={onMouseDown}
      className="w-1.5 shrink-0 cursor-col-resize bg-gray-700 hover:bg-amber-500 active:bg-amber-400
                 transition-colors relative group"
      title="Drag to resize"
    >
      <div className="absolute inset-y-0 -left-1 -right-1" />
    </div>
  );
}

function TripleLayout() {
  const splitPercent = useUIStore((s) => s.splitPercent);
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={containerRef} className="flex flex-1 overflow-hidden">
      <div className="overflow-y-auto p-4" style={{ width: `${splitPercent}%` }}>
        <TierListView />
      </div>
      <DragHandle containerRef={containerRef} />
      <div className="flex flex-col overflow-hidden" style={{ width: `${100 - splitPercent}%` }}>
        <div className="flex-1 overflow-y-auto p-4 border-b border-gray-700">
          <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">Relationships</h2>
          <RelationshipsView />
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">Evidence</h2>
          <EvidenceView />
        </div>
      </div>
    </div>
  );
}

function SplitLayout() {
  const { rightPaneTab, splitPercent } = useUIStore();
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={containerRef} className="flex flex-1 overflow-hidden">
      <div className="overflow-y-auto p-4" style={{ width: `${splitPercent}%` }}>
        <TierListView />
      </div>
      <DragHandle containerRef={containerRef} />
      <div className="flex flex-col overflow-hidden" style={{ width: `${100 - splitPercent}%` }}>
        <RightPaneTabs />
        <div className="flex-1 overflow-y-auto p-4">
          {rightPaneTab === 'relationships' && <RelationshipsView />}
          {rightPaneTab === 'evidence' && <EvidenceView />}
        </div>
      </div>
    </div>
  );
}

function TabsLayout() {
  const { activeView } = useUIStore();
  return (
    <main className="flex-1 overflow-y-auto p-6">
      {activeView === 'tierlist' && <TierListView />}
      {activeView === 'relationships' && <RelationshipsView />}
      {activeView === 'evidence' && <EvidenceView />}
    </main>
  );
}

export function AppShell() {
  const { layoutMode, setLayoutMode, selectedCharacterId, selectCharacter, activeTierListId } = useUIStore();

  useEffect(() => {
    if (activeTierListId) {
      setActiveTierListId(activeTierListId);
      ensureTierList();
    }
  }, [activeTierListId]);

  // Auto-switch to tabs layout on narrow screens (mobile)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    function handle(e: MediaQueryListEvent | MediaQueryList) {
      if (e.matches) setLayoutMode('tabs');
    }
    handle(mq);
    mq.addEventListener('change', handle);
    return () => mq.removeEventListener('change', handle);
  }, [setLayoutMode]);

  return (
    <div className="flex flex-col h-screen">
      <NavBar />
      <div className="flex flex-1 overflow-hidden">
        {layoutMode === 'triple' && <TripleLayout />}
        {layoutMode === 'split' && <SplitLayout />}
        {layoutMode === 'tabs' && <TabsLayout />}
        {selectedCharacterId && (
          <CharacterDetail
            characterId={selectedCharacterId}
            onClose={() => selectCharacter(null)}
          />
        )}
      </div>
    </div>
  );
}
