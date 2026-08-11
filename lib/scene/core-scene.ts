// The mainframe scene: the object itself, and every operation that changes it.
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

/* ---- materials ---- */
// Shared by appearance rather than by module. Two modules with the same status
// and no overrides get one material between them, so the common case still
// costs one of each kind; a per-module colour or opacity gets its own entry,
// keyed by the values that produced it.
//
// Everything is registered in one map because the selection dimming pass has to
// reach every always-on material, and with overrides in play there is no longer
// a fixed set of four to reach for.

type MatKind = 'band' | 'glow' | 'halo' | 'hot' | 'mark';

const MAT_KINDS: Record<
  MatKind,
  (c: number, o: number | null, gain: number) => THREE.MeshStandardMaterialParameters
> = {
  band: (c, o, gain) => ({
    color: 0x0a0a0a,
    emissive: c,
    emissiveIntensity: 1.9 * gain,
    roughness: 0.5,
    metalness: 0.0,
    side: THREE.DoubleSide,
    // Left opaque unless asked otherwise: transparency costs a sorting pass.
    transparent: o != null,
    opacity: o == null ? 1 : o,
  }),
  glow: (c, o) => ({
    color: 0x000000,
    emissive: c,
    emissiveIntensity: 1.6,
    transparent: true,
    opacity: (o == null ? 1 : o) * 0.16,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  }),
  halo: (c, o) => ({
    color: 0x000000,
    emissive: c,
    emissiveIntensity: 1.6,
    transparent: true,
    opacity: (o == null ? 1 : o) * 0.055,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  }),
  // Selection overlays. Kept out of the dimming pass below: they are the thing
  // being emphasised, so brightening the rest would defeat them.
  hot: (c) => ({
    color: 0x000000,
    emissive: c,
    emissiveIntensity: 3.2,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  }),
  mark: (c) => ({
    color: 0x000000,
    emissive: c,
    emissiveIntensity: 2.6,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  }),
};

const DIMMABLE = new Set<MatKind>(['band', 'glow', 'halo']);

/** Dim the always-on materials while something is picked. */
const DIM = 0.55;

/** Preferred world height of a label; thin bands shrink it to fit. */
const LABEL_H = 0.046;

const SCAN_Y = -1.86;
const SCAN_R = 3.3;

const FLASH = new THREE.Color(0xffffff);

const blinkOn = (t: number, hz: number) => Math.floor(t * hz * 2) % 2 === 0;
const smooth = (p: number) => p * p * (3 - 2 * p);

/** Per-module state that has to outlive the meshes. Rebuilding a strip throws
 *  its Object3D away, so anything derived at construction time — the spin
 *  phase, the scanner lane — has to be held here or it silently resets. */
interface Runtime {
  phase: number;
  lane: number;
}

interface Spinner {
  g: THREE.Group;
  speed: number;
  pick: THREE.Mesh;
}

interface Contact {
  pivot: THREE.Group;
  mark: THREE.Group;
}

interface SavedMat {
  mesh: THREE.Mesh;
  shared: THREE.Material;
  base: number;
}

interface Effect {
  kind: 'remove' | 'appear' | 'update';
  roots: THREE.Object3D[];
  dur: number;
  t: number;
  saved: SavedMat[];
  from?: THREE.Color;
  to?: THREE.Color;
  done?: () => void;
}

/**
 * Pull in the brand face before the first build, so labels rasterise in Futura
 * PT rather than whatever the fallback happens to be. The weight must match the
 * one labelMaterial draws with — each weight is its own font file.
 */
export async function preloadLabelFont(): Promise<void> {
  try {
    await document.fonts.load('700 128px "Futura PT"');
  } catch {
    /* the fallback face still renders; it is only less on-brand */
  }
}

