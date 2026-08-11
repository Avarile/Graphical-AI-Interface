// The one connection, opened on first use.
//
// node:sqlite is built into Node — no dependency, no native build step, and a
// synchronous API, which is the right shape for a local file: there is no round
// trip to wait on, so an async wrapper would only be ceremony.
//
// Server only. Nothing under lib/db may be imported from a client component;
// the route handlers are the boundary.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { migrate } from './migrate';
import { seedIfNew } from './seed';

const FILE = process.env.MODULES_DB || path.join(process.cwd(), 'data', 'modules.db');

// Development reloads this module on every edit, and each evaluation would
// otherwise open its own handle to the same file. The connection is parked on a
// global symbol so a reload finds the one that is already open.
const HANDLE = Symbol.for('mainframe.modules.db');

interface Holder {
  [HANDLE]?: DatabaseSync;
}

export function database(): DatabaseSync {
  const holder = globalThis as unknown as Holder;
  const open = holder[HANDLE];
  if (open) return open;

  mkdirSync(path.dirname(FILE), { recursive: true });
  const db = new DatabaseSync(FILE);

  // WAL lets a read run while a write is in flight, which is what two open tabs
  // actually do. The timeout is what turns the remaining overlap from an
  // immediate SQLITE_BUSY into a short wait.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');

  migrate(db);
  seedIfNew(db);

  holder[HANDLE] = db;
  return db;
}

/** Where the store lives — for error messages, not for opening it. */
export const databaseFile = FILE;
