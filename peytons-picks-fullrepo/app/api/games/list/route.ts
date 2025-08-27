export const runtime = 'nodejs';
import { getClient } from '../../../../lib/db';

export async function GET() {
  try {
    const client = await getClient();
    const res = await client.query('SELECT week, game_id, to_char(game_date, \'YYYY-MM-DD\') as game_date, kickoff_local, home_team, away_team, favorite, underdog, spread, notes FROM games ORDER BY game_date, kickoff_local, game_id');
    return new Response(JSON.stringify({ games: res.rows }), { headers: { 'content-type': 'application/json' } });
  } catch (e:any) {
    return new Response(JSON.stringify({ error: 'List failed: ' + e.message }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
}
