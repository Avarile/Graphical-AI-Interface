'use client';

// The client root: React owns the module list, the scene owns the WebGL, the
// database owns the truth, and this is the seam between all three.
//
// Every edit goes through one of addModule / removeModule / replaceModule, on
// three sides at once — the scene keeps its own mirror of the list because its
// operations are indexed and surgical, React keeps one because that is what the
// panel renders from, and each change is sent to /api/modules as it happens.
// Anything that changes the data updates all three here, so there is exactly one
// place they could fall out of step rather than a dozen.
//
// There is no save step. Writes are per-module and queued in the order they were
// asked for (see lib/modules/client.ts), so there is no unsaved work to lose and
// nothing to confirm on the way out. The one thing that still writes a file is
// Export, which is a snapshot of the store rather than the store itself.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  blankModule,
  createModule,
  deleteModule,
  download,
  exportToFile,
  loadModules,
  normalize,
  saveModule,
  uniqueId,
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
    text: 'Reading the module store…',
    kind: '',
  });
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [refillKey, setRefillKey] = useState(0);
  const [scannerVisible, setScannerVisible] = useState(true);

  const setIo = useCallback((text: string, kind: IoKind = '') => {
    setIoState({ text, kind });
  }, []);

  /** Refill every control from the module — the revert path, and the
   *  confirmation after a successful edit. */
  const refill = useCallback(() => setRefillKey((k) => k + 1), []);

  // The console API and the effect callbacks need whatever is current, not
  // whatever was current when they were created.
  const live = useRef({ modules, selected });
  live.current = { modules, selected };

  /** Change the list on both sides at once.
   *
   *  The ref is updated here rather than waiting for the next render, because
   *  two edits can land in the same tick: two clicks on Add would otherwise both
   *  read the same list, pick the same free id, and send two POSTs the second of
   *  which the server has to refuse. */
  const applyModules = useCallback((update: (ms: Module[]) => Module[]) => {
    const next = update(live.current.modules);
    live.current.modules = next;
    setModules(next);
  }, []);

  /** Send one change to the store and say how it went.
   *
   *  The page has already applied the change by the time this runs — the scene
   *  animates immediately and waiting on a round trip would show as lag. So a
   *  failure here means the page is ahead of the store, and the message says so
   *  rather than pretending the edit did not happen. */
  const persist = useCallback(
    (what: string, run: () => Promise<unknown>) => {
      setIo('Saving…', '');
      run().then(
        () => setIo('Saved · ' + new Date().toLocaleTimeString(), 'ok'),
        (err: Error) => {
          console.error(err);
          setIo(
            'could not ' + what + ': ' + err.message +
              ' — the page is ahead of the store; Reload to resync',
            'err',
          );
        },
      );
    },
    [setIo],
  );

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

  const readStore = useCallback(async () => {
    const { modules: read, warnings, skipped, migrated } = await loadModules({
      statuses: STATUS_KEYS,
    });
    for (const w of warnings) console.warn('module store:', w);

    if (skipped) {
      setIo(
        skipped + ' entr' + (skipped === 1 ? 'y' : 'ies') + ' skipped: ' + warnings[0],
        'err',
      );
    } else if (migrated) {
      setIo(read.length + ' modules loaded from a version 1 record', 'ok');
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
        read = await readStore();
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
  }, [readStore, setIo]);

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
      applyModules((ms) => ms.map((m, j) => (j === i ? module : m)));
      refill();
      scene.flashUpdate(i, prev);
      // Addressed by the id it is stored under, which an edit may be changing.
      persist('save ' + cur.id, () => saveModule(cur.id, module));
      return true;
    },
    [applyModules, persist, refill, setIo, takenIds],
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
        applyModules((ms) => ms.map((m, j) => (j === i ? unlocked : m)));
        refill();
        persist('unlock ' + cur.id, () => saveModule(cur.id, unlocked));
        return;
      }

      // No validation is repeated here: whatever the store would refuse, the
      // form refuses too, in the same words, because it is the same code.
      commitAt(i, candidate);
    },
    [applyModules, commitAt, persist, refill, setIo],
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
    applyModules((ms) => [...ms, mod]);
    setSelected(i);
    scene.setSelected(i);
    refill();
    // Initializing: blink, then ease up out of nothing.
    scene.startAppear(i);
    persist('add ' + mod.id, () => createModule(mod));
  }, [applyModules, persist, refill, takenIds]);

  const onDelete = useCallback(() => {
    const scene = sceneRef.current;
    const i = live.current.selected;
    if (i == null || !scene || scene.isRemoving) return;
    const { id } = live.current.modules[i];
    // Blink out, fade away, and only then drop the module — unmounting first
    // would destroy the very objects the effect is animating.
    const started = scene.startRemove(i, () => {
      scene.removeModule(i);
      applyModules((ms) => ms.filter((_, j) => j !== i));
      setSelected(null);
      setRemoving(false);
      persist('delete ' + id, () => deleteModule(id));
    });
    if (started) setRemoving(true);
  }, [applyModules, persist]);

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

  /* ---- store-level actions ---- */

  // A ref, not the `busy` state, because the guard has to hold within a single
  // tick: setBusy() does not land until the next render, so two calls in the
  // same tick would both read `false` and both start working. The buttons are
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

  /** Write the store out to modules.json — a snapshot, not a save. Everything
   *  on screen is already stored; this is the readable, committable copy. */
  const onExport = useCallback(() => {
    void withBusy('Exporting…', async () => {
      try {
        const n = await exportToFile();
        setIo('Exported ' + n + ' modules to modules.json · ' + new Date().toLocaleTimeString(), 'ok');
      } catch (err) {
        // Read-only host: still let the work out, as a file to drop in by hand.
        download(live.current.modules);
        throw new Error((err as Error).message + ' — downloaded modules.json instead');
      }
    });
  }, [setIo, withBusy]);

  const onReload = useCallback(() => {
    const scene = sceneRef.current;
    if (scene?.isRemoving) return;
    void withBusy('Reading…', async () => {
      // Rebuild everything from the store, discarding whatever is on screen.
      // Runtime state goes with it: these are no longer the modules those
      // phases belonged to.
      const read = await readStore();
      setSelected(null);
      applyModules(() => read);
      sceneRef.current?.setModules(read);
      refill();
    });
  }, [applyModules, readStore, refill, withBusy]);

  /* ---- console API ---- */
  //   listModules()                              ids, in store order
  //   getModule('db-ledger')                     a copy, safe to poke at
  //   setStatus('db-ledger', 'running')
  //   setField('db-ledger', 'appearance.color', '#3E8CF0')
  //   setField('db-ledger', 'layout.visible', false)
  //   pinPhase('db-ledger')                      freeze it where it is now
  //   saveToFile() · reloadModules()
  //
  // Everything goes through the same validate-then-replace path the panel uses,
  // so a bad value from the console is refused rather than corrupting the list,
  // and is written to the store the same way an edit in the panel is.

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

    // Freeze a module where it currently sits, so a reload reproduces this exact
    // arrangement instead of rolling a fresh random angle.
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
    window.saveToFile = onExport;
    window.reloadModules = onReload;
    return () => {
      delete window.saveToFile;
      delete window.reloadModules;
    };
  }, [onExport, onReload]);

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
        onExport={onExport}
        onReload={onReload}
      />
    </>
  );
}
