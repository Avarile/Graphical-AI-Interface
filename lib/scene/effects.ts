// The lifecycle animations: a module appearing, being edited, or going away.
//
// Effects run on private material clones. The shared status materials back a
// dozen modules each, so fading or recolouring one in place would drag the rest
// with it — same reason the selection highlight keeps its own materials.
//
// This knows nothing about modules: it takes the roots of whatever subtrees an
// effect should play over, saves their materials, animates the clones, and puts
// the originals back when it is done.

import * as THREE from 'three';

const FLASH = new THREE.Color(0xffffff);

const blinkOn = (t: number, hz: number) => Math.floor(t * hz * 2) % 2 === 0;
const smooth = (p: number) => p * p * (3 - 2 * p);

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

export class EffectRunner {
  private readonly fx: Effect[] = [];

  /** Initializing: blink, then ease up out of nothing. */
  appear(roots: THREE.Object3D[], dur: number): void {
    this.start({ kind: 'appear', roots, dur });
  }

  /** Blink out and fade away. The caller's `done` is what actually drops the
   *  module — unmounting first would destroy the very objects being animated. */
  remove(roots: THREE.Object3D[], dur: number, done: () => void): void {
    this.start({ kind: 'remove', roots, dur, done });
  }

  /** Flash to white, then settle into the new colour. */
  update(roots: THREE.Object3D[], dur: number, from: THREE.Color, to: THREE.Color): void {
    this.start({ kind: 'update', roots, dur, from, to });
  }

  private start(e: Omit<Effect, 't' | 'saved'>): void {
    const full: Effect = { ...e, t: 0, saved: this.isolate(e.roots) };
    if (full.kind === 'appear') this.fade(full.saved, 0);
    this.fx.push(full);
  }

  /** Swap in a private clone of every material in these subtrees, remembering
   *  what was there and what its opacity was. */
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

  private restore(saved: SavedMat[]): void {
    for (const s of saved) {
      (s.mesh.material as THREE.Material).dispose();
      s.mesh.material = s.shared;
    }
  }

  /** Scale every mesh's own opacity, so a glow at 0.16 stays a glow. */
  private fade(saved: SavedMat[], k: number): void {
    for (const s of saved) (s.mesh.material as THREE.Material).opacity = s.base * k;
  }

  private tint(saved: SavedMat[], color: THREE.Color): void {
    for (const s of saved) {
      const mat = s.mesh.material as THREE.MeshStandardMaterial;
      if (mat.emissive) mat.emissive.copy(color);
    }
  }

  /** Drop every running effect without firing its completion — used by a
   *  rebuild, which is about to replace the objects the effects drive. */
  cancelAll(): void {
    while (this.fx.length) {
      const e = this.fx.pop()!;
      for (const r of e.roots) r.visible = true;
      this.restore(e.saved);
    }
  }

  /** Drop only the effects driving this object. Unmounting one module must not
   *  abort an animation running on another. */
  cancelFor(root: THREE.Object3D): void {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      if (!this.fx[i].roots.includes(root)) continue;
      const e = this.fx.splice(i, 1)[0];
      for (const r of e.roots) r.visible = true;
      this.restore(e.saved);
    }
  }

  step(dt: number): void {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const e = this.fx[i];
      e.t += dt;
      const p = Math.min(e.t / e.dur, 1);

      if (e.kind === 'remove') {
        const lead = 0.34;
        for (const r of e.roots) r.visible = e.t < lead ? blinkOn(e.t, 14) : true;
        this.fade(e.saved, e.t < lead ? 1 : 1 - (e.t - lead) / (e.dur - lead));
      } else if (e.kind === 'appear') {
        for (const r of e.roots) r.visible = e.t < 0.45 ? blinkOn(e.t, 10) : true;
        this.fade(e.saved, smooth(p));
      } else if (e.kind === 'update') {
        for (const r of e.roots) r.visible = e.t < 0.4 ? blinkOn(e.t, 12) : true;
        // Flash to white, then settle into the new status colour.
        this.tint(
          e.saved,
          p < 0.5
            ? e.from!.clone().lerp(FLASH, p * 2)
            : FLASH.clone().lerp(e.to!, (p - 0.5) * 2),
        );
      }

      if (p < 1) continue;

      // Off the list before done() runs — a completion unmounts its module, and
      // cancelFor() must not find this effect still there.
      this.fx.splice(i, 1);
      for (const r of e.roots) r.visible = true;
      this.restore(e.saved);
      if (e.done) e.done();
    }
  }
}
