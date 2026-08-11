// Read/write access to modules.json.
//
// The module definitions are data, not markup, so they live in a file the page
// fetches at start-up. This is the only code that knows that file's shape.
//
// Everything about that shape is declared once, in SPEC below: field types,
// defaults, ranges, and the order they are written back in. Defaults,
// validation, serialisation and the control panel's form controls are all
// derived from it, so adding a field later means adding one line to SPEC —
// nothing else has to learn about it.
//
// A module is a nested object, grouped by concern:
//
//   { id, label, status,
//     geometry:   { radius, y, arc, band },
//     motion:     { speed, phase, lane },
//     appearance: { color, opacity, glow, halo, trail, label, ... },
//     layout:     { visible, locked, selectable, order },
//     meta:       { description, group, tags, href, tooltip },
//     links:      { dependsOn, connections },
//     telemetry:  { progress, health, metrics } }
//
// `id` is identity: it keys the console API, names the meshes, and is what a
// save/reload pairs a row back up with. `label` is display text only, so
// renaming what the user sees can never lose a module.
//
// Writing back needs a server that accepts PUT /modules.json — serve.ps1 does.
// Opened straight off disk (file://) the page still runs, read-only, and
// download() hands you a replacement file to drop in by hand.

const FILE = './modules.json';

// Bumped for a change older readers could misread. Version 1 was a flat row
// per module; loadModules() still reads it and migrates on the way in.
export const VERSION = 2;

/**
 * The shape of a module, in the order it is written back.
 *
 * kind      how the value is checked and coerced (see check() below)
 * required  must be present; no default is substituted
 * default   used when the key is absent, and omitted again on save
 * nullable  null is a legal value distinct from the default
 * min/max   inclusive bounds for num/int
 * ui        how the control panel renders it: control type and label
 */
export const SPEC = {
  id:     { kind: 'id',   required: true,  ui: { control: 'text',   label: 'ID', wide: true } },
  label:  { kind: 'text', default: null, nullable: true, ui: { control: 'text', label: 'Label', wide: true } },
  status: { kind: 'enum', required: true,  ui: { control: 'status', label: 'Status', wide: true } },

  geometry: { title: 'Geometry', open: true, fields: {
    radius: { kind: 'num', required: true, initial: 0.95, min: 0.01, max: 8,   ui: { control: 'number', label: 'Radius', step: 0.02 } },
    y:      { kind: 'num', required: true, initial: 0,    min: -8,   max: 8,   ui: { control: 'number', label: 'Height', step: 0.05 } },
    arc:    { kind: 'num', required: true, initial: 180,  min: 1,    max: 360, ui: { control: 'number', label: 'Arc °',  step: 5 } },
    band:   { kind: 'num', required: true, initial: 0.05, min: 0.002, max: 2,  ui: { control: 'number', label: 'Band',   step: 0.005 } },
  } },

  motion: { title: 'Motion', fields: {
    speed: { kind: 'num', required: true, initial: 0.08, min: -10, max: 10, ui: { control: 'number', label: 'Speed', step: 0.01 } },
    // null means "pick one at load time". A number pins the strip's starting
    // angle, so a saved arrangement reloads exactly as it was left.
    phase: { kind: 'num', default: null, nullable: true, min: 0, max: 6.2832,
             ui: { control: 'phase', label: 'Phase', step: 0.01 } },
    // null means "next free scanner lane". A number fixes the contact's ring.
    lane:  { kind: 'int', default: null, nullable: true, min: 0, max: 4,
             ui: { control: 'number', label: 'Lane', step: 1 } },
  } },

  appearance: { title: 'Appearance', fields: {
    color:        { kind: 'color', default: null, nullable: true, ui: { control: 'color',  label: 'Colour override' } },
    opacity:      { kind: 'num',   default: null, nullable: true, min: 0, max: 1, ui: { control: 'number', label: 'Opacity', step: 0.05 } },
    glow:         { kind: 'bool',  default: true,  ui: { control: 'toggle', label: 'Glow' } },
    halo:         { kind: 'bool',  default: true,  ui: { control: 'toggle', label: 'Halo' } },
    trail:        { kind: 'bool',  default: true,  ui: { control: 'toggle', label: 'Trail' } },
    label:        { kind: 'text',  default: null, nullable: true, ui: { control: 'text', label: 'Band text', wide: true } },
    labelVisible: { kind: 'bool',  default: true,  ui: { control: 'toggle', label: 'Show band text' } },
    labelScale:   { kind: 'num',   default: 1, min: 0.2, max: 4, ui: { control: 'number', label: 'Text scale', step: 0.05 } },
  } },

  layout: { title: 'Layout', fields: {
    visible:    { kind: 'bool', default: true,  ui: { control: 'toggle', label: 'Visible' } },
    locked:     { kind: 'bool', default: false, ui: { control: 'toggle', label: 'Locked' } },
    selectable: { kind: 'bool', default: true,  ui: { control: 'toggle', label: 'Selectable' } },
    order:      { kind: 'num',  default: null, nullable: true, ui: { control: 'number', label: 'Sort order', step: 1 } },
  } },

  meta: { title: 'Metadata', fields: {
    description: { kind: 'text',    default: '', ui: { control: 'text', label: 'Description', wide: true } },
    group:       { kind: 'text',    default: '', ui: { control: 'text', label: 'Group', wide: true } },
    tags:        { kind: 'strings', default: [], ui: { control: 'list', label: 'Tags', wide: true } },
    href:        { kind: 'text',    default: null, nullable: true, ui: { control: 'text', label: 'Link URL', wide: true } },
    tooltip:     { kind: 'text',    default: null, nullable: true, ui: { control: 'text', label: 'Tooltip', wide: true } },
  } },

  links: { title: 'Relationships', fields: {
    dependsOn:   { kind: 'ids', default: [], ui: { control: 'list', label: 'Depends on', wide: true } },
    connections: { kind: 'ids', default: [], ui: { control: 'list', label: 'Connections', wide: true } },
  } },

  telemetry: { title: 'Telemetry', fields: {
    progress: { kind: 'num',    default: null, nullable: true, min: 0, max: 1, ui: { control: 'number', label: 'Progress', step: 0.05 } },
    health:   { kind: 'num',    default: null, nullable: true, min: 0, max: 1, ui: { control: 'number', label: 'Health', step: 0.05 } },
    metrics:  { kind: 'nummap', default: {}, ui: { control: 'pairs', label: 'Metrics', wide: true } },
  } },
};

