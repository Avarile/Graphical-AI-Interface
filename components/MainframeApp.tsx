'use client';

// The client root: React owns the module list, the scene owns the WebGL, and
// this is the seam between them.
//
// Every edit goes through one of addModule / removeModule / replaceModule, on
// both sides at once — the scene keeps its own mirror of the list because its
// operations are indexed and surgical, and React keeps one because that is what
// the panel renders from. Anything that changes the data updates both here, so
// there is exactly one place they could fall out of step rather than a dozen.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  blankModule,
  download,
  loadModules,
  normalize,
  saveModules,
  uniqueId,
  verify,
  type Module,
} from '@/lib/modules-store';
import { STATUS, STATUS_KEYS } from '@/lib/status';
import { Stage } from '@/lib/scene/stage';
import { CoreScene, preloadLabelFont } from '@/lib/scene/core-scene';
import { Hud } from './Hud';
import { ModulePanel, type IoKind } from './ModulePanel';

declare global {
  interface Window {
    listModules?: () => string[];
    getModule?: (id: string) => Module;
    setStatus?: (id: string, status: string) => string;
    setField?: (id: string, path: string, value: unknown) => string;
    pinPhase?: (id: string) => string;
    saveToFile?: () => void;
    reloadModules?: () => void;
  }
}

