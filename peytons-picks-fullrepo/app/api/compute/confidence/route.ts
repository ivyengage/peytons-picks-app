// app/api/compute/confidence/route.ts
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { getClient } from '../../../../lib/db';

// ---------- Helpers ----------

// very small, readable model: convert spread → cover probability
// - spread is the Tuesday spread stored in games.spread (fav is negative, dog is positive is fine)
// - we use a simple logistic-like mapping that caps at [0.55, 0.90] to avoid overconfidence
function probFromSpread(absSpread: number): number {
  // baseline above 50%, increase with spread, but cap
  const p = 0.50 + Math.min(0.40, absSpread / 35); // 35 pts ~ +0.40
  return Math.max(0.55, Math.min(0.90, p));
}

// turn a probability into a compact 0–100 confidence score
function scoreFromProb(p: number): number {
  // center at 50% => 0, scale to ±40, then add small boost for larger edges
  return Math.round((p - 0.5) * 100);
}

// ---------- Core handler ----------

async function handle(req: NextRequest) {
  const url = new URL(req.url);
  const week = Number(url.searchParams.get('week') || '1');
  const redirect = ['1', 'true'].includes(
    (url.searchParams.get('redirect') || '').toLowerCase()
  );

  const client = await getClient();

  try {
    // 1) pull this week's games
    const gamesRes = await client.query(
      `
        SELECT game_id, week, game_date, kickoff_local,
               home_team, away_team, favorite, underdog, spread, notes
        FROM games
        WHERE week = $1
        ORDER BY game_id
      `,
      [week]
    );

    let upserts = 0;

    // 2) compute + upsert for each game
    for (const g of gamesRes.rows as Array<{
      game_id: string;
      week: number;
      game_date: string | null;
      kickoff_local: string | null;
      home_team: string;
      away_team: string;
      favorite: string | null;
      underdog: string | null;
      spread: string | number | null;
      notes: string | null;
    }>) {
      // parse spread safely
      const rawSpread =
        typeof g.spread === 'number'
          ? g.spread
          : (g.spread ? Number(String(g.spread).trim()) : NaN);

      // default decision if we can’t parse spread
      let pickTeam = g.favorite || g.home_team;
      let pickSide: 'favorite' | 'underdog' = 'favorite';
      let coverProb = 0.60; // conservative default
      const reasons: string[] = [];

      if (!Number.isFinite(rawSpread)) {
        reasons.push('No/invalid spread → using conservative default.');
      } else {
        const absS = Math.abs(rawSpread);
        coverProb = probFromSpread(absS);

        if (rawSpread < 0) {
          // favorite is laying points
          pickTeam = g.favorite || g.home_team;
          pickSide = 'favorite';
          reasons.push(
            `Favorite ${pickTeam} is ${Math.abs(rawSpread)}-pt fave (Tue), prob≈${Math.round(
              coverProb * 100
            )}%`
          );
        } else if (rawSpread > 0) {
          // underdog is getting points
          pickTeam = g.underdog || g.away_team;
          pickSide = 'underdog';
          reasons.push(
            `Underdog ${pickTeam} is +${Math.abs(rawSpread)} (Tue), prob≈${Math.round(
              coverProb * 100
            )}%`
          );
        } else {
          // pick slight edge to home team if pk
          pickTeam = g.home_team;
          pickSide = 'favorite';
          coverProb = 0.58;
          reasons.push('Pick’em line → small lean to home team.');
        }
      }

      // small nudges using notes (optional)
      if (g.notes) {
        const note = g.notes.toLowerCase();
        if (note.includes('injury') || note.includes('qb out')) {
          coverProb = Math.max(0.55, coverProb - 0.02);
          reasons.push('Minor downgrade: injury note.');
        }
        if (note.includes('weather') || note.includes('wind')) {
          reasons.push('Weather flagged (FYI).');
        }
      }

      const score = scoreFromProb(coverProb);

      // 3) UPSERT into confidence (includes week!)
      await client.query(
        `
        INSERT INTO confidence
          (game_id, pick_team, pick_side, cover_prob, score, reasons, week)
        VALUES
          ($1,      $2,        $3,        $4,         $5,    $6,      $7)
        ON CONFLICT (game_id) DO UPDATE
        SET pick_team  = EXCLUDED.pick_team,
            pick_side  = EXCLUDED.pick_side,
            cover_prob = EXCLUDED.cover_prob,
            score      = EXCLUDED.score,
            reasons    = EXCLUDED.reasons,
            week       = EXCLUDED.week
        `,
        [
          g.game_id,
          pickTeam,
          pickSide,
          coverProb,
          score,
          JSON.stringify(reasons),
          week,
        ]
      );
      upserts++;
    }

    // 4) success response or redirect to board
    if (redirect) {
      return NextResponse.redirect(`${url.origin}/board?week=${week}`);
    }

    return NextResponse.json({
      ok: true,
      upserts,
      games: gamesRes.rowCount,
      week,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || 'unknown error' },
      { status: 500 }
    );
  } finally {
    // IMPORTANT on Neon: release, do not end()
    // @ts-ignore
    if (typeof client.release === 'function') client.release();
  }
}

// Expose both GET & POST (so your board buttons can use simple links)
export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
