'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Module } from '@/lib/modules-store';
import { ModuleList } from './ModuleList';
import { ModuleForm } from './module-form/ModuleForm';

export type IoKind = '' | 'dirty' | 'ok' | 'err';

export interface ModulePanelProps {
  modules: Module[];
  selected: number | null;
  /** A delete blinks the module out before dropping it. The form goes as soon
   *  as the fade starts, but the row stays highlighted until it is really gone,
   *  so this is not simply `selected != null`. */
  showForm: boolean;
  io: { text: string; kind: IoKind };
  busy: boolean;
  refillKey: number;
  scannerVisible: boolean;
  onSelect: (i: number) => void;
  onClearSelection: () => void;
  onCommit: (candidate: Module) => void;
  onPin: () => void;
  onScannerVisible: (visible: boolean) => void;
  onAdd: () => void;
  onDelete: () => void;
  onSave: () => void;
  onReload: () => void;
}

/**
 * The panel is a workbench, not a readout: it earns its screen only while it is
 * being used. Closed on load, opened by the handle, and closed again once the
 * pointer and focus have both left — the delay is there so crossing a corner of
 * the scene on the way back doesn't slam it shut.
 */
function useDrawer(panelRef: React.RefObject<HTMLDivElement | null>) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  // Never yank the panel out from under a live edit: a focused field or a
  // hovered panel means it is still in use, whatever the pointer did on the
  // way past.
  const scheduleHide = useCallback(
    (delay = 900) => {
      clear();
      timer.current = setTimeout(() => {
        const el = panelRef.current;
        if (el && (el.matches(':hover') || el.contains(document.activeElement))) {
          scheduleHide();
          return;
        }
        setOpen(false);
      }, delay);
    },
    [clear, panelRef],
  );

  // Touch has no pointerleave — reaching for the scene is the close gesture.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = panelRef.current;
      const target = e.target as Node | null;
      if (el && target && el.contains(target)) return;
      if (target instanceof Element && target.id === 'drawer-tab') return;
      scheduleHide(200);
    };
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('pointerdown', onDown);
    };
  }, [panelRef, scheduleHide]);

  useEffect(() => clear, [clear]);

  return { open, setOpen, clear, scheduleHide };
}

export function ModulePanel(props: ModulePanelProps) {
  const {
    modules,
    selected,
    showForm,
    io,
    busy,
    refillKey,
    scannerVisible,
    onSelect,
    onClearSelection,
    onCommit,
    onPin,
    onScannerVisible,
    onAdd,
    onDelete,
    onSave,
    onReload,
  } = props;

  const panelRef = useRef<HTMLDivElement>(null);
  const { open, setOpen, clear, scheduleHide } = useDrawer(panelRef);

  const current = selected != null ? modules[selected] : undefined;

  return (
    <>
      <div
        ref={panelRef}
        className={'panel' + (open ? '' : ' closed')}
        id="mod-panel"
        onPointerEnter={clear}
        onFocus={clear}
        onPointerLeave={() => scheduleHide()}
        onBlur={() => scheduleHide()}
      >
        <div className="head">
          <b>Modules</b>
          <span id="count">{modules.length} modules</span>
        </div>

        <ModuleList
          modules={modules}
          selected={selected}
          onSelect={onSelect}
          onClearSelection={onClearSelection}
        />

        {/* The form is mounted only while something is picked — the old page
            toggled display:none on a form that was always there. */}
        {showForm && current && (
          <ModuleForm
            module={current}
            refillKey={refillKey}
            onCommit={onCommit}
            onPin={onPin}
          />
        )}

        <label className="toggle">
          <input
            type="checkbox"
            checked={scannerVisible}
            onChange={(e) => onScannerVisible(e.currentTarget.checked)}
          />
          Scanner view
        </label>

        <div className="acts">
          <button type="button" onClick={onAdd}>
            Add module
          </button>
          <button
            type="button"
            className="ghost"
            onClick={onDelete}
            disabled={selected == null}
          >
            Delete
          </button>
        </div>

        <div className="acts">
          <button type="button" onClick={onSave} disabled={busy}>
            Save
          </button>
          <button type="button" className="ghost" onClick={onReload} disabled={busy}>
            Reload
          </button>
        </div>

        {/* modules.json read/write status. Doubles as the fatal-error surface,
            since a black canvas with no explanation is the worst way to report
            a bad file. */}
        <div id="io" className={io.kind}>
          {io.text}
        </div>
      </div>

      {/* The handle rides the drawer's edge — one control, both directions.
          It is a sibling of .panel because the CSS positions it with a
          `.panel.closed ~ #drawer-tab` sibling rule. */}
      <button
        type="button"
        id="drawer-tab"
        aria-controls="mod-panel"
        aria-expanded={open}
        aria-label={(open ? 'Hide' : 'Show') + ' modules panel'}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? '>' : '<'}
      </button>
    </>
  );
}
