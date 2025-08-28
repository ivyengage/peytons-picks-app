export const runtime = 'nodejs';
import { NextRequest } from 'next/server';
import { getClient } from '../../../../lib/db';
// Allow browser GET to call the existing POST handler
export async function GET(req: NextRequest) {
  // delegate to the POST endpoint so both methods work the same
  // @ts-ignore
  return POST(req);
}
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

// ---------- Top-level helpers (improved matching) ----------
const stop = new Set(['university','state','college','of','the','at','and']);

// common abbreviations → canonical "core" (no spaces/punct)
const ALIAS: Record<string,string> = {
  lsu: 'louisianastate',
  uga: 'georgia',
  bama: 'alabama',
  usc: 'southerncalifornia',
  ucla: 'californiolosangeles',
  tcu: 'texaschristian',
  olemiss: 'mississippi',
  byu: 'brighamyoung',
  usf: 'southflorida',
  ucf: 'centralflorida',
  fau: 'floridaatlantic',
  fiu: 'floridainternational',
  smu: 'southernmethodist',
  utsa: 'texassanantonio',
  utep: 'texaselpaso',
  uab: 'alabamabirmingham',
  unlv: 'nevadalasvegas',
  umass: 'massachusetts',
  uconn: 'connecticut',
  unc: 'northcarolina',
  ncsu: 'northcarolinastate',
  ncstate: 'northcarolinastate',
  wvu: 'westvirginia',
  miamioh: 'miamiohio',
};

function coreName(raw: string) {
  // remove parentheses e.g. "Miami (OH)" → "Miami OH"
  const deparen = raw.replace(/\((.*?)\)/g, ' $1 ');
  const words = deparen.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/);
  // collapse to concatenated core, dropping filler words
  let core = words.filter(w => !stop.has(w)).join('');
  // alias match on full core or last token (common shorthands)
  const last = words.at(-1) || '';
  if (ALIAS[core]) core = ALIAS[core];
  else if (ALIAS[last]) core = ALIAS[last];
  return core;
}

function sameMatch(a1: string, a2: string, b1: string, b2: string) {
  const A1 = coreName(a1), A2 = coreName(a2), B1 = coreName(b1), B2 = coreName(b2);
  const eq = (x: string, y: string) => x && y && (x.includes(y) || y.includes(x));
  // match regardless of ordering
  return (eq(A1, B1) && eq(A2, B2)) || (eq(A1, B2) && eq(A2, B1));
}
// -----------------------------------------------------------

const median = (nums: number[]): number | null => {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
// --------------------------------------

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const week = Number(url.searchParams.get('week') || '1');

    const apiKey = process.env.ODDS_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'ODDS_API_KEY missing' }), { status: 500 });
    }

    const client = await getClient();

    const gamesRes = await client.query(
      `SELECT game_id, home_team, away_team FROM games WHERE week=$1 ORDER BY game_id`,
      [week]
    );
    const games = gamesRes.rows as Array<{ game_id: string; home_team: string; away_team: string }>;

    const oddsUrl =
      `https://api.the-odds-api.com/v4/sports/americanfootball_ncaaf/odds/?` +
      `regions=us&markets=spreads,totals&oddsFormat=american&dateFormat=iso&apiKey=${apiKey}`;
    const resp = await fetch(oddsUrl, { cache: 'no-store' });
    if (!resp.ok) {
      const txt = await resp.text();
      client.release();
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
          const home = mSp.outcomes.find(o => coreName(o.name) === coreName(ev.home_team));
          const away = mSp.outcomes.find(o => coreName(o.name) === coreName(ev.away_team));
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

      const consensus_spread = median(spreads);
      const consensus_total  = median(totals);
      if (consensus_spread == null && consensus_total == null) continue;

      await client.query(
        `INSERT INTO market_now (game_id, consensus_spread, consensus_total, books_covered)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (game_id) DO UPDATE
           SET consensus_spread = EXCLUDED.consensus_spread,
               consensus_total  = EXCLUDED.consensus_total,
               books_covered    = EXCLUDED.books_covered,
               fetched_at       = NOW()`,
        [g.game_id, consensus_spread, consensus_total, spreads.length || null]
      );
      updated++;
    }

    client.release();
    return new Response(
      JSON.stringify({ ok: true, updated, events_checked: events.length }),
      { headers: { 'content-type': 'application/json' } }
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
