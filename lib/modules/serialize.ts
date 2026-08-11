// The modules.json format.
//
// SQLite is the store; this is the export. The file is still the readable,
// diffable, git-committable form of an arrangement — one line per group, one
// block per module, so a change to a radius touches a single line — and it is
// still what a fresh database seeds itself from.
//
// Defaults are left out, so a plain module stays short no matter how many
// optional fields the schema grows. Reading puts them back: normalize() fills
// in every default it finds missing, so this is lossless in both directions.

import {
  GROUPS,
  SCALARS,
  SPEC,
  VERSION,
  groupFields,
  type FieldSpec,
  type Module,
} from './schema';

function isDefault(v: unknown, spec: FieldSpec): boolean {
  const d = spec.default;
  if (Array.isArray(d)) return Array.isArray(v) && v.length === 0;
  if (d && typeof d === 'object') {
    return !!v && typeof v === 'object' && Object.keys(v as object).length === 0;
  }
  return v === d;
}

function serializeModule(m: Module): string {
  const parts: string[] = [];
  const bag = m as unknown as Record<string, unknown>;

  for (const key of SCALARS) {
    const spec = SPEC[key] as FieldSpec;
    if (!spec.required && isDefault(bag[key], spec)) continue;
    parts.push('    "' + key + '": ' + JSON.stringify(bag[key]));
  }

  for (const g of GROUPS) {
    const src = (bag[g] || {}) as Record<string, unknown>;
    const fields = groupFields(g);
    const inner: string[] = [];
    for (const [k, spec] of Object.entries(fields)) {
      if (!spec.required && isDefault(src[k], spec)) continue;
      inner.push('"' + k + '": ' + JSON.stringify(src[k]));
    }
    // Keys this build does not know about are written back verbatim.
    for (const k of Object.keys(src)) {
      if (!(k in fields)) inner.push('"' + k + '": ' + JSON.stringify(src[k]));
    }
    if (inner.length) parts.push('    "' + g + '": { ' + inner.join(', ') + ' }');
  }

  for (const k of Object.keys(bag)) {
    if (!(k in SPEC)) parts.push('    "' + k + '": ' + JSON.stringify(bag[k]));
  }

  return '  {\n' + parts.join(',\n') + '\n  }';
}

export function serialize(modules: Module[]): string {
  const body = modules.map(serializeModule).join(',\n');
  return '{\n  "version": ' + VERSION + ',\n  "modules": [\n' +
         body.replace(/^/gm, '  ') + '\n  ]\n}\n';
}

// Hand the user the file to save themselves — the way out when the server
// cannot write it. The anchor goes into the document (a detached one is ignored
// by some browsers) and the URL is revoked on a later turn, since revoking it
// in this one can cancel the download that click() has only just started.
export function download(modules: Module[]): void {
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
