// app/api/compute/confidence/route.ts
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { getClient } from '../../../../lib/db';

// ---------- small helpers ----------
function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}
function logistic(x: number, k: number) {
  return 1 / (1 + Math.exp(-k * x));
}

async function handle(req: NextRequest) {
  const url = new URL(req.url);
  const week = Number(url.searchParams.get('week') || '1');
  const redirect = ['1', 'true'].includes((url.searchParams.get('redirect') || '').toLowerCase());

  const client = await getClient();
  let upserts = 0;
  let seen = 0;

  try {
    // 1) Load current feature weights (or create defaults)
    const fw = await client.query(`
      SELECT * FROM feature_weights WHERE active = TRUE LIMIT 1
    `);
    const W = fw.rows[0] || {
      w_movement: 1.0,
      w_home: 0.2,
      w_weather: 0.2,
      w_injury: 0.2,
      w_bookskill: 0.3,
      k_logistic: 0.9,
    };

    // 2) Detect which column in market_now stores the live spread
    const probe = await client.query<{
      column_name: string;
    }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_name = 'market_now'
          AND column_name = ANY($1::text[])`,
      [[
        'consensus_spread',
        'median_spread',
        'market_spread',
        'spread',
        'fav_spread',
        'spread_favorite',
      ]]
    );
    const marketCol = probe.rows[0]?.column_name || null;

    // 3) Pull games (this week), optionally joining market_now
    // Build SELECT fragment for the market spread if available
    const marketSelect = marketCol ? `m.${marketCol}::numeric AS market_spread` : `NULL::numeric AS market_spread`;
    const sql = `
      SELECT
        g.game_id,
        g.week,
        g.home_team,
        g.away_team,
        g.favorite,
        g.underdog,
        g.spread::numeric AS tuesday_spread,
        ${marketSelect},
        g.game_date,
        g.kickoff_local
      FROM games g
      ${marketCol ? `LEFT JOIN market_now m ON m.game_id = g.game_id` : ``}
      WHERE g.week = $1
      ORDER BY g.game_date NULLS LAST, g.kickoff_local NULLS LAST, g.game_id
    `;
    const { rows: games } = await client.query(sql, [week]);

    // Safety: ensure history table exists (no-op if already there)
    await client.query(`
      CREATE TABLE IF NOT EXISTS pick_history (
        week INT NOT NULL,
        game_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        pick_team TEXT NOT NULL,
        pick_side TEXT NOT NULL,           -- 'favorite' | 'underdog'
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

    // 4) For each game, compute features → score → probability, then upsert
    for (const g of games) {
      seen++;

      const favorite: string | null = g.favorite || null;
      const underdog: string | null = g.underdog || null;

      // Normalize Tuesday spread to a positive magnitude (favorite’s POV)
      // Your CSVs usually store spread from favorite POV but sign can vary.
      // We take absolute value to avoid sign mistakes.
      const tue = Number(g.tuesday_spread ?? 0);
      const tue_abs = Math.abs(tue);

      // Market spread (same POV) if present; otherwise null
      const mrk = (g as any).market_spread != null ? Number((g as any).market_spread) : null;
      const mrk_abs = mrk == null ? null : Math.abs(mrk);

      // Feature 1: market movement (how much market is away from Tuesday number)
      // Positive → more bullish on favorite to cover.
      let f_movement = 0;
      if (mrk_abs != null) {
        f_movement = mrk_abs - tue_abs;
      }

      // Feature 2: home effect — small nudge toward the home team being the favorite
      // If favorite is home → +1 ; if favorite is away → -1
      let f_home = 0;
      if (favorite) {
        const favIsHome = favorite === g.home_team;
        f_home = favIsHome ? 1 : -1;
      }

      // Features 3/4/5: weather/injury/bookskill placeholders (0 if not wired yet)
      // (These can be populated from your weather/injury/book_skill tables if present.)
      const f_weather = 0;
      const f_injury = 0;
      const f_bookskill = 0;

      // Composite score
      const score =
        (W.w_movement ?? 1.0)  * f_movement +
        (W.w_home ?? 0.2)      * f_home +
        (W.w_weather ?? 0.2)   * f_weather +
        (W.w_injury ?? 0.2)    * f_injury +
        (W.w_bookskill ?? 0.3) * f_bookskill;

      // Probability that the model’s preferred side covers
      const cover_prob = clamp(logistic(score, Number(W.k_logistic ?? 0.9)), 0.01, 0.99);

      // Choose pick side: if score >= 0 → favorite; else → underdog
      const pick_side: 'favorite' | 'underdog' = score >= 0 ? 'favorite' : 'underdog';
      const pick_team = pick_side === 'favorite' ? favorite : underdog;

      // Explain briefly (optional reasons JSON string)
      const reasons = JSON.stringify({
        movement: f_movement,
        home_edge: f_home,
        weather: f_weather,
        injury: f_injury,
        bookskill: f_bookskill,
        weights: {
          movement: Number(W.w_movement ?? 1.0),
          home: Number(W.w_home ?? 0.2),
          weather: Number(W.w_weather ?? 0.2),
          injury: Number(W.w_injury ?? 0.2),
          bookskill: Number(W.w_bookskill ?? 0.3),
          k: Number(W.k_logistic ?? 0.9)
        }
      });

      // If we failed to identify teams, skip safe
      if (!pick_team || !favorite || !underdog) continue;

      // UPSERT into confidence
      await client.query(
        `CREATE TABLE IF NOT EXISTS confidence (
          week INT,
          game_id TEXT PRIMARY KEY,
          pick_team TEXT,
          pick_side TEXT,
          cover_prob DOUBLE PRECISION,
          score DOUBLE PRECISION,
          reasons JSONB,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )`
      );

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
        [week, g.game_id, pick_team, pick_side, cover_prob, score, reasons]
      );
      upserts += r1.rowCount ?? 0;

      // LOG prediction snapshot for learning later
      await client.query(
        `INSERT INTO pick_history
           (week, game_id, pick_team, pick_side, cover_prob,
            tuesday_spread, consensus_spread,
            f_movement, f_home, f_weather, f_injury, f_bookskill)
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
        [
          week,
          g.game_id,
          pick_team,
          pick_side,
          cover_prob,
          tue_abs,
          mrk_abs,
          f_movement,
          f_home,
          f_weather,
          f_injury,
          f_bookskill,
        ]
      );
    }

    const result = { ok: true, upserts, games: seen };

    if (redirect) {
      return NextResponse.redirect(`${url.origin}/board?week=${week}`);
    }
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  } finally {
    (client as any).release?.();
  }
}

export async function GET(req: NextRequest)  { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
