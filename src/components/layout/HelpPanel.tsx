import { useUIStore } from '../../stores/ui-store';

export function HelpPanel() {
  const open = useUIStore((s) => s.helpOpen);
  const setHelpOpen = useUIStore((s) => s.setHelpOpen);
  const setOpen = (v: boolean) => setHelpOpen(v);

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
                <Row op="A > B" meaning="A must be in a strictly higher tier than B (tier gap of at least 1)" />
                <Row op="A >= B" meaning="A and B must be in the same tier, with A positioned before B" />
                <Row op="A <= B" meaning="Reverse of >= (same tier, B before A)" />
                <Row op="A < B" meaning="Reverse of > (B in a strictly higher tier)" />
              </tbody>
            </table>
            <p className="text-[11px] text-gray-500 mt-2">
              There is no explicit equality operator — "<code>=</code>" is no longer supported.
              If you want two characters in the same tier, use <code className="text-gray-300">&gt;=</code>
              (or <code className="text-gray-300">&lt;=</code>) and pick which one sits before the other.
            </p>
          </section>

          {/* Input syntax */}
          <section>
            <h3 className="text-white font-medium mb-2">Input Syntax</h3>
            <div className="space-y-2 text-xs">
              <SyntaxRow label="Basic" example="Luffy > Zoro" desc="One relationship" />
              <SyntaxRow label="Chain" example="Luffy > Zoro > Sanji > Usopp" desc="Creates 3 relationships in one entry" />
              <SyntaxRow label="Fan-out" example="Luffy > Zoro, Sanji, Nami" desc="Luffy is above all three" />
              <SyntaxRow label="Combined" example="Luffy > Zoro, Sanji > Usopp" desc="Luffy above both, both above Usopp" />
              <SyntaxRow label="Same tier" example="Shanks >= Mihawk" desc="Same tier, Shanks positioned before Mihawk" />
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
            <p className="text-xs text-gray-400 mt-2">
              Name matching is strict: a line must use either the exact character name or an
              unambiguous prefix (one that matches exactly one character). If a prefix could
              mean multiple characters, the line is flagged as ambiguous — type the full name.
            </p>
          </section>

          {/* Browsing the list */}
          <section>
            <h3 className="text-white font-medium mb-2">Browse &amp; Filter</h3>
            <p className="text-xs text-gray-400">
              Above the relationship list you can filter by name (matches either endpoint) and
              sort by <span className="text-gray-300">Newest</span> (default),
              <span className="text-gray-300"> Oldest</span>, or alphabetically
              (<span className="text-gray-300">A–Z</span>, by the name on the left).
              Equality rows are shown with the alphabetically-first name on the left so the
              sort order matches what you see.
            </p>
            <p className="text-xs text-gray-400 mt-2">
              The <span className="text-gray-300">Redundant</span> toggle next to the sort
              dropdown filters the list down to relationships that are already implied by
              another path through the graph — each one shows the chain that implies it
              (e.g. <code className="text-amber-400/80">implied by: A &gt; B &gt;= C &gt; D</code>).
              Use it to prune noise, but remember that deleting a redundant rel is a
              judgment call: sometimes the direct statement carries context a derived chain
              doesn't.
            </p>
            <p className="text-xs text-gray-400 mt-2">
              The <span className="text-red-300">Contradictions</span> toggle shows only
              relationships that take part in a conflict and groups them by the cycle /
              class they belong to. A contradiction is something the rules themselves can't
              satisfy (e.g. <code className="text-red-300">A &gt;= B</code> and <code className="text-red-300">B &gt;= A</code>
              together require <em>A before B and B before A simultaneously</em>, or a
              <code className="text-red-300"> &gt;</code> edge inside a chain of
              <code className="text-red-300"> &gt;=</code> that forces both endpoints to the
              same tier). Delete one relationship from each group to resolve.
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
                <span className="text-gray-300">Non-strict (&gt;=) = same tier:</span> A &gt;= B pulls
                both characters into the same tier and puts A before B in position. If
                you drag A up to a higher tier manually, the placement stays until the
                next Compact, which pulls A back down to match B.
              </li>
              <li>
                <span className="text-gray-300">Strict (&gt;) = tier gap:</span> A &gt; B forces
                A to be in a strictly higher tier (at least one tier above B).
              </li>
              <li>
                <span className="text-gray-300">Auto-placement:</span> When you add a
                relationship, any unranked character is placed at the tier implied by
                its partner — same tier for &gt;=, one tier above/below for &gt;.
              </li>
              <li>
                <span className="text-gray-300">Drag cascading:</span> Moving a character pulls
                every partner it's tied to (via &gt;=) into the same tier and pushes
                strict superiors/inferiors apart. If there's no room, the move is
                blocked with an explanation.
              </li>
              <li>
                <span className="text-gray-300">Cycle prevention:</span> Any cycle of
                relationships is unsatisfiable — it would force a character to be both
                before and after itself. Cycles are rejected at input time; if any
                exist in stored data (e.g. legacy <code>=</code> pairs), the
                inconsistency banner above the tier list flags them.
              </li>
              <li>
                <span className="text-gray-300">Chain-length check:</span> A new relationship
                that would build a strict-chain longer than the tier list can hold is
                rejected outright — you'll see the offending chain and how many tiers
                it would need.
              </li>
            </ul>
          </section>

          {/* Compact */}
          <section>
            <h3 className="text-white font-medium mb-2">Compact</h3>
            <p className="text-xs text-gray-400">
              <span className="text-gray-300">Compact</span> in the top bar moves every
              <em> placed</em> character up as high as their relationships allow. Unranked
              characters are left alone. A placed character with no relationships floats to
              the top tier. If any chain is longer than the tier list can hold, nothing
              moves and you'll see an error explaining which chain is the problem. Undo
              with Ctrl+Z.
            </p>
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
              Manage tiers directly on the tier row itself. Each tier list has its own
              tier definitions — default is S/A/B/C/D/F but you can use any names.
            </p>
            <ul className="text-xs space-y-1 mt-2 text-gray-400">
              <li>
                <span className="text-gray-300">Rename</span> — click the tier letter on
                the colored label box and type. Enter to save, Esc to cancel.
              </li>
              <li>
                <span className="text-gray-300">Recolor</span> — hover the tier row and a
                small color swatch appears in the corner of the label box. Click it to
                open the color picker.
              </li>
              <li>
                <span className="text-gray-300">Insert above / below</span> — hover a
                tier row to reveal the action strip; <span className="text-gray-300">+ ▲</span>
                adds a new tier directly above this one, <span className="text-gray-300">+ ▼</span>
                adds one directly below. The new tier opens in rename mode automatically.
              </li>
              <li>
                <span className="text-gray-300">Reorder</span> — the <span className="text-gray-300">▲</span>
                and <span className="text-gray-300">▼</span> buttons in the same strip move the tier
                up or down in the list.
              </li>
              <li>
                <span className="text-gray-300">Delete</span> — <span className="text-gray-300">✕</span>
                in the strip removes the tier. Any characters assigned to it are also
                removed from the tier list (the characters themselves are kept in the
                Unranked pool). Disabled when there's only one tier left.
              </li>
            </ul>
          </section>

          {/* Deleting characters */}
          <section>
            <h3 className="text-white font-medium mb-2">Removing Characters</h3>
            <ul className="text-xs space-y-1 text-gray-400">
              <li>
                <span className="text-gray-300">Hover a card in the Unranked pool</span> and click the
                small red <code className="text-gray-300">×</code> at the top-right to delete a single
                character.
              </li>
              <li>
                <span className="text-gray-300">&ldquo;Select to delete…&rdquo;</span> in the Unranked
                header enters bulk mode. Tap cards to toggle them (checkmarks appear), use
                <span className="text-gray-300"> Select all</span> /
                <span className="text-gray-300"> Clear</span>, then
                <span className="text-gray-300"> Delete N</span> wipes them in one transaction.
                Drag-and-drop is disabled while select mode is active.
              </li>
              <li>
                Deleting a character also removes their image and every relationship they
                appear in. All restorable via Backups if you made a mistake.
              </li>
              <li>
                Clicking any card (not in select mode) still opens the Character Details panel,
                which also has a <span className="text-gray-300">Delete Character</span> button.
              </li>
            </ul>
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
              <li>
                <span className="text-gray-300">Backups</span> — manual only, no timers or
                background work. Four buttons in the Backups panel:
                <span className="text-gray-300"> (1) Create Snapshot</span> (in-browser, fast, for
                quick undo — up to 20 kept);
                <span className="text-gray-300"> (2) Download (fast)</span> saves a small core
                JSON to your Downloads folder (no image blobs);
                <span className="text-gray-300"> (3) Download full</span> includes every image
                base64-encoded — use occasionally as a complete archive;
                <span className="text-gray-300"> (4) Picked folder (Chromium)</span> writes to a
                folder of your choice with one click. On Firefox, point the Downloads folder at
                a cloud-synced directory (Dropbox / OneDrive / iCloud Drive) and disk failures
                won&rsquo;t cost you your list. Snapshots are also created just before an Import
                so you can revert.
              </li>
              <li>
                <span className="text-gray-300">Export</span> — saves <em>only the tier list you&rsquo;re currently
                viewing</em>, along with its characters, relationships, and the images those
                characters use. The file is called <code>tierlist-&lt;name&gt;-YYYY-MM-DD.json</code>.
                <br />
                <span className="text-gray-300">Import</span> — pick a file, then the dialog offers two choices:
                <span className="text-gray-300"> Replace current list</span> wipes the list you&rsquo;re viewing
                and fills it with the file&rsquo;s contents (your other tier lists are untouched);
                <span className="text-gray-300"> Add as new list</span> copies the file into a brand-new tier list
                with fresh ids, leaving everything you have alone. A backup snapshot is taken before either
                so the operation is reversible from the Backups panel.
              </li>
              <li>
                <span className="text-gray-300">Mobile</span> — Touch drag with long-press (hold a card for ~200ms, then drag).
                Layout auto-switches to the single-pane tabs view on narrow screens. Tap the
                <span className="text-gray-300"> ⋮ </span> overflow button in the top bar to reach
                Present, Sync, Backups, Export, Import, Help, plus card-size and image-display controls.
              </li>
              <li><span className="text-gray-300">Undo / Redo</span> — Ctrl+Z to undo, Ctrl+Shift+Z or Ctrl+Y to redo. Tracks drag moves and relationship placements (last 50 states).</li>
              <li><span className="text-gray-300">Save Image</span> — In presentation mode, click "Save Image" to download the tier list as a PNG.</li>
              <li>
                <span className="text-gray-300">Copy Text</span> — Opens a text version
                of the current tier list, one line per tier in the format
                <code className="text-gray-300"> TierName: Entry1, Entry2, Entry3</code>.
                Click <span className="text-gray-300">Copy to Clipboard</span> or the textarea
                to copy. Tiers are in display order and characters are in their current
                within-tier positions.
              </li>
              <li>
                <span className="text-gray-300">Graph</span> — Click &quot;Show Graph&quot; in the relationships panel.
                Two layout modes, toggle in the toolbar:
                <span className="text-gray-300"> Tier</span> groups nodes into rows by their current tier
                assignment (S on top, F on bottom; an Unranked row underneath for characters not yet placed) —
                great for seeing how the DAG sits against your rankings.
                <span className="text-gray-300"> DAG</span> is an auto-layered graph (dagre) that shows the
                relationship structure on its own, ignoring tier assignments — handy when you want to see the
                pure logical hierarchy.
                Drag or scroll to pan, hold <Key>Ctrl</Key>/<Key>⌘</Key> + scroll to zoom (cursor-anchored),
                or use the <Key>+</Key>/<Key>−</Key>/<Key>Fit</Key> buttons.
                Click <span className="text-gray-300">Fullscreen</span> to open it viewport-filling.
                Shortcuts in fullscreen: <Key>F</Key>/<Key>0</Key> to fit, <Key>+</Key>/<Key>-</Key> to zoom,
                arrow keys to pan, <Key>Esc</Key> to exit.
              </li>
              <li>
                <span className="text-gray-300">Sync</span> — Connect once to a self-hosted sync
                server (Docker) and every device stays in step automatically: edits upload within
                a couple of seconds, other devices pull when you open or refocus the app.
                A dot next to the <span className="text-gray-300">Sync</span> button shows state —
                green = up to date, amber = uploading, red = offline. The
                <span className="text-gray-300"> Push Now</span> / <span className="text-gray-300">Pull Now</span>
                buttons in the Sync panel force it immediately if you don't want to wait.
                On a private network the server runs with no token required (Tailscale/LAN handles
                access) — just Connect and it works.
              </li>
              <li><span className="text-gray-300">Share</span> — Generate a read-only link for the current tier list (requires sync server).</li>
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
