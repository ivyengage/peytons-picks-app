// app/api/compute/confidence/route.ts
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { getClient } from '../../../../lib/db';

function clamp(x: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, x)); }
function logistic(x: number, k: number) { return 1 / (1 + Math.exp(-k * x)); }

export async function GET(req: NextRequest)  { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }

async function handle(req: NextRequest) {
  const url = new URL(req.url);
  const week = Number(url.searchParams.get('week') || '1');
  const redirect = ['1','true'].includes((url.searchParams.get('redirect') || '').toLowerCase());

  const client = await getClient();
  let upserts = 0, seen = 0;

  try {
    // Read latest learned weights (optional)
    const { rows: wr } = await client.query(
      `SELECT * FROM model_weights ORDER BY asof_week DESC LIMIT 1`
    );
    const W = wr[0] || { w_market:1.0, w_homeaway:0.2, w_injury:0.2, w_weather:0.2, w_travel:0.05, reg_lambda:0.5, cal_a:1.0, cal_b:0.0 };

    // Detect which market column exists
    const probe = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'market_now'
          AND column_name = ANY($1::text[])`,
      [[ 'consensus_spread','median_spread','market_spread','spread','fav_spread','spread_favorite' ]]
    );
    const marketCol = probe.rows[0]?.column_name || null;
    const marketSelect = marketCol ? `m.${marketCol}::numeric AS market_spread` : `NULL::numeric AS market_spread`;

    // Pull games for this week
    const sql = `
      SELECT
        g.game_id, g.week, g.home_team, g.away_team, g.favorite, g.underdog,
        g.spread::numeric AS tuesday_spread,
        ${marketSelect},
        g.game_date, g.kickoff_local
      FROM games g
      ${marketCol ? `LEFT JOIN market_now m ON m.game_id = g.game_id` : ``}
      WHERE g.week = $1
      ORDER BY g.game_date NULLS LAST, g.kickoff_local NULLS LAST, g.game_id
    `;
    const { rows: games } = await client.query(sql, [week]);

    // Ensure tables exist (no-op if present)
    await client.query(`
      CREATE TABLE IF NOT EXISTS confidence (
        week INT,
        game_id TEXT PRIMARY KEY,
        pick_team TEXT,
        pick_side TEXT,
        cover_prob DOUBLE PRECISION,
        score DOUBLE PRECISION,
        reasons JSONB,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS pick_history (
        week INT NOT NULL,
        game_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        pick_team TEXT NOT NULL,
        pick_side TEXT NOT NULL,
        cover_prob DOUBLE PRECISION NOT NULL,
        tuesday_spread DOUBLE PRECISION NOT NULL,
        consensus_spread DOUBLE PRECISION,
        f_movement DOUBLE PRECISION DEFAULT 0,
        f_home DOUBLE PRECISION DEFAULT 0,
        f_weather DOUBLE PRECISION DEFAULT 0,
        f_injury DOUBLE PRECISION DEFAULT 0,
        f_bookskill DOUBLE PRECISION DEFAULT 0,
        PRIMARY KEY (week, game_id)
      )
    `);

    for (const g of games) {
      seen++;

      const favorite: string | null = g.favorite || null;
      const underdog: string | null = g.underdog || null;
      const tue = Number(g.tuesday_spread ?? 0);
      const tue_abs = Math.abs(tue);

      const mrk = (g as any).market_spread != null ? Number((g as any).market_spread) : null;
      const mrk_abs = mrk == null ? null : Math.abs(mrk);

      // Features
      const f_movement = mrk_abs == null ? 0 : (mrk_abs - tue_abs);           // how far market moved from Tuesday
      const f_home     = favorite ? (favorite === g.home_team ? 1 : -1) : 0;  // home favorite slight bump
      const f_weather  = 0;  // wire up later
      const f_injury   = 0;  // wire up later
      const f_bookskill= 0;  // wire up later

      // Score & probability (with optional calibration a,b)
      const rawScore =
          (Number(W.w_market ?? 1.0))    * f_movement +
          (Number(W.w_homeaway ?? 0.2))  * f_home +
          (Number(W.w_weather ?? 0.2))   * f_weather +
          (Number(W.w_injury ?? 0.2))    * f_injury +
          (Number(W.w_travel ?? 0.05))   * 0; // placeholder
      const rawProb = logistic(rawScore / (1 + Number(W.reg_lambda ?? 0.5)), 1.0);
      const cover_prob = clamp(Number(W.cal_a ?? 1.0) * rawProb + Number(W.cal_b ?? 0.0), 0.01, 0.99);

      // Pick side
      const pick_side: 'favorite'|'underdog' = rawScore >= 0 ? 'favorite' : 'underdog';
      const pick_team = pick_side === 'favorite' ? favorite : underdog;

      if (!pick_team || !favorite || !underdog) continue;

      const reasons = JSON.stringify({
        movement: f_movement, home_edge: f_home, weather: f_weather, injury: f_injury, bookskill: f_bookskill,
        weights: { w_market:W.w_market, w_homeaway:W.w_homeaway, w_weather:W.w_weather, w_injury:W.w_injury, w_travel:W.w_travel, reg_lambda:W.reg_lambda, cal_a:W.cal_a, cal_b:W.cal_b }
      });

      // Upsert into confidence
      const r1 = await client.query(
        `INSERT INTO confidence
           (week, game_id, pick_team, pick_side, cover_prob, score, reasons, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, NOW())
         ON CONFLICT (game_id) DO UPDATE SET
           week       = EXCLUDED.week,
           pick_team  = EXCLUDED.pick_team,
           pick_side  = EXCLUDED.pick_side,
           cover_prob = EXCLUDED.cover_prob,
           score      = EXCLUDED.score,
           reasons    = EXCLUDED.reasons,
           updated_at = NOW()`,
        [week, g.game_id, pick_team, pick_side, cover_prob, rawScore, reasons]
      );

      // Log snapshot to pick_history
      await client.query(
        `INSERT INTO pick_history
           (week, game_id, pick_team, pick_side, cover_prob,
            tuesday_spread, consensus_spread, f_movement, f_home, f_weather, f_injury, f_bookskill)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (week, game_id) DO UPDATE SET
           pick_team        = EXCLUDED.pick_team,
           pick_side        = EXCLUDED.pick_side,
           cover_prob       = EXCLUDED.cover_prob,
           tuesday_spread   = EXCLUDED.tuesday_spread,
           consensus_spread = EXCLUDED.consensus_spread,
           f_movement       = EXCLUDED.f_movement,
           f_home           = EXCLUDED.f_home,
           f_weather        = EXCLUDED.f_weather,
           f_injury         = EXCLUDED.f_injury,
           f_bookskill      = EXCLUDED.f_bookskill`,
        [ week, g.game_id, pick_team, pick_side, cover_prob, tue_abs, mrk_abs, f_movement, f_home, f_weather, f_injury, f_bookskill ]
      );

      upserts += r1.rowCount ?? 0;
    }

    const result = { ok: true, upserts, games: seen };
    if (redirect) return NextResponse.redirect(`${url.origin}/board?week=${week}`);
    return NextResponse.json(result);
  } catch (e:any) {
    return NextResponse.json({ ok:false, error: e.message }, { status:500 });
  } finally {
    (client as any).release?.();
  }
}
