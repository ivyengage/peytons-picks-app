// app/api/compute/refresh-all/route.ts
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET or POST /api/compute/refresh-all?week=1[&redirect=1]
 * - Calls refresh-market (POST)
 * - Calls confidence     (POST)
 * - Returns JSON summary
 * - If redirect=1, sends you back to /board?week=...
 */
async function runAll(req: NextRequest) {
  const url = new URL(req.url);
  const week = Number(url.searchParams.get('week') || '1');
  const redirect = url.searchParams.get('redirect') === '1';

  // Build absolute URLs to your own API routes
  const base = `${url.origin}/api/compute`;

  const r1 = await fetch(`${base}/refresh-market?week=${week}`, {
    method: 'POST',
    cache: 'no-store',
  });
  const j1 = await r1.json().catch(() => ({}));

  const r2 = await fetch(`${base}/confidence?week=${week}`, {
    method: 'POST',
    cache: 'no-store',
  });
  const j2 = await r2.json().catch(() => ({}));

  if (redirect) {
    // hop back to the board once both are done
    return NextResponse.redirect(`${url.origin}/board?week=${week}`);
  }

  return NextResponse.json({
    ok: r1.ok && r2.ok,
    week,
    refresh_market: { status: r1.status, ...j1 },
    confidence:     { status: r2.status, ...j2 },
  });
}

// Allow both GET (clickable from browser) and POST
export async function GET(req: NextRequest)  { return runAll(req); }
export async function POST(req: NextRequest) { return runAll(req); }
