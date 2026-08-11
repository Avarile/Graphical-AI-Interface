// The scanner view: a flat sensor plate pinned under the mainframe, with a
// radar sweep turning across it.
//
// It is also the deck the module contacts sit on — the scene parents them into
// this group, so they inherit its height and its visibility. The contacts
// themselves know nothing about it beyond the one number they are handed
// (`SCANNER.y`, as their `deckY`), which is what keeps the two objects
// independent of each other.
//
// The plate's three materials are private to it and it disposes them itself.
// dispose() works off its own mesh list rather than traversing, so tearing the
// scanner down never touches contacts that happen to be parented to it.

import * as THREE from 'three';
import { flat } from '../three-utils';

export interface ScannerConfig {
  /** Height of the deck, relative to the mainframe's origin. */
  y?: number;
  radius?: number;
  /** Grid rings, as fractions of the radius. */
  rings?: readonly number[];
  /** Radial spokes. They span the full diameter, so n spokes draw 2n arms. */
  spokes?: number;
  /** Edge ticks, and how often one of them is a long cardinal mark. */
  ticks?: number;
  cardinalEvery?: number;
  /** Sweep needle: how wide its wedge is, in radians, and how fast it turns. */
  sweepArc?: number;
  sweepSpeed?: number;
}

const DEFAULTS: Required<ScannerConfig> = {
  y: -1.86,
  radius: 3.3,
  rings: [0.34, 0.58, 0.79],
  spokes: 4,
  ticks: 36,
  cardinalEvery: 9,
  sweepArc: 0.42,
  sweepSpeed: 0.3,
};

/** The built-in deck, for callers that need to place things on it before it
 *  exists — a contact's tether has to know how far it is reaching down. */
export const SCANNER: Readonly<Required<ScannerConfig>> = DEFAULTS;

export class Scanner {
  readonly group = new THREE.Group();

  private readonly sweep: THREE.Mesh;
  private readonly sweepSpeed: number;
  private readonly geoms: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];

  constructor(config: ScannerConfig = {}) {
    const cfg = { ...DEFAULTS, ...config };
    const R = cfg.radius;
    this.sweepSpeed = cfg.sweepSpeed;

    this.group.name = 'scanner-view';
    this.group.position.y = cfg.y;

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
    this.mats.push(plateMat, gridMat, rimMat);

    this.add('scanner-plate', new THREE.CircleGeometry(R, 128), plateMat);
    this.add('scanner-rim', new THREE.RingGeometry(R - 0.012, R, 160), rimMat);

    cfg.rings.forEach((f, i) => {
      const r = R * f;
      this.add('scanner-ring-' + (i + 1), new THREE.RingGeometry(r - 0.006, r + 0.006, 128), gridMat);
    });

    for (let i = 0; i < cfg.spokes; i++) {
      const spoke = this.add(
        'scanner-axis-' + (i + 1),
        new THREE.PlaneGeometry(0.007, R * 2),
        gridMat,
      );
      spoke.rotation.z = (i * Math.PI) / cfg.spokes;
    }

    for (let i = 0; i < cfg.ticks; i++) {
      const cardinal = i % cfg.cardinalEvery === 0;
      const len = cardinal ? 0.2 : 0.1;
      const tick = this.add(
        'scanner-tick-' + (i + 1),
        new THREE.PlaneGeometry(cardinal ? 0.016 : 0.008, len),
        rimMat,
      );
      const a = (i / cfg.ticks) * Math.PI * 2;
      tick.position.set(Math.sin(a) * (R - len / 2), 0, Math.cos(a) * (R - len / 2));
      tick.rotation.z = -a;
    }

    // Sweep needle, rotating like a radar arm. Its material is a clone of the
    // plate's rather than a fifth entry above: it is the same surface, lit
    // brighter, and cloning keeps the two in step if the plate is retuned.
    const sweepMat = plateMat.clone();
    sweepMat.name = 'scanner-sweep';
    sweepMat.emissive = new THREE.Color(0x7fbef0);
    sweepMat.emissiveIntensity = 1.0;
    sweepMat.opacity = 0.1;
    this.mats.push(sweepMat);
    this.sweep = this.add(
      'scanner-sweep',
      new THREE.CircleGeometry(R * 0.995, 48, 0, cfg.sweepArc),
      sweepMat,
    );
  }

  /** Build one flat piece of the deck, name it, and keep it for disposal. */
  private add(name: string, geom: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
    const mesh = flat(new THREE.Mesh(geom, mat));
    mesh.name = name;
    this.geoms.push(geom);
    this.group.add(mesh);
    return mesh;
  }

  update(dt: number): void {
    this.sweep.rotation.z -= this.sweepSpeed * dt;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  dispose(): void {
    for (const g of this.geoms) g.dispose();
    for (const m of this.mats) m.dispose();
    this.geoms.length = 0;
    this.mats.length = 0;
  }
}
