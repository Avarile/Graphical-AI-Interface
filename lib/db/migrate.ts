// The database's shape, and how it gets there.
//
// One table, and the columns are chosen so that SPEC stays the only place a
// field is declared. Each of SPEC's groups is a JSON column: a new field inside
// a group is a new key inside that JSON and needs no migration at all, which is
// what keeps the promise SPEC's own header makes — "adding a field later means
// adding one line to SPEC, nothing else has to learn about it". Unknown keys
// ride along in the same JSON, so a row written by a later build survives a
// read and write here intact.
//
// What has to be queryable is a generated column over that JSON. Generated
// columns are derived by SQLite on read, so `grp` cannot drift from
// meta.group — it *is* meta.group, and it still takes an index.
//
// Adding a whole new GROUP to SPEC is the one change that needs a migration.
// assertColumns() below turns that from a silent data loss into a startup error
// naming the group.

import type { DatabaseSync } from 'node:sqlite';
import { GROUPS, SCALARS } from '@/lib/modules/schema';

const MIGRATIONS: string[] = [
  // 1 — modules, and a place to record that the store has been seeded.
  `
  CREATE TABLE modules (
    id          TEXT    PRIMARY KEY,
    label       TEXT,
    status      TEXT    NOT NULL,

    -- Store order. This is the array index the page and the scene address
    -- modules by, and the last tiebreak the module list sorts on, so it has to
    -- survive a round trip. Gaps after a delete are fine: only the order reads.
    position    INTEGER NOT NULL,

    geometry    TEXT    NOT NULL,
    motion      TEXT    NOT NULL,
    appearance  TEXT    NOT NULL,
    layout      TEXT    NOT NULL,
    meta        TEXT    NOT NULL,
    links       TEXT    NOT NULL,
    telemetry   TEXT    NOT NULL,

    -- Top-level keys this build does not recognise.
    extra       TEXT    NOT NULL DEFAULT '{}',
    updated_at  TEXT    NOT NULL,

    -- Derived, never written.
    grp         TEXT    GENERATED ALWAYS AS (json_extract(meta,   '$.group'))   VIRTUAL,
    visible     INTEGER GENERATED ALWAYS AS (json_extract(layout, '$.visible')) VIRTUAL,
    sort_order  REAL    GENERATED ALWAYS AS (json_extract(layout, '$.order'))   VIRTUAL
  );

  CREATE UNIQUE INDEX modules_position ON modules (position);

  -- Exactly the module list panel's sort: group, then explicit order, then
  -- store order for everything that did not ask for one.
  CREATE INDEX modules_group ON modules (grp, sort_order, position);

  CREATE TABLE app_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

/**
 * Bring the database up to the current schema.
 *
 * Versioning is SQLite's own `user_version`, so there is no bookkeeping table to
 * keep in step with the migrations themselves. Each step is its own transaction:
 * a failure leaves the database on the last version that fully applied.
 */
export function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  let version = row.user_version;

  while (version < MIGRATIONS.length) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version]);
      version++;
      // PRAGMA takes no bound parameters; the value is a loop counter, not input.
      db.exec('PRAGMA user_version = ' + version);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(
        'migration ' + (version + 1) + ' failed: ' + (err as Error).message,
      );
    }
  }

  assertColumns(db);
}

/** Every scalar and every group in SPEC needs a column to live in. A new field
 *  inside a group needs nothing; a new group, or a new top-level scalar, needs
 *  a migration — and finding that out at startup beats finding it out as a
 *  column of silently dropped data. */
function assertColumns(db: DatabaseSync): void {
  const cols = new Set(
    (db.prepare('PRAGMA table_info(modules)').all() as { name: string }[]).map((c) => c.name),
  );
  const missing = [...SCALARS, ...GROUPS].filter((k) => !cols.has(k));
  if (missing.length) {
    throw new Error(
      'the modules table has no column for ' + missing.join(', ') +
      ' — SPEC gained a group or a top-level field, so lib/db/migrate.ts needs a migration for it',
    );
  }
}
