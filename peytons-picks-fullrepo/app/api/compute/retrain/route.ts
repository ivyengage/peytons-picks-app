// app/api/compute/retrain/route.ts
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { getClient } from '../../../../lib/db';

export async function GET(req: NextRequest)  { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }

async function handle(req: NextRequest) {
  const url = new URL(req.url);
  const through = Number(url.searchParams.get('through_week') || '1');
  const window = Number(url.searchParams.get('window') || '4'); // last 4 weeks
  const fromWeek = Math.max(1, through - window + 1);

  const client = await getClient();
  try {
    const { rows } = await client.query(
      `SELECT pick_prob, outcome
         FROM graded_predictions
        WHERE week BETWEEN $1 AND $2
          AND outcome IN ('win','loss')`,
      [fromWeek, through]
    );
    if (!rows.length) {
      return NextResponse.json({ ok:false, error:'No graded rows in window' }, { status:400 });
    }

    // Simple probability calibration: p' = clamp(a*p + b)
    const A = [0.8,0.9,1.0,1.1,1.2];
    const B = [-0.1,-0.05,0,0.05,0.1];

    function logloss(a:number,b:number) {
      let s = 0, n = 0;
      for (const r of rows) {
        const y = (r.outcome === 'win') ? 1 : 0;
        const p0 = Number(r.pick_prob || 0.5);
        const p = Math.max(0.001, Math.min(0.999, a*p0 + b));
        s += -(y*Math.log(p) + (1-y)*Math.log(1-p));
        n++;
      }
      return s / n;
    }

    let best = { a:1.0, b:0.0, loss: 1e9 };
    for (const a of A) for (const b of B) {
      const L = logloss(a,b);
      if (L < best.loss) best = { a, b, loss: L };
    }

    await client.query(
      `INSERT INTO model_weights(asof_week, w_market, w_power, w_injury, w_weather, w_homeaway, w_travel, reg_lambda, cal_a, cal_b)
       VALUES($1,0.30,0.30,0.15,0.10,0.10,0.05,0.5,$2,$3)
       ON CONFLICT (asof_week) DO UPDATE SET cal_a=$2, cal_b=$3`,
      [through, best.a, best.b]
    );

    return NextResponse.json({ ok:true, window:{fromWeek, through}, calibration: best });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error:e.message }, { status:500 });
  } finally {
    (client as any).release?.();
  }
}
