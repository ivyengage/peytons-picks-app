// app/api/compute/refresh-market/route.ts
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
// If you already have helpers/types at top of this file, keep them above/below these imports as needed.

async function handle(req: NextRequest) {
  const url = new URL(req.url);
  const week = Number(url.searchParams.get('week') || '1');
  const redirect =
    ['1', 'true'].includes((url.searchParams.get('redirect') || '').toLowerCase());

  // --------------------------
  // YOUR EXISTING LOGIC STARTS
  // --------------------------
  //
  // Keep the body of your current POST here:
  //   - connect to DB
  //   - fetch odds for the week
  //   - compute spreads/totals medians
  //   - upsert into market_now
  //
  // Return whatever "result" object you previously JSON.stringify'd.
  //
  // IMPORTANT: do not "return new Response(...)" here—just build a result object.
  // For example:
  let result: any = { ok: true, updated: 0, events_checked: 0 };

  // ... (your existing code) ...
  // Make sure to populate result = { ok: true/false, updated, events_checked, ... }

  // --------------------------
  // YOUR EXISTING LOGIC ENDS
  // --------------------------

  if (redirect) {
    // Send the user back to the board
    return NextResponse.redirect(`${url.origin}/board?week=${week}`);
  }

  // Fallback: JSON (useful for debugging)
  return NextResponse.json(result);
}

// Support both GET (links) and POST (manual calls / tools)
export async function GET(req: NextRequest)  { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
