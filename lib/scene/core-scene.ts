// The mainframe scene: where the data meets the objects.
//
// This file assembles. The things it assembles — the mainframe, the scanner
// deck, each module's strip and contact, the materials, the labels, the
// lifecycle effects — are each standalone and each in their own file under
// ./objects and alongside. None of them reads a Module, a status or a store;
// they take numbers. Translating a Module into those numbers is this file's
// job, and it is the only place that translation happens, so the whole of
// "what the data means for the render" is the stripSpec/contactSpec/colorOf
// block below.
//
// This is deliberately imperative and deliberately not React. The scene's whole
// design is that one module changing touches one module's objects — mount(),
// unmount() and replaceModule() exist because rebuilding the stack for a single
// edit is what made every other strip jump. A declarative renderer that diffs a
// module list into a scene graph would throw that away and take the phase of
// every spinning strip with it.
//
// So React owns the data and this owns the WebGL. The panel calls the methods
// below; nothing here reads React state, and the per-frame state that could
// never live in React — each strip's live rotation — stays in `runtime`.

import * as THREE from 'three';
import type { Stage } from './stage';
import { STATUS } from '@/lib/status';
import { bandText, type Module } from '@/lib/modules-store';
import { LabelFactory } from './labels';
import { MaterialRegistry, type ModuleMaterials } from './materials';
import { EffectRunner } from './effects';
import { applyShadowFlags } from './three-utils';
import { Mainframe } from './objects/mainframe';
import { SCANNER, Scanner } from './objects/scanner';
import { Strip, type StripSpec } from './objects/strip';
import { Contact, type ContactSpec } from './objects/contact';

// The font gate belongs to the labels, but the app only ever talks to the
// scene — so it is re-exported here rather than making MainframeApp know about
// a second module.
export { preloadLabelFont } from './labels';

/** Per-module state that has to outlive the meshes. Rebuilding a strip throws
 *  its Object3D away, so anything derived at construction time — the spin
 *  phase, the scanner lane — has to be held here or it silently resets. */
interface Runtime {
  phase: number;
  lane: number;
}

/** One module's pair of objects.
 *
 *  They live under different parents — the strip inside the mainframe, the
 *  contact on the scanner deck — but nothing ever happens to one of them
 *  alone: they mount together, they turn together, they are picked together,
 *  and every lifecycle effect plays over both. Holding them as a pair is what
 *  keeps that from being two of everything at the same index. */
class ModuleView {
  constructor(
    readonly strip: Strip,
    readonly contact: Contact,
  ) {}

  /** The subtrees an effect plays over. */
  get roots(): THREE.Object3D[] {
    return [this.strip.group, this.contact.group];
  }

  /** Turn by one frame, keeping the contact on the strip's bearing, and report
   *  where that leaves them. */
  advance(dt: number): number {
    const a = this.strip.advance(dt);
    this.contact.setAngle(a);
    return a;
  }

  setPicked(on: boolean): void {
    this.strip.setPicked(on);
    this.contact.setPicked(on);
  }

  dispose(): void {
    this.strip.dispose();
    this.contact.dispose();
  }
}

export class CoreScene {
  readonly model = new THREE.Group();

  private readonly mats = new MaterialRegistry();
  private readonly labels: LabelFactory;
  private readonly fx = new EffectRunner();
  private readonly mainframe = new Mainframe();
  private readonly scanner = new Scanner();

  private modules: Module[] = [];
  private readonly runtime: Runtime[] = [];
  private readonly views: ModuleView[] = [];

  private laneSeq = 0;
  private selected: number | null = null;
  /** A delete defers its splice until the fade finishes, so the panel stays
   *  out of the way until the module is actually gone. */
  private removing = false;
  private frame = 0;
  private last = 0;
  private disposed = false;

  constructor(stage: Stage) {
    this.model.name = 'digital-system-core';
    // The only thing the labels want from the stage is one number about the GPU.
    this.labels = new LabelFactory(stage.renderer.capabilities.getMaxAnisotropy());

    // Darker studio: this object reads as emissive light bands on black.
    stage.scene.background = new THREE.Color(0x000000);
    stage.ground.material.opacity = 0.0;

    this.model.add(this.mainframe.group);
    this.model.add(this.scanner.group);
  }