// The grouped sections, in write order. Anything else in SPEC is a scalar that
// lives at the top level of a module.
export const GROUPS = Object.keys(SPEC).filter((k) => SPEC[k].fields);
const SCALARS = Object.keys(SPEC).filter((k) => !SPEC[k].fields);

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Is this a real number, or something JS would quietly turn into one?
 *
 * Number.isFinite(+v) alone is not enough, and the gap is not academic: +null,
 * +'' and +[] are all 0, and +true is 1. Clearing a numeric input produces NaN,
 * which JSON.stringify writes as null — so a bare coercion check would read
 * that null back as a legitimate 0 and move the module with no warning at all.
 * Only a number, or a string that is entirely a number, counts.
 */
function isNum(v) {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string' && v.trim() !== '') return Number.isFinite(+v);
  return false;
}

/**
 * Check one value against its spec entry.
 * @returns {{value: any} | {error: string}}  the coerced value, or why not
 */
function check(v, spec, opts) {
  if (v === null && (spec.nullable || spec.default === null)) return { value: null };

  switch (spec.kind) {
    case 'id':
      if (typeof v !== 'string' || !ID_RE.test(v.trim())) {
        return { error: 'must be an id: letters, digits, then . _ - (got ' + JSON.stringify(v) + ')' };
      }
      return { value: v.trim() };

    case 'text':
      if (typeof v !== 'string') return { error: 'must be text (got ' + JSON.stringify(v) + ')' };
      return { value: v };

    case 'enum': {
      const allowed = opts.statuses;
      if (typeof v !== 'string' || (allowed && !allowed.includes(v))) {
        return { error: 'must be one of ' + (allowed ? allowed.join(', ') : 'the known statuses') +
                        ' (got ' + JSON.stringify(v) + ')' };
      }
      return { value: v };
    }

    case 'num':
    case 'int': {
      if (!isNum(v)) return { error: 'must be a number (got ' + JSON.stringify(v) + ')' };
      let n = +v;
      if (spec.kind === 'int') {
        if (!Number.isInteger(n)) return { error: 'must be a whole number (got ' + n + ')' };
      }
      if (spec.min != null && n < spec.min) return { error: 'must be at least ' + spec.min + ' (got ' + n + ')' };
      if (spec.max != null && n > spec.max) return { error: 'must be at most ' + spec.max + ' (got ' + n + ')' };
      return { value: n };
    }

    case 'bool':
      if (typeof v !== 'boolean') return { error: 'must be true or false (got ' + JSON.stringify(v) + ')' };
      return { value: v };

    case 'color':
      if (typeof v !== 'string' || !HEX_RE.test(v.trim())) {
        return { error: 'must be a hex colour like #E4A025 (got ' + JSON.stringify(v) + ')' };
      }
      return { value: v.trim().toUpperCase() };

    case 'strings': {
      if (!Array.isArray(v)) return { error: 'must be a list (got ' + JSON.stringify(v) + ')' };
      const out = [];
      for (const s of v) {
        if (typeof s !== 'string' || !s.trim()) return { error: 'list entries must be non-empty text' };
        if (!out.includes(s.trim())) out.push(s.trim());
      }
      return { value: out };
    }

    case 'ids': {
      if (!Array.isArray(v)) return { error: 'must be a list of ids (got ' + JSON.stringify(v) + ')' };
      const out = [];
      for (const s of v) {
        if (typeof s !== 'string' || !ID_RE.test(s.trim())) return { error: 'list entries must be ids' };
        if (!out.includes(s.trim())) out.push(s.trim());
      }
      return { value: out };
    }

    case 'nummap': {
      if (!v || typeof v !== 'object' || Array.isArray(v)) {
        return { error: 'must be an object of name -> number' };
      }
      const out = {};
      for (const k of Object.keys(v)) {
        if (!isNum(v[k])) return { error: '"' + k + '" must be a number (got ' + JSON.stringify(v[k]) + ')' };
        out[k] = +v[k];
      }
      return { value: out };
    }

    default:
      return { error: 'unknown field kind "' + spec.kind + '"' };
  }
}

