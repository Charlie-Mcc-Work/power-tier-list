import { NavBar } from './NavBar';
import { useUIStore } from '../../stores/ui-store';
import { TierListView } from '../tier-list/TierListView';
import { RelationshipsView } from '../relationships/RelationshipsView';
import { EvidenceView } from '../evidence/EvidenceView';
import { CharacterDetail } from '../character/CharacterDetail';

export function AppShell() {
  const { activeView, selectedCharacterId, selectCharacter } = useUIStore();

  return (
    <div className="flex flex-col h-screen">
      <NavBar />
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-y-auto p-6">
          {activeView === 'tierlist' && <TierListView />}
          {activeView === 'relationships' && <RelationshipsView />}
          {activeView === 'evidence' && <EvidenceView />}
        </main>
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
