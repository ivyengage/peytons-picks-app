export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { getClient } from '../../../../lib/db';

type CfbdGame = {
  id: number;
  season: number;
  week: number;
  season_type: 'regular' | 'postseason';
  start_date: string;
  home_team: string;
  away_team: string;
  home_points: number | null;
  away_points: number | null;
  completed: boolean | null;
  notes?: string | null;
};

function coreName(raw: string) {
  const deparen = raw.replace(/\((.*?)\)/g, ' $1 ');
  const words = deparen.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/);
  const stop = new Set(['university', 'state', 'the']);
  let core = words.filter(w => !stop.has(w)).join('');
  const ALIAS: Record<string,string> = {};
  const last = words.at(-1) || '';
  if (ALIAS[core]) core = ALIAS[core];
  else if (ALIAS[last]) core = ALIAS[last];
  return core;
}

async function handle(req: NextRequest) {
  const url = new URL(req.url);
  const year = Number(url.searchParams.get('year') || new Date().getFullYear());
  const week = Number(url.searchParams.get('week') || '1');
  const seasonType = (url.searchParams.get('seasonType') || 'regular') as 'regular'|'postseason';
  const doGrade = ['1','true','yes'].includes((url.searchParams.get('grade') || '').toLowerCase());
  const redirect = ['1','true'].includes((url.searchParams.get('redirect') || '').toLowerCase());

  const apiKey = process.env.CFBD_API_KEY;
  if (!apiKey) return NextResponse.json({ ok:false, error:'CFBD_API_KEY missing' }, { status:500 });

  const cfbdUrl = `https://api.collegefootballdata.com/games?year=${year}&week=${week}&seasonType=${seasonType}&division=fbs`;
  const resp = await fetch(cfbdUrl, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!resp.ok) {
    const text = await resp.text();
    return NextResponse.json({ ok:false, error:'CFBD error', status:resp.status, text }, { status:500 });
  }
  const games: CfbdGame[] = await resp.json();

  const cfbdMap = new Map<string, CfbdGame>();
  for (const g of games) {
    const h = coreName(g.home_team);
    const a = coreName(g.away_team);
    const key = [h, a].sort().join('|');
    cfbdMap.set(key, g);
  }

  const client = await getClient();
  let updated = 0, considered = 0;
  try {
    const dbRes = await client.query<{ game_id: string; home_team: string; away_team: string }>(
      `SELECT game_id, home_team, away_team FROM games WHERE week = $1`,
      [week]
    );
    for (const row of dbRes.rows) {
      considered++;
      const h = coreName(row.home_team);
      const a = coreName(row.away_team);
      const key = [h, a].sort().join('|');
      const m = cfbdMap.get(key);
      if (!m) continue;
      if (m.home_points == null || m.away_points == null) continue;

      const upd = await client.query(
        `UPDATE games
         SET home_score = $1,
             away_score = $2,
             completed_at = COALESCE(completed_at, NOW())
         WHERE game_id = $3
           AND (home_score IS DISTINCT FROM $1 OR away_score IS DISTINCT FROM $2)`,
        [m.home_points, m.away_points, row.game_id]
      );
      if (upd.rowCount && upd.rowCount > 0) updated++;
    }
  } catch (e:any) {
    return NextResponse.json({ ok:false, error:e.message }, { status:500 });
  } finally {
    (client as any).release?.();
  }

  let graded: number | null = null;
  if (doGrade) {
    const gradeUrl = `${url.origin}/api/compute/postmortem?week=${week}`;
    const gRes = await fetch(gradeUrl, { method:'POST', cache:'no-store' });
    let gj:any = {};
    try { gj = await gRes.json(); } catch {}
    graded = gj?.graded ?? null;
  }

  if (redirect) return NextResponse.redirect(`${url.origin}/board?week=${week}`);

  return NextResponse.json({ ok:true, year, week, seasonType, cfbd_count: games.length, considered, updated, graded });
}

export async function GET(req: NextRequest)  { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
