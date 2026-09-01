import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SKYNET COUNTER',
  description: 'Weighted AI-risk signal from the last 30 days of tech news.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="crt min-h-screen">{children}</body>
    </html>
  );
}
