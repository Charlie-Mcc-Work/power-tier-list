import type { Inconsistency } from '../../types';

interface Props {
  inconsistencies: Inconsistency[];
}

export function InconsistencyBanner({ inconsistencies }: Props) {
  if (inconsistencies.length === 0) return null;

  const placements = inconsistencies.filter((i) => i.type === 'placement');
  const cycles = inconsistencies.filter((i) => i.type === 'cycle');

  return (
    <div className="mb-4 rounded-lg border border-yellow-600/50 bg-yellow-900/20 p-3">
      <div className="flex items-center gap-2 text-yellow-400 text-sm font-medium mb-1">
        <span>Warning: {inconsistencies.length} inconsistenc{inconsistencies.length === 1 ? 'y' : 'ies'} detected</span>
      </div>
      <ul className="text-xs text-yellow-300/80 space-y-1 mt-2">
        {cycles.map((c, i) => (
          <li key={`cycle-${i}`} className="flex items-start gap-1.5">
            <span className="text-red-400 shrink-0">Cycle:</span>
            <span>{c.message}</span>
          </li>
        ))}
        {placements.map((p, i) => (
          <li key={`place-${i}`} className="flex items-start gap-1.5">
            <span className="text-yellow-400 shrink-0">Rank:</span>
            <span>{p.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
