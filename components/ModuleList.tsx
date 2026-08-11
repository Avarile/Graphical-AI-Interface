'use client';

import { Fragment } from 'react';
import { displayName, type Module } from '@/lib/modules-store';
import { STATUS } from '@/lib/status';

export interface ModuleListProps {
  modules: Module[];
  selected: number | null;
  onSelect: (i: number) => void;
  onClearSelection: () => void;
}

/** Ungrouped modules sort last, whatever they are called. */
const LAST = '￿';

export function ModuleList({
  modules,
  selected,
  onSelect,
  onClearSelection,
}: ModuleListProps) {
  // Grouped by meta.group, then ordered by layout.order where it is set and by
  // file order where it is not. Sorting by group first is what keeps each
  // group's rows contiguous, so the headings below can be emitted on change.
  const rows = modules.map((m, i) => ({ m, i }));
  const grouped = rows.some((r) => r.m.meta.group);
  rows.sort((a, b) => {
    const ag = a.m.meta.group || LAST;
    const bg = b.m.meta.group || LAST;
    if (ag !== bg) return ag < bg ? -1 : 1;
    const ao = a.m.layout.order;
    const bo = b.m.layout.order;
    if (ao != null && bo != null && ao !== bo) return ao - bo;
    if (ao != null && bo == null) return -1;
    if (ao == null && bo != null) return 1;
    return a.i - b.i;
  });

  let lastGroup: string | undefined;

  return (
    <div
      id="mod-list"
      // Click the panel background (not a module row) to drop the selection.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClearSelection();
      }}
    >
      {rows.map(({ m, i }) => {
        const g = m.meta.group || '';
        const heading = grouped && g !== lastGroup ? g || 'ungrouped' : null;
        lastGroup = g;
        const hint = m.meta.tooltip || m.meta.description;

        return (
          <Fragment key={m.id}>
            {heading !== null && <div className="grp">{heading}</div>}
            <button
              type="button"
              className={
                'mod' +
                (i === selected ? ' on' : '') +
                // A hidden module still lists, so you can find it again.
                (m.layout.visible ? '' : ' off') +
                (m.layout.selectable ? '' : ' nosel')
              }
              title={hint || undefined}
              onClick={() => onSelect(i)}
            >
              <i style={{ background: m.appearance.color || STATUS[m.status].hex }} />
              {/* Plain text, not markup: a label is free text, so it may well
                  contain characters that would otherwise be read as HTML. */}
              <span>{displayName(m)}</span>
              {m.layout.locked && (
                <b className="lock" title="Locked">
                  ▪
                </b>
              )}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}
