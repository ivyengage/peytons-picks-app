import Link from "next/link";
export default function Home() {
  return (
    <main>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <img src="/logo.svg" alt="Peyton's Picks logo" width={160} height={60} />
        <h1 style={{ fontSize: 32, margin: 0 }}>Peyton’s Picks</h1>
      </div>
      <p style={{ marginTop: 8 }}>ATS-only pick engine. Upload CSVs or (next) screenshots → see Top-10 confidence.</p>
      <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
        <Link href="/upload" style={{ padding: '10px 14px', background: '#CC1236', color: 'white', borderRadius: 10, textDecoration: 'none' }}>Upload CSV</Link>
        <Link href="/import" style={{ padding: '10px 14px', background: '#0B2242', color: 'white', borderRadius: 10, textDecoration: 'none' }}>Import Screenshots (soon)</Link>
        <Link href="/board" style={{ padding: '10px 14px', background: '#0B2242', color: 'white', borderRadius: 10, textDecoration: 'none' }}>View Board</Link>
      </div>
    </main>
  );
}
