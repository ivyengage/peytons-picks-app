// app/api/compute/confidence/route.ts
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';

// Keep your existing imports (db helpers, types, utilities) here.
// Example:
// import { getClient } from '../../../../lib/db';

// Keep your existing helper functions/types here if any.

async function handle(req: NextRequest) {
  const url = new URL(req.url);
  const week = Number(url.searchParams.get('week') || '1');
  const redirect = ['1', 'true'].includes(
    (url.searchParams.get('redirect') || '').toLowerCase()
  );

  // ---------------------------------------------------------
  // BEGIN: YOUR EXISTING CONFIDENCE LOGIC
  // (Paste the body of your previous POST() here — read games,
  //  compute scores/cover %s, upsert into "confidence", etc.)
  //
  // Populate "result" the same way you used to return JSON, e.g.:
  //   { ok: true, upserts, games, ... }
  //
  let result: any = { ok: true, upserts: 0, games: 0 };

  // ... PASTE YOUR CURRENT LOGIC HERE ...
  // set: result = { ok, upserts, games, ... };

  // END: YOUR EXISTING CONFIDENCE LOGIC
  // ---------------------------------------------------------

  if (redirect) {
    return NextResponse.redirect(`${url.origin}/board?week=${week}`);
  }
  return NextResponse.json(result);
}

export async function GET(req: NextRequest)  { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
