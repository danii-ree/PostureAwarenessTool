import './globals.css';
export const metadata = { title: 'Posture progress', description: 'Track progress from your posture vest' };
export const viewport = { width: 'device-width', initialScale: 1 };
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
