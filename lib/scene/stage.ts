// Stage — 3D object viewer + exporter shell (three.js).
//
// The stage owns the whole scene: WebGL renderer, neutral studio lighting with
// a soft ground shadow, orbit controls (drag to orbit, wheel to zoom,
// right-drag to pan), a camera auto-framed to the object's bounds, resize
// handling, and an export call — stage.export('obj') for OBJ + MTL,
// stage.export('glb') for binary glTF — that downloads the current object.
// There is no on-screen toolbar: exporting is an occasional deliberate act, so
// it is an API call rather than furniture parked over the scene.
//
// Ported from the <three-d-stage> custom element. Three things changed and all
// three are consequences of the move to a bundler:
//
//   * No custom element and no shadow DOM. It takes a container element and
//     owns the canvas inside it, which is what a React ref hands you anyway.
//     Shadow DOM was buying style isolation that a CSS module already gives.
//   * three.js is imported, not fetched through an import map. The pinned
//     versions and their integrity hashes moved into package.json, where the
//     lockfile does the same job.
//   * Construction is synchronous. The old boot was async only because it had
//     to await two dynamic imports; a failure there was a misconfigured import
//     map, which is why the element carried an on-screen "three.js failed to
//     load" panel. A bundled import cannot fail at runtime, so that panel is
//     gone — the equivalent failure is now a build error.
//
// The exporters are still loaded on demand: they are large, and most sessions
// never export.
//
// Model in real-world meters, centered on the origin, y-up — exports inherit
// the scene's units and orientation.
//
// Default setup: neutral studio lighting (hemisphere + key + fill), a soft
// ground shadow, and NO environment map — so high metalness has nothing to
// reflect and renders near-black. Cap metalness around 0.3–0.4 and carry a
// metal look with a brighter base color.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface StageOptions {
  /** Export file basename. */
  name?: string;
  /** CSS color behind the scene. */
  background?: string;
  /** A slow turntable until the user interacts. */
  autorotate?: boolean;
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Tell the host an export attempt settled — telemetry only. Guarded so it can
 *  never break the download path. */
