export const metadata = { title: process.env.APP_NAME || "Peyton's Picks" };
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial', background: '#F7F8FA', color: '#0B2242' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: 24 }}>{children}</div>
      </body>
    </html>
  );
}
