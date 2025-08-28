export const runtime = 'nodejs';
import { NextRequest } from 'next/server';
import { getClient } from '../../../../lib/db';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const week = Number(url.searchParams.get('week') || '1');
    const client = await getClient();
    const res = await client.query(`
      SELECT g.week, g.game_id, g.favorite, g.underdog, g.home_team, g.away_team, g.spread,
             c.pick_side, c.pick_team, c.cover_prob, c.score, c.reasons,
             m.consensus_spread, m.consensus_total
      FROM games g
      LEFT JOIN confidence c ON c.game_id = g.game_id
      LEFT JOIN market_now m ON m.game_id = g.game_id
      WHERE g.week=$1
      ORDER BY c.score DESC NULLS LAST, g.game_date, g.kickoff_local
    `, [week]);
    client.release();
    return new Response(JSON.stringify({ picks: res.rows }), { headers: { 'content-type': 'application/json' } });
  } catch (e:any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
