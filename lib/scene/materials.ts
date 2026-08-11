// The scene's module materials: how they look, and who shares which.
//
// Shared by appearance rather than by module. Two modules with the same status
// and no overrides get one material between them, so the common case still
// costs one of each kind; a per-module colour or opacity gets its own entry,
// keyed by the values that produced it.
//
// Everything is registered in one map because the selection dimming pass has to
// reach every always-on material, and with overrides in play there is no longer
// a fixed set of four to reach for. That is also why there is exactly one
// registry per scene: an object handed its own copy would be invisible to the
// pass, and would light up while the rest of the stack dimmed around it.

import * as THREE from 'three';

export type MatKind = 'band' | 'glow' | 'halo' | 'hot' | 'mark';

/** The materials one module renders with. */
export interface ModuleMaterials {
  band: THREE.MeshStandardMaterial;
  glow: THREE.MeshStandardMaterial;
  halo: THREE.MeshStandardMaterial;
  hot: THREE.MeshStandardMaterial;
  mark: THREE.MeshStandardMaterial;
}

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

export class MaterialRegistry {
  private readonly reg = new Map<string, THREE.MeshStandardMaterial>();

  /** One material of one kind, made once and shared from then on. */
  get(
    kind: MatKind,
    colorHex: number,
    opacity: number | null,
    gain: number,
  ): THREE.MeshStandardMaterial {
    const key = kind + '|' + colorHex + '|' + (opacity == null ? 'auto' : opacity) + '|' + gain;
    const found = this.reg.get(key);
    if (found) return found;
    const mat = new THREE.MeshStandardMaterial(MAT_KINDS[kind](colorHex, opacity, gain));
    mat.name = kind + '-' + colorHex.toString(16).padStart(6, '0');
    // The dimming pass scales from this, so it has to be remembered before
    // anything touches emissiveIntensity.
    mat.userData.kind = kind;
    mat.userData.baseEmissive = mat.emissiveIntensity;
    mat.userData.baseOpacity = mat.transparent ? mat.opacity : null;
    mat.userData.dimmable = DIMMABLE.has(kind);
    this.reg.set(key, mat);
    return mat;
  }

  /** Every material one module needs, resolved once per mount. Only the band
   *  carries the per-status gain, so the others key on 1 and stay shared. */
  forModule(colorHex: number, opacity: number | null, gain: number): ModuleMaterials {
    return {
      band: this.get('band', colorHex, opacity, gain),
      glow: this.get('glow', colorHex, opacity, 1),
      halo: this.get('halo', colorHex, opacity, 1),
      hot: this.get('hot', colorHex, null, 1),
      mark: this.get('mark', colorHex, null, 1),
    };
  }

  /** Dim the always-on materials while something is picked, so the selected
   *  strip and its contact carry the eye. Driven off each material's own
   *  recorded base rather than recomputed constants, since a per-module colour
   *  override means there is no fixed set of materials to enumerate. */
  setDimmed(on: boolean): void {
    const k = on ? DIM : 1;
    for (const mat of this.reg.values()) {
      if (!mat.userData.dimmable) continue;
      mat.emissiveIntensity = (mat.userData.baseEmissive as number) * k;
      if (mat.userData.baseOpacity != null) {
        mat.opacity = (mat.userData.baseOpacity as number) * k;
      }
    }
  }

  /** The selection pulse. Only the picked module's meshes are visible with
   *  these materials, so this animates the strip and its contact in lockstep. */
  pulse(now: number): void {
    const p = 0.5 + 0.5 * Math.sin(now * 0.005);
    for (const mat of this.reg.values()) {
      if (mat.userData.kind === 'hot') mat.opacity = 0.55 + 0.35 * p;
      else if (mat.userData.kind === 'mark') mat.emissiveIntensity = 1.7 + 1.7 * p;
    }
  }

  dispose(): void {
    for (const mat of this.reg.values()) mat.dispose();
    this.reg.clear();
  }
}
