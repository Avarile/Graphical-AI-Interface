import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Mainframe',
  description: 'A rotating mainframe core — system modules as emissive light bands.',
};

// The design system's own stylesheet is linked rather than re-declared through
// next/font. It already carries the @font-face rules for the eight Futura PT
// weights, and the scene depends on one of them by name — core-scene.ts asks
// document.fonts for '700 128px "Futura PT"' before it rasterises any label.
// Restating those faces here would give that name two definitions to disagree
// about, so the vendored file stays the only one.
const DS = '/_ds/aaron-sansoni-design-system-f71563f5-c431-4f2a-b4ca-285616f74737';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href={`${DS}/tokens/fonts.css`} />
      </head>
      <body>{children}</body>
    </html>
  );
}
