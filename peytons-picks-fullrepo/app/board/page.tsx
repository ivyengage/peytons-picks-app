// app/board/page.tsx
export const dynamic = 'force-dynamic';
import { getClient } from '../../lib/db';

type Row = {
  game_id: string;
  week: number;
  game_date: string | null;        // pre-formatted in SQL
  kickoff_local: string | null;
  home_team: string;
  away_team: string;
  favorite: string | null;
  underdog: string | null;
  spread: number | null;
  consensus_spread: number | null; // from market_now
  consensus_total: number | null;  // from market_now
  score: number | null;            // from confidence
  pick_side: 'favorite' | 'underdog' | null;
  pick_team: string | null;
  cover_prob: number | null;
  reasons: unknown;
};

function fmtNum(n: number | null | undefined, d = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const f = Math.pow(10, d);
  return String(Math.round(n * f) / f);
}

function safeReasons(r: unknown): string[] {
  if (!r) return [];
  if (Array.isArray(r)) return r.map(String);
  if (typeof r === 'string') {
    try {
      const parsed = JSON.parse(r);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export default async function BoardPage({ searchParams }: { searchParams?: Record<string, string> }) {
  const week = Number(searchParams?.week ?? '1');

  const client = await getClient();
  try {
    const res = await client.query<Row>(`
      SELECT
        g.game_id,
        g.week,
        TO_CHAR(g.game_date, 'YYYY-MM-DD') AS game_date,
        g.kickoff_local,
        g.home_team,
        g.away_team,
        g.favorite,
        g.underdog,
        g.spread,
        m.consensus_spread,
        m.consensus_total,
        c.score,
        c.pick_side,
        c.pick_team,
        c.cover_prob,
        c.reasons
      FROM games g
      LEFT JOIN market_now m ON m.game_id = g.game_id
      LEFT JOIN confidence c ON c.game_id = g.game_id
      WHERE g.week = $1
      ORDER BY (c.score IS NULL) ASC, c.score DESC, g.game_date, g.kickoff_local, g.game_id
    `, [week]);

    const rows = (res.rows ?? []).map(r => ({ ...r, reasons: safeReasons(r.reasons) }));
    const top10 = rows.filter(r => r.score != null).slice(0, 10);

    return (
      <main style={{ padding: 24, fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial' }}>
        <h1 style={{ margin: 0, marginBottom: 8 }}>Peyton’s Picks — Board (Week {week})</h1>

        {/* Toolbar */}
        <div style={{ margin: '12px 0', display: 'flex', gap: 12 }}>
  <a
    href={`/api/compute/refresh-all?week=${week}&redirect=1`}
    style={{ padding: '8px 12px', background: '#0B2242', color: '#fff',
             borderRadius: 8, textDecoration: 'none', fontWeight: 600 }}
  >
    🔁 Refresh All
  </a>
  <a
    href={`/api/games/status?week=${week}`}
    style={{ padding: '8px 12px', border: '1px solid #ddd',
             borderRadius: 8, textDecoration: 'none' }}
  >
    DB Status
  </a>
</div>

        {/* Top 10 */}
        <section style={{ border:'1px solid #e5e7eb', borderRadius:10, padding:16, background:'#fff', marginBottom:20 }}>
          <h2 style={{ marginTop:0 }}>Top 10</h2>
          {top10.length === 0 ? (
            <div>No confidence scores yet. Click <strong>Refresh All</strong> above.</div>
          ) : (
            <ol style={{ paddingLeft: 18 }}>
              {top10.map(g => (
                <li key={g.game_id} style={{ marginBottom: 8 }}>
                  <strong>
                    {g.pick_team ?? (g.pick_side === 'underdog' ? (g.underdog ?? 'Underdog') : (g.favorite ?? 'Favorite'))}
                  </strong>
                  {' — score '}{fmtNum(g.score)}
                  {', cover '}{g.cover_prob != null ? `${Math.round(g.cover_prob * 100)}%` : '—'}
                  {' — '}{g.away_team} @ {g.home_team} ({g.game_date ?? ''} {g.kickoff_local ?? ''})
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Full table */}
        <div style={{ overflow:'auto', border:'1px solid #e5e7eb', borderRadius:10 }}>
          <table style={{ width:'100%', borderCollapse:'collapse', background:'#fff', fontSize:14 }}>
            <thead>
              <tr>
                {['week','game_id','date','kickoff','home','away','favorite','underdog','Tue spread','Market spr/ttl','Pick','Score','Cover %','Reasons'].map(h => (
                  <th key={h} style={{ textAlign:'left', padding:8, borderBottom:'1px solid #eee' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(g => (
                <tr key={g.game_id}>
                  <td style={{ padding:8, borderBottom:'1px solid #f3f4f6' }}>{g.week}</td>
                  <td style={{ padding:8, borderBottom:'1px solid #f3f4f6' }}>{g.game_id}</td>
                  <td style={{ padding:8, borderBottom:'1px solid #f3f4f6' }}>{g.game_date ?? '—'}</td>
                  <td style={{ padding:8, borderBottom:'1px solid #f3f4f6' }}>{g.kickoff_local ?? '—'}</td>
                  <td style={{ padding:8, borderBottom:'1px solid #f3f4f6' }}>{g.home_team}</td>
                  <td style={{ padding:8, borderBottom:'1px solid #f3f4f6' }}>{g.away_team}</td>
                  <td style={{ padding:8, borderBottom:'1px solid #f3f4f6', fontWeight:600 }}>{g.favorite ?? '—'}</td>
                  <td style={{ padding:8, borderBottom:'1px solid #f3f4f6' }}>{g.underdog ?? '—'}</td>
                  <td style={{ padding:8, borderBottom:'1px solid #f3f4f6' }}>{fmtNum(g.spread)}</td>
                  <td style={{ padding:8, borderBottom:'1px solid #f3f4f6' }}>
                    {(g.consensus_spread != null || g.consensus_total != null)
                      ? `${fmtNum(g.consensus_spread)} / ${fmtNum(g.consensus_total)}`
                      : '—'}
                  </td>
                  <td style={{ padding:8, borderBottom:'1px solid #f3f4f6' }}>
                    {g.pick_side ? (g.pick_side === 'underdog' ? (g.underdog ?? 'Underdog') : (g.favorite ?? 'Favorite')) : '—'}
                  </td>
                  <td style={{ padding:8, borderBottom:'1px solid #f3f4f6' }}>{fmtNum(g.score)}</td>
                  <td style={{ padding:8, borderBottom:'1px solid #f3f4f6' }}>
                    {g.cover_prob != null ? `${Math.round(g.cover_prob * 100)}%` : '—'}
                  </td>
                  <td style={{ padding:8, borderBottom:'1px solid #f3f4f6', maxWidth:420 }}>
                    {(g.reasons as string[]).slice(0, 3).join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    );
  } catch (e: any) {
    return (
      <pre style={{ padding:16, whiteSpace:'pre-wrap' }}>
        Board error: {e?.message || String(e)}
      </pre>
    );
  } finally {
    client.release();
  }
}