function clone(v) {
  if (Array.isArray(v)) return v.slice();
  if (v && typeof v === 'object') return { ...v };
  return v;
}

/**
 * A module with every field at its default, ready to be filled in.
 * Required fields take their declared `initial` — zero would be outside the
 * permitted range for most of them, so a blank module has to start valid.
 */
export function blankModule(id, status) {
  const m = { id, label: null, status };
  for (const g of GROUPS) {
    m[g] = {};
    for (const [k, spec] of Object.entries(SPEC[g].fields)) {
      m[g][k] = spec.required ? spec.initial : clone(spec.default);
    }
  }
  return m;
}

/**
 * Fill in defaults and coerce what is there, keeping anything unrecognised.
 *
 * Unknown keys are carried through rather than dropped: a file written by a
 * later build must survive a load/save here without quietly losing the fields
 * this one does not understand yet.
 *
 * @returns {{module: object, errors: string[]}}
 */
export function normalize(raw, opts = {}) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { module: null, errors: ['is not an object'] };
  }

  const who = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : '(no id)';
  const out = {};

  for (const key of SCALARS) {
    const spec = SPEC[key];
    if (raw[key] === undefined) {
      if (spec.required) errors.push(who + ': ' + key + ' is missing');
      else out[key] = clone(spec.default);
      continue;
    }
    const r = check(raw[key], spec, opts);
    if (r.error) errors.push(who + ': ' + key + ' ' + r.error);
    else out[key] = r.value;
  }

  for (const g of GROUPS) {
    const src = raw[g] === undefined || raw[g] === null ? {} : raw[g];
    if (typeof src !== 'object' || Array.isArray(src)) {
      errors.push(who + ': ' + g + ' must be an object');
      continue;
    }
    out[g] = {};
    for (const [k, spec] of Object.entries(SPEC[g].fields)) {
      if (src[k] === undefined) {
        if (spec.required) errors.push(who + ': ' + g + '.' + k + ' is missing');
        else out[g][k] = clone(spec.default);
        continue;
      }
      const r = check(src[k], spec, opts);
      if (r.error) errors.push(who + ': ' + g + '.' + k + ' ' + r.error);
      else out[g][k] = r.value;
    }
    // Unrecognised keys inside a known group.
    for (const k of Object.keys(src)) {
      if (!(k in SPEC[g].fields)) out[g][k] = clone(src[k]);
    }
  }

  // Unrecognised groups / top-level keys.
  for (const k of Object.keys(raw)) {
    if (!(k in SPEC)) out[k] = clone(raw[k]);
  }

  return { module: errors.length ? null : out, errors };
}

