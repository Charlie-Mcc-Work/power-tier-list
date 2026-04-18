# Power Tier List

A local-first web app for building logically consistent strength tier lists of fictional characters. Designed for One Piece power scaling with 400+ characters, but works for any fictional universe.

## What Makes This Different

This isn't a drag-and-drop tier maker. It's a **constraint-based reasoning tool** where your stated relationships (e.g., "Luffy > Kaido") are **enforced rules** — the tier list physically cannot contradict your data.

- **Relationships are law** — define `A > B` and A is guaranteed to be in a higher tier than B. Always.
- **Cascading enforcement** — drag a character to a new tier and everything else adjusts to stay consistent
- **Chain input** — type `Warcury > V. Nusjuro > Mars > Saturn` to create 3 relationships in one shot
- **IDE-like autocomplete** — fuzzy character name matching as you type, Tab to complete, arrow keys to navigate
- **Bulk operations** — paste 400+ character names or hundreds of relationship statements at once

## Operators

Five operators that map directly to tier list constraints:

| Operator | Meaning | Enforcement |
|----------|---------|-------------|
| `>` | strictly stronger | must be in a **higher** tier |
| `>=` | at least as strong | same tier or higher |
| `=` | equal | forces **same** tier |
| `<=` | at most as strong | same tier or lower |
| `<` | strictly weaker | must be in a **lower** tier |

The distinction between `>` and `>=` matters: `A > B` forces them into different tiers, while `A >= B` allows them to share one.

## Features

### Tier List
- S/A/B/C/D/F tier rows with drag-and-drop ([@dnd-kit](https://dndkit.com/))
- **Enforced drag** — moving a character cascades all relationship constraints automatically
- Upload character images (filenames become character names) or **add by name** in bulk
- Image uploads match existing characters by filename, so you can add names first and images later
- Inconsistency warnings if manual placements ever violate the relationship graph

### Relationship Input
- **Autocomplete** — start typing a character name and get fuzzy-matched suggestions
- **Tab to complete**, arrow keys to navigate, click to select
- **Chains** — `A > B > C > D` creates multiple relationships in one entry
- **Notes** — every relationship has an optional note field for context ("Chapter 1044", "Luffy defeats Kaido")
- **Bulk mode** — paste many statements at once (one per line, chains supported, `#` comments ignored)
- **Auto-placement** — newly related characters are automatically placed into tiers based on the graph

### Evidence / Knowledge Base
- Three evidence types: **Feats** (things they did), **Statements** (things said about them), **Titles** (formal designations)
- Link evidence to specific characters and relationships
- Filter by type or character

### Layout
- **Triple (|||)** — tier list left, relationships + evidence stacked right (default)
- **Split (|+)** — tier list left, tabbed right pane
- **Tabs ([ ])** — single fullscreen view
- Draggable resize handle between panes (20–80%)

### Persistence
- All data auto-saves to IndexedDB (survives refreshes and browser restarts)
- **Export** — full JSON including base64-encoded images
- **Import** — restore on any machine
- Character detail panel — click any character to view/edit their relationships, evidence, and name

## Getting Started

```bash
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

### Workflow for a Large Tier List

1. **Add characters** — click "Add by Name" on the tier list panel and paste your character names (one per line)
2. **Add relationships** — switch to the relationships panel and type chains like `Luffy > Zoro > Sanji` with autocomplete, or switch to Bulk mode and paste hundreds of statements
3. **Auto-placement** — characters are automatically placed into tiers as relationships are added
4. **Fine-tune** — drag characters between tiers; all constraints cascade automatically
5. **Add images** — drag-drop image files; they match existing characters by filename
6. **Export** — save your work to a JSON file from the nav bar

## Tech Stack

- **React 19** + **TypeScript 6** — UI framework
- **Vite 8** — build tooling
- **Tailwind CSS 4** — styling
- **@dnd-kit** — drag-and-drop
- **Dexie.js** — IndexedDB wrapper (persistence including image blobs)
- **Zustand** — UI state management

### Core Algorithms

- **Topological sort** (Kahn's) — derives character ordering from the relationship DAG
- **Cycle detection** (Tarjan's SCC) — catches circular relationships
- **Constraint enforcement** — BFS cascade that pushes descendants down / ancestors up after any change, respecting strict vs non-strict gaps
- **Layered ranking** — maps graph layers proportionally across S–F tiers

## Project Structure

```
src/
├── components/
│   ├── character/      # Character detail side panel
│   ├── evidence/       # Evidence CRUD and display
│   ├── layout/         # App shell, nav bar, layout modes
│   ├── relationships/  # Autocomplete input, relationship list, ranked view, cycle warning
│   └── tier-list/      # Tier rows, drag-and-drop, image/name upload
├── db/
│   ├── database.ts     # Dexie schema (characters, tierLists, relationships, evidence, images)
│   └── export-import.ts
├── hooks/              # Data access (useCharacters, useTierList, useRelationships, useEvidence)
├── lib/
│   ├── graph.ts        # Topological sort, cycle detection, layered ranking
│   ├── enforce-constraints.ts  # Cascading constraint enforcement engine
│   ├── relationship-parser.ts  # Chain parser (A > B > C) with 5 operators
│   ├── inconsistency-checker.ts
│   └── fuzzy-match.ts  # Character name matching for autocomplete
├── stores/             # Zustand (layout mode, selected character)
└── types/              # TypeScript type definitions
```

## License

Private — all rights reserved.
