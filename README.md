# Power Tier List

A local-first web app for creating strength tier lists of fictional characters with a built-in relational reasoning system. Primarily designed for One Piece power scaling, but works for any fictional universe.

## What Makes This Different

This isn't just a drag-and-drop tier maker. It's a **reasoning tool** that helps you keep your character rankings logically consistent.

- **Type relationships** like `Mihawk > Shanks` and the app builds a directed graph that can auto-place characters into tiers
- **Track evidence** — attach feats, statements, and titles to characters and relationships so every ranking has justification
- **Detect inconsistencies** — if your manual tier placements contradict your stated relationships, the app flags them
- **Catch contradictions** — circular rankings (A > B > C > A) are automatically detected

## Features

### Tier List
- Classic S/A/B/C/D/F tier rows
- Drag-and-drop characters between tiers and reorder within tiers
- Upload character images — file names automatically become character names
- Inconsistency warnings when placements contradict the relationship graph

### Relational Reasoning
- Natural input syntax: `Mihawk > Shanks` (likely), `Luffy >> Kaido` (certain), `Zoro >? Sanji` (speculative)
- Derived ranking via topological sort — see where the math says characters should land
- **Apply to Tier List** button — one click to auto-place characters based on their relationships
- Cycle detection with clear explanations of which relationships conflict

### Evidence / Knowledge Base
- Three evidence types: **Feats** (things they did), **Statements** (things said about them), **Titles** (formal designations)
- Link evidence to specific characters and relationships
- Filter by type or character
- Every ranking decision can be backed by sourced evidence

### Persistence
- All data auto-saves to IndexedDB (survives page refreshes and browser restarts)
- **Export** — download your entire tier list (including images) as a JSON file
- **Import** — restore from a previous export on any machine
- Click any character to view/edit their details, relationships, and evidence in a side panel

## Tech Stack

- **React 19 + TypeScript** — UI framework
- **Vite** — build tooling
- **Tailwind CSS 4** — styling
- **@dnd-kit** — drag-and-drop
- **Dexie.js** — IndexedDB wrapper for persistence (including image blobs)
- **Zustand** — UI state management

## Getting Started

```bash
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

### Quick Start

1. Go to the **Tier List** tab and upload some character images (drag-and-drop or click)
2. Drag characters from the Unranked pool into tier rows
3. Switch to **Relationships** and type comparisons like `Luffy >> Kaido`
4. Click **Apply to Tier List** to auto-place characters based on relationships
5. Switch to **Evidence** to add feats, statements, and titles backing up your rankings
6. Use **Export** (top nav) to save your work to a file

## Project Structure

```
src/
├── components/       # React UI components
│   ├── character/    # Character detail side panel
│   ├── evidence/     # Evidence CRUD and display
│   ├── layout/       # App shell and navigation
│   ├── relationships/# Relationship input, list, ranked view
│   └── tier-list/    # Tier rows, drag-and-drop, image upload
├── db/               # Dexie database and export/import
├── hooks/            # React hooks for data access
├── lib/              # Core logic (graph algorithms, parser, matching)
├── stores/           # Zustand UI state
└── types/            # TypeScript type definitions
```

## License

Private — all rights reserved.
