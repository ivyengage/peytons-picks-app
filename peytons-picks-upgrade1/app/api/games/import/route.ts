import { NextRequest } from 'next/server';
import { getClient } from '@/lib/db';
export async function POST(req: NextRequest) {
  try {
    const { rows } = await req.json();
    if (!rows?.length) return new Response(JSON.stringify({ error: 'No rows' }), { status: 400 });
    const client = await getClient();
    let inserted = 0;
    for (const r of rows) {
      const q = `INSERT INTO games
      (week, slate_type, lock_datetime_ct, game_id, game_date, kickoff_local, home_team, away_team, favorite, underdog, spread, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (game_id) DO UPDATE SET
        week=EXCLUDED.week,
        slate_type=EXCLUDED.slate_type,
        lock_datetime_ct=EXCLUDED.lock_datetime_ct,
        game_date=EXCLUDED.game_date,
        kickoff_local=EXCLUDED.kickoff_local,
        home_team=EXCLUDED.home_team,
        away_team=EXCLUDED.away_team,
        favorite=EXCLUDED.favorite,
        underdog=EXCLUDED.underdog,
        spread=EXCLUDED.spread,
        notes=EXCLUDED.notes`;
      const vals = [
        Number(r.week), String(r.slate_type||'regular'), new Date(r.lock_datetime_ct),
        String(r.game_id), new Date(r.game_date), String(r.kickoff_local),
        String(r.home_team), String(r.away_team), String(r.favorite), String(r.underdog),
        Number(r.spread), String(r.notes||'')
      ];
      await client.query(q, vals);
      inserted++;
    }
    await client.end();
    return new Response(JSON.stringify({ ok: true, inserted }), { headers: { 'content-type': 'application/json' } });
  } catch (e:any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
}
