// Rows in, modules out.
//
// The mapping is derived from SPEC rather than written out: the column list is
// SCALARS + GROUPS, so the statements below follow the schema without being
// told about it. This file holds no rules — a value is checked by verify() at
// the route boundary, before it ever reaches here, exactly as it was when the
// store was a file.

import type { DatabaseSync } from 'node:sqlite';
import { GROUPS, SCALARS, SPEC, type Module } from '@/lib/modules/schema';

/** The columns a write touches, in a fixed order. `position` is set separately:
 *  an append computes it, a bulk replace assigns it. */
const COLUMNS = [...SCALARS, ...GROUPS, 'extra', 'updated_at'];

const SET = COLUMNS.map((c) => c + ' = :' + c).join(', ');
const NAMES = COLUMNS.join(', ');
const BINDS = COLUMNS.map((c) => ':' + c).join(', ');

/** Append: the next free position, computed in the same statement so two
 *  concurrent inserts cannot pick the same one. */
export const INSERT_SQL =
  'INSERT INTO modules (' + NAMES + ', position) VALUES (' + BINDS +
  ', (SELECT COALESCE(MAX(position), -1) + 1 FROM modules))';

/** Bulk replace: position is given, since the caller is defining the order. */
export const INSERT_AT_SQL =
  'INSERT INTO modules (' + NAMES + ', position) VALUES (' + BINDS + ', :position)';

/** Replace one module in place, keeping its position. The id is in the SET as
 *  well as the WHERE: a rename is an ordinary edit here, and there are no
 *  foreign keys to cascade — links.dependsOn and links.connections are soft
 *  references, and a dangling one is a warning rather than an error. */
export const UPDATE_SQL = 'UPDATE modules SET ' + SET + ' WHERE id = :prev_id';

export const SELECT_ALL_SQL = 'SELECT * FROM modules ORDER BY position';
export const SELECT_ONE_SQL = 'SELECT * FROM modules WHERE id = ?';

type Bindable = string | number | null;

/** A module, flattened into the columns it is stored in. */
export function moduleToRow(m: Module): Record<string, Bindable> {
  const bag = m as unknown as Record<string, unknown>;
  const row: Record<string, Bindable> = {
    extra: '{}',
    updated_at: new Date().toISOString(),
  };

  for (const k of SCALARS) {
    const v = bag[k];
    row[k] = v == null ? null : (v as Bindable);
  }
  for (const g of GROUPS) {
    row[g] = JSON.stringify(bag[g] ?? {});
  }

  // Whatever this build does not recognise at the top level. Unknown keys
  // *inside* a group need no help: they are already in that group's JSON.
  const extra: Record<string, unknown> = {};
  for (const k of Object.keys(bag)) {
    if (!(k in SPEC)) extra[k] = bag[k];
  }
  row.extra = JSON.stringify(extra);

  return row;
}

/** A stored row, back into the module the page renders. */
export function rowToModule(row: Record<string, unknown>): Module {
  const m: Record<string, unknown> = {};

  // Unknown keys first, so a stale one can never shadow a real field.
  Object.assign(m, JSON.parse(String(row.extra ?? '{}')));
  for (const k of SCALARS) m[k] = row[k] ?? null;
  for (const g of GROUPS) m[g] = JSON.parse(String(row[g] ?? '{}'));

  return m as Module;
}

/** Run `fn` as one unit of work, or not at all. */
export function transact<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
