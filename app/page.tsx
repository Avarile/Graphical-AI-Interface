'use client';

import dynamic from 'next/dynamic';

// Loaded with ssr: false, and the whole page is a client component so that it
// can say so — the App Router refuses that option from a server component.
//
// It is not optional here. The app is a WebGL canvas: three.js, ResizeObserver,
// requestAnimationFrame and a canvas 2D context for the band labels all want a
// browser, and none of them have anything useful to say during a server render.
const MainframeApp = dynamic(() => import('@/components/MainframeApp'), {
  ssr: false,
});

export default function Page() {
  return <MainframeApp />;
}
