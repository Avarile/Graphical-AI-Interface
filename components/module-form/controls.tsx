'use client';

// One component per ui.control in SPEC.
//
// These are uncontrolled on purpose, and it is worth saying why, because a
// controlled input is the reflex here and it would be wrong twice over:
//
//   * React's onChange is the DOM's `input` event — it fires per keystroke.
//     The original bound the native `change` event, which for a text field
//     fires on blur. That difference is the whole editing model: committing
//     per keystroke would re-geometry the strip on every character typed, and
//     "0.0" would be refused as out of range on its way to "0.05".
//   * A controlled number input cannot hold the intermediate states of typing
//     a number. Binding state to a number turns "-" and "0." into NaN before
//     the user has finished the thought.
//
// So the DOM holds the edit in progress, each control exposes a read() to the
// form, and the form asks for every value at once when a native `change`
// bubbles up to it. That is the same shape as the original — what changed is
// that these are components rendering JSX, not functions concatenating HTML.

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { FieldSpec } from '@/lib/modules-store';
import { STATUS } from '@/lib/status';

/* ---- the reader registry ---- */
// Each control registers a function that returns whatever the schema should
// judge — including null or NaN for an empty or unparseable field, so the one
// set of validation rules gets to produce the message.

export type Reader = () => unknown;

interface Registry {
  register: (path: string, read: Reader) => () => void;
}

const RegistryContext = createContext<Registry | null>(null);

export function ReaderRegistry({
  readers,
  children,
}: {
  readers: React.MutableRefObject<Map<string, Reader>>;
  children: ReactNode;
}) {
  const value: Registry = {
    register: (path, read) => {
      readers.current.set(path, read);
      return () => {
        // Only drop it if it is still ours: a remounting control registers its
        // replacement before the outgoing one cleans up.
        if (readers.current.get(path) === read) readers.current.delete(path);
      };
    },
  };
  return <RegistryContext.Provider value={value}>{children}</RegistryContext.Provider>;
}