export default function MainframeApp() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CoreScene | null>(null);
  const stageRef = useRef<Stage | null>(null);

  const [modules, setModules] = useState<Module[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [io, setIoState] = useState<{ text: string; kind: IoKind }>({
    text: 'Reading modules.json…',
    kind: '',
  });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [refillKey, setRefillKey] = useState(0);
  const [scannerVisible, setScannerVisible] = useState(true);

  // How many entries the last read could not use. `modules` is then a subset of
  // the file, and saving would write the rest out of existence — so this
  // survives until the next read and gates the save behind a confirmation.
  const [skippedOnLoad, setSkippedOnLoad] = useState(0);

  const setIo = useCallback((text: string, kind: IoKind = '') => {
    setIoState({ text, kind });
  }, []);

  const markDirty = useCallback(() => {
    setDirty(true);
    setIo('Unsaved changes', 'dirty');
  }, [setIo]);

  /** Refill every control from the module — the revert path, and the
   *  confirmation after a successful edit. */
  const refill = useCallback(() => setRefillKey((k) => k + 1), []);

  // The console API and the effect callbacks need whatever is current, not
  // whatever was current when they were created.
  const live = useRef({ modules, selected, dirty, skippedOnLoad });
  live.current = { modules, selected, dirty, skippedOnLoad };

  /** Ids currently in use, optionally ignoring one entry — the module being
   *  renamed should not collide with itself. */
  const takenIds = useCallback((exceptIndex?: number) => {
    const taken = new Set<string>();
    live.current.modules.forEach((m, i) => {
      if (i !== exceptIndex) taken.add(m.id);
    });
    return taken;
  }, []);

  /* ---- reading ---- */

  const readFile = useCallback(async () => {
    const { modules: read, warnings, skipped, migrated } = await loadModules({
      statuses: STATUS_KEYS,
    });
    setSkippedOnLoad(skipped);
    setDirty(false);
    for (const w of warnings) console.warn('modules.json:', w);

    if (skipped) {
      setIo(
        skipped + ' entr' + (skipped === 1 ? 'y' : 'ies') + ' skipped: ' + warnings[0],
        'err',
      );
    } else if (migrated) {
      // Worth saying out loud: the next save changes the file's format.
      setIo(
        read.length + ' modules loaded from a version 1 file — saving rewrites it as version 2',
        'dirty',
      );
    } else if (warnings.length) {
      setIo(
        warnings.length + ' warning' + (warnings.length === 1 ? '' : 's') + ': ' + warnings[0],
        'err',
      );
    } else {
      setIo(read.length + ' modules loaded');
    }
    return read;
  }, [setIo]);

  /* ---- boot ---- */

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let stage: Stage | null = null;
    let scene: CoreScene | null = null;

    (async () => {
      // Pull in the brand face before the first build, so labels rasterise in
      // Futura PT rather than whatever the fallback happens to be.
      await preloadLabelFont();
      if (cancelled) return;

      stage = new Stage(container, {
        name: 'digital-system-core',
        background: '#000000',
      });
      scene = new CoreScene(stage);
      stageRef.current = stage;
      sceneRef.current = scene;

      let read: Module[] = [];
      try {
        read = await readFile();
      } catch (err) {
        // Nothing to draw and no way to recover — say so where the list would be.
        setIo(String((err as Error).message), 'err');
        return;
      }
      if (cancelled) return;

      scene.setModules(read);
      stage.setObject(scene.model);
      // setObject turns casting on for every mesh it finds — restate the opt-outs.
      scene.reapplyShadowFlags();
      stage.camera.position.multiplyScalar(0.68);
      stage.controls.update();
      scene.start();
      setModules(read);
    })();

    return () => {
      cancelled = true;
      scene?.dispose();
      stage?.dispose();
      sceneRef.current = null;
      stageRef.current = null;
    };
  }, [readFile, setIo]);

  /* ---- edits ---- */

  const commitAt = useCallback(
    (i: number, next: Module): boolean => {
      const scene = sceneRef.current;
      if (!scene) return false;
      const cur = live.current.modules[i];
      const { module, errors } = normalize(next, { statuses: STATUS_KEYS });
      if (errors.length || !module) {
        setIo(errors[0] + ' — reverted', 'err');
        refill();
        return false;
      }
      if (module.id !== cur.id && takenIds(i).has(module.id)) {
        setIo('Another module already uses the id "' + module.id + '" — reverted', 'err');
        refill();
        return false;
      }
      const prev = scene.colorOfIndex(i);
      scene.replaceModule(i, module);
      setModules((ms) => ms.map((m, j) => (j === i ? module : m)));
      markDirty();
      refill();
      scene.flashUpdate(i, prev);
      return true;
    },
    [markDirty, refill, setIo, takenIds],
  );

  const onCommit = useCallback(
    (candidate: Module) => {
      const scene = sceneRef.current;
      const i = live.current.selected;
      if (i == null || !scene || scene.isRemoving) return;
      const cur = live.current.modules[i];

      // Unlocking is the one edit a locked module accepts. Everything else is
      // refused — the controls are disabled too, so this is the backstop.
      if (cur.layout.locked) {
        if (candidate.layout.locked) {
          setIo('Module is locked — untick Locked to edit it', 'err');
          refill();
          return;
        }
        const unlocked = structuredClone(cur);
        unlocked.layout.locked = false;
        scene.replaceModule(i, unlocked);
        setModules((ms) => ms.map((m, j) => (j === i ? unlocked : m)));
        markDirty();
        refill();
        return;
      }

      // No validation is repeated here: whatever the loader would refuse, the
      // form refuses too, in the same words, because it is the same code.
      commitAt(i, candidate);
    },
    [commitAt, markDirty, refill, setIo],
  );

  const onSelect = useCallback(
    (i: number) => {
      const m = live.current.modules[i];
      if (!m) return;
      if (!m.layout.selectable) {
        setIo(
          (m.label && m.label.trim() ? m.label.trim() : m.id) + ' is marked not selectable',
          'err',
        );
        return;
      }
      setSelected(i);
      sceneRef.current?.setSelected(i);
      refill();
    },
    [refill, setIo],
  );

  const onClearSelection = useCallback(() => {
    setSelected(null);
    sceneRef.current?.setSelected(null);
  }, []);

  const onAdd = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene || scene.isRemoving) return;
    // Numbering by list length repeats itself after a delete — add, remove an
    // older module, add again and you get the same id twice. Ask for a free one.
    const mod = blankModule(uniqueId('new-module', takenIds()), 'init');
    const i = live.current.modules.length;
    scene.addModule(mod);
    setModules((ms) => [...ms, mod]);
    setSelected(i);
    scene.setSelected(i);
    markDirty();
    refill();
    // Initializing: blink, then ease up out of nothing.
    scene.startAppear(i);
  }, [markDirty, refill, takenIds]);

  const onDelete = useCallback(() => {
    const scene = sceneRef.current;
    const i = live.current.selected;
    if (i == null || !scene || scene.isRemoving) return;
    // Blink out, fade away, and only then drop the module — unmounting first
    // would destroy the very objects the effect is animating.
    const started = scene.startRemove(i, () => {
      scene.removeModule(i);
      setModules((ms) => ms.filter((_, j) => j !== i));
      setSelected(null);
      setRemoving(false);
      markDirty();
    });
    if (started) setRemoving(true);
  }, [markDirty]);

  const onPin = useCallback(() => {
    const i = live.current.selected;
    if (i == null) return;
    try {
      const id = live.current.modules[i].id;
      window.pinPhase?.(id);
      setIo('Phase and lane pinned', 'ok');
    } catch (err) {
      setIo((err as Error).message, 'err');
    }
  }, [setIo]);

  const onScannerVisible = useCallback((visible: boolean) => {
    setScannerVisible(visible);
    sceneRef.current?.setScannerVisible(visible);
  }, []);

  /* ---- modules.json read/write ---- */
  // Saving is explicit. Edits are fiddly and continuous — a strip's arc gets
  // nudged a dozen times before it looks right — and writing the file on each
  // keystroke would bury the version worth keeping.

  // A ref, not the `busy` state, because the guard has to hold within a single
  // tick: setBusy() does not land until the next render, so two calls in the
  // same tick would both read `false` and both start writing. The buttons are
  // disabled while busy, but saveToFile() from the console is not.
  const busyRef = useRef(false);

  const withBusy = useCallback(
    async (label: string, fn: () => Promise<void>) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setIo(label, '');
      try {
        await fn();
      } catch (err) {
        setIo(String((err as Error).message), 'err');
        console.error(err);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [setIo],
  );

  const onSave = useCallback(() => {
    void withBusy('Saving…', async () => {
      const list = live.current.modules;
      // Bad rows are not a transport problem, so they are caught before the
      // write is attempted — there is no point handing the user a broken file
      // to install by hand, which is what the fallback below would do.
      const problems = verify(list, { statuses: STATUS_KEYS });
      if (problems.length) {
        for (const p of problems) console.warn('modules.json:', p);
        throw new Error(
          problems.length +
            ' invalid module' +
            (problems.length === 1 ? '' : 's') +
            ': ' +
            problems[0],
        );
      }

      // The file still holds entries this session could not read. Saving
      // replaces it with what is on screen, so this is the moment they are
      // lost for good.
      const skipped = live.current.skippedOnLoad;
      if (skipped > 0) {
        const one = skipped === 1;
        const ok = window.confirm(
          skipped +
            (one ? ' entry was' : ' entries were') +
            ' skipped when modules.json was read — see the console for which.\n\n' +
            'Saving writes only the ' +
            list.length +
            ' module' +
            (list.length === 1 ? '' : 's') +
            ' shown here, deleting ' +
            (one ? 'that entry' : 'those entries') +
            ' permanently.\n\nSave anyway?',
        );
        if (!ok) {
          setIo('Save cancelled — modules.json untouched', '');
          return;
        }
      }

      try {
        const n = await saveModules(list, { statuses: STATUS_KEYS });
        setDirty(false);
        // Whatever was skipped is genuinely gone now; stop warning about it.
        setSkippedOnLoad(0);
        setIo('Saved ' + n + ' modules · ' + new Date().toLocaleTimeString(), 'ok');
      } catch (err) {
        // Read-only host: still let the work out, as a file to drop in by hand.
        download(list);
        throw new Error((err as Error).message + ' — downloaded modules.json instead');
      }
    });
  }, [setIo, withBusy]);

  const onReload = useCallback(() => {
    const scene = sceneRef.current;
    if (scene?.isRemoving) return;
    if (live.current.dirty && !window.confirm('Discard unsaved changes and re-read modules.json?')) {
      return;
    }
    void withBusy('Reading…', async () => {
      // Rebuild everything from the file, discarding whatever is on screen.
      // Runtime state goes with it: these are no longer the modules those
      // phases belonged to.
      const read = await readFile();
      setSelected(null);
      setModules(read);
      sceneRef.current?.setModules(read);
      refill();
    });
  }, [readFile, refill, withBusy]);

  /* ---- console API ---- */
  //   listModules()                              ids, in file order
  //   getModule('db-ledger')                     a copy, safe to poke at
  //   setStatus('db-ledger', 'running')
  //   setField('db-ledger', 'appearance.color', '#3E8CF0')
  //   setField('db-ledger', 'layout.visible', false)
  //   pinPhase('db-ledger')                      freeze it where it is now
  //   saveToFile() · reloadModules()
  //
  // Everything goes through the same validate-then-replace path the panel uses,
  // so a bad value from the console is refused rather than corrupting the list.

  useEffect(() => {
    const indexOfId = (id: string) => {
      const i = live.current.modules.findIndex((m) => m.id === id);
      if (i < 0) throw new Error('no module with id "' + id + '" — try listModules()');
      return i;
    };

    /** Apply a change to one module, validating it first. */
    const commit = (i: number, mutate: (m: Module) => void): Module => {
      const next = structuredClone(live.current.modules[i]);
      mutate(next);
      const { module, errors } = normalize(next, { statuses: STATUS_KEYS });
      if (errors.length || !module) throw new Error(errors[0]);
      if (!commitAt(i, next)) throw new Error('refused');
      return module;
    };

    window.listModules = () => live.current.modules.map((m) => m.id);
    window.getModule = (id) => structuredClone(live.current.modules[indexOfId(id)]);

    window.setStatus = (id, status) => {
      if (!STATUS[status]) {
        throw new Error('status must be one of: ' + STATUS_KEYS.join(', '));
      }
      commit(indexOfId(id), (m) => {
        m.status = status;
      });
      return id + ' → ' + status;
    };

    window.setField = (id, path, value) => {
      const parts = String(path).split('.');
      if (parts.length > 2) throw new Error('path is "field" or "group.field"');
      commit(indexOfId(id), (m) => {
        const bag = m as unknown as Record<string, unknown>;
        if (parts.length === 1) bag[parts[0]] = value;
        else {
          if (!bag[parts[0]] || typeof bag[parts[0]] !== 'object') bag[parts[0]] = {};
          (bag[parts[0]] as Record<string, unknown>)[parts[1]] = value;
        }
      });
      return id + ' ' + path + ' = ' + JSON.stringify(value);
    };

    // Freeze a module where it currently sits, so a save reproduces this exact
    // arrangement instead of rolling a fresh random angle on the next load.
    window.pinPhase = (id) => {
      const i = indexOfId(id);
      const scene = sceneRef.current;
      if (!scene) throw new Error('the scene is not running');
      const livePhase = scene.livePhase(i);
      commit(i, (m) => {
        m.motion.phase = Math.round(livePhase * 10000) / 10000;
        m.motion.lane = scene.liveLane(i);
      });
      return id + ' pinned at ' + livePhase.toFixed(3);
    };

    return () => {
      delete window.listModules;
      delete window.getModule;
      delete window.setStatus;
      delete window.setField;
      delete window.pinPhase;
    };
  }, [commitAt]);

  useEffect(() => {
    window.saveToFile = onSave;
    window.reloadModules = onReload;
    return () => {
      delete window.saveToFile;
      delete window.reloadModules;
    };
  }, [onSave, onReload]);

  // Losing a session of layout work to a stray refresh is not worth the silence.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  return (
    <>
      <Hud />
      <div ref={containerRef} className="stage" />
      <ModulePanel
        modules={modules}
        selected={selected}
        showForm={selected != null && !removing}
        io={io}
        busy={busy}
        refillKey={refillKey}
        scannerVisible={scannerVisible}
        onSelect={onSelect}
        onClearSelection={onClearSelection}
        onCommit={onCommit}
        onPin={onPin}
        onScannerVisible={onScannerVisible}
        onAdd={onAdd}
        onDelete={onDelete}
        onSave={onSave}
        onReload={onReload}
      />
    </>
  );
}
