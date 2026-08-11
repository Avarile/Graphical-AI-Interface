// Write the store out to modules.json.
//
// The database is authoritative, but the file is still the readable, diffable,
// committable form of an arrangement — and it is what a fresh database seeds
// itself from. This is the one thing that writes it.
//
// It is /api/export rather than /api/modules/export on purpose: a static
// segment under /api/modules would win against [id], and "export" is a
// perfectly legal module id.

import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { serialize } from '@/lib/modules/serialize';
import { fail } from '@/lib/api/http';
import { listModules } from '@/lib/db/modules-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FILE = path.join(process.cwd(), 'modules.json');

export async function POST() {
  let modules;
  try {
    modules = listModules();
  } catch (err) {
    return fail('could not read the module store: ' + (err as Error).message, 500);
  }

  // Written via a temporary file in the same directory, then renamed. rename is
  // atomic within a filesystem, so a crash or a full disk mid-write leaves the
  // previous modules.json intact rather than a half-truncated one.
  const tmp = FILE + '.tmp-' + process.pid;
  try {
    await fs.writeFile(tmp, serialize(modules), 'utf8');
    await fs.rename(tmp, FILE);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    const e = err as NodeJS.ErrnoException;
    // A read-only filesystem is the expected failure on a serverless host, and
    // the panel has a real answer for it — it downloads the file instead — so it
    // is worth naming rather than reporting as a generic 500.
    if (e.code === 'EROFS' || e.code === 'EACCES' || e.code === 'EPERM') {
      return fail('the filesystem is read-only on this host — save the file locally instead', 503);
    }
    return fail('could not write modules.json: ' + e.message, 500);
  }

  return NextResponse.json({ ok: true, modules: modules.length, file: 'modules.json' });
}
