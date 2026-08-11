// modules.json over HTTP — the replacement for serve.ps1.
//
// GET returns the file as it sits on disk; PUT validates a replacement and
// writes it. That is the same contract the PowerShell server offered, with one
// difference worth the migration on its own: serve.ps1 had to restate the
// schema in PowerShell and deliberately kept its copy shallow — "only as deep
// as the page will start" — because the real rules lived in the browser and
// restating them "would only give it somewhere to drift".
//
// This route is JavaScript, so it imports those rules instead. verify() here is
// the exact function the control panel calls before it will save, which means
// the server can now enforce the *whole* schema — ranges, colour formats, tag
// types — rather than a hand-copied subset of it.

import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { verify, VERSION } from '@/lib/modules-store';
import { STATUS_KEYS } from '@/lib/status';

// fs and a mutable file: this cannot run on the edge, and must not be cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FILE = path.join(process.cwd(), 'modules.json');

/** Errors mention the file, never its absolute path — that is server detail. */
function fail(message: string, status: number) {
  return new NextResponse(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export async function GET() {
  let text: string;
  try {
    text = await fs.readFile(FILE, 'utf8');
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return fail('modules.json does not exist', 404);
    return fail('could not read modules.json: ' + e.message, 500);
  }

  // Served as-is rather than re-serialised: the file's hand-tuned layout — one
  // line per group — is the point of writing it that way, and a round trip
  // through JSON.stringify would flatten it.
  return new NextResponse(text, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export async function PUT(request: Request) {
  const body = await request.text();
  if (!body.trim()) return fail('body is empty', 400);

  let doc: unknown;
  try {
    doc = JSON.parse(body);
  } catch (err) {
    return fail('body is not valid JSON: ' + (err as Error).message, 400);
  }

  // Valid JSON is not the same as a valid module list, and it is the module
  // list the page needs: {"hello":"world"} parses and would strand the page on
  // a black canvas. A bare array is accepted, as it is on read.
  if (!doc || typeof doc !== 'object') {
    return fail('body is a scalar, not a module document', 400);
  }
  const wrapped = doc as { modules?: unknown };
  const list = Array.isArray(doc) ? doc : wrapped.modules;
  if (!Array.isArray(list)) return fail('body has no "modules" array', 400);

  // The whole schema, not a shallow copy of it — this is the same call the
  // panel makes before it will offer to save. Duplicate ids are caught here
  // too: a save/reload pairs a row back up with itself by id, so a file with
  // two of the same is one the reader would silently halve.
  const problems = verify(list, { statuses: STATUS_KEYS });
  if (problems.length) {
    const detail = problems.slice(0, 3).join('; ');
    const more = problems.length > 3 ? ` (and ${problems.length - 3} more)` : '';
    return fail(`${problems.length} invalid module(s): ${detail}${more}`, 422);
  }

  // Written via a temporary file in the same directory, then renamed. rename is
  // atomic within a filesystem, so a crash or a full disk mid-write leaves the
  // previous modules.json intact rather than a half-truncated one — this file
  // is the only copy of a session's layout work.
  const tmp = FILE + '.tmp-' + process.pid;
  try {
    await fs.writeFile(tmp, body, 'utf8');
    await fs.rename(tmp, FILE);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    const e = err as NodeJS.ErrnoException;
    // A read-only filesystem is the expected failure on a serverless host, and
    // the panel has a real answer for it — it downloads the file instead — so
    // it is worth naming rather than reporting as a generic 500.
    if (e.code === 'EROFS' || e.code === 'EACCES' || e.code === 'EPERM') {
      return fail('the filesystem is read-only on this host — save the file locally instead', 503);
    }
    return fail('could not write modules.json: ' + e.message, 500);
  }

  return NextResponse.json({ ok: true, modules: list.length, version: VERSION });
}
