import './globals.css';
export const metadata = { title: 'Posture progress', description: 'Track progress from your posture vest' };
export const viewport = { width: 'device-width', initialScale: 1 };
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
