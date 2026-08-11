'use client';

// The editing form, generated from SPEC.
//
// Not a line of this form is written by hand. Every control, its type, its
// range and its label come from the schema in modules-store.ts, so declaring a
// field there is the whole job of adding it to the panel — there is no markup
// to keep in step and no second copy of the validation rules.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GROUPS,
  SPEC,
  groupFields,
  isGroup,
  type FieldSpec,
  type Module,
} from '@/lib/modules-store';
import { Field, ReaderRegistry, type Reader } from './controls';

/** Everything editable, as [path, spec], in schema order. */
const FIELDS: [string, FieldSpec][] = (() => {
  const out: [string, FieldSpec][] = [];
  for (const [key, spec] of Object.entries(SPEC)) {
    if (isGroup(spec)) {
      for (const [fk, fs] of Object.entries(spec.fields)) out.push([key + '.' + fk, fs]);
    } else {
      out.push([key, spec]);
    }
  }
  return out;
})();

const SCALAR_FIELDS = FIELDS.filter(([p]) => !p.includes('.'));

function readPath(m: Module, path: string): unknown {
  const p = path.split('.');
  const bag = m as unknown as Record<string, unknown>;
  if (p.length === 1) return bag[p[0]];
  const group = bag[p[0]] as Record<string, unknown> | undefined;
  return (group || {})[p[1]];
}

function writePath(m: Module, path: string, v: unknown): void {
  const p = path.split('.');
  const bag = m as unknown as Record<string, unknown>;
  if (p.length === 1) {
    bag[p[0]] = v;
    return;
  }
  if (!bag[p[0]] || typeof bag[p[0]] !== 'object') bag[p[0]] = {};
  (bag[p[0]] as Record<string, unknown>)[p[1]] = v;
}

export interface ModuleFormProps {
  module: Module;
  /** Bumped by the parent to refill every control from `module` — the revert
   *  path, and the confirmation after a successful edit. */
  refillKey: number;
  /** A native `change` reached the form; here is what every control now says. */
  onCommit: (candidate: Module) => void;
  onPin: () => void;
}

export function ModuleForm({ module, refillKey, onCommit, onPin }: ModuleFormProps) {
  const readers = useRef<Map<string, Reader>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);

  // Section open/closed state lives above the refill boundary, so refilling the
  // controls never snaps the sections a user has opened back shut.
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const g of GROUPS) {
      const s = SPEC[g];
      init[g] = isGroup(s) ? !!s.open : false;
    }
    return init;
  });

  // Read every control into a copy of the module. Cloning rather than building
  // fresh is what preserves fields this build does not know about.
  const latest = useRef({ module, onCommit });
  latest.current = { module, onCommit };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // The native `change` event, not React's onChange — see the note in
    // controls.tsx. It bubbles, so one delegated listener covers every control.
    const handler = () => {
      const { module: cur, onCommit: commit } = latest.current;
      const next = structuredClone(cur);
      for (const [path] of FIELDS) {
        const read = readers.current.get(path);
        if (read) writePath(next, path, read());
      }
      commit(next);
    };
    el.addEventListener('change', handler);
    return () => el.removeEventListener('change', handler);
  }, []);

  // A locked module stays readable but not editable — except for the lock
  // itself, which is the way back out.
  const locked = !!module.layout.locked;
  const disabledFor = (path: string) => locked && path !== 'layout.locked';

  const groups = useMemo(
    () => GROUPS.map((g) => ({ g, spec: SPEC[g], fields: Object.entries(groupFields(g)) })),
    [],
  );

  return (
    <div id="mod-form" ref={containerRef}>
      {/* Keyed on the module and the refill counter: a new key rebuilds the
          controls, which is how defaultValue gets to speak again. */}
      <div key={`${module.id}:${refillKey}`}>
        <ReaderRegistry readers={readers}>
          {/* The ungrouped scalars — id, label, status — sit at the top. */}
          <div className="fields">
            {SCALAR_FIELDS.map(([path, spec]) => (
              <Field
                key={path}
                path={path}
                spec={spec}
                value={readPath(module, path)}
                disabled={disabledFor(path)}
              />
            ))}
          </div>

          {groups.map(({ g, spec, fields }) => (
            <details
              key={g}
              className="sect"
              open={open[g]}
              onToggle={(e) =>
                setOpen((o) => ({ ...o, [g]: (e.currentTarget as HTMLDetailsElement).open }))
              }
            >
              <summary>{isGroup(spec) ? spec.title : g}</summary>
              <div className="fields">
                {fields.map(([k, fs]) => {
                  const path = g + '.' + k;
                  return (
                    <Field
                      key={path}
                      path={path}
                      spec={fs}
                      value={readPath(module, path)}
                      disabled={disabledFor(path)}
                      onPin={onPin}
                    />
                  );
                })}
              </div>
            </details>
          ))}
        </ReaderRegistry>
      </div>
    </div>
  );
}