/** What the page should show for a module: its label, or its id. */
export function displayName(m) {
  return (m.label && m.label.trim()) || m.id;
}

/** What should be printed on the band: the override, else the display name. */
export function bandText(m) {
  const o = m.appearance && m.appearance.label;
  return (o && o.trim()) || displayName(m);
}

/**
 * An id not already in `taken`, by appending -2, -3, … as needed.
 * Duplicates are the one thing the file cannot carry: ids address modules from
 * the console API and are how a save/reload pairs a module back up with itself.
 */
export function uniqueId(base, taken) {
  const cleaned = String(base).trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+/, '');
  const root = ID_RE.test(cleaned) ? cleaned : 'module';
  if (!taken.has(root)) return root;
  for (let n = 2; ; n++) {
    const candidate = root + '-' + n;
    if (!taken.has(candidate)) return candidate;
  }
}

/* ---- version 1 ---- */
// The original format: one flat object per module, name doubling as identity
// and display text. Read and lifted into v2 so an old file still opens.

function looksLikeV1(m) {
  return !!m && typeof m === 'object' && m.id === undefined &&
         typeof m.name === 'string' && m.geometry === undefined;
}

function fromV1(m) {
  return {
    id: m.name,
    label: m.name,
    status: m.status,
    geometry: { radius: m.radius, y: m.y, arc: m.arc, band: m.band },
    motion: { speed: m.speed },
  };
}

/**
 * Fetch and parse modules.json.
 * @param {{statuses?: string[]}} opts  known status keys, to validate against
 * @returns {Promise<{modules: object[], warnings: string[], skipped: number,
 *                    migrated: boolean, version: number}>}
 *   `skipped` counts entries in the file that did not make it into `modules`.
 *   Callers must keep it: saving after a skip writes those entries out of
 *   existence, so the user has to be told before that happens.
 * @throws if the file is missing, unreadable, or not shaped like a module list
 */