function notifyExport(format: string, ok: boolean): void {
  try {
    window.parent.postMessage(
      { type: 'omelette:notify-3d-export', format, ok: ok === true },
      '*',
    );
  } catch {
    /* nothing here is worth failing an export over */
  }
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly ground: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>;

  private readonly container: HTMLElement;
  private readonly note: HTMLDivElement;
  private readonly key: THREE.DirectionalLight;
  private readonly resizeObserver: ResizeObserver;
  private readonly loop: () => void;
  private readonly basename: string;
  private object: THREE.Object3D | null = null;
  private disposed = false;

  constructor(container: HTMLElement, opts: StageOptions = {}) {
    this.container = container;
    this.basename = (opts.name || 'model').replace(/[^\w.-]+/g, '_');

    // preserveDrawingBuffer keeps the last frame readable after compositing
    // (toDataURL / drawImage) — it's what lets the screenshot tools capture
    // the scene instead of a blank canvas.
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.outline = 'none';
    this.renderer = renderer;
    container.appendChild(renderer.domElement);

    // The controls hint. It lived in the element's shadow root before; with no
    // shadow root it is an ordinary child, and its styling moved to the
    // stylesheet alongside everything else.
    const note = document.createElement('div');
    note.className = 'stage-note';
    note.textContent = 'Drag to orbit · scroll to zoom · right-drag to pan';
    container.appendChild(note);
    this.note = note;

    const scene = new THREE.Scene();
    this.scene = scene;
    if (opts.background) scene.background = new THREE.Color(opts.background);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500);
    camera.position.set(3, 2.2, 4);
    this.camera = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    this.controls = controls;

    // Neutral studio: soft sky/ground wash, a shadow-casting key light, and a
    // dim fill from behind so silhouettes never go black.
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d2c4, 1.0));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(4, 7, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0002;
    this.key = key;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xfff4e6, 0.5);
    fill.position.set(-5, 3, -4);
    scene.add(fill);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.ShadowMaterial({ opacity: 0.18 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.ground = ground;
    scene.add(ground);

    controls.autoRotate = !!opts.autorotate;
    controls.autoRotateSpeed = 1.2;
    controls.addEventListener('start', () => {
      controls.autoRotate = false;
    });

    this.fit();
    this.resizeObserver = new ResizeObserver(() => this.fit());
    this.resizeObserver.observe(container);

    this.loop = () => {
      controls.update();
      renderer.render(scene, camera);
    };
    renderer.setAnimationLoop(this.loop);
  }

  private fit = (): void => {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  /** Show (and own) the object. Replaces any previous object, enables shadows
   *  on every mesh, rests it on the ground plane, and frames the camera to its
   *  bounds. */
  setObject(object: THREE.Object3D): void {
    if (this.object) this.scene.remove(this.object);
    this.object = object;
    object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    const box = new THREE.Box3().setFromObject(object);
    if (!box.isEmpty()) {
      // Rest the object on the ground without moving its origin.
      this.ground.position.y = box.min.y;
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const dist = (sphere.radius / Math.tan((this.camera.fov * Math.PI) / 360)) * 1.35;
      const dir = new THREE.Vector3(1, 0.55, 1.25).normalize();
      this.camera.position.copy(sphere.center).add(dir.multiplyScalar(dist));
      this.camera.near = Math.max(dist / 100, 0.01);
      this.camera.far = dist * 100;
      this.camera.updateProjectionMatrix();
      this.controls.target.copy(sphere.center);
      this.controls.update();
      const span = sphere.radius * 3;
      const shadowCam = this.key.shadow.camera;
      shadowCam.left = -span;
      shadowCam.right = span;
      shadowCam.top = span;
      shadowCam.bottom = -span;
      shadowCam.updateProjectionMatrix();
    }
    this.scene.add(object);
  }

  /** Export the current object as 'obj' (OBJ + MTL) or 'glb'. Resolves to
   *  false when there is no object yet; downloads the files otherwise. */
  async export(format: 'obj' | 'glb'): Promise<boolean> {
    if (!this.object) return false;
    await this.runExport(format === 'obj' ? 'obj' : 'glb');
    return true;
  }

  /** Every mesh and material needs a unique name for o/usemtl lines — fill in
   *  stable fallbacks, and return the unique material list. */
  private nameParts(): THREE.Material[] {
    const mats: THREE.Material[] = [];
    const seen = new Set<string>();
    let meshI = 0;
    let matI = 0;
    this.object?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (!mesh.name) mesh.name = 'part_' + meshI;
      meshI += 1;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of list) {
        if (!m || mats.includes(m)) continue;
        if (!m.name) {
          m.name = 'mat_' + matI;
          matI += 1;
        }
        while (seen.has(m.name)) {
          m.name = m.name + '_' + matI;
          matI += 1;
        }
        seen.add(m.name);
        mats.push(m);
      }
    });
    return mats;
  }

  /** One export attempt, reported however it settles. Rethrows so a failure
   *  stays visible on the console exactly as before. */
  private async runExport(format: 'obj' | 'glb'): Promise<void> {
    if (!this.object) return;
    try {
      await (format === 'obj' ? this.exportObj() : this.exportGlb());
      notifyExport(format, true);
    } catch (err) {
      notifyExport(format, false);
      throw err;
    }
  }

  private async exportObj(): Promise<void> {
    if (!this.object) return;
    const { OBJExporter } = await import('three/examples/jsm/exporters/OBJExporter.js');
    const mats = this.nameParts();
    const base = this.basename;
    const obj = 'mtllib ' + base + '.mtl\n' + new OBJExporter().parse(this.object);
    let mtl = '# Exported by Stage\n';
    for (const m of mats) {
      const mm = m as THREE.MeshStandardMaterial;
      const c = mm.color || { r: 0.8, g: 0.8, b: 0.8 };
      const rough = typeof mm.roughness === 'number' ? mm.roughness : 0.5;
      const opacity = typeof mm.opacity === 'number' ? mm.opacity : 1;
      mtl += 'newmtl ' + m.name + '\n';
      mtl += 'Kd ' + c.r.toFixed(4) + ' ' + c.g.toFixed(4) + ' ' + c.b.toFixed(4) + '\n';
      mtl += 'Ks 0.2000 0.2000 0.2000\n';
      mtl += 'Ns ' + Math.round((1 - rough) * 200) + '\n';
      mtl += 'd ' + opacity.toFixed(4) + '\n\n';
    }
    download(new Blob([obj], { type: 'text/plain' }), base + '.obj');
    download(new Blob([mtl], { type: 'text/plain' }), base + '.mtl');
  }

  private async exportGlb(): Promise<void> {
    if (!this.object) return;
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
    this.nameParts();
    const base = this.basename;
    const buf = await new GLTFExporter().parseAsync(this.object, { binary: true });
    download(new Blob([buf as ArrayBuffer], { type: 'model/gltf-binary' }), base + '.glb');
  }

  /** Stop rendering and give the GPU its memory back. React strict mode mounts
   *  effects twice in development, so this has to be safe to call on a stage
   *  that is already gone. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.note.remove();
  }
}
