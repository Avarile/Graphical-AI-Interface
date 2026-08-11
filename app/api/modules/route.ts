// The module collection.
//
//   GET   the whole list, in store order
//   POST  add one
//   PUT   replace the whole list, in one transaction (an import, not an edit)
//
// The single-module edits live in ./[id]/route.ts.
//
// Writes go through normalize() — the exact call the control panel commits
// through — which is why the server can enforce the *whole* schema: ranges,
// colour formats, tag types, rather than a hand-copied subset of it. The
// PowerShell server this replaced had to restate the rules in its own language
// and deliberately kept its copy shallow, because restating them "would only
// give it somewhere to drift". Nothing here restates anything.
//
// What is stored is what normalize() returned, not what arrived: a body may
// legitimately leave out every defaulted field, and storing it as sent would put
// a half-empty row in the table.

import { NextResponse } from 'next/server';
import { VERSION } from '@/lib/modules/schema';
import { acceptList, acceptModule, fail, readJson } from '@/lib/api/http';
import { hasModule, insertModule, listModules, replaceAll } from '@/lib/db/modules-repo';

// node:sqlite and a file on disk: this cannot run on the edge, and must not be
// cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(
      { version: VERSION, modules: listModules() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return fail('could not read the module store: ' + (err as Error).message, 500);
  }
}

export async function POST(request: Request) {
  const { body, error } = await readJson(request);
  if (error) return fail(error, 400);

  const { module: mod, error: bad } = acceptModule(body);
  if (!mod) return fail(bad!, 422);

  try {
    // Duplicate ids are the one thing the store cannot carry: an id addresses a
    // module from the console API, names its meshes, and is the primary key.
    if (hasModule(mod.id)) return fail('a module with the id "' + mod.id + '" already exists', 409);
    return NextResponse.json({ module: insertModule(mod) }, { status: 201 });
  } catch (err) {
    return fail('could not add the module: ' + (err as Error).message, 500);
  }
}

export async function PUT(request: Request) {
  const { body, error } = await readJson(request);
  if (error) return fail(error, 400);

  // Valid JSON is not the same as a module list, and it is the module list the
  // page needs: {"hello":"world"} parses and would strand the page on a black
  // canvas. A bare array is accepted, as it is on read.
  if (!body || typeof body !== 'object') return fail('body is a scalar, not a module document', 400);
  const wrapped = body as { modules?: unknown };
  const list = Array.isArray(body) ? body : wrapped.modules;
  if (!Array.isArray(list)) return fail('body has no "modules" array', 400);

  // Duplicate ids are caught here too: a store with two of the same is one the
  // reader would silently halve — and the primary key would refuse it half way
  // through the write.
  const { modules, error: bad } = acceptList(list);
  if (!modules) return fail(bad!, 422);

  try {
    const n = replaceAll(modules);
    return NextResponse.json({ ok: true, modules: n, version: VERSION });
  } catch (err) {
    return fail('could not replace the module list: ' + (err as Error).message, 500);
  }
}