function flat<T extends THREE.Object3D>(mesh: T): T {
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

export class CoreScene {
  readonly model = new THREE.Group();

  private readonly stage: Stage;
  private readonly scanner = new THREE.Group();
  private readonly sweep: THREE.Mesh;
  private readonly matReg = new Map<string, THREE.MeshStandardMaterial>();
  private readonly labelCache = new Map<string, THREE.MeshBasicMaterial>();

  private modules: Module[] = [];
  private readonly runtime: Runtime[] = [];
  private readonly spinners: Spinner[] = [];
  private readonly contacts: Contact[] = [];
  private readonly fx: Effect[] = [];

  private laneSeq = 0;
  private selected: number | null = null;
  /** A delete defers its splice until the fade finishes, so the panel stays
   *  out of the way until the module is actually gone. */
  private removing = false;
  private frame = 0;
  private last = 0;
  private disposed = false;

  constructor(stage: Stage) {
    this.stage = stage;
    this.model.name = 'digital-system-core';

    // Darker studio: this object reads as emissive light bands on black.
    stage.scene.background = new THREE.Color(0x000000);
    stage.ground.material.opacity = 0.0;

    const coreMat = new THREE.MeshStandardMaterial({
      name: 'core-shell',
      color: 0x0b0b0c,
      roughness: 0.4,
      metalness: 0.3,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    });
    const spineMat = new THREE.MeshStandardMaterial({
      name: 'spine',
      color: 0x0a0908,
      emissive: 0xbb9244,
      emissiveIntensity: 0.08,
      roughness: 0.7,
      metalness: 0.2,
    });

    // Central mainframe column + faint containment shell.
    const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 3.1, 20), spineMat);
    spine.name = 'mainframe-spine';
    this.model.add(spine);

    const shell = new THREE.Mesh(
      new THREE.CylinderGeometry(1.24, 1.24, 3.0, 64, 1, true),
      coreMat,
    );
    shell.name = 'containment-shell';
    this.model.add(shell);

    for (const [y, name] of [
      [1.55, 'cap-top'],
      [-1.55, 'cap-base'],
    ] as const) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.24, 0.01, 10, 96), spineMat);
      ring.name = name;
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      this.model.add(ring);
    }

    /* ---- Scanner view: flat sensor plane pinned under the mainframe ---- */
    const plateMat = new THREE.MeshStandardMaterial({
      name: 'scanner-plate',
      color: 0x04121f,
      emissive: 0x0b3459,
      emissiveIntensity: 0.55,
      roughness: 0.9,
      metalness: 0.0,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const gridMat = new THREE.MeshStandardMaterial({
      name: 'scanner-grid',
      color: 0x000000,
      emissive: 0x5fa9e6,
      emissiveIntensity: 1.1,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const rimMat = new THREE.MeshStandardMaterial({
      name: 'scanner-rim',
      color: 0x000000,
      emissive: 0x8fc7f2,
      emissiveIntensity: 1.5,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.scanner.name = 'scanner-view';
    this.scanner.position.y = SCAN_Y;
    this.model.add(this.scanner);

    const plate = flat(new THREE.Mesh(new THREE.CircleGeometry(SCAN_R, 128), plateMat));
    plate.name = 'scanner-plate';
    this.scanner.add(plate);

    const rim = flat(
      new THREE.Mesh(new THREE.RingGeometry(SCAN_R - 0.012, SCAN_R, 160), rimMat),
    );
    rim.name = 'scanner-rim';
    this.scanner.add(rim);

    [0.34, 0.58, 0.79].forEach((f, i) => {
      const r = SCAN_R * f;
      const ring = flat(
        new THREE.Mesh(new THREE.RingGeometry(r - 0.006, r + 0.006, 128), gridMat),
      );
      ring.name = 'scanner-ring-' + (i + 1);
      this.scanner.add(ring);
    });

    for (let i = 0; i < 4; i++) {
      const spoke = flat(
        new THREE.Mesh(new THREE.PlaneGeometry(0.007, SCAN_R * 2), gridMat),
      );
      spoke.name = 'scanner-axis-' + (i + 1);
      spoke.rotation.z = (i * Math.PI) / 4;
      this.scanner.add(spoke);
    }

    for (let i = 0; i < 36; i++) {
      const cardinal = i % 9 === 0;
      const len = cardinal ? 0.2 : 0.1;
      const tick = flat(
        new THREE.Mesh(new THREE.PlaneGeometry(cardinal ? 0.016 : 0.008, len), rimMat),
      );
      tick.name = 'scanner-tick-' + (i + 1);
      const a = (i / 36) * Math.PI * 2;
      tick.position.set(Math.sin(a) * (SCAN_R - len / 2), 0, Math.cos(a) * (SCAN_R - len / 2));
      tick.rotation.z = -a;
      this.scanner.add(tick);
    }

    // Sweep needle, rotating like a radar arm.
    const sweep = flat(
      new THREE.Mesh(new THREE.CircleGeometry(SCAN_R * 0.995, 48, 0, 0.42), plateMat.clone()),
    );
    sweep.name = 'scanner-sweep';
    const sweepMat = sweep.material as THREE.MeshStandardMaterial;
    sweepMat.name = 'scanner-sweep';
    sweepMat.emissive = new THREE.Color(0x7fbef0);
    sweepMat.emissiveIntensity = 1.0;
    sweepMat.opacity = 0.1;
    this.scanner.add(sweep);
    this.sweep = sweep;
  }

  /* ---- materials ---- */

  private material(
    kind: MatKind,
    colorHex: number,
    opacity: number | null,
    gain: number,
  ): THREE.MeshStandardMaterial {
    const key = kind + '|' + colorHex + '|' + (opacity == null ? 'auto' : opacity) + '|' + gain;
    const found = this.matReg.get(key);
    if (found) return found;
    const mat = new THREE.MeshStandardMaterial(MAT_KINDS[kind](colorHex, opacity, gain));
    mat.name = kind + '-' + colorHex.toString(16).padStart(6, '0');
    // The dimming pass scales from this, so it has to be remembered before
    // anything touches emissiveIntensity.
    mat.userData.kind = kind;
    mat.userData.baseEmissive = mat.emissiveIntensity;
    mat.userData.baseOpacity = mat.transparent ? mat.opacity : null;
    mat.userData.dimmable = DIMMABLE.has(kind);
    this.matReg.set(key, mat);
    return mat;
  }

  /** The colour a module actually renders in: its own override, else its status. */
  private colorOf(m: Module): number {
    return m.appearance.color
      ? new THREE.Color(m.appearance.color).getHex()
      : STATUS[m.status].color;
  }

  /** Every material one module needs, resolved once per mount. Only the band
   *  carries the per-status gain, so the others key on 1 and stay shared. */
  private matsFor(m: Module) {
    const c = this.colorOf(m);
    const o = m.appearance.opacity;
    return {
      band: this.material('band', c, o, STATUS[m.status].gain || 1),
      glow: this.material('glow', c, o, 1),
      halo: this.material('halo', c, o, 1),
      hot: this.material('hot', c, null, 1),
      mark: this.material('mark', c, null, 1),
    };
  }

  /* ---- module name labels ---- */
  // Drawn to a canvas, then mapped onto a slice of cylinder sharing the band's
  // axis — so the name curves with the strip and travels with it as it turns.
  // A canvas texture needs no font loader and no extra dependency.

  private labelMaterial(name: string): THREE.MeshBasicMaterial {
    const found = this.labelCache.get(name);
    if (found) return found;

    // Oversampled and heavy: at this size the glyphs land on few screen pixels,
    // and thin strokes plus mipmap minification are what read as "dim".
    const FS = 128;
    const PAD = 24;
    const font = '700 ' + FS + 'px "Futura PT", system-ui, sans-serif';
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    ctx.font = font;
    canvas.width = Math.ceil(ctx.measureText(name).width) + PAD * 2;
    canvas.height = FS + PAD * 2;
    // Resizing the canvas resets the context, so restate the draw settings.
    ctx.font = font;
    ctx.textBaseline = 'middle';
    // Drawn twice so the anti-aliased edges reach full white rather than grey.
    ctx.fillStyle = '#ffffff';
    ctx.fillText(name, PAD, canvas.height / 2);
    ctx.fillText(name, PAD, canvas.height / 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.stage.renderer.capabilities.getMaxAnisotropy();

    // Unlit, so the name stays clean white over the band's own emission.
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    mat.name = 'label-' + name;
    mat.userData.aspect = canvas.width / canvas.height;
    this.labelCache.set(name, mat);
    return mat;
  }

  /* ---- object construction ---- */
  // Mesh names come from the id, not the label: they end up as the o / usemtl
  // entries in an exported OBJ, so they have to survive a rename.

  private makeContact(m: Module, rt: Runtime): Contact {
    const { radius, y } = m.geometry;
    const mat = this.matsFor(m);
    const id = m.id;

    const pivot = new THREE.Group();
    pivot.name = id + '-contact';
    pivot.rotation.y = rt.phase;
    pivot.visible = m.layout.visible;

    // Contacts sit further out for wider modules, echoing the strip's own
    // radius. The lane comes from runtime, not the array index, so deleting one
    // module never shifts everyone else's contact outward or inward.
    const d = 0.42 + (radius - 0.62) * 1.55 + rt.lane * 0.3;

    const blip = new THREE.Mesh(new THREE.OctahedronGeometry(0.05), mat.band);
    blip.name = id + '-blip';
    blip.position.set(d, 0.012, 0);
    pivot.add(blip);

    // Vertical tether from the strip down to its contact.
    const tether = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0035, 0.0035, y - SCAN_Y, 6),
      mat.glow,
    );
    tether.name = id + '-tether';
    tether.position.set(d, (y - SCAN_Y) / 2, 0);
    pivot.add(tether);

    // Selection marker: a ring drawn on the plate around the dot, a brighter
    // twin of the dot itself, and a beam up the tether so the pairing between
    // contact and strip reads as one object. Hidden until the module is picked.
    const mark = new THREE.Group();
    mark.name = id + '-select';
    mark.visible = false;

    const ring = flat(new THREE.Mesh(new THREE.RingGeometry(0.082, 0.104, 44), mat.mark));
    ring.name = id + '-select-ring';
    ring.position.set(d, 0.014, 0);
    mark.add(ring);

    const hotBlip = new THREE.Mesh(new THREE.OctahedronGeometry(0.062), mat.hot);
    hotBlip.name = id + '-select-blip';
    hotBlip.position.set(d, 0.012, 0);
    mark.add(hotBlip);

    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, y - SCAN_Y, 8),
      mat.mark,
    );
    beam.name = id + '-select-beam';
    beam.position.set(d, (y - SCAN_Y) / 2, 0);
    mark.add(beam);

    pivot.add(mark);

    return { pivot, mark };
  }

  private makeStrip(m: Module, rt: Runtime): Spinner {
    const { radius, y, arc: arcDeg, band: h } = m.geometry;
    const app = m.appearance;
    const mat = this.matsFor(m);
    const id = m.id;

    const g = new THREE.Group();
    g.name = id;
    g.position.y = y;
    // Resume where this module was, rather than rolling a new random phase —
    // that reset was what made the whole stack jump on every edit.
    g.rotation.y = rt.phase;
    g.visible = m.layout.visible;

    const arc = THREE.MathUtils.degToRad(arcDeg);
    const seg = Math.max(24, Math.round(arcDeg / 3));

    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, h, seg, 1, true, 0, arc),
      mat.band,
    );
    band.name = id + '-band';
    g.add(band);

    // The three soft layers are optional per module: a dense stack reads better
    // with some of them off, and they are the cheapest thing to drop.
    if (app.glow) {
      const glow = new THREE.Mesh(
        new THREE.CylinderGeometry(radius + 0.014, radius + 0.014, h * 2.4, seg, 1, true, -0.04, arc + 0.08),
        mat.glow,
      );
      glow.name = id + '-glow';
      g.add(glow);
    }

    if (app.halo) {
      const halo = new THREE.Mesh(
        new THREE.CylinderGeometry(radius + 0.03, radius + 0.03, h * 3.0, seg, 1, true, -0.07, arc + 0.14),
        mat.halo,
      );
      halo.name = id + '-halo';
      g.add(halo);
    }

    // Trailing light streak: a thinner, dimmer continuation of the arc.
    if (app.trail) {
      const tail = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, h * 0.34, seg, 1, true, arc, Math.min(arc * 0.8, 2.4)),
        mat.glow,
      );
      tail.name = id + '-trail';
      g.add(tail);
    }

    // Text printed on the band: a cylinder slice on the same axis, a hair
    // outside the band's own radius. The cylinder's UVs run along the arc, so
    // the texture wraps with the curve instead of hovering flat in front of it.
    if (app.labelVisible) {
      const labMat = this.labelMaterial(bandText(m));
      // Clear of the band by enough that depth testing never nibbles the text.
      const lr = radius + 0.014;
      let lh = Math.min(LABEL_H, h * 0.78) * app.labelScale;
      let lTheta = (lh * (labMat.userData.aspect as number)) / lr;
      // Long name on a short arc: scale the label down rather than squash it.
      const fit = arc * 0.9;
      if (lTheta > fit) {
        lh *= fit / lTheta;
        lTheta = fit;
      }

      const label = new THREE.Mesh(
        new THREE.CylinderGeometry(lr, lr, lh, Math.max(12, Math.round(lTheta * 48)), 1, true, (arc - lTheta) / 2, lTheta),
        labMat,
      );
      label.name = id + '-label';
      label.userData.noShadow = true;
      label.renderOrder = 10;
      g.add(label);
    }

    // Selection overlay: a brighter twin of the band, hidden until picked.
    const pick = new THREE.Mesh(
      new THREE.CylinderGeometry(radius + 0.006, radius + 0.006, h * 1.45, seg, 1, true, -0.015, arc + 0.03),
      mat.hot,
    );
    pick.name = id + '-select';
    pick.visible = false;
    g.add(pick);

    return { g, speed: m.motion.speed * Math.PI * 2 * 0.15, pick };
  }

  /* ---- highlight ---- */

  /** Dim the always-on materials while something is picked, so the selected
   *  strip and its contact carry the eye. Driven off each material's own
   *  recorded base rather than recomputed constants, since a per-module colour
   *  override means there is no fixed set of materials to enumerate. */
  private applyHighlight(): void {
    const k = this.selected != null ? DIM : 1;
    for (const mat of this.matReg.values()) {
      if (!mat.userData.dimmable) continue;
      mat.emissiveIntensity = (mat.userData.baseEmissive as number) * k;
      if (mat.userData.baseOpacity != null) {
        mat.opacity = (mat.userData.baseOpacity as number) * k;
      }
    }
    for (let i = 0; i < this.spinners.length; i++) {
      this.spinners[i].pick.visible = i === this.selected;
    }
    for (let i = 0; i < this.contacts.length; i++) {
      this.contacts[i].mark.visible = i === this.selected;
    }
  }

  /* ---- lifecycle animations ---- */
  // Effects run on private material clones. The shared status materials back a
  // dozen modules each, so fading or recolouring one in place would drag the
  // rest with it — same reason the selection highlight keeps its own materials.

  private isolate(roots: THREE.Object3D[]): SavedMat[] {
    const saved: SavedMat[] = [];
    for (const root of roots) {
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const shared = mesh.material as THREE.Material & { opacity: number };
        saved.push({ mesh, shared, base: shared.opacity });
        const copy = shared.clone();
        copy.transparent = true;
        mesh.material = copy;
      });
    }
    return saved;
  }

  private restoreFx(saved: SavedMat[]): void {
    for (const s of saved) {
      (s.mesh.material as THREE.Material).dispose();
      s.mesh.material = s.shared;
    }
  }

  /** Scale every mesh's own opacity, so a glow at 0.16 stays a glow. */
  private fadeFx(saved: SavedMat[], k: number): void {
    for (const s of saved) (s.mesh.material as THREE.Material).opacity = s.base * k;
  }

  private tintFx(saved: SavedMat[], color: THREE.Color): void {
    for (const s of saved) {
      const mat = s.mesh.material as THREE.MeshStandardMaterial;
      if (mat.emissive) mat.emissive.copy(color);
    }
  }

  private startFx(
    kind: Effect['kind'],
    roots: THREE.Object3D[],
    dur: number,
    opts?: Partial<Effect>,
  ): void {
    const e: Effect = { kind, roots, dur, t: 0, saved: this.isolate(roots), ...opts };
    if (kind === 'appear') this.fadeFx(e.saved, 0);
    this.fx.push(e);
  }

  /** Drop every running effect without firing its completion — used by
   *  rebuild(), which is about to replace the objects the effects drive. */
  private cancelFx(): void {
    while (this.fx.length) {
      const e = this.fx.pop()!;
      for (const r of e.roots) r.visible = true;
      this.restoreFx(e.saved);
    }
    this.removing = false;
  }

  /** Drop only the effects driving this object. Unmounting one module must not
   *  abort an animation running on another. */
  private cancelFxFor(root: THREE.Object3D): void {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      if (!this.fx[i].roots.includes(root)) continue;
      const e = this.fx.splice(i, 1)[0];
      for (const r of e.roots) r.visible = true;
      this.restoreFx(e.saved);
    }
  }

  private stepFx(dt: number): void {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const e = this.fx[i];
      e.t += dt;
      const p = Math.min(e.t / e.dur, 1);

      if (e.kind === 'remove') {
        const lead = 0.34;
        for (const r of e.roots) r.visible = e.t < lead ? blinkOn(e.t, 14) : true;
        this.fadeFx(e.saved, e.t < lead ? 1 : 1 - (e.t - lead) / (e.dur - lead));
      } else if (e.kind === 'appear') {
        for (const r of e.roots) r.visible = e.t < 0.45 ? blinkOn(e.t, 10) : true;
        this.fadeFx(e.saved, smooth(p));
      } else if (e.kind === 'update') {
        for (const r of e.roots) r.visible = e.t < 0.4 ? blinkOn(e.t, 12) : true;
        // Flash to white, then settle into the new status colour.
        this.tintFx(
          e.saved,
          p < 0.5
            ? e.from!.clone().lerp(FLASH, p * 2)
            : FLASH.clone().lerp(e.to!, (p - 0.5) * 2),
        );
      }

      if (p < 1) continue;

      // Off the list before done() runs — a completion unmounts its module, and
      // cancelFxFor() must not find this effect still there.
      this.fx.splice(i, 1);
      for (const r of e.roots) r.visible = true;
      this.restoreFx(e.saved);
      if (e.done) e.done();
    }
  }

  /* ---- scene graph operations ---- */
  // One module changing must touch one module's objects. Rebuilding the whole
  // stack for a single edit is what made every other strip jump.

  private disposeGroup(g: THREE.Object3D): void {
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
  }

  /** Stage.setObject() turns casting on for every mesh it finds, so the label
   *  opt-outs have to be restated after it runs. */
  reapplyShadowFlags(): void {
    this.applyShadowFlags(this.model);
  }

  /** Labels opt out of casting: the shadow pass ignores map transparency, so a
   *  label would otherwise throw a solid rectangle onto the bands behind it. */
  private applyShadowFlags(root: THREE.Object3D): void {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = !mesh.userData.noShadow;
      mesh.receiveShadow = true;
    });
  }

  /** motion.phase and motion.lane are the saved versions of these two. A number
   *  there pins the value so a saved arrangement reloads exactly as it was
   *  left; null means "choose one now". */
  private newRuntime(m: Module): Runtime {
    const phase = m.motion.phase != null ? m.motion.phase : Math.random() * Math.PI * 2;
    const lane = m.motion.lane != null ? m.motion.lane : this.laneSeq++ % 5;
    return { phase, lane };
  }

  /** Build module i's objects and put them in the scene at slot i. */
  private mount(i: number): void {
    const s = this.makeStrip(this.modules[i], this.runtime[i]);
    const c = this.makeContact(this.modules[i], this.runtime[i]);
    this.spinners[i] = s;
    this.contacts[i] = c;
    this.model.add(s.g);
    this.scanner.add(c.pivot);
    this.applyShadowFlags(s.g);
    this.applyShadowFlags(c.pivot);
  }

  /** Tear module i's objects out, leaving the arrays for the caller to adjust. */
  private unmount(i: number): void {
    this.cancelFxFor(this.spinners[i].g);
    this.disposeGroup(this.spinners[i].g);
    this.model.remove(this.spinners[i].g);
    this.disposeGroup(this.contacts[i].pivot);
    this.scanner.remove(this.contacts[i].pivot);
  }

  /* ---- the API the panel drives ---- */

  /** Replace the whole list, discarding whatever is on screen. Runtime state
   *  goes with it: these are no longer the modules those phases belonged to. */
  setModules(modules: Module[]): void {
    this.cancelFx();
    for (let i = 0; i < this.spinners.length; i++) this.unmount(i);
    this.spinners.length = 0;
    this.contacts.length = 0;
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
    this.spinners.splice(i, 1);
    this.contacts.splice(i, 1);
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
    this.scanner.visible = visible;
  }

  /** Kick off the update flash for a module index, given its previous colour. */
  flashUpdate(i: number, prevColor: number): void {
    if (!this.spinners[i] || !this.contacts[i]) return;
    this.startFx('update', [this.spinners[i].g, this.contacts[i].pivot], 0.8, {
      from: new THREE.Color(prevColor),
      to: new THREE.Color(this.colorOf(this.modules[i])),
    });
  }

  /** Initializing: blink, then ease up out of nothing. */
  startAppear(i: number): void {
    if (!this.spinners[i] || !this.contacts[i]) return;
    this.startFx('appear', [this.spinners[i].g, this.contacts[i].pivot], 1.2);
  }

  /** Blink out, fade away, and only then drop the module — unmounting first
   *  would destroy the very objects the effect is animating. */
  startRemove(i: number, done: () => void): boolean {
    if (!this.spinners[i] || !this.contacts[i]) return false;
    this.removing = true;
    this.startFx('remove', [this.spinners[i].g, this.contacts[i].pivot], 0.75, {
      done: () => {
        this.removing = false;
        done();
      },
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

      for (let i = 0; i < this.spinners.length; i++) {
        const a = (this.spinners[i].g.rotation.y += this.spinners[i].speed * dt);
        // Park the live angle in runtime so a remount picks up exactly here.
        this.runtime[i].phase = a;
        if (this.contacts[i]) this.contacts[i].pivot.rotation.y = a;
      }
      this.sweep.rotation.z -= 0.3 * dt;
      this.stepFx(dt);

      // Selection pulse. Only the picked module's meshes are visible with these
      // materials, so this animates the strip and its contact in lockstep.
      if (this.selected != null) {
        const p = 0.5 + 0.5 * Math.sin(now * 0.005);
        for (const mat of this.matReg.values()) {
          if (mat.userData.kind === 'hot') mat.opacity = 0.55 + 0.35 * p;
          else if (mat.userData.kind === 'mark') mat.emissiveIntensity = 1.7 + 1.7 * p;
        }
      }

      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.cancelFx();
    for (let i = 0; i < this.spinners.length; i++) this.unmount(i);
    this.spinners.length = 0;
    this.contacts.length = 0;
    for (const mat of this.matReg.values()) mat.dispose();
    this.matReg.clear();
    for (const mat of this.labelCache.values()) {
      mat.map?.dispose();
      mat.dispose();
    }
    this.labelCache.clear();
    this.disposeGroup(this.model);
  }
}
