export async function GET() {
  const body = { ok: true, app: process.env.APP_NAME || "Peyton's Picks" };
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}
