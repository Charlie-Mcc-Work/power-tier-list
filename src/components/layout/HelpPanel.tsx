import { useState } from 'react';

let openFn: (() => void) | null = null;
export function openHelpPanel() {
  openFn?.();
}

export function HelpPanel() {
  const [open, setOpen] = useState(false);
  openFn = () => setOpen(true);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60">
      <div className="bg-[#1a1a1a] border border-gray-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-sm font-medium text-white">How It Works</h2>
          <button
            onClick={() => setOpen(false)}
            className="text-gray-400 hover:text-white transition-colors text-sm"
          >
            x
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6 text-sm text-gray-300">
          {/* Operators */}
          <section>
            <h3 className="text-white font-medium mb-2">Operators</h3>
            <table className="w-full text-xs">
              <tbody className="divide-y divide-gray-800">
                <Row op="A > B" meaning="A must be in a strictly higher tier than B" />
                <Row op="A >= B" meaning="A must be in the same tier or higher than B — also enforces A before B within the same tier" />
                <Row op="A = B" meaning="A and B must be in the same tier (creates A >= B and B >= A)" />
                <Row op="A <= B" meaning="Reverse of >= (B is same or higher)" />
                <Row op="A < B" meaning="Reverse of > (B is strictly higher)" />
              </tbody>
            </table>
          </section>

          {/* Input syntax */}
          <section>
            <h3 className="text-white font-medium mb-2">Input Syntax</h3>
            <div className="space-y-2 text-xs">
              <SyntaxRow label="Basic" example="Luffy > Zoro" desc="One relationship" />
              <SyntaxRow label="Chain" example="Luffy > Zoro > Sanji > Usopp" desc="Creates 3 relationships in one entry" />
              <SyntaxRow label="Fan-out" example="Luffy > Zoro, Sanji, Nami" desc="Luffy is above all three" />
              <SyntaxRow label="Combined" example="Luffy > Zoro, Sanji > Usopp" desc="Luffy above both, both above Usopp" />
              <SyntaxRow label="Equality" example="Shanks = Mihawk" desc="Forces same tier" />
            </div>
          </section>

          {/* Autocomplete */}
          <section>
            <h3 className="text-white font-medium mb-2">Autocomplete</h3>
            <ul className="text-xs space-y-1 text-gray-400">
              <li><Key>Tab</Key> Accept the highlighted suggestion</li>
              <li><Key>↑</Key> <Key>↓</Key> Navigate suggestions</li>
              <li><Key>Esc</Key> Dismiss suggestions</li>
              <li><Key>Enter</Key> Submit the relationship</li>
              <li>Works after commas too — type <code className="text-gray-300">Luffy &gt; Zo</code> then Tab</li>
            </ul>
          </section>

          {/* Multi-line paste */}
          <section>
            <h3 className="text-white font-medium mb-2">Bulk Paste</h3>
            <p className="text-xs text-gray-400">
              Paste multiple lines into the input and each line is processed as a separate
              relationship. Lines starting with <code className="text-gray-300">#</code> are ignored.
              Chains and fan-out syntax work per line.
            </p>
          </section>

          {/* Enforcement */}
          <section>
            <h3 className="text-white font-medium mb-2">How Enforcement Works</h3>
            <ul className="text-xs space-y-1.5 text-gray-400">
              <li>
                <span className="text-gray-300">Relationships are rules, not suggestions.</span> The
                tier list physically cannot contradict your stated relationships.
              </li>
              <li>
                <span className="text-gray-300">Auto-placement:</span> When you add a relationship,
                characters are automatically placed in the highest valid tier.
              </li>
              <li>
                <span className="text-gray-300">Drag cascading:</span> Moving a character pushes
                related characters in both directions — superiors get pushed up, inferiors
                get pushed down. If there's no room (a character hits the top or bottom
                tier), the move is blocked with a warning explaining which rule caused it.
              </li>
              <li>
                <span className="text-gray-300">Within-tier ordering:</span> Characters with
                A &gt;= B in the same tier are kept in order (A before B).
              </li>
              <li>
                <span className="text-gray-300">Cycle prevention:</span> Relationships that would
                create an unsatisfiable cycle (containing any &gt;) are rejected with
                the full cycle path shown.
              </li>
            </ul>
          </section>

          {/* Notes */}
          <section>
            <h3 className="text-white font-medium mb-2">Notes</h3>
            <p className="text-xs text-gray-400">
              Every relationship has an optional note field for context — chapter numbers,
              fight outcomes, title references, etc. Notes appear as subtext in the
              relationship list.
            </p>
          </section>

          {/* Tiers */}
          <section>
            <h3 className="text-white font-medium mb-2">Custom Tiers</h3>
            <p className="text-xs text-gray-400">
              Click "Manage Tiers" below the tier list to add, remove, rename, recolor,
              or reorder tiers. Each tier list has its own tier definitions. Default is
              S/A/B/C/D/F but you can use any names.
            </p>
          </section>

          {/* Keyboard */}
          <section>
            <h3 className="text-white font-medium mb-2">Other Controls</h3>
            <ul className="text-xs space-y-1 text-gray-400">
              <li><span className="text-gray-300">Search</span> — Type in the search bar to find characters. Non-matches dim so matches stand out.</li>
              <li><span className="text-gray-300"># toggle</span> — Show/hide character count per tier</li>
              <li><span className="text-gray-300">XS / S / M / L</span> — Card size presets</li>
              <li><span className="text-gray-300">Fit / Fill</span> — Image display: show full image or crop to square</li>
              <li><span className="text-gray-300">Present</span> — Fullscreen view for screenshots (Escape to exit)</li>
              <li><span className="text-gray-300">Backups</span> — Auto-snapshots on every app start, restorable anytime</li>
              <li><span className="text-gray-300">Export / Import</span> — Save/load as JSON file</li>
              <li><span className="text-gray-300">Mobile</span> — Touch drag with long-press. Layout auto-switches to tabs on small screens.</li>
              <li><span className="text-gray-300">Undo / Redo</span> — Ctrl+Z to undo, Ctrl+Shift+Z or Ctrl+Y to redo. Tracks drag moves and relationship placements (last 50 states).</li>
              <li><span className="text-gray-300">Save Image</span> — In presentation mode, click "Save Image" to download the tier list as a PNG.</li>
              <li><span className="text-gray-300">Graph</span> — Click "Show Graph" in the relationships panel to see the relationship DAG. Pan by dragging, zoom with mousewheel.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

function Row({ op, meaning }: { op: string; meaning: string }) {
  return (
    <tr>
      <td className="py-1.5 pr-4 font-mono text-amber-400 whitespace-nowrap">{op}</td>
      <td className="py-1.5 text-gray-400">{meaning}</td>
    </tr>
  );
}

function SyntaxRow({ label, example, desc }: { label: string; example: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-gray-500 w-16 shrink-0">{label}</span>
      <code className="text-amber-400/80 font-mono shrink-0">{example}</code>
      <span className="text-gray-500">— {desc}</span>
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="px-1.5 py-0.5 rounded bg-[#2a2a2a] border border-gray-700 text-gray-300 text-[10px] font-mono">
      {children}
    </kbd>
  );
}
