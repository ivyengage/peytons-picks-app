'use client';

import { useState } from 'react';
import Tesseract from 'tesseract.js';

type Row = {
  week: number;
  slate_type: string;
  lock_datetime_ct: string;
  game_id: string;
  game_date: string;
  kickoff_local: string;
  home_team: string;
  away_team: string;
  favorite: string;
  underdog: string;
  spread: number;
  notes: string;
};

function parsePairs(text: string) {
  const norm = text.replace(/−/g, '-');
  const re = /([A-Za-z0-9 .,'()&/-]+?)\s*\(\s*([+-]?\d+(?:\.\d)?)\s*\)/g;
  const matches: { team: string; line: number }[] = [];
  let m;
  while ((m = re.exec(norm)) !== null) {
    const team = m[1].trim().replace(/\s+/g, ' ');
    const line = parseFloat(m[2]);
    if (!isNaN(line) && team.length >= 2) {
      matches.push({ team, line });
    }
  }
  const pairs: Array<{ top: {team:string,line:number}, bottom: {team:string,line:number} }> = [];
  for (let i = 0; i+1 < matches.length; i += 2) {
    pairs.push({ top: matches[i], bottom: matches[i+1] });
  }
  return pairs;
}

export default function ImportPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [week, setWeek] = useState<number>(1);
  const [defaultDate, setDefaultDate] = useState<string>('');
  const [defaultTime, setDefaultTime] = useState<string>('');
  const [status, setStatus] = useState<string>('');

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    const arr = Array.from(files);
    setStatus('Running OCR…');
    const allPairs: ReturnType<typeof parsePairs> = [];
    for (const f of arr) {
      const imgUrl = URL.createObjectURL(f);
      const out = await Tesseract.recognize(imgUrl, 'eng', { logger: () => {} });
      const text = out.data.text || '';
      const pairs = parsePairs(text);
      allPairs.push(...pairs);
      URL.revokeObjectURL(imgUrl);
    }
    const newRows: Row[] = allPairs.map((p, idx) => {
      const top = p.top; const bottom = p.bottom;
      let favorite = top.team, underdog = bottom.team, spread = -Math.abs(top.line);
      if (top.line > 0) { favorite = bottom.team; underdog = top.team; spread = -Math.abs(top.line); }
      if (top.line < 0) { favorite = top.team; underdog = bottom.team; spread = -Math.abs(top.line); }
      if (top.line >= 0 && bottom.line >= 0) {
        if (top.line > bottom.line) { favorite = bottom.team; underdog = top.team; spread = -Math.abs(top.line); }
        else { favorite = top.team; underdog = bottom.team; spread = -Math.abs(bottom.line); }
      }
      const n = idx + 1;
      return {
        week,
        slate_type: 'regular',
        lock_datetime_ct: defaultDate && defaultTime ? `${defaultDate} ${defaultTime}` : '',
        game_id: `W${week}G${n}`,
        game_date: defaultDate || '',
        kickoff_local: defaultTime || '',
        home_team: bottom.team,
        away_team: top.team,
        favorite,
        underdog,
        spread,
        notes: ''
      };
    });
    setRows(newRows);
    setStatus(`Parsed ${newRows.length} games. Review & edit below.`);
  }

  function updateRow(i: number, key: keyof Row, val: string) {
    const copy = rows.slice();
    // @ts-ignore
    copy[i][key] = key === 'spread' ? Number(val) : val;
    setRows(copy);
  }

  function quote(s: string) {
    if (s.includes(',') || s.includes('"')) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function downloadCSV() {
    if (!rows.length) return;
    const header = 'week,slate_type,lock_datetime_ct,game_id,game_date,kickoff_local,home_team,away_team,favorite,underdog,spread,notes';
    const lines = rows.map(r => [
      r.week, r.slate_type, r.lock_datetime_ct, r.game_id, r.game_date, r.kickoff_local,
      quote(r.home_team), quote(r.away_team), quote(r.favorite), quote(r.underdog), r.spread, quote(r.notes)
    ].join(','));
    const csv = [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `week${week}_from_screenshots.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importToDB() {
    if (!rows.length) { setStatus('No rows to import'); return; }
    setStatus('Importing to database…');
    const res = await fetch('/api/games/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rows })
    });
    const out = await res.json();
    if (res.ok) setStatus(`Imported ${out.inserted} rows ✔️`);
    else setStatus(`Error: ${out.error}`);
  }

  return (
    <main>
      <h2>Import Screenshots</h2>
      <p>Upload multiple screenshots. We’ll OCR, parse teams/spreads, and build the slate. Top team is treated as <strong>away</strong>, bottom as <strong>home</strong>.</p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label>Week: <input type="number" value={week} onChange={e=>setWeek(Number(e.target.value)||1)} style={{ width: 80 }} /></label>
        <label>Date: <input type="text" placeholder="YYYY-MM-DD" value={defaultDate} onChange={e=>setDefaultDate(e.target.value)} style={{ width: 120 }} /></label>
        <label>Time: <input type="text" placeholder="HH:MM" value={defaultTime} onChange={e=>setDefaultTime(e.target.value)} style={{ width: 90 }} /></label>
        <input type="file" accept="image/*" multiple onChange={e => handleFiles(e.target.files)} />
        <button onClick={downloadCSV} style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid #ddd' }}>Download CSV</button>
        <button onClick={importToDB} style={{ padding: '8px 12px', borderRadius: 10, background: '#CC1236', color: 'white', border: 'none' }}>Import to DB</button>
      </div>

      <p style={{ marginTop: 8 }}>{status}</p>

      {rows.length > 0 && (
        <div style={{ marginTop: 12, overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
            <thead>
              <tr>
                {['week','game_id','game_date','kickoff_local','home_team','away_team','favorite','underdog','spread','notes'].map(h => (
                  <th key={h} style={{ textAlign:'left', padding:8, borderBottom:'1px solid #eee' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r,i)=>(
                <tr key={i}>
                  <td style={{ padding:8 }}><input value={r.week} onChange={e=>updateRow(i,'week',e.target.value)} style={{ width: 60 }} /></td>
                  <td style={{ padding:8 }}><input value={r.game_id} onChange={e=>updateRow(i,'game_id',e.target.value)} style={{ width: 90 }} /></td>
                  <td style={{ padding:8 }}><input value={r.game_date} onChange={e=>updateRow(i,'game_date',e.target.value)} style={{ width: 110 }} /></td>
                  <td style={{ padding:8 }}><input value={r.kickoff_local} onChange={e=>updateRow(i,'kickoff_local',e.target.value)} style={{ width: 90 }} /></td>
                  <td style={{ padding:8 }}><input value={r.home_team} onChange={e=>updateRow(i,'home_team',e.target.value)} style={{ width: 180 }} /></td>
                  <td style={{ padding:8 }}><input value={r.away_team} onChange={e=>updateRow(i,'away_team',e.target.value)} style={{ width: 180 }} /></td>
                  <td style={{ padding:8 }}><input value={r.favorite} onChange={e=>updateRow(i,'favorite',e.target.value)} style={{ width: 180, fontWeight:600 }} /></td>
                  <td style={{ padding:8 }}><input value={r.underdog} onChange={e=>updateRow(i,'underdog',e.target.value)} style={{ width: 180 }} /></td>
                  <td style={{ padding:8 }}><input value={r.spread} onChange={e=>updateRow(i,'spread',e.target.value)} style={{ width: 70 }} /></td>
                  <td style={{ padding:8 }}><input value={r.notes} onChange={e=>updateRow(i,'notes',e.target.value)} style={{ width: 160 }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
