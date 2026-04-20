# Development Guide

## Mandatory Pre-Commit Rule

**Before every commit, you MUST check whether the help panel (`src/components/layout/HelpPanel.tsx`) needs updating.** If the commit changes any of the following, read HelpPanel.tsx and update it to match:

- Operators or their enforcement behavior
- Relationship input syntax (chains, fan-out, autocomplete, paste)
- Keyboard shortcuts or controls
- Drag-and-drop behavior or constraint enforcement
- Tier management (add/remove/rename/reorder/recolor)
- Image display modes or card sizing
- Presentation mode
- Backups/snapshots or export/import
- Any new user-facing feature or removal of an existing one

The help panel is the user's reference for how the app works. If it's wrong, the user is misled. **Do not skip this check.**

## Do Not Modify Build/Server Config Without Being Asked

**Never modify the following files or settings unless the user explicitly asks:**

- `vite.config.ts` (dev server port, base path, plugins, build options)
- `tsconfig*.json`
- `package.json` scripts, `engines`, or dependency versions
- `.github/workflows/*` or any CI config
- ESLint, Prettier, Tailwind, or other tool configs

If you believe a change is needed (e.g., a port conflict, a failing build), **propose it and wait for approval** before editing. If you do make such a change because the user approved it, call it out explicitly in the commit message — do not bury it in an unrelated batch.

## Build & Run

```bash
npm install        # install dependencies
npm run dev        # start dev server (Vite, http://localhost:5173)
npm run build      # type-check (tsc) + production build
npm run lint       # ESLint
```

## Architecture

Local-first app — all state lives in IndexedDB via Dexie.js. No backend. React components subscribe to DB changes via `dexie-react-hooks` live queries.

**Data flow:** User action → hook function (writes to IndexedDB) → live query fires → component re-renders.

**Constraint enforcement:** Relationships are enforced rules, not suggestions. The enforcement engine (`src/lib/enforce-constraints.ts`) runs after every drag-drop and relationship change. It uses BFS to cascade constraints through the relationship graph, respecting the strict (`>`, 1-tier gap) vs non-strict (`>=`, same tier OK + within-tier ordering) distinction.

**Per-list scoping:** Characters, relationships, and evidence are scoped to each tier list via `tierListId`. Hooks filter by `getActiveTierListId()`. Deleting a tier list cascades to all associated data.

## Key Files

- `src/lib/enforce-constraints.ts` — Constraint cascade engine (enforceAfterMove, autoPlaceAndEnforce, enforceWithinTierOrder)
- `src/lib/graph.ts` — Graph algorithms (topological sort, Tarjan's SCC, cycle detection)
- `src/lib/relationship-parser.ts` — Chain/fan-out parser for "A > B, C, D" syntax
- `src/hooks/use-tier-list.ts` — Tier assignment CRUD + enforceAndAutoPlace + tier def management
- `src/hooks/use-relationships.ts` — Relationship CRUD + chain add + cycle prevention
- `src/db/database.ts` — Dexie schema (6 tables including snapshots)
- `src/db/export-import.ts` — Export/import + snapshot backup system
- `src/components/layout/HelpPanel.tsx` — User-facing reference for all rules and controls (KEEP UP TO DATE)

## Conventions

- Operators: `>` (strict), `>=` (non-strict), `=` (bidirectional >=), `<=`, `<`
- Tier definitions are per-list (custom names, colors, order)
- Character images are optional (imageId is nullable)
- The `strict` field on relationships controls enforcement gap (true = 1-tier minimum, false = 0)
- Non-strict `>=` also enforces within-tier ordering (A before B in the same tier)
- Characters, relationships, evidence are scoped by `tierListId`
- Auto-snapshots on app start + before imports; last 20 kept
