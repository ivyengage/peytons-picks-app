// app/api/compute/fetch-scores/route.ts
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { getClient } from '../../../../lib/db';

export async function GET(req: NextRequest)  { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }

async function handle(req: NextRequest) {
  const url = new URL(req.url);
  const year = Number(url.searchParams.get('year') || new Date().getFullYear());
  const week = Number(url.searchParams.get('week') || '1');
  const seasonType = (url.searchParams.get('seasonType') || 'regular');

  const apiKey = process.env.CFBD_API_KEY;
  if (!apiKey) return NextResponse.json({ ok:false, error:'CFBD_API_KEY missing' }, { status:500 });

  const qs = new URLSearchParams({ year:String(year), week:String(week), seasonType, division:'fbs' });
  const resp = await fetch(`https://api.collegefootballdata.com/games?${qs}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!resp.ok) {
    const text = await resp.text();
    return NextResponse.json({ ok:false, error:'CFBD error', status:resp.status, text }, { status:500 });
  }
  const games = await resp.json();

  // Map CFBD rows to your existing games IDs by normalized team names.
  const norm = (s:string)=> s.toLowerCase().replace(/[^a-z0-9]+/g,'');
  const client = await getClient();
  let inserted = 0;

  try {
    // Pull this week's games from your DB to map to game_id
    const { rows: sheet } = await client.query(
      `SELECT game_id, home_team, away_team FROM games WHERE week = $1`, [week]
    );

    // Build a map from normalized "home@away" -> game_id
    const idMap = new Map<string,string>();
    for (const r of sheet) {
      idMap.set(`${norm(r.home_team)}@${norm(r.away_team)}`, r.game_id);
    }

    for (const g of games) {
      if (g.home_points == null || g.away_points == null) continue;
      const key = `${norm(g.home_team)}@${norm(g.away_team)}`;
      const game_id = idMap.get(key);
      if (!game_id) continue; // skip mismatches

      await client.query(
        `INSERT INTO results(week, game_id, home_team, away_team, home_score, away_score)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (week,game_id) DO UPDATE SET
           home_score=EXCLUDED.home_score, away_score=EXCLUDED.away_score, completed_at=now()`,
        [week, game_id, g.home_team, g.away_team, g.home_points, g.away_points]
      );
      inserted++;
    }
  } catch (e:any) {
    return NextResponse.json({ ok:false, error:e.message }, { status:500 });
  } finally {
    (client as any).release?.();
  }

  return NextResponse.json({ ok:true, inserted });
}

