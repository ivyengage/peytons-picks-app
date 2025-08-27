export const runtime = 'nodejs';
export async function GET() {
  const url = process.env.DATABASE_URL || '';
  if (!url) return new Response(JSON.stringify({ ok:false, message: 'DATABASE_URL is missing' }), { status: 500 });
  try {
    const u = new URL(url);
    const host = u.hostname;
    const db = u.pathname.replace('/', '');
    return new Response(JSON.stringify({ ok:true, host, db }), { headers: { 'content-type': 'application/json' } });
  } catch (e:any) {
    return new Response(JSON.stringify({ ok:false, message: 'DATABASE_URL malformed', valueSample: url.slice(0, 24) + '...' }), { status: 500 });
  }
}
