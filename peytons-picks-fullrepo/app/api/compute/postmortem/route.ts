// app/api/compute/postmortem/route.ts
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { getClient } from '../../../../lib/db';

async function handle(req: NextRequest) {
  const url = new URL(req.url);
  const week = Number(url.searchParams.get('week') || '1');

  const client = await getClient();
  try {
    // 1) Compute ATS fields on games (scores must be present)
    await client.query(/* the UPDATE games ... WHERE week = $1 */, [week]);

    // 2) Grade our picks
    const r1 = await client.query(/* the INSERT INTO picks_history ... WHERE week = $1 */, [week]);

    // 3) Calibration (optional)
    const r2 = await client.query(/* the calibration CTE insert ... */, [week]);

    // 4) Book skill (optional) -- only if you maintain per-book grades
    // await client.query(...);

    return NextResponse.json({
      ok: true,
      graded: r1.rowCount ?? null
    });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error: e.message }, { status: 500 });
  } finally {
    client.release?.();  // or client.end() based on your db helper
  }
}

export async function GET(req: NextRequest)  { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
