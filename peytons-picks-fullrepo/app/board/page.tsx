export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { getClient } from '../../lib/db';

export default async function Board() {
  const client = await getClient();
  const picksRes = await client.query(`
    SELECT g.week, g.game_id, g.favorite, g.underdog, g.home_team, g.away_team, g.spread,
           c.pick_side, c.pick_team, c.cover_prob, c.score, c.reasons,
           to_char(g.game_date, 'YYYY-MM-DD') as game_date, g.kickoff_local,
           m.consensus_spread, m.consensus_total
    FROM games g
    LEFT JOIN confidence c ON c.game_id = g.game_id
    LEFT JOIN market_now m ON m.game_id = g.game_id
    ORDER BY (c.score IS NULL), c.score DESC, g.game_date, g.kickoff_local
  `);
  const rows = picksRes.rows;
  await client.end();

  const haveConfidence = rows.some((r:any) => r.score !== null);
  const top10 = haveConfidence
    ? rows.filter((r:any) => r.score !== null).slice(0,10)
    : rows.slice(0,10);

  return (
    <main>
      <h2>Board</h2>
      <p>{haveConfidence ? 'Confidence Top-10' : 'Top-10 (no confidence yet — run Refresh Market & Compute)'} </p>

      <section style={{ margin:'12px 0', padding:12, background:'#fff', border:'1px solid #e5e7eb', borderRadius:12 }}>
        <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
          <a href="/api/compute/refresh-market?week=1" style={{ padding:'8px 12px', background:'#0B2242', color:'#fff', borderRadius:10, textDecoration:'none' }}>1) Refresh Market</a>
          <a href="/api/compute/confidence?week=1" style={{ padding:'8px 12px', background:'#CC1236', color:'#fff', borderRadius:10, textDecoration:'none' }}>2) Compute Confidence</a>
          <a href="/api/confidence/list?week=1" style={{ padding:'8px 12px', border:'1px solid #ddd', borderRadius:10, textDecoration:'none' }}>View JSON</a>
        </div>
      </section>

      <section style={{ margin:'12px 0', padding:12, background:'#fff', border:'1px solid #e5e7eb', borderRadius:12 }}>
        <h3 style={{ marginTop:0 }}>Top 10</h3>
        <ol>
          {top10.map((r:any)=>(
            <li key={r.game_id}>
              <strong>{r.pick_team ? r.pick_team : r.favorite}</strong>
              {r.score != null ? <> — score {r.score.toFixed(1)}, cover {(r.cover_prob*100).toFixed(1)}%</> : <> — (no score yet)</>}
              <div style={{ fontSize:12, opacity:0.8 }}>
                Tue line: {r.favorite} {r.spread} vs {r.underdog}
                {r.consensus_spread!=null ? <> — market now fav {r.consensus_spread}</> : null}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div style={{ overflow:'auto', border:'1px solid #e5e7eb', borderRadius:12 }}>
        <table style={{ width:'100%', borderCollapse:'collapse', background:'#fff' }}>
          <thead>
            <tr>
              {['game_id','game_date','kickoff_local','home_team','away_team','favorite','underdog','Tue spread','Market now','Pick','Score','Cover %'].map(h=>(
                <th key={h} style={{ textAlign:'left', padding:8, borderBottom:'1px solid #eee' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r:any)=>(
              <tr key={r.game_id}>
                <td style={{ padding:8 }}>{r.game_id}</td>
                <td style={{ padding:8 }}>{r.game_date}</td>
                <td style={{ padding:8 }}>{r.kickoff_local}</td>
                <td style={{ padding:8 }}>{r.home_team}</td>
                <td style={{ padding:8 }}>{r.away_team}</td>
                <td style={{ padding:8, fontWeight:600 }}>{r.favorite}</td>
                <td style={{ padding:8 }}>{r.underdog}</td>
                <td style={{ padding:8 }}>{r.spread}</td>
                <td style={{ padding:8 }}>{r.consensus_spread!=null ? r.consensus_spread : '—'}</td>
                <td style={{ padding:8 }}>{r.pick_team || '—'}</td>
                <td style={{ padding:8 }}>{r.score!=null ? r.score.toFixed(1) : '—'}</td>
                <td style={{ padding:8 }}>{r.cover_prob!=null ? (r.cover_prob*100).toFixed(1)+'%' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
