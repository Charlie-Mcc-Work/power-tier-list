/**
 * End-to-end round-trip tests for Export / Import / Snapshots. These run
 * against an in-memory IndexedDB (fake-indexeddb) so Dexie is exercised
 * identically to the browser — no mocks of the actual import/export code.
 *
 * Every test resets the DB so tests are independent.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './database';
import type { Character, TierList, Relationship, Evidence, ImageBlob } from '../types';
import { DEFAULT_TIER_DEFS } from '../types';
import {
  exportData,
  exportCoreData,
  importData,
  createSnapshot,
  restoreSnapshot,
  listSnapshots,
  deleteSnapshot,
  clearAllSnapshots,
  exportSingleList,
  importSingleListReplace,
  importSingleListAsNew,
  detectImportFileKind,
  type SingleListExport,
} from './export-import';

async function resetDb() {
  await db.transaction(
    'rw',
    [db.characters, db.tierLists, db.relationships, db.evidence, db.images, db.snapshots, db.snapshotData, db.meta],
    async () => {
      await db.characters.clear();
      await db.tierLists.clear();
      await db.relationships.clear();
      await db.evidence.clear();
      await db.images.clear();
      await db.snapshots.clear();
      await db.snapshotData.clear();
      await db.meta.clear();
    },
  );
}

function ch(id: string, name: string, tierListId: string, imageId?: string): Character {
  return { id, tierListId, name, imageId, createdAt: 1, updatedAt: 1 };
}
function tl(id: string, name: string): TierList {
  return {
    id, name,
    tierDefs: DEFAULT_TIER_DEFS,
    tiers: [],
    createdAt: 1,
    updatedAt: 1,
  };
}
function rel(id: string, superiorId: string, inferiorId: string, strict = true, tierListId = 't1'): Relationship {
  return {
    id,
    tierListId,
    superiorId,
    inferiorId,
    strict,
    evidenceIds: [],
    createdAt: 1,
  };
}
function ev(id: string, text: string, characterIds: string[], tierListId = 't1'): Evidence {
  return {
    id,
    tierListId,
    kind: 'feat',
    characterIds,
    relationshipIds: [],
    text,
    createdAt: 1,
  };
}
function img(id: string, bytes: number[]): ImageBlob {
  return {
    id,
    blob: new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
    mimeType: 'image/png',
    originalFilename: `${id}.png`,
    createdAt: 1,
  };
}

async function seedSample() {
  const tierListA = tl('t1', 'Main');
  tierListA.tiers = [
    { characterId: 'c1', tier: 'S', position: 0 },
    { characterId: 'c2', tier: 'A', position: 0 },
  ];
  const tierListB = tl('t2', 'Side');
  const characters = [
    ch('c1', 'Luffy', 't1', 'i1'),
    ch('c2', 'Zoro', 't1'),
    ch('c3', 'Nami', 't2'),
  ];
  const relationships = [
    rel('r1', 'c1', 'c2', true),
    rel('r2', 'c1', 'c2', false), // will be deduped by schema but we're seeding raw
  ];
  const evidence = [ev('e1', 'Chapter 1', ['c1', 'c2'])];
  const images = [img('i1', [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])];

  await db.tierLists.bulkAdd([tierListA, tierListB]);
  await db.characters.bulkAdd(characters);
  // Don't actually add both r1+r2 (violates unique index); just r1.
  await db.relationships.bulkAdd([relationships[0]]);
  await db.evidence.bulkAdd(evidence);
  await db.images.bulkAdd(images);
}

describe('Export round-trip (full, with images)', () => {
  beforeEach(resetDb);

  it('exports all tables and re-imports them intact (replace mode)', async () => {
    await seedSample();

    const json = await exportData();
    expect(typeof json).toBe('string');
    expect(json.length).toBeGreaterThan(0);

    // Wipe the DB and reimport with replace mode.
    await resetDb();
    const summary = await importData(json, { mode: 'replace' });

    expect(summary.tierLists).toBe(2);
    expect(summary.characters).toBe(3);
    expect(summary.relationships).toBe(1);
    expect(summary.evidence).toBe(1);
    expect(summary.images).toBe(1);

    const [tls, chars, rels, evs, imgs] = await Promise.all([
      db.tierLists.toArray(),
      db.characters.toArray(),
      db.relationships.toArray(),
      db.evidence.toArray(),
      db.images.toArray(),
    ]);

    expect(tls).toHaveLength(2);
    expect(tls.find((t) => t.id === 't1')?.name).toBe('Main');
    expect(tls.find((t) => t.id === 't1')?.tiers).toHaveLength(2);

    expect(chars).toHaveLength(3);
    expect(chars.find((c) => c.id === 'c1')?.name).toBe('Luffy');
    expect(chars.find((c) => c.id === 'c1')?.imageId).toBe('i1');

    expect(rels).toHaveLength(1);
    expect(rels[0].superiorId).toBe('c1');
    expect(rels[0].inferiorId).toBe('c2');
    expect(rels[0].strict).toBe(true);

    expect(evs).toHaveLength(1);
    expect(evs[0].text).toBe('Chapter 1');

    expect(imgs).toHaveLength(1);
    expect(imgs[0].mimeType).toBe('image/png');
    // Verify the blob round-tripped byte-for-byte.
    const restoredBytes = new Uint8Array(await imgs[0].blob.arrayBuffer());
    expect(Array.from(restoredBytes)).toEqual([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  });

  it('Before-import snapshot makes a replace import reversible', async () => {
    await seedSample();

    // Build a tiny replacement export that has only one tier list and nothing else.
    const replacement = JSON.stringify({
      version: 1,
      exportedAt: Date.now(),
      tierLists: [{ id: 'only', name: 'Only', tierDefs: DEFAULT_TIER_DEFS, tiers: [], createdAt: 1, updatedAt: 1 }],
      characters: [],
      relationships: [],
      evidence: [],
      images: [],
    });

    await importData(replacement, { mode: 'replace' });

    // Verify the replacement happened.
    const tls = await db.tierLists.toArray();
    expect(tls).toHaveLength(1);
    expect(tls[0].id).toBe('only');

    // The Before-import snapshot should exist and be restorable.
    const snaps = await listSnapshots();
    const beforeImport = snaps.find((s) => s.name.startsWith('Before import'));
    expect(beforeImport).toBeDefined();

    await restoreSnapshot(beforeImport!.id);

    const [tls2, chars2] = await Promise.all([db.tierLists.toArray(), db.characters.toArray()]);
    expect(tls2).toHaveLength(2);
    expect(tls2.find((t) => t.id === 't1')).toBeDefined();
    expect(chars2).toHaveLength(3);
  });

  it('rejects files with the wrong version or missing required fields', async () => {
    await expect(importData('{ "version": 99, "tierLists": [], "characters": [] }'))
      .rejects.toThrow(/Unsupported export version/);

    await expect(importData('not json {'))
      .rejects.toThrow(/Invalid JSON/);

    await expect(importData('{ "version": 1 }'))
      .rejects.toThrow(/missing required fields/);
  });
});

describe('Per-list export/import (single-list files)', () => {
  beforeEach(resetDb);

  it('exportSingleList only includes data scoped to the chosen list', async () => {
    await seedSample();

    const json = await exportSingleList('t1');
    const parsed = JSON.parse(json) as SingleListExport;

    expect(parsed.version).toBe(2);
    expect(parsed.kind).toBe('tierList');
    expect(parsed.tierList.id).toBe('t1');
    // Only c1 and c2 are in t1; c3 is in t2 and must NOT be in the export.
    const charIds = parsed.characters.map((c) => c.id).sort();
    expect(charIds).toEqual(['c1', 'c2']);
    // Relationship r1 belongs to t1 and should be included.
    expect(parsed.relationships).toHaveLength(1);
    expect(parsed.relationships[0].id).toBe('r1');
    // Evidence e1 belongs to t1.
    expect(parsed.evidence).toHaveLength(1);
    // c1 references image i1; that image should be included, and only that one.
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0].id).toBe('i1');
  });

  it('exportSingleList throws when the tier list does not exist', async () => {
    await expect(exportSingleList('does-not-exist')).rejects.toThrow(/not found/);
  });

  it('detectImportFileKind distinguishes single-list from full-db and garbage', async () => {
    await seedSample();

    const singleListJson = await exportSingleList('t1');
    const fullDbJson = await exportData();

    const single = detectImportFileKind(singleListJson);
    expect(single.kind).toBe('single-list');

    const full = detectImportFileKind(fullDbJson);
    expect(full.kind).toBe('full-db');

    const garbage = detectImportFileKind('not json at all {');
    expect(garbage.kind).toBe('unknown');

    const wrongShape = detectImportFileKind(JSON.stringify({ version: 42 }));
    expect(wrongShape.kind).toBe('unknown');
  });

  it('importSingleListReplace wipes the target list\'s data and keeps other lists untouched', async () => {
    await seedSample();

    // Export t1 so we have a valid file on hand.
    const json = await exportSingleList('t1');

    // Create an EMPTY target list "t-empty" we'll replace.
    await db.tierLists.add(tl('t-empty', 'Empty target'));
    // Give the empty target a character and a relationship so we can check they get wiped.
    await db.characters.add(ch('c-empty', 'Soon gone', 't-empty'));
    await db.relationships.add(rel('r-empty', 'c-empty', 'c-empty', true, 't-empty'));

    const parsed = JSON.parse(json) as SingleListExport;
    const summary = await importSingleListReplace('t-empty', parsed);

    expect(summary.characters).toBe(2); // c1 + c2 from t1

    // The target list's metadata kept its ID but took the file's name, tiers, etc.
    const target = await db.tierLists.get('t-empty');
    expect(target?.id).toBe('t-empty');
    expect(target?.name).toBe('Main'); // from file
    expect(target?.tiers).toHaveLength(2);

    // The target list now has 2 characters (from the file), scoped to t-empty.
    const targetChars = await db.characters.where('tierListId').equals('t-empty').toArray();
    expect(targetChars.map((c) => c.name).sort()).toEqual(['Luffy', 'Zoro']);

    // The old "c-empty" character is gone (it was scoped to the replaced list).
    expect(await db.characters.get('c-empty')).toBeUndefined();
    // The old "r-empty" relationship is gone.
    expect(await db.relationships.get('r-empty')).toBeUndefined();

    // The *other* tier list t2 and its character c3 are completely untouched.
    const t2 = await db.tierLists.get('t2');
    expect(t2).toBeDefined();
    const c3 = await db.characters.get('c3');
    expect(c3?.name).toBe('Nami');
    expect(c3?.tierListId).toBe('t2');

    // t1 (the list we exported FROM) should still exist as-is — the target was t-empty.
    const t1 = await db.tierLists.get('t1');
    expect(t1).toBeDefined();
    expect(t1?.name).toBe('Main');
  });

  it('importSingleListAsNew adds a new list with fresh ids; no existing rows are overwritten', async () => {
    await seedSample();
    const json = await exportSingleList('t1');
    const parsed = JSON.parse(json) as SingleListExport;

    const beforeTlCount = await db.tierLists.count();
    const beforeCharCount = await db.characters.count();

    const summary = await importSingleListAsNew(parsed);

    // One new tier list, 2 new characters, 1 new relationship.
    expect(await db.tierLists.count()).toBe(beforeTlCount + 1);
    expect(await db.characters.count()).toBe(beforeCharCount + 2);

    // The new tier list's id is a fresh UUID — NOT 't1'.
    expect(summary.newTierListId).not.toBe('t1');
    const newList = await db.tierLists.get(summary.newTierListId);
    expect(newList).toBeDefined();
    expect(newList?.tiers).toHaveLength(2); // the file had 2 tier assignments

    // The new tier list's tier assignments reference the NEW character ids, not 'c1'/'c2'.
    for (const t of newList!.tiers) {
      expect(t.characterId).not.toBe('c1');
      expect(t.characterId).not.toBe('c2');
      // And the referenced character must exist in the DB under the new list.
      const char = await db.characters.get(t.characterId);
      expect(char).toBeDefined();
      expect(char?.tierListId).toBe(summary.newTierListId);
    }

    // Original 'c1' and 'c2' under 't1' are still exactly as they were.
    const origC1 = await db.characters.get('c1');
    expect(origC1?.name).toBe('Luffy');
    expect(origC1?.tierListId).toBe('t1');

    // The imported relationship references the new character ids, not 'c1'/'c2'.
    const newRels = await db.relationships.where('tierListId').equals(summary.newTierListId).toArray();
    expect(newRels).toHaveLength(1);
    expect(newRels[0].superiorId).not.toBe('c1');
    expect(newRels[0].inferiorId).not.toBe('c2');

    // The original relationship 'r1' under t1 is untouched.
    const origR1 = await db.relationships.get('r1');
    expect(origR1).toBeDefined();
    expect(origR1?.superiorId).toBe('c1');
    expect(origR1?.inferiorId).toBe('c2');
  });

  it('round-trip: export a list, replace it with itself, content is stable (ids are fresh)', async () => {
    await seedSample();

    const beforeChars = await db.characters.where('tierListId').equals('t1').toArray();
    const beforeNames = beforeChars.map((c) => c.name).sort();

    const json = await exportSingleList('t1');
    const parsed = JSON.parse(json) as SingleListExport;
    await importSingleListReplace('t1', parsed);

    const afterTl = await db.tierLists.get('t1');
    const afterChars = await db.characters.where('tierListId').equals('t1').toArray();
    const afterRels = await db.relationships.where('tierListId').equals('t1').toArray();

    // The tier list keeps its id but gets its name/tiers refreshed.
    expect(afterTl?.id).toBe('t1');
    expect(afterTl?.name).toBe('Main');
    expect(afterTl?.tiers).toHaveLength(2);
    // Tier assignments now reference the FRESH character ids.
    const freshCharIds = new Set(afterChars.map((c) => c.id));
    for (const t of afterTl!.tiers) expect(freshCharIds.has(t.characterId)).toBe(true);

    // Content preserved under new ids.
    expect(afterChars.map((c) => c.name).sort()).toEqual(beforeNames);

    // Relationship between the two characters is preserved (by name).
    const charById = new Map(afterChars.map((c) => [c.id, c.name]));
    expect(afterRels).toHaveLength(1);
    expect(charById.get(afterRels[0].superiorId)).toBe('Luffy');
    expect(charById.get(afterRels[0].inferiorId)).toBe('Zoro');

    // And the OTHER tier list is untouched as always.
    expect(await db.tierLists.get('t2')).toBeDefined();
  });

  it('REGRESSION: replacing a DIFFERENT list does not move characters away from the source', async () => {
    // Repro of the bug where importSingleListReplace used bulkPut with the
    // file's original ids, which upserted source-list characters to the
    // target's tierListId — effectively moving them and leaving the source
    // empty but with stale tier assignments still pointing at them.
    await seedSample();
    const json = await exportSingleList('t1');
    const parsed = JSON.parse(json) as SingleListExport;

    // User creates a new empty list and replaces IT with the file.
    await db.tierLists.add(tl('t-new', 'New'));
    await importSingleListReplace('t-new', parsed);

    // The SOURCE list (t1) must still have its characters.
    const sourceChars = await db.characters.where('tierListId').equals('t1').toArray();
    expect(sourceChars.map((c) => c.name).sort()).toEqual(['Luffy', 'Zoro']);
    const sourceCharIds = new Set(sourceChars.map((c) => c.id));
    // Source list's tier assignments still resolve to real characters in t1.
    const sourceList = await db.tierLists.get('t1');
    for (const t of sourceList!.tiers) {
      expect(sourceCharIds.has(t.characterId)).toBe(true);
    }
    // Source relationship still references source characters.
    const sourceRels = await db.relationships.where('tierListId').equals('t1').toArray();
    expect(sourceRels).toHaveLength(1);
    expect(sourceCharIds.has(sourceRels[0].superiorId)).toBe(true);
    expect(sourceCharIds.has(sourceRels[0].inferiorId)).toBe(true);

    // The TARGET list (t-new) now also has the contents (copies, distinct ids).
    const targetChars = await db.characters.where('tierListId').equals('t-new').toArray();
    expect(targetChars.map((c) => c.name).sort()).toEqual(['Luffy', 'Zoro']);
    const targetCharIds = new Set(targetChars.map((c) => c.id));
    // And none of the target's ids overlap with the source's.
    for (const id of targetCharIds) expect(sourceCharIds.has(id)).toBe(false);
  });

  it('imports create FRESH image ids so copies are self-contained', async () => {
    await seedSample();
    const json = await exportSingleList('t1');
    const parsed = JSON.parse(json) as SingleListExport;

    // Replace-mode import into a different list.
    await db.tierLists.add(tl('t-new', 'New'));
    await importSingleListReplace('t-new', parsed);

    // The source list's characters still point at the original image id.
    const sourceChars = await db.characters.where('tierListId').equals('t1').toArray();
    const sourceImageIds = sourceChars.map((c) => c.imageId).filter(Boolean);
    expect(sourceImageIds).toContain('i1');

    // The target list's characters reference a DIFFERENT image id (a fresh uuid).
    const targetChars = await db.characters.where('tierListId').equals('t-new').toArray();
    const targetImageIds = targetChars.map((c) => c.imageId).filter(Boolean);
    expect(targetImageIds).not.toContain('i1'); // not the original
    for (const id of targetImageIds) expect(id).not.toBe('i1');

    // The DB now has at least 2 distinct image rows, both with the same bytes.
    const allImages = await db.images.toArray();
    expect(allImages.length).toBeGreaterThanOrEqual(2);
    const originalBlob = allImages.find((i) => i.id === 'i1');
    const copyBlob = allImages.find((i) => i.id === targetImageIds[0]);
    expect(originalBlob).toBeDefined();
    expect(copyBlob).toBeDefined();
    const originalBytes = new Uint8Array(await originalBlob!.blob.arrayBuffer());
    const copyBytes = new Uint8Array(await copyBlob!.blob.arrayBuffer());
    expect(Array.from(copyBytes)).toEqual(Array.from(originalBytes));
  });

  it('REGRESSION: deleting an imported list does not break images in the source list', async () => {
    // The "all question marks" bug: old imports reused image ids, so
    // deleting the imported list called bulkDelete on image ids that were
    // also referenced by the source list — wiping the source's pictures.
    // Verified by doing exactly that sequence and checking images survive.
    await seedSample();

    // Import t1 as a new list.
    const json = await exportSingleList('t1');
    const parsed = JSON.parse(json) as SingleListExport;
    const { newTierListId } = await importSingleListAsNew(parsed);

    // Source image i1 is in the DB.
    expect(await db.images.get('i1')).toBeDefined();

    // Delete the new list (we need to use deleteTierList to exercise that code path).
    const { deleteTierList } = await import('../hooks/use-tier-list');
    await deleteTierList(newTierListId);

    // Source list must still have its characters AND its image.
    const sourceChars = await db.characters.where('tierListId').equals('t1').toArray();
    expect(sourceChars).toHaveLength(2);
    expect(await db.images.get('i1')).toBeDefined();
    // The surviving character's imageId still resolves.
    const luffy = sourceChars.find((c) => c.name === 'Luffy');
    expect(luffy?.imageId).toBe('i1');
    expect(await db.images.get(luffy!.imageId!)).toBeDefined();
  });

  it('defensive delete: even with manually-shared image ids, deleting one list spares shared images', async () => {
    // Simulate legacy state where two lists share an image id (which is how
    // the old bug got users into trouble). Verify our defensive
    // deleteTierList refuses to drop the image because it's still in use.
    await db.tierLists.add(tl('shared-a', 'A'));
    await db.tierLists.add(tl('shared-b', 'B'));
    await db.images.add(img('shared-i', [1, 2, 3]));
    await db.characters.add(ch('c-a', 'A-char', 'shared-a', 'shared-i'));
    await db.characters.add(ch('c-b', 'B-char', 'shared-b', 'shared-i'));

    const { deleteTierList } = await import('../hooks/use-tier-list');
    await deleteTierList('shared-a');

    // Image survives because c-b still references it.
    expect(await db.images.get('shared-i')).toBeDefined();
    // c-b's imageId still resolves.
    const cb = await db.characters.get('c-b');
    expect(cb?.imageId).toBe('shared-i');
    expect(await db.images.get(cb!.imageId!)).toBeDefined();
  });
});

describe('Import in merge mode', () => {
  beforeEach(resetDb);

  it('adds new items without wiping existing ones', async () => {
    // Start with the sample (2 tier lists, 3 characters, 1 relationship).
    await seedSample();

    // Build an import file with ONE new tier list and ONE new character.
    const incoming = JSON.stringify({
      version: 1,
      exportedAt: Date.now(),
      tierLists: [{ id: 't-new', name: 'Imported', tierDefs: DEFAULT_TIER_DEFS, tiers: [], createdAt: 1, updatedAt: 1 }],
      characters: [{ id: 'c-new', tierListId: 't-new', name: 'NewChar', createdAt: 1, updatedAt: 1 }],
      relationships: [],
      evidence: [],
      images: [],
    });

    const summary = await importData(incoming); // default = merge

    expect(summary.tierLists).toBe(1);
    expect(summary.characters).toBe(1);

    const [tls, chars] = await Promise.all([db.tierLists.toArray(), db.characters.toArray()]);
    // Original 2 + 1 imported = 3
    expect(tls).toHaveLength(3);
    expect(tls.map((t) => t.id).sort()).toEqual(['t-new', 't1', 't2']);
    // Original 3 + 1 imported = 4
    expect(chars).toHaveLength(4);
    expect(chars.map((c) => c.id).sort()).toEqual(['c-new', 'c1', 'c2', 'c3']);
    // Relationship untouched
    expect(await db.relationships.count()).toBe(1);
  });

  it('overwrites only items whose ids collide with the file', async () => {
    await seedSample();
    // 't1' has name 'Main'; import file renames it to 'Renamed'. Existing
    // tier list 't2' should remain. Character 'c1' gets a new name too.
    const incoming = JSON.stringify({
      version: 1,
      exportedAt: Date.now(),
      tierLists: [{ id: 't1', name: 'Renamed', tierDefs: DEFAULT_TIER_DEFS, tiers: [], createdAt: 1, updatedAt: 2 }],
      characters: [{ id: 'c1', tierListId: 't1', name: 'NewLuffy', createdAt: 1, updatedAt: 2 }],
      relationships: [],
      evidence: [],
      images: [],
    });

    await importData(incoming, { mode: 'merge' });

    const [tls, chars] = await Promise.all([db.tierLists.toArray(), db.characters.toArray()]);
    expect(tls).toHaveLength(2);
    expect(tls.find((t) => t.id === 't1')?.name).toBe('Renamed');
    expect(tls.find((t) => t.id === 't2')?.name).toBe('Side');
    expect(chars).toHaveLength(3);
    expect(chars.find((c) => c.id === 'c1')?.name).toBe('NewLuffy');
    // Non-colliding characters are untouched.
    expect(chars.find((c) => c.id === 'c2')?.name).toBe('Zoro');
  });

  it('merge leaves the images table alone when the file has no images', async () => {
    await seedSample();
    const originalImageCount = await db.images.count();

    const partialFile = JSON.stringify({
      version: 1,
      partial: true,
      exportedAt: Date.now(),
      tierLists: [{ id: 't-new', name: 'Imported', tierDefs: DEFAULT_TIER_DEFS, tiers: [], createdAt: 1, updatedAt: 1 }],
      characters: [],
      relationships: [],
      evidence: [],
      images: [],
    });

    await importData(partialFile, { mode: 'merge' });

    expect(await db.images.count()).toBe(originalImageCount);
  });
});

describe('Core-only export (partial)', () => {
  beforeEach(resetDb);

  it('excludes image blobs and sets partial: true', async () => {
    await seedSample();
    const json = await exportCoreData();
    const parsed = JSON.parse(json);
    expect(parsed.partial).toBe(true);
    expect(parsed.images).toEqual([]);
    expect(parsed.characters).toHaveLength(3);
    expect(parsed.tierLists).toHaveLength(2);
  });

  it('restoring a core-only snapshot preserves the images table', async () => {
    await seedSample();

    const snapshotId = await createSnapshot('Test core snapshot', { core: true });

    // Mutate everything including images.
    await db.transaction('rw', [db.characters, db.tierLists, db.relationships, db.images], async () => {
      await db.characters.clear();
      await db.tierLists.clear();
      await db.relationships.clear();
      await db.images.clear();
      await db.images.add(img('new-image', [9, 9, 9]));
    });

    // Sanity: mutation happened.
    expect(await db.characters.count()).toBe(0);
    expect(await db.tierLists.count()).toBe(0);
    const imagesBeforeRestore = await db.images.toArray();
    expect(imagesBeforeRestore).toHaveLength(1);
    expect(imagesBeforeRestore[0].id).toBe('new-image');

    // Restore the core-only snapshot.
    await restoreSnapshot(snapshotId);

    const [tls, chars, imgs] = await Promise.all([
      db.tierLists.toArray(),
      db.characters.toArray(),
      db.images.toArray(),
    ]);
    expect(tls).toHaveLength(2);
    expect(chars).toHaveLength(3);

    // CRITICAL: images table should be UNTOUCHED by a partial restore.
    // This means "new-image" (which wasn't in the snapshot) is still present.
    // The original "i1" image from seedSample is still present because we
    // didn't clear it before mutating.
    const imgIds = imgs.map((i) => i.id).sort();
    expect(imgIds).toEqual(['new-image']);
    // Note: "i1" was cleared by our mutation above; the point of this test is
    // that the RESTORE itself didn't touch images (it only repopulated the
    // core tables), so "new-image" survives.
  });
});

describe('Snapshot CRUD', () => {
  beforeEach(resetDb);

  it('createSnapshot / listSnapshots / deleteSnapshot cycle', async () => {
    await seedSample();
    const id1 = await createSnapshot('One', { core: true });
    const id2 = await createSnapshot('Two', { core: true });

    const list = await listSnapshots();
    // Both should be listed. The createdAt timestamps are ms-precision, so two
    // snapshots created in the same millisecond can tie; don't assume order.
    expect(list).toHaveLength(2);
    expect(list.map((s) => s.name).sort()).toEqual(['One', 'Two']);

    // Data lives in the split table, not in the metadata row.
    const meta1 = await db.snapshots.get(id1);
    expect(meta1).toBeDefined();
    expect((meta1 as unknown as { data?: string }).data).toBeUndefined();
    const data1 = await db.snapshotData.get(id1);
    expect(data1?.data).toBeTruthy();

    await deleteSnapshot(id1);
    expect(await db.snapshots.get(id1)).toBeUndefined();
    expect(await db.snapshotData.get(id1)).toBeUndefined();
    // The other snapshot is untouched.
    expect(await db.snapshots.get(id2)).toBeDefined();
  });

  it('clearAllSnapshots wipes both metadata and payload but leaves live data alone', async () => {
    await seedSample();
    await createSnapshot('A', { core: true });
    await createSnapshot('B', { core: true });

    const before = await db.characters.count();
    expect(before).toBe(3);

    const { deleted } = await clearAllSnapshots();
    expect(deleted).toBe(2);
    expect(await db.snapshots.count()).toBe(0);
    expect(await db.snapshotData.count()).toBe(0);

    // Live data is untouched.
    expect(await db.characters.count()).toBe(before);
    expect(await db.tierLists.count()).toBe(2);
  });

  it('restoreSnapshot fails gracefully when the payload is missing', async () => {
    await seedSample();
    const id = await createSnapshot('Orphan', { core: true });
    // Simulate a legacy row whose payload was dropped during migration.
    await db.snapshotData.delete(id);

    await expect(restoreSnapshot(id)).rejects.toThrow(/payload is unavailable/);
  });
});
