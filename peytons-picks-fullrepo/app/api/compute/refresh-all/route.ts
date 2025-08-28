// app/api/compute/refresh-all/route.ts
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET/POST /api/compute/refresh-all?week=1[&redirect=1]
 */
async function runAll(req: NextRequest) {
  const url = new URL(req.url);
  const week = Number(url.searchParams.get('week') || '1');
  const redirect = ['1','true'].includes((url.searchParams.get('redirect') || '').toLowerCase());

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
    return NextResponse.redirect(`${url.origin}/board?week=${week}`);
  }

  return NextResponse.json({
    ok: r1.ok && r2.ok,
    week,
    refresh_market: { status: r1.status, ...j1 },
    confidence:     { status: r2.status, ...j2 },
  });
}

export async function GET(req: NextRequest)  { return runAll(req); }
export async function POST(req: NextRequest) { return runAll(req); }
