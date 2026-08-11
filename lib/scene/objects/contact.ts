// One module's contact: the blip it shows on the scanner deck, and the tether
// tying that blip back up to its strip.
//
// The scene parents this into the scanner group, so it is authored in the
// deck's own space — everything sits at y = 0 and reaches upward. How far it
// has to reach is `deckY`, handed over as a number: the contact never imports
// the scanner, so the two can be positioned, replaced or rebuilt separately.
//
// Mesh names come from the id, not the label: they end up as the o / usemtl
// entries in an exported OBJ, so they have to survive a rename.

import * as THREE from 'three';
import type { ModuleMaterials } from '../materials';
import { disposeTree, flat } from '../three-utils';

export interface ContactSpec {
  /** Names every mesh in the contact. Identity, not display text. */
  id: string;
  /** The strip's radius — contacts sit further out for wider modules. */
  radius: number;
  /** The strip's height, which is how far the tether has to reach. */
  y: number;
  /** Which ring of the deck this contact stands on. */
  lane: number;
  /** The strip's starting rotation — the two turn together. */
  phase: number;
  visible: boolean;
  /** Height of the deck this is parented to, in the mainframe's space. */
  deckY: number;
}

export class Contact {
  readonly group = new THREE.Group();

  private readonly mark = new THREE.Group();

  constructor(spec: ContactSpec, mat: ModuleMaterials) {
    const { id, radius, y, deckY } = spec;
    const reach = y - deckY;

    this.group.name = id + '-contact';
    this.group.rotation.y = spec.phase;
    this.group.visible = spec.visible;

    // Contacts sit further out for wider modules, echoing the strip's own
    // radius. The lane is passed in from the scene's runtime state, not derived
    // from a list position, so deleting one module never shifts everyone else's
    // contact outward or inward.
    const d = 0.42 + (radius - 0.62) * 1.55 + spec.lane * 0.3;

    const blip = new THREE.Mesh(new THREE.OctahedronGeometry(0.05), mat.band);
    blip.name = id + '-blip';
    blip.position.set(d, 0.012, 0);
    this.group.add(blip);

    // Vertical tether from the strip down to its contact.
    const tether = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0035, 0.0035, reach, 6),
      mat.glow,
    );
    tether.name = id + '-tether';
    tether.position.set(d, reach / 2, 0);
    this.group.add(tether);

    // Selection marker: a ring drawn on the plate around the dot, a brighter
    // twin of the dot itself, and a beam up the tether so the pairing between
    // contact and strip reads as one object. Hidden until the module is picked.
    this.mark.name = id + '-select';
    this.mark.visible = false;

    const ring = flat(new THREE.Mesh(new THREE.RingGeometry(0.082, 0.104, 44), mat.mark));
    ring.name = id + '-select-ring';
    ring.position.set(d, 0.014, 0);
    this.mark.add(ring);

    const hotBlip = new THREE.Mesh(new THREE.OctahedronGeometry(0.062), mat.hot);
    hotBlip.name = id + '-select-blip';
    hotBlip.position.set(d, 0.012, 0);
    this.mark.add(hotBlip);

    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, reach, 8), mat.mark);
    beam.name = id + '-select-beam';
    beam.position.set(d, reach / 2, 0);
    this.mark.add(beam);

    this.group.add(this.mark);
  }

  /** Track the strip's rotation, so blip and band stay on the same bearing. */
  setAngle(a: number): void {
    this.group.rotation.y = a;
  }

  setPicked(on: boolean): void {
    this.mark.visible = on;
  }

  /** Geometry only — the materials are the scene's, shared with the strip this
   *  contact belongs to. */
  dispose(): void {
    disposeTree(this.group);
  }
}
