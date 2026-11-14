import type { Metadata, Viewport } from 'next';
import './globals.css';
import './apple.css';

export const metadata: Metadata = {
  title: 'Tide — know what your decision rests on',
  description: 'A living decision board: sources to stance-tagged facts to answers, weighted by authority, agreement and time, rechecking only the affected branch.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
