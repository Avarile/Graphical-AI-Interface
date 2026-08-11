// One module's strip: the light band that turns inside the mainframe, plus
// everything drawn flush with it.
//
// Built from a plain spec rather than from a Module — nothing here knows the
// module schema, the store, or the status table. The scene resolves all of
// that and hands over numbers, which is what lets a strip be built, sized and
// reasoned about on its own.
//
// Mesh names come from the id, not the label: they end up as the o / usemtl
// entries in an exported OBJ, so they have to survive a rename.

import * as THREE from 'three';
import type { ModuleMaterials } from '../materials';
import type { LabelFactory } from '../labels';
import { disposeTree } from '../three-utils';

/** How far the soft layers reach past the band they wrap: `h` as a multiple of
 *  the band's own height, `pad` in radians past each end of its arc, `r` in
 *  world units outside its radius.
 *
 *  Both are flush with the band — same height, same arc — so they add light to
 *  it rather than bleeding around it. `r` still differs between them and stays
 *  non-zero: the two layers and the band would otherwise be coplanar, and the
 *  band writes depth, so they need separating or they z-fight. */
const SOFT = {
  glow: { h: 1.0, pad: 0, r: 0.014 },
  halo: { h: 1.0, pad: 0, r: 0.03 },
} as const;

/** Preferred world height of a label; thin bands shrink it to fit. */
const LABEL_H = 0.058;

/** How much of a band's height the text may occupy. Most bands are shorter
 *  than LABEL_H allows for, so this — not LABEL_H — is what actually sets the
 *  size on the majority of modules. */
const LABEL_FILL = 0.95;

/** Inset from the strip's leading edge, as a fraction of its arc. The label is
 *  set flush left rather than centred, so names line up with each other as the
 *  stack turns instead of drifting with each strip's own arc length. */
const LABEL_LEAD = 0.05;

/** Turns a module's `speed` into radians per second. */
const SPIN = Math.PI * 2 * 0.15;

export interface StripSpec {
  /** Names every mesh in the strip. Identity, not display text. */
  id: string;
  radius: number;
  /** Height in the stack. */
  y: number;
  /** Arc length, in degrees. */
  arcDeg: number;
  /** Band height. */
  band: number;
  /** Where in its rotation the strip starts. */
  phase: number;
  visible: boolean;
  glow: boolean;
  halo: boolean;
  trail: boolean;
  /** Text printed on the band; null draws no label at all. */
  label: string | null;
  labelScale: number;
  /** Revolutions per second, before SPIN scales it. */
  speed: number;
}

export class Strip {
  readonly group = new THREE.Group();

  private readonly pick: THREE.Mesh;
  private readonly rate: number;

  constructor(spec: StripSpec, mat: ModuleMaterials, labels: LabelFactory) {
    const { id, radius, band: h } = spec;
    this.rate = spec.speed * SPIN;

    this.group.name = id;
    this.group.position.y = spec.y;
    // Resume where this module was, rather than rolling a new random phase —
    // that reset was what made the whole stack jump on every edit.
    this.group.rotation.y = spec.phase;
    this.group.visible = spec.visible;

    const arc = THREE.MathUtils.degToRad(spec.arcDeg);
    const seg = Math.max(24, Math.round(spec.arcDeg / 3));

    const bandMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, h, seg, 1, true, 0, arc),
      mat.band,
    );
    bandMesh.name = id + '-band';
    this.group.add(bandMesh);

    // The three soft layers are optional per module: a dense stack reads better
    // with some of them off, and they are the cheapest thing to drop.
    if (spec.glow) {
      const s = SOFT.glow;
      const glow = new THREE.Mesh(
        new THREE.CylinderGeometry(radius + s.r, radius + s.r, h * s.h, seg, 1, true, -s.pad, arc + s.pad * 2),
        mat.glow,
      );
      glow.name = id + '-glow';
      this.group.add(glow);
    }

    if (spec.halo) {
      const s = SOFT.halo;
      const halo = new THREE.Mesh(
        new THREE.CylinderGeometry(radius + s.r, radius + s.r, h * s.h, seg, 1, true, -s.pad, arc + s.pad * 2),
        mat.halo,
      );
      halo.name = id + '-halo';
      this.group.add(halo);
    }

    // Trailing light streak: a thinner, dimmer continuation of the arc.
    if (spec.trail) {
      const tail = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, h * 0.34, seg, 1, true, arc, Math.min(arc * 0.8, 2.4)),
        mat.glow,
      );
      tail.name = id + '-trail';
      this.group.add(tail);
    }

    // Text printed on the band: a cylinder slice on the same axis, a hair
    // outside the band's own radius. The cylinder's UVs run along the arc, so
    // the texture wraps with the curve instead of hovering flat in front of it.
    if (spec.label != null) {
      const labMat = labels.get(spec.label);
      // Clear of the band by enough that depth testing never nibbles the text.
      const lr = radius + 0.014;
      let lh = Math.min(LABEL_H, h * LABEL_FILL) * spec.labelScale;
      let lTheta = (lh * (labMat.userData.aspect as number)) / lr;
      // Set flush to the arc's leading edge, one lead in. The tail keeps a
      // matching gap, so a name that fills its strip still stops short of both
      // edges rather than running off one of them.
      const lead = arc * LABEL_LEAD;
      // Long name on a short arc: scale the label down rather than squash it.
      const fit = arc * (1 - 2 * LABEL_LEAD);
      if (lTheta > fit) {
        lh *= fit / lTheta;
        lTheta = fit;
      }

      const label = new THREE.Mesh(
        new THREE.CylinderGeometry(lr, lr, lh, Math.max(12, Math.round(lTheta * 48)), 1, true, lead, lTheta),
        labMat,
      );
      label.name = id + '-label';
      label.userData.noShadow = true;
      label.renderOrder = 10;
      this.group.add(label);
    }

    // Selection overlay: a brighter twin of the band, hidden until picked.
    this.pick = new THREE.Mesh(
      new THREE.CylinderGeometry(radius + 0.006, radius + 0.006, h * 1.45, seg, 1, true, -0.015, arc + 0.03),
      mat.hot,
    );
    this.pick.name = id + '-select';
    this.pick.visible = false;
    this.group.add(this.pick);
  }

  /** Turn by one frame's worth, and report where that leaves it. The scene
   *  parks the returned angle in its runtime state, so a remount picks up
   *  exactly here rather than snapping back to the saved phase. */
  advance(dt: number): number {
    return (this.group.rotation.y += this.rate * dt);
  }

  setPicked(on: boolean): void {
    this.pick.visible = on;
  }

  /** Geometry only — the materials are the scene's, shared with every other
   *  module that looks like this one. */
  dispose(): void {
    disposeTree(this.group);
  }
}
