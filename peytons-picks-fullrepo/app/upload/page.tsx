'use client';
import { useState } from 'react';
export default function UploadPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [status, setStatus] = useState<string>('');
  function parseCSV(text: string) {
    const lines = text.split(/\r?\n/).filter(Boolean);
    const header = lines[0].split(',');
    const data = lines.slice(1).map((line) => {
      const cols = line.split(',');
      const obj: any = {};
      header.forEach((h, i) => obj[h.trim()] = (cols[i] ?? '').trim());
      return obj;
    });
    setRows(data);
  }
  async function handleSubmit() {
    if (!rows.length) { setStatus('No rows to upload'); return; }
    setStatus('Uploading...');
    const res = await fetch('/api/games/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rows })
    });
    const out = await res.json();
    if (res.ok) setStatus(`Imported ${out.inserted} rows.`);
    else setStatus(`Error: ${out.error}`);
  }
  return (
    <main>
      <h2>Upload CSV</h2>
      <p>CSV header: <code>week,slate_type,lock_datetime_ct,game_id,game_date,kickoff_local,home_team,away_team,favorite,underdog,spread,notes</code></p>
      <input type="file" accept=".csv" onChange={async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const text = await file.text();
        parseCSV(text);
      }} />
      <div style={{ marginTop: 16 }}>
        <button onClick={handleSubmit} style={{ padding: '10px 14px', background: '#CC1236', color: 'white', borderRadius: 10, border: 'none' }}>Import to DB</button>
      </div>
      <p style={{ marginTop: 8 }}>{status}</p>
      {rows.length > 0 && (
        <div style={{ marginTop: 16, maxHeight: 360, overflow: 'auto', border: '1px solid #ddd', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{Object.keys(rows[0]).map((h) => (<th key={h} style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>{h}</th>))}</tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>{Object.values(r).map((v:any, j) => (<td key={j} style={{ padding: 8, borderBottom: '1px solid #f3f4f6' }}>{v}</td>))}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
