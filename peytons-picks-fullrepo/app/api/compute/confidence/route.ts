// app/api/compute/confidence/route.ts
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';

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
  //   - read games
  //   - apply confidence model
  //   - upsert into confidence table
  //
  let result: any = { ok: true, upserts: 0, games: 0 };

  // ... (your existing confidence scoring code) ...
  // Make sure to populate: result = { ok, upserts, games, ... }

  // --------------------------
  // YOUR EXISTING LOGIC ENDS
  // --------------------------

  if (redirect) {
    return NextResponse.redirect(`${url.origin}/board?week=${week}`);
  }

  return NextResponse.json(result);
}

export async function GET(req: NextRequest)  { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
