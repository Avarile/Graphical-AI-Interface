// The statuses a module may carry.
//
// This used to live inside the page script, which meant serve.ps1 had no way to
// check a status server-side and deliberately did not try. It sits in its own
// file now so the API route and the scene validate against the same four keys.
//
// `color` is what three.js wants (a hex number), `hex` what CSS wants, and
// `gain` scales the band's emissive intensity — running is the common case and
// reads too hot at full strength when a dozen of them are on screen at once.

export interface StatusDef {
  color: number;
  hex: string;
  name: string;
  gain?: number;
}

export const STATUS: Record<string, StatusDef> = {
  // Sampled off the reference frame rather than taken from the design system:
  // the strip cores there sit at hsl(44, 93%, 61%), and no token on the brand's
  // gold ramp is that saturated — --gold-500 has the hue but only 68% sat, so
  // it reads dusty against black where the reference reads lit. Deliberate
  // divergence; the ramp still owns every other gold surface in the scene.
  running: { color: 0xf8c845, hex: '#F8C845', name: 'running', gain: 0.62 },
  fault: { color: 0xe0342b, hex: '#E0342B', name: 'fault' },
  init: { color: 0x2fcb6a, hex: '#2FCB6A', name: 'initializing' },
  loading: { color: 0x3e8cf0, hex: '#3E8CF0', name: 'loading' },
};

export const STATUS_KEYS = Object.keys(STATUS);
