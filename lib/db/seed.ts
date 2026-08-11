// First run: fill an empty database from modules.json.
//
// The file stays in the repo as the known-good starting arrangement, and this is
// the only code that reads it. After the seed the database is authoritative and
// the file is only ever *written* — by an explicit export.
//
// Seeding is recorded in app_meta rather than inferred from an empty table, so
// deleting every module leaves an empty store rather than one that refills
// itself on the next restart.

import type { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fromV1, looksLikeV1, normalize, type Module } from '@/lib/modules/schema';
import { STATUS_KEYS } from '@/lib/status';
import { INSERT_AT_SQL, moduleToRow, transact } from './rows';

const SEED_FILE = path.join(process.cwd(), 'modules.json');

export function seedIfNew(db: DatabaseSync): void {
  const done = db.prepare('SELECT value FROM app_meta WHERE key = ?').get('seeded');
  if (done) return;

  const modules = readSeedFile();
  if (modules.length) {
    const insert = db.prepare(INSERT_AT_SQL);
    transact(db, () => {
      modules.forEach((m, i) => insert.run({ ...moduleToRow(m), position: i }));
    });
    console.log('modules.db: seeded ' + modules.length + ' modules from modules.json');
  }

  // Marked either way. A missing or unreadable seed file is not a reason to
  // retry on every request — the store is simply empty, and the panel can add
  // modules to it.
  db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?)')
    .run('seeded', new Date().toISOString());
}

/** The seed file, validated by the same rules everything else is. Bad entries
 *  are reported and skipped rather than failing the boot: an unreadable seed
 *  should leave an empty store, not an app that will not start. */
function readSeedFile(): Module[] {
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(SEED_FILE, 'utf8'));
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== 'ENOENT') {
      console.warn('modules.json could not be read for seeding: ' + e.message);
    }
    return [];
  }

  const wrapped = doc as { modules?: unknown } | null;
  const list = Array.isArray(doc) ? doc : wrapped && wrapped.modules;
  if (!Array.isArray(list)) {
    console.warn('modules.json has no "modules" array — starting with an empty store');
    return [];
  }

  const out: Module[] = [];
  const seen = new Set<string>();
  list.forEach((entry, i) => {
    const raw = looksLikeV1(entry) ? fromV1(entry as Record<string, unknown>) : entry;
    const { module, errors } = normalize(raw, { statuses: STATUS_KEYS });
    if (!module) {
      console.warn('modules.json entry ' + i + ' not seeded — ' + errors[0]);
      return;
    }
    if (seen.has(module.id)) {
      console.warn('modules.json duplicate id "' + module.id + '" not seeded');
      return;
    }
    seen.add(module.id);
    out.push(module);
  });
  return out;
}