  /* ---- data -> render ---- */
  // Everything the objects are given, they are given from here. A field that
  // changes what is drawn is read in this block and nowhere else.

  /** The colour a module actually renders in: its own override, else its status. */
  private colorOf(m: Module): number {
    return m.appearance.color
      ? new THREE.Color(m.appearance.color).getHex()
      : STATUS[m.status].color;
  }

  private matsFor(m: Module): ModuleMaterials {
    return this.mats.forModule(
      this.colorOf(m),
      m.appearance.opacity,
      STATUS[m.status].gain || 1,
    );
  }

  private stripSpec(m: Module, rt: Runtime): StripSpec {
    return {
      id: m.id,
      radius: m.geometry.radius,
      y: m.geometry.y,
      arcDeg: m.geometry.arc,
      band: m.geometry.band,
      phase: rt.phase,
      visible: m.layout.visible,
      glow: m.appearance.glow,
      halo: m.appearance.halo,
      trail: m.appearance.trail,
      // The band's own text, or the display name; hidden is simply no label.
      label: m.appearance.labelVisible ? bandText(m) : null,
      labelScale: m.appearance.labelScale,
      speed: m.motion.speed,
    };
  }

  private contactSpec(m: Module, rt: Runtime): ContactSpec {
    return {
      id: m.id,
      radius: m.geometry.radius,
      y: m.geometry.y,
      lane: rt.lane,
      phase: rt.phase,
      visible: m.layout.visible,
      // Where the tether has to reach down to. Passed as a number so the
      // contact never has to know what a scanner is.
      deckY: SCANNER.y,
    };
  }

  /** motion.phase and motion.lane are the saved versions of these two. A number
   *  there pins the value so a saved arrangement reloads exactly as it was
   *  left; null means "choose one now". */
  private newRuntime(m: Module): Runtime {
    const phase = m.motion.phase != null ? m.motion.phase : Math.random() * Math.PI * 2;
    const lane = m.motion.lane != null ? m.motion.lane : this.laneSeq++ % 5;
    return { phase, lane };
  }

  /* ---- scene graph operations ---- */
  // One module changing must touch one module's objects. Rebuilding the whole
  // stack for a single edit is what made every other strip jump.

  /** Build module i's objects and put them in the scene at slot i. */
  private mount(i: number): void {
    const m = this.modules[i];
    const rt = this.runtime[i];
    const mat = this.matsFor(m);

    const view = new ModuleView(
      new Strip(this.stripSpec(m, rt), mat, this.labels),
      new Contact(this.contactSpec(m, rt), mat),
    );
    this.views[i] = view;

    this.model.add(view.strip.group);
    this.scanner.group.add(view.contact.group);
    applyShadowFlags(view.strip.group);
    applyShadowFlags(view.contact.group);
  }

  /** Tear module i's objects out, leaving the arrays for the caller to adjust. */
  private unmount(i: number): void {
    const view = this.views[i];
    this.fx.cancelFor(view.strip.group);
    this.model.remove(view.strip.group);
    this.scanner.group.remove(view.contact.group);
    view.dispose();
  }

  /** Drop every running effect without firing its completion — used by the
   *  paths that are about to replace the objects the effects drive. */
  private cancelFx(): void {
    this.fx.cancelAll();
    this.removing = false;
  }

  /** Dim everything but the picked module, and show its two overlays. */
  private applyHighlight(): void {
    this.mats.setDimmed(this.selected != null);
    for (let i = 0; i < this.views.length; i++) {
      this.views[i].setPicked(i === this.selected);
    }
  }

  /** Stage.setObject() turns casting on for every mesh it finds, so the label
   *  opt-outs have to be restated after it runs. */
  reapplyShadowFlags(): void {
    applyShadowFlags(this.model);
  }

  /* ---- the API the panel drives ---- */

