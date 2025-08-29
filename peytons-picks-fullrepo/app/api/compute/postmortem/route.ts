// app/api/compute/postmortem/route.ts
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { getClient } from '../../../../lib/db';

async function handle(req: NextRequest) {
  const url = new URL(req.url);
  const week = Number(url.searchParams.get('week') || '1');

  const client = await getClient();
  try {
    // 0) Ensure picks_history exists (safe no-op if it already does)
    await client.query(`
      CREATE TABLE IF NOT EXISTS picks_history (
        week INT,
        game_id TEXT PRIMARY KEY,
        pick_team TEXT,
        pick_side TEXT,
        score NUMERIC,
        cover_prob NUMERIC,
        outcome INT,        -- 1 = covered, 0 = not covered, NULL = push
        won BOOLEAN,
        brier NUMERIC,
        logloss NUMERIC,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // 1) Compute ATS fields on games using Tuesday line
    const updateGamesSql = `
      UPDATE games g
      SET
        margin      = CASE
                        WHEN home_score IS NOT NULL AND away_score IS NOT NULL
                        THEN home_score - away_score
                        ELSE NULL
                      END,
        fav_spread  = CASE WHEN spread IS NOT NULL THEN ABS(spread) ELSE NULL END,
        fav_margin  = CASE
                        WHEN favorite IS NOT NULL AND home_score IS NOT NULL AND away_score IS NOT NULL THEN
                          CASE
                            WHEN favorite = home_team THEN (home_score - away_score)
                            WHEN favorite = away_team THEN (away_score - home_score)
                            ELSE NULL
                          END
                        ELSE NULL
                      END,
        ats_result  = CASE
                        WHEN home_score IS NULL OR away_score IS NULL OR spread IS NULL OR favorite IS NULL THEN NULL
                        WHEN favorite = home_team AND (home_score - away_score)  >  ABS(spread) THEN 'favorite'
                        WHEN favorite = away_team AND (away_score - home_score)  >  ABS(spread) THEN 'favorite'
                        WHEN favorite = home_team AND (home_score - away_score)  =  ABS(spread) THEN 'push'
                        WHEN favorite = away_team AND (away_score - home_score)  =  ABS(spread) THEN 'push'
                        ELSE 'underdog'
                      END,
        favorite_covered = CASE
                             WHEN home_score IS NULL OR away_score IS NULL OR spread IS NULL OR favorite IS NULL THEN NULL
                             WHEN (favorite = home_team  AND (home_score - away_score)  > ABS(spread)) OR
                                  (favorite = away_team  AND (away_score - home_score)  > ABS(spread))
                             THEN TRUE ELSE FALSE END,
        completed_at = CASE
                         WHEN home_score IS NOT NULL AND away_score IS NOT NULL
                         THEN COALESCE(completed_at, NOW())
                         ELSE completed_at
                       END
      WHERE g.week = $1
    `;
    await client.query(updateGamesSql, [week]);

    // 2) Insert graded picks into picks_history (upsert on game_id)
    // Clamp probabilities for logloss stability
    const insertPicksSql = `
      INSERT INTO picks_history (week, game_id, pick_team, pick_side, score, cover_prob, outcome, won, brier, logloss)
      SELECT
        g.week,
        g.game_id,
        c.pick_team,
        c.pick_side,
        c.score,
        LEAST(GREATEST(c.cover_prob, 0.001), 0.999) AS p,
        CASE
          WHEN g.ats_result = 'push' THEN NULL
          WHEN c.pick_side = g.ats_result THEN 1
          ELSE 0
        END AS outcome,
        CASE
          WHEN g.ats_result = 'push' THEN NULL
          WHEN c.pick_side = g.ats_result THEN TRUE
          ELSE FALSE
        END AS won,
        CASE
          WHEN g.ats_result = 'push' THEN NULL
          ELSE POWER(LEAST(GREATEST(c.cover_prob,0),1) - CASE WHEN c.pick_side = g.ats_result THEN 1 ELSE 0 END, 2)
        END AS brier,
        CASE
          WHEN g.ats_result = 'push' THEN NULL
          ELSE -(
                (CASE WHEN c.pick_side = g.ats_result THEN 1 ELSE 0 END) * LN(LEAST(GREATEST(c.cover_prob,0.001),0.999)) +
                (CASE WHEN c.pick_side = g.ats_result THEN 0 ELSE 1 END) * LN(1 - LEAST(GREATEST(c.cover_prob,0.001),0.999))
              )
        END AS logloss
      FROM games g
      JOIN confidence c ON c.game_id = g.game_id
      WHERE g.week = $1
        AND g.home_score IS NOT NULL
        AND g.away_score IS NOT NULL
      ON CONFLICT (game_id) DO UPDATE SET
        week       = EXCLUDED.week,
        pick_team  = EXCLUDED.pick_team,
        pick_side  = EXCLUDED.pick_side,
        score      = EXCLUDED.score,
        cover_prob = EXCLUDED.cover_prob,
        outcome    = EXCLUDED.outcome,
        won        = EXCLUDED.won,
        brier      = EXCLUDED.brier,
        logloss    = EXCLUDED.logloss,
        created_at = NOW()
      RETURNING game_id
    `;
    const r = await client.query(insertPicksSql, [week]);
    const graded = r.rowCount ?? 0;

    return NextResponse.json({ ok: true, week, graded });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  } finally {
    // release pooled client
    (client as any).release?.();
  }
}

export async function GET(req: NextRequest)  { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
