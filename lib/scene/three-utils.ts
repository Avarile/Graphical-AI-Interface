// Small three.js helpers shared by every scene object.
//
// Nothing here knows about modules, materials or the scene — these are the
// three or four operations that every object in lib/scene/objects needs and
// none of them owns.

import * as THREE from 'three';

/** Lay an object flat in the XZ plane. The disc primitives — circles, rings,
 *  planes — are all authored facing +Z, so anything drawn on the scanner deck
 *  has to be turned onto its back first. */
export function flat<T extends THREE.Object3D>(o: T): T {
  o.rotation.x = -Math.PI / 2;
  return o;
}

/** Give back the geometry of every mesh in a subtree.
 *
 *  Geometry only: materials are shared — one band material backs a dozen
 *  modules — so disposing them here would take the rest of the stack with it.
 *  An object with private materials of its own disposes those itself. */
export function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.geometry.dispose();
  });
}

/** Turn shadows on across a subtree, honouring per-mesh opt-outs.
 *
 *  Labels opt out of casting: the shadow pass ignores map transparency, so a
 *  label would otherwise throw a solid rectangle onto the bands behind it. */
export function applyShadowFlags(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = !mesh.userData.noShadow;
    mesh.receiveShadow = true;
  });
}
