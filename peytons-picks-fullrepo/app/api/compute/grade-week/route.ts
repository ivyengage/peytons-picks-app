// app/api/compute/grade-week/route.ts
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { getClient } from '../../../../lib/db';

export async function GET(req: NextRequest)  { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }

async function handle(req: NextRequest) {
  const url = new URL(req.url);
  const week = Number(url.searchParams.get('week') || '1');

  const client = await getClient();
  try {
    // Join games (Tuesday spread) + confidence (our pick) + results (finals)
    const { rows } = await client.query(`
      WITH base AS (
        SELECT
          c.week, c.game_id,
          g.home_team, g.away_team, g.favorite, g.underdog, g.spread AS tuesday_spread,
          c.pick_team, c.pick_side, c.cover_prob AS pick_prob, c.score,
          r.home_score, r.away_score
        FROM confidence c
        JOIN games g   ON g.week=c.week AND g.game_id=c.game_id
        LEFT JOIN results r ON r.week=c.week AND r.game_id=c.game_id
        WHERE c.week=$1
      )
      SELECT * FROM base
    `, [week]);

    let graded = 0, upserts = 0;
    for (const r of rows) {
      if (r.home_score == null || r.away_score == null) continue;

      const spread = Number(r.tuesday_spread);      // favorite is negative in your data
      const favTeam = r.favorite;                   // favorite team string
      const favPts = (favTeam === r.home_team) ? r.home_score : r.away_score;
      const dogPts = (favTeam === r.home_team) ? r.away_score : r.home_score;
      const favMargin = favPts - dogPts;            // favorite winning margin
      const coverMargin = favMargin + spread;       // >0 = favorite covered; <0 = dog covered; =0 push

      let favOutcome: 'win'|'loss'|'push' = 'push';
      if (coverMargin > 0) favOutcome = 'win';
      else if (coverMargin < 0) favOutcome = 'loss';

      let outcome: 'win'|'loss'|'push' = 'push';
      if (r.pick_side === 'favorite') outcome = favOutcome;
      else outcome = (favOutcome === 'win' ? 'loss' : favOutcome === 'loss' ? 'win' : 'push');

      await client.query(
        `INSERT INTO graded_predictions
          (week, game_id, pick_team, pick_side, tuesday_spread, pick_prob, score, outcome, cover_margin)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (week, game_id) DO UPDATE SET
           pick_team=EXCLUDED.pick_team,
           pick_side=EXCLUDED.pick_side,
           pick_prob=EXCLUDED.pick_prob,
           score=EXCLUDED.score,
           outcome=EXCLUDED.outcome,
           cover_margin=EXCLUDED.cover_margin`,
        [week, r.game_id, r.pick_team, r.pick_side, spread, r.pick_prob, r.score, outcome, coverMargin]
      );
      upserts++; graded++;
    }

    return NextResponse.json({ ok:true, week, graded, upserts });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error:e.message }, { status:500 });
  } finally {
    (client as any).release?.();
  }
}
