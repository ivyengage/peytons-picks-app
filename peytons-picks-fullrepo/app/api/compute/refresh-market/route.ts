// app/api/compute/refresh-market/route.ts
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';

// Keep your existing imports (db helpers, types, utilities) here.
// Example (adjust path if you already have it):
// import { getClient } from '../../../../lib/db';

// Keep your existing helper functions/types here (median, norm, sameMatch, etc.)

async function handle(req: NextRequest) {
  const url = new URL(req.url);
  const week = Number(url.searchParams.get('week') || '1');
  const redirect = ['1', 'true'].includes(
    (url.searchParams.get('redirect') || '').toLowerCase()
  );

  // ---------------------------------------------------------
  // BEGIN: YOUR EXISTING REFRESH-MARKET LOGIC
  // (Paste the body of your previous POST() here — connect to DB,
  //  fetch Odds API, compute medians, upsert to market_now, etc.)
  //
  // Populate "result" the same way you used to return JSON, e.g.:
  //   { ok: true, updated, events_checked, ... }
  //
  let result: any = { ok: true, updated: 0, events_checked: 0 };

  // ... PASTE YOUR CURRENT LOGIC HERE ...
  // set: result = { ok, updated, events_checked, ... };

  // END: YOUR EXISTING REFRESH-MARKET LOGIC
  // ---------------------------------------------------------

  if (redirect) {
    // Send the user back to the board instead of returning JSON
    return NextResponse.redirect(`${url.origin}/board?week=${week}`);
  }

  // Fallback: JSON (handy for debugging)
  return NextResponse.json(result);
}

// Support both GET (from <a href=...>) and POST (from tools)
export async function GET(req: NextRequest)  { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
