import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SKYNET COUNTER',
  description: 'Weighted AI-risk signal from the last 30 days of tech news.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400&family=JetBrains+Mono:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="crt min-h-screen">
        {children}
        <footer className="site-credit">
          <span>Site par</span>
          <a href="https://arianeguay.ca" target="_blank" rel="noopener">
            Ariane Guay<span className="dot">.</span>
          </a>
        </footer>
      </body>
    </html>
  );
}
