export const runtime = 'nodejs';
import { NextRequest } from 'next/server';
import { getClient } from '../../../../lib/db';

type OddsEvent = {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Array<{
    key: string;
    title: string;
    markets: Array<{
      key: string;  // 'spreads' | 'totals'
      outcomes: Array<{ name: string; price: number; point?: number }>
    }>
  }>
};

function norm(s: string) {
  return s.toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/stateu?$/,'state')
    .replace(/university$/,'');
}

function sameMatch(a1: string, a2: string, b1: string, b2: string) {
  const A1 = norm(a1), A2 = norm(a2), B1 = norm(b1), B2 = norm(b2);
  return (A1 === B1 && A2 === B2) || (A1 === B2 && A2 === B1);
}

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const week = Number(url.searchParams.get('week') || '1');
    const apiKey = process.env.ODDS_API_KEY;
    if (!apiKey) return new Response(JSON.stringify({ error: 'ODDS_API_KEY missing' }), { status: 500 });
    const client = await getClient();

    const gamesRes = await client.query(`SELECT game_id, home_team, away_team FROM games WHERE week=$1 ORDER BY game_id`, [week]);
    const games = gamesRes.rows;

    const oddsUrl = `https://api.the-odds-api.com/v4/sports/americanfootball_ncaaf/odds/?regions=us&markets=spreads,totals&oddsFormat=american&dateFormat=iso&apiKey=${apiKey}`;
    const resp = await fetch(oddsUrl, { cache: 'no-store' });
    if (!resp.ok) {
      const txt = await resp.text();
      return new Response(JSON.stringify({ error: 'Odds API error', details: txt }), { status: 500 });
    }
    const events: OddsEvent[] = await resp.json();

    let updated = 0;
    for (const g of games) {
      const ev = events.find(e => sameMatch(e.home_team, e.away_team, g.home_team, g.away_team));
      if (!ev) continue;

      const spreads: number[] = [];
      const totals: number[] = [];

      for (const bk of ev.bookmakers || []) {
        const mSp = (bk.markets || []).find(m => m.key === 'spreads');
        if (mSp) {
          const home = mSp.outcomes.find(o => norm(o.name) === norm(ev.home_team));
          const away = mSp.outcomes.find(o => norm(o.name) === norm(ev.away_team));
          if (home?.point != null && away?.point != null) {
            if (home.point < 0) spreads.push(Number(home.point));
            else if (away.point < 0) spreads.push(Number(away.point));
          }
        }
        const mTot = (bk.markets || []).find(m => m.key === 'totals');
        if (mTot) {
          const over = mTot.outcomes.find(o => o.name.toLowerCase().includes('over'));
          if (over?.point != null) totals.push(Number(over.point));
        }
      }

      function median(nums: number[]) {
        if (!nums.length) return null;
        const s = [...nums].sort((a,b)=>a-b);
        const mid = Math.floor(s.length/2);
        return s.length % 2 ? s[mid] : (s[mid-1]+s[mid])/2;
      }

      const consensus_spread = median(spreads);
      const consensus_total = median(totals);
      if (consensus_spread == null && consensus_total == null) continue;

      await client.query(
        `INSERT INTO market_now (game_id, consensus_spread, consensus_total, books_covered)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (game_id) DO UPDATE SET consensus_spread=EXCLUDED.consensus_spread,
           consensus_total=EXCLUDED.consensus_total, books_covered=EXCLUDED.books_covered, fetched_at=NOW()`,
        [g.game_id, consensus_spread, consensus_total, spreads.length || null]
      );
      updated++;
    }

    await client.end();
    return new Response(JSON.stringify({ ok: true, updated, events_checked: events.length }), { headers: { 'content-type': 'application/json' } });
  } catch (e:any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
