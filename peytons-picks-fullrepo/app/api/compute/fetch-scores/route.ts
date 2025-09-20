// app/api/compute/fetch-scores/route.ts
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { getClient } from '../../../../lib/db';

export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }

async function run(req: NextRequest) {
  const url = new URL(req.url);
  const year = Number(url.searchParams.get('year') || new Date().getFullYear());
  const week = Number(url.searchParams.get('week') || '1');
  const seasonType = url.searchParams.get('seasonType') || 'regular';

  const key = process.env.CFBD_API_KEY;
  if (!key) return NextResponse.json({ ok:false, error:'CFBD_API_KEY missing' }, { status:500 });

  const qs = new URLSearchParams({ year:String(year), week:String(week), seasonType });
  const resp = await fetch(`https://api.collegefootballdata.com/games?${qs}`, {
    headers: { Authorization: `Bearer ${key}` },
    cache: 'no-store'
  });
  if (!resp.ok) {
    const txt = await resp.text();
    return NextResponse.json({ ok:false, error:'CFBD error', details:txt }, { status:500 });
  }
  const games = await resp.json(); // array

  const client = await getClient();
  try {
    for (const g of games) {
      if (g.home_points == null || g.away_points == null) continue;
      // build a stable id ; or map to your existing games.game_id if you store one
      const gid = `${g.home_team}__${g.away_team}__${g.start_date?.slice(0,10)}`;
      await client.query(
        `INSERT INTO results(week, game_id, home_team, away_team, home_score, away_score)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (week,game_id) DO UPDATE SET
           home_score=EXCLUDED.home_score, away_score=EXCLUDED.away_score`,
        [week, gid, g.home_team, g.away_team, g.home_points, g.away_points]
      );
    }
  } finally {
    client.release();
  }
  return NextResponse.json({ ok:true, inserted: games.length });
}