export async function loadModules(opts = {}) {
  let res;
  try {
    // Cache-busted: you edit this file with the page open.
    res = await fetch(FILE + '?t=' + Date.now(), { cache: 'no-store' });
  } catch (err) {
    throw new Error(
      'could not read modules.json (' + err.message + '). ' +
      'Opening the page over file:// blocks the fetch — serve it with serve.ps1.'
    );
  }
  if (!res.ok) throw new Error('modules.json returned HTTP ' + res.status);

  let doc;
  try {
    doc = await res.json();
  } catch (err) {
    throw new Error('modules.json is not valid JSON: ' + err.message);
  }

  // Accept either the wrapped document or a bare array, so a hand-trimmed file
  // still loads.
  const list = Array.isArray(doc) ? doc : doc && doc.modules;
  if (!Array.isArray(list)) throw new Error('modules.json has no "modules" array');

  const warnings = [];
  const fileVersion = !Array.isArray(doc) && isNum(doc.version) ? +doc.version : 1;

  // A file from a future version may carry fields this build cannot render.
  // Load it anyway — normalize() keeps what it does not understand.
  if (fileVersion > VERSION) {
    warnings.push(
      'file is version ' + fileVersion + ', this build writes ' + VERSION +
      ' — unknown fields are preserved but not rendered'
    );
  }

  const modules = [];
  const seen = new Set();
  let skipped = 0;
  let migrated = false;

  list.forEach((entry, i) => {
    let raw = entry;
    if (looksLikeV1(entry)) { raw = fromV1(entry); migrated = true; }

    const { module, errors } = normalize(raw, opts);
    if (errors.length) {
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
    warnings.push('read as version 1 and migrated — saving will rewrite it as version ' + VERSION);
  }

  // Dangling references are worth reporting but must not drop a module: the
  // target may simply not have been added yet.
  for (const m of modules) {
    for (const field of ['dependsOn', 'connections']) {
      for (const ref of m.links[field]) {
        if (!seen.has(ref)) warnings.push(m.id + ': ' + field + ' points at unknown id "' + ref + '"');
      }
    }
  }

  return { modules, warnings, skipped, migrated, version: fileVersion };
}

/* ---- writing ---- */

function isDefault(v, spec) {
  const d = spec.default;
  if (Array.isArray(d)) return Array.isArray(v) && v.length === 0;
  if (d && typeof d === 'object') return v && typeof v === 'object' && Object.keys(v).length === 0;
  return v === d;
}

// One line per group, one block per module: a change to a radius touches a
// single line, which is most of the reason for having a file at all. Defaults
// are left out, so a plain module stays short no matter how many optional
// fields the schema grows.
function serializeModule(m) {
  const parts = [];

  for (const key of SCALARS) {
    const spec = SPEC[key];
    if (!spec.required && isDefault(m[key], spec)) continue;
    parts.push('    "' + key + '": ' + JSON.stringify(m[key]));
  }

  for (const g of GROUPS) {
    const src = m[g] || {};
    const inner = [];
    for (const [k, spec] of Object.entries(SPEC[g].fields)) {
      if (!spec.required && isDefault(src[k], spec)) continue;
      inner.push('"' + k + '": ' + JSON.stringify(src[k]));
    }
    // Keys this build does not know about are written back verbatim.
    for (const k of Object.keys(src)) {
      if (!(k in SPEC[g].fields)) inner.push('"' + k + '": ' + JSON.stringify(src[k]));
    }
    if (inner.length) parts.push('    "' + g + '": { ' + inner.join(', ') + ' }');
  }

  for (const k of Object.keys(m)) {
    if (!(k in SPEC)) parts.push('    "' + k + '": ' + JSON.stringify(m[k]));
  }

  return '  {\n' + parts.join(',\n') + '\n  }';
}

export function serialize(modules) {
  const body = modules.map(serializeModule).join(',\n');
  return '{\n  "version": ' + VERSION + ',\n  "modules": [\n' +
         body.replace(/^/gm, '  ') + '\n  ]\n}\n';
}

/**
 * Check modules before they can reach the file.
 *
 * The same rules as reading, applied in the other direction. Writing an invalid
 * module is worse than reading one: JSON.stringify turns NaN into null, so the
 * bad value survives on disk in a form the loader has to guess about, and the
 * in-memory object that produced it is gone as soon as the page reloads.
 *
 * @returns {string[]} problems found; empty means safe to write
 */
export function verify(modules, opts = {}) {
  const problems = [];
  const seen = new Set();
  for (const m of modules) {
    const { errors } = normalize(m, opts);
    problems.push(...errors);
    const id = m && m.id;
    if (typeof id === 'string') {
      if (seen.has(id)) problems.push('two modules share the id "' + id + '"');
      seen.add(id);
    }
  }
  return problems;
}

/**
 * Write the list back to modules.json.
 * @throws if the modules are not writable, no server is listening, or it refuses
 */
export async function saveModules(modules, opts = {}) {
  const problems = verify(modules, opts);
  if (problems.length) {
    throw new Error(
      'refusing to save ' + problems.length + ' problem' +
      (problems.length === 1 ? '' : 's') + ': ' + problems[0]
    );
  }

  const body = serialize(modules);
  let res;
  try {
    res = await fetch(FILE, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  } catch (err) {
    throw new Error('no writable server (' + err.message + ') — run serve.ps1');
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error('server refused the write: HTTP ' + res.status + ' ' + detail.slice(0, 120));
  }
  return modules.length;
}

// Fallback for a read-only host: hand the user the file to save themselves.
// This is the last way out for a session of layout work, so it does not get to
// be clever: the anchor goes into the document (a detached one is ignored by
// some browsers) and the URL is revoked on a later turn, since revoking it in
// this one can cancel the download that click() has only just started.
export function download(modules) {
  const url = URL.createObjectURL(new Blob([serialize(modules)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'modules.json';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 10000);
}