function useRegister(path: string, read: Reader): void {
  const ctx = useContext(RegistryContext);
  const latest = useRef(read);
  latest.current = read;
  useEffect(() => {
    if (!ctx) return;
    return ctx.register(path, () => latest.current());
    // ctx is rebuilt each render but register() closes over a stable ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
}

/* ---- shared helpers, ported from the schema ---- */

export const isNullable = (s: FieldSpec) => !!s.nullable || s.default === null;
const emptyValue = (s: FieldSpec) => (isNullable(s) ? null : '');

export interface ControlProps {
  path: string;
  spec: FieldSpec;
  value: unknown;
  disabled: boolean;
  /** Only the phase control uses this. */
  onPin?: () => void;
}

/* ---- the controls ---- */

function TextControl({ path, spec, value, disabled }: ControlProps) {
  const ref = useRef<HTMLInputElement>(null);
  useRegister(path, () => {
    const v = ref.current?.value.trim() ?? '';
    return v === '' ? emptyValue(spec) : v;
  });
  return (
    <input
      ref={ref}
      type="text"
      defaultValue={value == null ? '' : String(value)}
      disabled={disabled}
    />
  );
}

function NumberControl({ path, spec, value, disabled }: ControlProps) {
  const ref = useRef<HTMLInputElement>(null);
  useRegister(path, () => {
    const raw = ref.current?.value.trim() ?? '';
    return raw === '' ? null : Number(raw);
  });
  return (
    <input
      ref={ref}
      type="number"
      step={spec.ui.step}
      min={spec.min}
      max={spec.max}
      placeholder={isNullable(spec) ? 'auto' : undefined}
      defaultValue={value == null ? '' : String(value)}
      disabled={disabled}
    />
  );
}

function ToggleControl({ path, value, disabled }: ControlProps) {
  const ref = useRef<HTMLInputElement>(null);
  useRegister(path, () => !!ref.current?.checked);
  return <input ref={ref} type="checkbox" defaultChecked={!!value} disabled={disabled} />;
}

function StatusControl({ path, value, disabled }: ControlProps) {
  const ref = useRef<HTMLSelectElement>(null);
  useRegister(path, () => ref.current?.value ?? '');
  return (
    <select ref={ref} defaultValue={String(value ?? '')} disabled={disabled}>
      {Object.keys(STATUS).map((k) => (
        <option key={k} value={k}>
          {STATUS[k].name}
        </option>
      ))}
    </select>
  );
}

/** A colour input has no way to say "no override", so an explicit auto box
 *  carries the null and greys the swatch out while it is ticked. */
function ColorControl({ path, value, disabled }: ControlProps) {
  const [auto, setAuto] = useState(value == null);
  const autoRef = useRef<HTMLInputElement>(null);
  const valRef = useRef<HTMLInputElement>(null);
  useRegister(path, () =>
    autoRef.current?.checked ? null : (valRef.current?.value ?? '').toUpperCase(),
  );
  return (
    <span className="swatch">
      <input
        ref={autoRef}
        type="checkbox"
        data-role="auto"
        title="Use the status colour"
        defaultChecked={value == null}
        disabled={disabled}
        onChange={(e) => setAuto(e.currentTarget.checked)}
      />
      <input
        ref={valRef}
        type="color"
        data-role="value"
        defaultValue={value == null ? '#888888' : String(value)}
        // The swatch has its own reason to be greyed out, on top of the lock.
        disabled={disabled || auto}
      />
    </span>
  );
}

function ListControl({ path, value, disabled }: ControlProps) {
  const ref = useRef<HTMLInputElement>(null);
  useRegister(path, () =>
    (ref.current?.value ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return (
    <input
      ref={ref}
      type="text"
      placeholder="comma separated"
      defaultValue={((value as string[]) || []).join(', ')}
      disabled={disabled}
    />
  );
}

function PairsControl({ path, value, disabled }: ControlProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useRegister(path, () => {
    const out: Record<string, number> = {};
    for (const line of (ref.current?.value ?? '').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      const eq = t.indexOf('=');
      // A line with no "=" is left as NaN on purpose: the schema reports it.
      if (eq < 0) out[t] = NaN;
      else out[t.slice(0, eq).trim()] = Number(t.slice(eq + 1).trim());
    }
    return out;
  });
  const initial = Object.entries((value as Record<string, number>) || {})
    .map(([k, n]) => k + ' = ' + n)
    .join('\n');
  return (
    <textarea
      ref={ref}
      rows={2}
      placeholder="name = number, one per line"
      defaultValue={initial}
      disabled={disabled}
    />
  );
}

/** A number, plus a way to capture where the strip has actually got to —
 *  typing a radian angle by hand is nobody's idea of a good time. */
function PhaseControl({ path, spec, value, disabled, onPin }: ControlProps) {
  const ref = useRef<HTMLInputElement>(null);
  useRegister(path, () => {
    const raw = ref.current?.value.trim() ?? '';
    return raw === '' ? null : Number(raw);
  });
  return (
    <span className="withbtn">
      <input
        ref={ref}
        type="number"
        step={spec.ui.step}
        placeholder="auto"
        defaultValue={value == null ? '' : String(value)}
        disabled={disabled}
      />
      <button
        type="button"
        data-role="pin"
        title="Pin the angle it is at now"
        disabled={disabled}
        onClick={onPin}
      >
        pin
      </button>
    </span>
  );
}

const CONTROLS: Record<string, (p: ControlProps) => ReactNode> = {
  text: TextControl,
  number: NumberControl,
  toggle: ToggleControl,
  status: StatusControl,
  color: ColorControl,
  list: ListControl,
  pairs: PairsControl,
  phase: PhaseControl,
};

/** One labelled field: caption plus whichever control the schema asked for. */
export function Field(props: ControlProps) {
  const { spec } = props;
  const Control = CONTROLS[spec.ui.control];
  if (!Control) return null;
  const cls =
    'fld' + (spec.ui.wide ? ' wide' : '') + (spec.ui.control === 'toggle' ? ' row' : '');
  return (
    <label className={cls}>
      <span className="cap">{spec.ui.label}</span>
      <span className="ctl" data-path={props.path}>
        <Control {...props} />
      </span>
    </label>
  );
}