  /** Replace the whole list, discarding whatever is on screen. Runtime state
   *  goes with it: these are no longer the modules those phases belonged to. */
  setModules(modules: Module[]): void {
    this.cancelFx();
    for (let i = 0; i < this.views.length; i++) this.unmount(i);
    this.views.length = 0;
    this.runtime.length = 0;
    this.laneSeq = 0;
    this.selected = null;

    this.modules = modules.slice();
    for (const m of this.modules) this.runtime.push(this.newRuntime(m));
    for (let i = 0; i < this.modules.length; i++) this.mount(i);
    this.applyHighlight();
  }

  addModule(mod: Module): void {
    this.modules.push(mod);
    this.runtime.push(this.newRuntime(mod));
    this.mount(this.modules.length - 1);
    this.applyHighlight();
  }

  removeModule(i: number): void {
    this.unmount(i);
    this.views.splice(i, 1);
    this.modules.splice(i, 1);
    this.runtime.splice(i, 1);
    if (this.selected === i) this.selected = null;
    this.applyHighlight();
  }

  /** Swap module i's definition, keeping its runtime — so an edit re-geometries
   *  that one strip in place without disturbing its spin or anyone else's. An
   *  edit that pins phase or lane is the one exception: those are the runtime,
   *  so the runtime has to follow the data. */
  replaceModule(i: number, mod: Module): void {
    const before = this.modules[i];
    this.unmount(i);
    this.modules[i] = mod;
    if (mod.motion.phase != null && mod.motion.phase !== before.motion.phase) {
      this.runtime[i].phase = mod.motion.phase;
    }
    if (mod.motion.lane != null && mod.motion.lane !== before.motion.lane) {
      this.runtime[i].lane = mod.motion.lane;
    }
    this.mount(i);
    this.applyHighlight();
  }

  setSelected(i: number | null): void {
    this.selected = i;
    this.applyHighlight();
  }

  /** Show or hide the sensor plate under the mainframe.
   *
   *  The "Scanner view" checkbox existed in the old markup but nothing ever
   *  read it — there was no handler for #f-scanner anywhere in the page, so
   *  ticking it did nothing. This is the method it was always reaching for. */
  setScannerVisible(visible: boolean): void {
    this.scanner.setVisible(visible);
  }

  /** Kick off the update flash for a module index, given its previous colour. */
  flashUpdate(i: number, prevColor: number): void {
    const view = this.views[i];
    if (!view) return;
    this.fx.update(
      view.roots,
      0.8,
      new THREE.Color(prevColor),
      new THREE.Color(this.colorOf(this.modules[i])),
    );
  }

  /** Initializing: blink, then ease up out of nothing. */
  startAppear(i: number): void {
    const view = this.views[i];
    if (!view) return;
    this.fx.appear(view.roots, 1.2);
  }

  /** Blink out, fade away, and only then drop the module — unmounting first
   *  would destroy the very objects the effect is animating. */
  startRemove(i: number, done: () => void): boolean {
    const view = this.views[i];
    if (!view) return false;
    this.removing = true;
    this.fx.remove(view.roots, 0.75, () => {
      this.removing = false;
      done();
    });
    return true;
  }

  get isRemoving(): boolean {
    return this.removing;
  }

  /** The colour a module renders in right now — captured before an edit so the
   *  update flash knows where to start. */
  colorOfIndex(i: number): number {
    return this.colorOf(this.modules[i]);
  }

  /** Where module i has actually got to, normalised into [0, 2π). */
  livePhase(i: number): number {
    const p = this.runtime[i].phase;
    return ((p % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  }

  liveLane(i: number): number {
    return this.runtime[i].lane;
  }

  /* ---- the frame loop ---- */

  start(): void {
    this.last = performance.now();
    const tick = (now: number) => {
      if (this.disposed) return;
      const dt = Math.min((now - this.last) / 1000, 0.1);
      this.last = now;

      // Park each live angle in runtime so a remount picks up exactly here.
      for (let i = 0; i < this.views.length; i++) {
        this.runtime[i].phase = this.views[i].advance(dt);
      }
      this.scanner.update(dt);
      this.fx.step(dt);
      if (this.selected != null) this.mats.pulse(now);

      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.cancelFx();
    for (let i = 0; i < this.views.length; i++) this.unmount(i);
    this.views.length = 0;
    this.mats.dispose();
    this.labels.dispose();
    this.mainframe.dispose();
    this.scanner.dispose();
  }
}
