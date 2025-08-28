export const runtime = 'nodejs';
import { NextRequest } from 'next/server';
import { getClient } from '../../../../lib/db';

type Game = {
  game_id: string;
  favorite: string;
  underdog: string;
  home_team: string;
  away_team: string;
  spread: number; // Tuesday line (negative for favorite)
};

type Market = {
  game_id: string;
  consensus_spread: number | null;
  consensus_total: number | null;
};

function zscores(xs: number[]) {
  const n = xs.length || 1;
  const mean = xs.reduce((a,b)=>a+b,0)/n;
  const sd = Math.sqrt(xs.reduce((a,b)=>a+(b-mean)*(b-mean),0)/n) || 1;
  return xs.map(x => (x-mean)/sd);
}

function sigmoid(x: number) {
  return 1/(1+Math.exp(-x));
}

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const week = Number(url.searchParams.get('week') || '1');
    const client = await getClient();

    const res = await client.query(`
      SELECT g.game_id, g.favorite, g.underdog, g.home_team, g.away_team, g.spread,
             m.consensus_spread, m.consensus_total
      FROM games g
      LEFT JOIN market_now m ON m.game_id = g.game_id
      WHERE g.week=$1
      ORDER BY g.game_id
    `, [week]);
    const rows: Array<Game & Market> = res.rows as any;

    const feat_market_signed_fav: number[] = [];
    const feat_market_signed_dog: number[] = [];
    const feat_variance: number[] = [];
    const feat_home: number[] = [];

    for (const r of rows) {
      const tue = Number(r.spread);
      const cur = (r.consensus_spread!=null) ? Number(r.consensus_spread) : tue;

      const edge_market = cur - tue; // positive -> toward dog
      feat_market_signed_fav.push(-edge_market);
      feat_market_signed_dog.push(+edge_market);

      const total = (r.consensus_total!=null) ? Number(r.consensus_total) : 54;
      const variance_pen = 0.015 * Math.abs(tue) + 0.005 * total;
      feat_variance.push(variance_pen);

      const favIsHome = r.favorite === r.home_team;
      feat_home.push(favIsHome ? 1 : 0);
    }

    const z_market_fav = zscores(feat_market_signed_fav);
    const z_market_dog = zscores(feat_market_signed_dog);
    const z_variance = zscores(feat_variance);
    const z_home = zscores(feat_home);

    const w_market = 0.6;
    const w_var = 0.1;
    const w_home = 0.05;
    const scale = 1.5;

    let upserts = 0;
    for (let i=0; i<rows.length; i++) {
      const r = rows[i];
      const favHome = r.favorite === r.home_team;
      const dogHome = r.underdog === r.home_team;

      const X_fav = (w_market * z_market_fav[i]) + (w_home * (favHome ? z_home[i] : 0)) - (w_var * z_variance[i]);
      const X_dog = (w_market * z_market_dog[i]) + (w_home * (dogHome ? z_home[i] : 0)) - (w_var * z_variance[i]);

      const p_fav = sigmoid(X_fav/scale);
      const p_dog = sigmoid(X_dog/scale);
      const score_fav = 100 * (p_fav - 0.5);
      const score_dog = 100 * (p_dog - 0.5);

      const pick_side = score_dog > score_fav ? 'underdog' : 'favorite';
      const pick_team = pick_side === 'underdog' ? r.underdog : r.favorite;
      const cover_prob = pick_side === 'underdog' ? p_dog : p_fav;
      const score = pick_side === 'underdog' ? score_dog : score_fav;

      const tue = Number(r.spread);
      const cur = (r.consensus_spread!=null) ? Number(r.consensus_spread) : tue;
      const edge_market = cur - tue;

      const reasons = [
        (edge_market>0
          ? `Market moved ${edge_market.toFixed(1)} pts toward dog since Tue`
          : edge_market<0
            ? `Market moved ${Math.abs(edge_market).toFixed(1)} pts toward favorite since Tue`
            : `No market movement since Tue`
        ),
        `Variance guard: |Tue spread|=${Math.abs(tue).toFixed(1)}; total=${((r.consensus_total!=null)?Number(r.consensus_total):54).toFixed(0)}`,
        pick_side==='underdog'
          ? (dogHome ? 'Dog is at home' : 'Dog on the road')
          : (favHome ? 'Favorite is at home' : 'Favorite on the road')
      ];

      await client.query(
        `INSERT INTO confidence (game_id, pick_side, pick_team, cover_prob, score, reasons, computed_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,NOW())
         ON CONFLICT (game_id) DO UPDATE SET pick_side=EXCLUDED.pick_side, pick_team=EXCLUDED.pick_team,
           cover_prob=EXCLUDED.cover_prob, score=EXCLUDED.score, reasons=EXCLUDED.reasons, computed_at=NOW()`,
        [r.game_id, pick_side, pick_team, cover_prob, score, JSON.stringify(reasons)]
      );
      upserts++;
    }

    await client.end();
    return new Response(JSON.stringify({ ok: true, upserts, games: rows.length }), { headers: { 'content-type': 'application/json' } });
  } catch (e:any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
