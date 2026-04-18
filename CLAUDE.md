# Development Guide

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

**Constraint enforcement:** Relationships are enforced rules, not suggestions. The enforcement engine (`src/lib/enforce-constraints.ts`) runs after every drag-drop and relationship change. It uses BFS to cascade constraints through the relationship graph, respecting the strict (`>`, 1-tier gap) vs non-strict (`>=`, same tier OK) distinction.

## Key Files

- `src/lib/enforce-constraints.ts` — Constraint cascade engine (enforceAfterMove, autoPlaceAndEnforce)
- `src/lib/graph.ts` — Graph algorithms (topological sort, Tarjan's SCC, layered ranking)
- `src/lib/relationship-parser.ts` — Chain parser for "A > B > C" syntax
- `src/hooks/use-tier-list.ts` — Tier assignment CRUD + enforceAndAutoPlace
- `src/hooks/use-relationships.ts` — Relationship CRUD + bulk/chain add
- `src/db/database.ts` — Dexie schema definition (5 tables)

## Conventions

- Operators: `>` (strict), `>=` (non-strict), `=` (bidirectional >=), `<=`, `<`
- Tier indices: S=0, A=1, B=2, C=3, D=4, F=5 (lower index = better tier)
- Character images are optional (imageId is nullable)
- The `strict` field on relationships controls enforcement gap (true = 1-tier minimum, false = 0)
