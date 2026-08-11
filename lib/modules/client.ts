// Talking to the module store from the browser.
//
// The store is a SQLite database behind /api/modules, and every edit goes to it
// as it happens: adding, editing and deleting each make their own request rather
// than marking the page dirty and waiting for a save. There is no unsaved state
// to lose, which is the whole point of the change — but it means the order the
// writes arrive in matters, so they are queued through one chain below rather
// than raced.
//
// Nothing here restates the schema. Reads are normalized on the way in, exactly
// as they were when the store was a file, because a row written by a later build
// is still a row this one has to survive.

import {
  fromV1,
  isNum,
  looksLikeV1,
  normalize,
  VERSION,
  type Module,
  type Opts,
} from './schema';

const API = '/api/modules';

/* ---- request plumbing ---- */

/** Every mutation, in the order it was asked for.
 *
 *  Two edits to the same module a moment apart are two PUTs, and nothing about
 *  fetch() promises the first will reach the server first. A chain costs one
 *  round trip of latency on a burst and removes the entire class of bug where
 *  the older value is the one that sticks. */
let chain: Promise<unknown> = Promise.resolve();

function queued<T>(fn: () => Promise<T>): Promise<T> {
  // Runs on both settle paths: one failed write must not strand the queue.
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

/** The server's own words on a failure — it explains refusals in the same terms
 *  the panel does, because it refuses them with the same code. */
async function orThrow(res: Response, what: string): Promise<Response> {
  if (res.ok) return res;
  const detail = await res.text().catch(() => '');
  throw new Error(
    'could not ' + what + ': HTTP ' + res.status + (detail ? ' ' + detail.slice(0, 160) : ''),
  );
}

async function send(method: string, url: string, body: unknown, what: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error('no server (' + (err as Error).message + ')');
  }
  await orThrow(res, what);
  return res.status === 204 ? null : res.json();
}

/* ---- reading ---- */

export interface LoadResult {
  modules: Module[];
  warnings: string[];
  /** Rows the store returned that did not survive validation. Only reachable
   *  after a schema change: everything is checked on the way in. */
  skipped: number;
  migrated: boolean;
  version: number;
}

/**
 * Read the whole list, in store order.
 * @throws if the server is unreachable or does not answer with a module list
 */
export async function loadModules(opts: Opts = {}): Promise<LoadResult> {
  let res: Response;
  try {
    res = await fetch(API, { cache: 'no-store' });
  } catch (err) {
    throw new Error(
      'could not reach the module store (' + (err as Error).message + '). ' +
      'Is the dev server running?'
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error('the module store returned HTTP ' + res.status + ' ' + detail.slice(0, 160));
  }

  let doc: unknown;
  try {
    doc = await res.json();
  } catch (err) {
    throw new Error('the module store did not return JSON: ' + (err as Error).message);
  }

  // Accept either the wrapped document or a bare array, so a hand-made response
  // still loads.
  const wrapped = doc as { modules?: unknown; version?: unknown } | null;
  const list = Array.isArray(doc) ? doc : wrapped && wrapped.modules;
  if (!Array.isArray(list)) throw new Error('the module store returned no "modules" array');

  const warnings: string[] = [];
  const fileVersion =
    !Array.isArray(doc) && wrapped && isNum(wrapped.version) ? +(wrapped.version as number) : 1;

  // A store written by a future version may carry fields this build cannot
  // render. Load it anyway — normalize() keeps what it does not understand.
  if (fileVersion > VERSION) {
    warnings.push(
      'the store is version ' + fileVersion + ', this build writes ' + VERSION +
      ' — unknown fields are preserved but not rendered'
    );
  }

  const modules: Module[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let migrated = false;

  list.forEach((entry: unknown, i: number) => {
    let raw = entry;
    if (looksLikeV1(entry)) { raw = fromV1(entry as Record<string, unknown>); migrated = true; }

    const { module, errors } = normalize(raw, opts);
    if (errors.length || !module) {
      warnings.push('entry ' + i + ' skipped — ' + errors[0]);
      skipped++;
      return;
    }
    if (seen.has(module.id)) {
      warnings.push('duplicate id "' + module.id + '" skipped');
      skipped++;
      return;
    }
    seen.add(module.id);
    modules.push(module);
  });

  if (migrated) {
    warnings.push('read as version 1 and migrated — the next write stores it as version ' + VERSION);
  }

  // Dangling references are worth reporting but must not drop a module: the
  // target may simply not have been added yet.
  for (const m of modules) {
    for (const field of ['dependsOn', 'connections'] as const) {
      for (const ref of m.links[field]) {
        if (!seen.has(ref)) warnings.push(m.id + ': ' + field + ' points at unknown id "' + ref + '"');
      }
    }
  }

  return { modules, warnings, skipped, migrated, version: fileVersion };
}

/* ---- writing ---- */
// Each of these returns the module as the store actually holds it, so the page
// renders what was written rather than what it hoped would be written.

/** Add one module to the end of the list. */
export function createModule(mod: Module): Promise<Module> {
  return queued(async () => {
    const out = await send('POST', API, mod, 'add ' + mod.id);
    return (out as { module: Module }).module;
  });
}

/**
 * Replace one module.
 * @param id the id it is currently stored under — `mod.id` may be a rename
 */
export function saveModule(id: string, mod: Module): Promise<Module> {
  return queued(async () => {
    const out = await send('PUT', API + '/' + encodeURIComponent(id), mod, 'save ' + id);
    return (out as { module: Module }).module;
  });
}

export function deleteModule(id: string): Promise<void> {
  return queued(async () => {
    await send('DELETE', API + '/' + encodeURIComponent(id), undefined, 'delete ' + id);
  });
}

/** Replace the entire list in one transaction — import, not an edit. */
export function replaceAll(modules: Module[]): Promise<number> {
  return queued(async () => {
    const out = await send('PUT', API, { version: VERSION, modules }, 'replace the module list');
    return (out as { modules: number }).modules;
  });
}

/** Write the store out to modules.json, on the server, in the readable format.
 *  @returns how many modules were written */
export function exportToFile(): Promise<number> {
  return queued(async () => {
    const out = await send('POST', API + '/export', {}, 'export modules.json');
    return (out as { modules: number }).modules;
  });
}
