// The names printed on the bands.
//
// Drawn to a canvas, then handed back as a material for the strip to map onto a
// slice of cylinder. A canvas texture needs no font loader and no extra
// dependency; the cost is that the type has to be laid out by hand, which is
// what most of the code below is doing.
//
// The preload gate and the rasteriser live in the same file on purpose: they
// have to name the same weight and the same size, or the first build lands on
// the fallback face while the gate reports success.

import * as THREE from 'three';

/* The band label's type: all-caps and widely tracked, so a name reads as
 * stamped onto the strip rather than set on it. Only weights the design system
 * actually ships a file for are usable — 300/400/500/600/700/900 — since asking
 * for anything else gets a synthetic bolding of the nearest one. */
const LABEL_WEIGHT = 400;

/** Canvas rasterisation size. Oversampled and heavy: at the on-screen size
 *  the glyphs land on few pixels, and thin strokes plus mipmap minification
 *  are what read as "dim". */
const LABEL_PX = 128;

const LABEL_FACE = '"Futura PT", system-ui, sans-serif';
const LABEL_FONT = LABEL_WEIGHT + ' ' + LABEL_PX + 'px ' + LABEL_FACE;

/** Tracking, as a fraction of the font size. */
const LABEL_TRACK = 0.18;

/** Ink the name is drawn in: a dark gold off the brand ramp's warm end, deep
 *  enough to hold against the band's own emission. */
const LABEL_INK = '#674E1E';

/**
 * Pull in the brand face before the first build, so labels rasterise in Futura
 * PT rather than whatever the fallback happens to be. The weight must match the
 * one LabelFactory draws with — each weight is its own font file.
 */
export async function preloadLabelFont(): Promise<void> {
  try {
    await document.fonts.load(LABEL_WEIGHT + ' ' + LABEL_PX + 'px "Futura PT"');
  } catch {
    /* the fallback face still renders; it is only less on-brand */
  }
}

/** Band text is set in caps. Done at rasterisation time only — the stored
 *  name keeps its own casing, so the panel and the module list still show what
 *  the user actually typed. */
function bandCaps(name: string): string {
  return name.toLocaleUpperCase();
}

export class LabelFactory {
  private readonly cache = new Map<string, THREE.MeshBasicMaterial>();
  private readonly anisotropy: number;

  /** Takes the renderer's max anisotropy rather than the renderer: it is the
   *  only thing about the GPU this needs to know. */
  constructor(anisotropy: number) {
    this.anisotropy = anisotropy;
  }

  /** A material carrying `text`, made once per distinct string. The aspect
   *  ratio of the canvas is left on `userData.aspect` — the strip sizes its
   *  label cylinder from it. */
  get(text: string): THREE.MeshBasicMaterial {
    const found = this.cache.get(text);
    if (found) return found;

    const FS = LABEL_PX;
    const PAD = 24;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    // Set in caps and letter-spaced by hand. Tracking is applied between the
    // glyphs below rather than by the shaper, so the run has to be measured the
    // same way — one measureText over the whole string would come up short by
    // every gap. Splitting per code point means kerning pairs are lost, which
    // at this tracking is the intent anyway.
    const chars = [...bandCaps(text)];
    const track = FS * LABEL_TRACK;

    ctx.font = LABEL_FONT;
    const adv = chars.map((ch) => ctx.measureText(ch).width);
    const run = adv.reduce((a, b) => a + b, 0) + track * Math.max(0, chars.length - 1);

    canvas.width = Math.ceil(run) + PAD * 2;
    canvas.height = FS + PAD * 2;
    // Resizing the canvas resets the context, so restate the draw settings.
    ctx.font = LABEL_FONT;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = LABEL_INK;

    // Drawn twice so the anti-aliased edges reach full opacity rather than
    // washing out to a half-covered grey.
    for (let pass = 0; pass < 2; pass++) {
      let x = PAD;
      for (let i = 0; i < chars.length; i++) {
        ctx.fillText(chars[i], x, canvas.height / 2);
        x += adv[i] + track;
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.anisotropy;

    // Unlit, so the name holds its own flat tone against the band's emission
    // rather than picking up scene lighting on top of it.
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    mat.name = 'label-' + text;
    mat.userData.aspect = canvas.width / canvas.height;
    this.cache.set(text, mat);
    return mat;
  }

  dispose(): void {
    for (const mat of this.cache.values()) {
      mat.map?.dispose();
      mat.dispose();
    }
    this.cache.clear();
  }
}
