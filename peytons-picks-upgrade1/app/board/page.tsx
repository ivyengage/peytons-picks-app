async function getGames() {
  const res = await fetch(process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}/api/games/list` : 'http://localhost:3000/api/games/list', { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load games');
  return res.json();
}
export default async function Board() {
  const data = await getGames();
  const games = data.games || [];
  // placeholder Top-10: by absolute spread desc
  const top10 = [...games].sort((a:any,b:any)=>Math.abs(b.spread)-Math.abs(a.spread)).slice(0,10);
  return (
    <main>
      <h2>Board</h2>
      <p>Showing {games.length} games (placeholder confidence until odds/weather are connected).</p>
      <section style={{ margin:'12px 0', padding:12, background:'#fff', border:'1px solid #e5e7eb', borderRadius:12 }}>
        <h3 style={{ marginTop:0 }}>Top 10 (placeholder)</h3>
        <ol>
          {top10.map((g:any)=>(
            <li key={g.game_id}>
              <strong>{g.favorite}</strong> {g.spread} vs {g.underdog} — {g.game_date} {g.kickoff_local}
            </li>
          ))}
        </ol>
      </section>
      <div style={{ overflow:'auto', border:'1px solid #e5e7eb', borderRadius:12 }}>
        <table style={{ width:'100%', borderCollapse:'collapse', background:'#fff' }}>
          <thead>
            <tr>
              {['week','game_id','game_date','kickoff_local','home_team','away_team','favorite','underdog','spread','notes'].map(h=>(
                <th key={h} style={{ textAlign:'left', padding:8, borderBottom:'1px solid #eee' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {games.map((g:any)=>(
              <tr key={g.game_id}>
                <td style={{ padding:8 }}>{g.week}</td>
                <td style={{ padding:8 }}>{g.game_id}</td>
                <td style={{ padding:8 }}>{g.game_date}</td>
                <td style={{ padding:8 }}>{g.kickoff_local}</td>
                <td style={{ padding:8 }}>{g.home_team}</td>
                <td style={{ padding:8 }}>{g.away_team}</td>
                <td style={{ padding:8, fontWeight:600 }}>{g.favorite}</td>
                <td style={{ padding:8 }}>{g.underdog}</td>
                <td style={{ padding:8 }}>{g.spread}</td>
                <td style={{ padding:8 }}>{g.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
