// Reading and writing modules.
//
// This is storage, not policy: nothing here decides whether a module is valid.
// The routes call verify() — the same function the panel calls — before anything
// reaches these functions, so the rules live in exactly one place and this layer
// stays a mapping.
//
// Server only.

import type { Module } from '@/lib/modules/schema';
import { database } from './connection';
import {
  INSERT_AT_SQL,
  INSERT_SQL,
  SELECT_ALL_SQL,
  SELECT_ONE_SQL,
  UPDATE_SQL,
  moduleToRow,
  rowToModule,
  transact,
} from './rows';

type Row = Record<string, unknown>;

/** Every module, in store order. */
export function listModules(): Module[] {
  const rows = database().prepare(SELECT_ALL_SQL).all() as Row[];
  return rows.map(rowToModule);
}

export function getModule(id: string): Module | null {
  const row = database().prepare(SELECT_ONE_SQL).get(id) as Row | undefined;
  return row ? rowToModule(row) : null;
}

export function hasModule(id: string): boolean {
  return database().prepare('SELECT 1 FROM modules WHERE id = ?').get(id) !== undefined;
}

export function countModules(): number {
  const row = database().prepare('SELECT COUNT(*) AS n FROM modules').get() as { n: number };
  return row.n;
}

/** Add one module to the end of the list. */
export function insertModule(mod: Module): Module {
  database().prepare(INSERT_SQL).run(moduleToRow(mod));
  return mod;
}

/**
 * Replace one module in place, keeping its position.
 * @param prevId the id it is stored under — `mod.id` may be a rename
 * @returns the stored module, or null if `prevId` is not in the store
 */
export function updateModule(prevId: string, mod: Module): Module | null {
  const { changes } = database()
    .prepare(UPDATE_SQL)
    .run({ ...moduleToRow(mod), prev_id: prevId });
  return changes ? mod : null;
}

export function deleteModule(id: string): boolean {
  const { changes } = database().prepare('DELETE FROM modules WHERE id = ?').run(id);
  return changes > 0;
}

/** Replace the entire list, in one transaction. An import, not an edit: the
 *  positions come from the order given. */
export function replaceAll(modules: Module[]): number {
  const db = database();
  const insert = db.prepare(INSERT_AT_SQL);
  return transact(db, () => {
    db.exec('DELETE FROM modules');
    modules.forEach((m, i) => insert.run({ ...moduleToRow(m), position: i }));
    return modules.length;
  });
}
