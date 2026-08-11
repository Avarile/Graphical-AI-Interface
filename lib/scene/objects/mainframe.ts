// The mainframe itself: the central column and the shell the strips turn
// inside of.
//
// Static furniture — it never changes once built, which is why it is the one
// object here with no update() and no per-module anything. Its two materials
// are private to it, so it disposes them itself.

import * as THREE from 'three';
import { disposeTree } from '../three-utils';

export interface MainframeConfig {
  /** Central column. */
  spineRadius?: number;
  spineHeight?: number;
  /** Containment shell. The cap rings share its radius. */
  shellRadius?: number;
  shellHeight?: number;
  /** Cap rings, at +y and -y. */
  capY?: number;
  capThickness?: number;
}

const DEFAULTS: Required<MainframeConfig> = {
  spineRadius: 0.055,
  spineHeight: 3.1,
  shellRadius: 1.24,
  shellHeight: 3.0,
  capY: 1.55,
  capThickness: 0.01,
};

export class Mainframe {
  readonly group = new THREE.Group();

  private readonly mats: THREE.Material[] = [];

  constructor(config: MainframeConfig = {}) {
    const cfg = { ...DEFAULTS, ...config };
    this.group.name = 'mainframe';

    // Near-black and barely there: this object reads as emissive light bands,
    // and the shell is only meant to give them something to be inside of.
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
    this.mats.push(coreMat, spineMat);

    const spine = new THREE.Mesh(
      new THREE.CylinderGeometry(cfg.spineRadius, cfg.spineRadius, cfg.spineHeight, 20),
      spineMat,
    );
    spine.name = 'mainframe-spine';
    this.group.add(spine);

    const shell = new THREE.Mesh(
      new THREE.CylinderGeometry(cfg.shellRadius, cfg.shellRadius, cfg.shellHeight, 64, 1, true),
      coreMat,
    );
    shell.name = 'containment-shell';
    this.group.add(shell);

    for (const [y, name] of [
      [cfg.capY, 'cap-top'],
      [-cfg.capY, 'cap-base'],
    ] as const) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(cfg.shellRadius, cfg.capThickness, 10, 96),
        spineMat,
      );
      ring.name = name;
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      this.group.add(ring);
    }
  }

  dispose(): void {
    disposeTree(this.group);
    for (const m of this.mats) m.dispose();
    this.mats.length = 0;
  }
}
