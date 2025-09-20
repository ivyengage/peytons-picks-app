// app/api/compute/confidence/route.ts
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { getClient } from '../../../../lib/db'; // keep your existing helper

type GameRow = {
  game_id: string;
  week: number;
  game_date: string;
  home_team: string;
  away_team: string;
  favorite: string | null;
  underdog: string | null;
  // market snapshot columns written by refresh-market:
  consensus_spread: number | null;  // negative means favorite by abs(spread)
  consensus_total: number | null;
};

// fast erf + normal CDF helpers
const erf = (x: number) => {
  // Abramowitz/Stegun approximation
  const a1= 0.254829592, a2=-0.284496736, a3= 1.421413741, a4=-1.453152027, a5=1.061405429, p=0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + p * Math.abs(x));
  const y = 1 - (((((a5*t + a4)*t) + a3)*t + a2)*t + a1) * t * Math.exp(-x*x);
  return sign * y;
};
const normCdf = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));

/**
 * Convert spread to “favorite covers” probability.
 * If spread < 0, favorite is listed favorite by |spread|.
 * If spread > 0 (rare in our convention), flip the sign.
 */
function favoriteCoverProb(spread: number, sigma = 13.5): number {
  // We want P(favorite margin >= |spread|)
  // Model margin ~ N(mu, sigma), where mu ~ spread (negative for favorite).
  // Under that common convention, use -spread for favorite-cover probability.
  const z = -spread / sigma;
  return 1 - normCdf(z);
}

export async function handle(req: NextRequest) {
  const url = new URL(req.url);
  const week = Number(url.searchParams.get('week') || '1');
  const redirect = ['1', 'true'].includes((url.searchParams.get('redirect') || '').toLowerCase());

  const client = await getClient();

  // 1) Pull week’s games WITH market snapshot columns
  const { rows } = await client.query<GameRow>(`
    SELECT
      g.game_id, g.week, g.game_date, g.home_team, g.away_team,
      g.favorite, g.underdog,
      g.consensus_spread, g.consensus_total
    FROM games g
    WHERE g.week = $1
    ORDER BY g.game_date, g.game_id
  `, [week]);

  let upserts = 0;
  const reasonsNow = (g: GameRow, pickTeam: string, pickSide: 'favorite'|'underdog', p: number) => ([
    `market: spread=${g.consensus_spread ?? 'n/a'}, total=${g.consensus_total ?? 'n/a'}`,
    `pick: ${pickTeam} (${pickSide})`,
    `cover_prob ~ ${Math.round(p*100)}%`,
  ]);

  for (const g of rows) {
    // If we don't have a consensus spread yet, skip this game (don’t write uniform defaults)
    if (g.consensus_spread === null || g.consensus_spread === undefined) continue;

    // 2) Compute favorite cover probability from spread
    const pFav = favoriteCoverProb(g.consensus_spread);

    // Decide pick
    const pickSide: 'favorite'|'underdog' = pFav >= 0.5 ? 'favorite' : 'underdog';
    const coverProb = pickSide === 'favorite' ? pFav : (1 - pFav);

    // Pick team (fall back to reading from favorite/underdog columns if set)
    let pickTeam = '';
    if (pickSide === 'favorite') {
      pickTeam = g.favorite || (g.consensus_spread < 0 ? g.home_team : g.away_team);
    } else {
      pickTeam = g.underdog || (g.consensus_spread < 0 ? g.away_team : g.home_team);
    }

    // A simple score that increases with both confidence and spread size
    const score = Math.abs(g.consensus_spread) * (Math.abs(coverProb - 0.5) * 2);

    // 3) Upsert confidence row
    await client.query(
      `
      INSERT INTO confidence
        (game_id, week, pick_team, pick_side, cover_prob, score, reasons, updated_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
      ON CONFLICT (game_id) DO UPDATE SET
        week       = EXCLUDED.week,
        pick_team  = EXCLUDED.pick_team,
        pick_side  = EXCLUDED.pick_side,
        cover_prob = EXCLUDED.cover_prob,
        score      = EXCLUDED.score,
        reasons    = EXCLUDED.reasons,
        updated_at = NOW()
      `,
      [
        g.game_id,
        g.week,
        pickTeam,
        pickSide,
        coverProb,
        score,
        JSON.stringify(reasonsNow(g, pickTeam, pickSide, coverProb)),
      ]
    );
    upserts++;
  }

  await client.end();

  const result = { ok: true, upserts, games: rows.length };
  if (redirect) return NextResponse.redirect(`${url.origin}/board?week=${week}`);
  return NextResponse.json(result);
}

export async function GET(req: NextRequest)  { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }

