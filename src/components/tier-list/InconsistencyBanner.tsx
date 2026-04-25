import type { Inconsistency } from '../../types';
import { useUIStore } from '../../stores/ui-store';

interface Props {
  inconsistencies: Inconsistency[];
}

export function InconsistencyBanner({ inconsistencies }: Props) {
  const setActiveView = useUIStore((s) => s.setActiveView);
  const setRelationshipsFilter = useUIStore((s) => s.setRelationshipsFilter);

  function openContradictions() {
    setActiveView('relationships');
    setRelationshipsFilter('contradictions');
  }

  if (inconsistencies.length === 0) return null;

  const placements = inconsistencies.filter((i) => i.type === 'placement').length;
  const contradictions = inconsistencies.filter((i) => i.type === 'cycle').length;

  return (
    <div className="mb-4 rounded-lg border border-yellow-600/50 bg-yellow-900/20 p-3 space-y-1">
      {placements > 0 && (
        <div className="flex items-start gap-3 text-xs">
          <span className="text-yellow-400 font-medium shrink-0 min-w-[88px]">
            {placements} placement{placements === 1 ? '' : 's'}
          </span>
          <span className="text-yellow-300/80">
            Tier positions don't match the written relationships. Click{' '}
            <span className="text-gray-200 font-medium">Compact</span> to snap
            everyone to exactly what the relationships imply.
          </span>
        </div>
      )}
      {contradictions > 0 && (
        <div className="flex items-start gap-3 text-xs">
          <span className="text-red-400 font-medium shrink-0 min-w-[88px]">
            {contradictions} contradiction{contradictions === 1 ? '' : 's'}
          </span>
          <span className="text-yellow-300/80">
            Some relationships conflict with each other and can't all be
            satisfied.{' '}
            <button
              type="button"
              onClick={openContradictions}
              className="text-red-300 underline underline-offset-2 hover:text-red-200"
            >
              Open Relationships → Contradictions
            </button>{' '}
            to see the groups.
          </span>
        </div>
      )}
    </div>
  );
}
