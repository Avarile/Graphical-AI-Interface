// The bits every module route needs.
//
// In its own file rather than shared between the routes: a route.ts may export
// HTTP methods and route config and nothing else, so a helper exported from one
// would be a build error rather than a shortcut.
//
// The accept* functions are the write boundary. They run normalize() — the same
// call the control panel commits through — and hand back what it produced, so
// what reaches the database is the filled-in module rather than whatever shape
// the request happened to arrive in. Checking without keeping the result is the
// trap here: a request body may legitimately omit every defaulted field, and
// storing it as sent would leave those fields missing in the row.

import { NextResponse } from 'next/server';
import { normalize, type Module } from '@/lib/modules/schema';
import { STATUS_KEYS } from '@/lib/status';

/** Errors say what was wrong with the request, never where the store is on
 *  disk — that is server detail. */
export function fail(message: string, status: number) {
  return new NextResponse(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

/** A request body, or why it is not one. */
export async function readJson(request: Request): Promise<{ body?: unknown; error?: string }> {
  const text = await request.text();
  if (!text.trim()) return { error: 'body is empty' };
  try {
    return { body: JSON.parse(text) };
  } catch (err) {
    return { error: 'body is not valid JSON: ' + (err as Error).message };
  }
}

function describe(problems: string[]): string {
  const detail = problems.slice(0, 3).join('; ');
  return problems.length + ' problem(s): ' + detail +
    (problems.length > 3 ? ' (and ' + (problems.length - 3) + ' more)' : '');
}

/** One module as the store should hold it, or a sentence naming what is wrong
 *  with it. */
export function acceptModule(candidate: unknown): { module?: Module; error?: string } {
  const { module, errors } = normalize(candidate, { statuses: STATUS_KEYS });
  if (!module) return { error: describe(errors) };
  return { module };
}

/** A whole list, checked together — so two modules sharing an id is caught here
 *  rather than becoming a primary key collision half way through the write. */
export function acceptList(list: unknown[]): { modules?: Module[]; error?: string } {
  const problems: string[] = [];
  const modules: Module[] = [];
  const seen = new Set<string>();

  for (const candidate of list) {
    const { module, errors } = normalize(candidate, { statuses: STATUS_KEYS });
    if (!module) {
      problems.push(...errors);
      continue;
    }
    if (seen.has(module.id)) problems.push('two modules share the id "' + module.id + '"');
    seen.add(module.id);
    modules.push(module);
  }

  if (problems.length) return { error: describe(problems) };
  return { modules };
}
