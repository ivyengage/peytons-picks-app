// app/board/page.tsx
export const dynamic = 'force-dynamic';
import { getClient } from '../../lib/db';

type Row = {
  game_id: string;
  week: number;
  game_date: string | null;
  kickoff_local: string | null;
  home_team: string;
  away_team: string;
  favorite: string | null;
  underdog: string | null;
  spread: number | null;
  score: number | null;
  pick_side: 'favorite' | 'underdog' | null;
  cover_prob: number | null;
  reasons: any; // json or text
  consensus_spread: number | null;
  consensus_total: number | null;
};

function fmtNum(n: number | null | undefined) {
  if (n === null || n === undefined) return '—';
  return (Math.round(n * 10) / 10).toString();
}

export default async function BoardPage({ searchParams }: { searchParams?: Record<string, string> }) {
  const week = Number(searchParams?.week ?? '1');
  const client = await getClient();
  try {
    const res = await client.query<Row>(
      `
      SELECT
        g.game_id, g.week, g.game_date, g.kickoff_local,
        g.home_team, g.away_team, g.favorite, g.underdog, g.spread,
        c.score, c.pick_side, c.cover_prob, c.reasons,
        m.consensus_spread, m.consensus_total
      FROM games g
      LEFT JOIN confidence c ON c.game_id = g.game_id
      LEFT JOIN market_now m ON m.game_id = g.game_id
      WHERE g.week = $1
      ORDER BY (c.score IS NULL) ASC, c.score DESC, g.game_id
      `,
      [week]
    );

    const rows = res.rows.map((r) => {
      // normalize reasons field (it can be text or json)
      let reasonsArr: string[] = [];
      if (Array.isArray(r.reasons)) {
        reasonsArr = r.reasons as unknown as string[];
      } else if (typeof r.reasons === 'string' && r.reasons.trim()) {
        try {
          const parsed = JSON.parse(r.reasons);
          if (Array.isArray(parsed)) reasonsArr = parsed;
        } catch {
          // keep empty if not parseable
        }
      }
      return { ...r, reasons: reasonsArr };
    });

    const top10 = rows
      .filter((r) => r.score !== null && r.score !== undefined)
      .sort((a, b) => (b.score! - a.score!))
      .slice(0, 10);

    return (
      <main style={{ padding: '24px', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial' }}>
        <h1 style={{ marginBottom: 12 }}>Board</h1>
        <p style={{ marginBottom: 16 }}>Showing {rows.length} games (Top-10 by confidence).</p>

        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 24 }}>
          <h2 style={{ marginTop: 0 }}>Top 10</h2>
          <ol style={{ paddingLeft: 18, marginTop: 8 }}>
            {top10.map((g) => (
              <li key={g.game_id} style={{ marginBottom: 8 }}>
                <strong>
                  {g.pick_side === 'underdog' ? g.underdog ?? 'Dog' : g.favorite ?? 'Fav'}
                </strong>
                {' — '}
                {fmtNum(g.score)} (cover {g.cover_prob ? Math.round(g.cover_prob * 100) : '—'}%)
                {' — '}
                {g.away_team} @ {g.home_team}
                {' — '}
                {g.game_date ?? ''} {g.kickoff_local ?? ''}
              </li>
            ))}
          </ol>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr>
              {[
                'week', 'game_id', 'game_date', 'kickoff_local', 'home_team', 'away_team',
                'favorite', 'underdog', 'spread', 'market_now', 'score', 'pick_side', 'cover%', 'notes'
              ].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #e5e7eb' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.game_id}>
                <td style={{ padding: '8px', borderBottom: '1px solid #f3f4f6' }}>{g.week}</td>
                <td style={{ padding: '8px', borderBottom: '1px solid #f3f4f6' }}>{g.game_id}</td>
                <td style={{ padding: '8px', borderBottom: '1px solid #f3f4f6' }}>{g.game_date ?? '—'}</td>
                <td style={{ padding: '8px', borderBottom: '1px solid #f3f4f6' }}>{g.kickoff_local ?? '—'}</td>
                <td style={{ padding: '8px', borderBottom: '1px solid #f3f4f6' }}>{g.home_team}</td>
                <td style={{ padding: '8px', borderBottom: '1px solid #f3f4f6' }}>{g.away_team}</td>
                <td style={{ padding: '8px', borderBottom: '1px solid #f3f4f6' }}>{g.favorite ?? '—'}</td>
                <td style={{ padding: '8px', borderBottom: '1px solid #f3f4f6' }}>{g.underdog ?? '—'}</td>
                <td style={{ padding: '8px', borderBottom: '1px solid #f3f4f6' }}>{fmtNum(g.spread)}</td>
                <td style={{ padding: '8px', borderBottom: '1px solid #f3f4f6' }}>
                  {g.consensus_spread != null || g.consensus_total != null
                    ? `${fmtNum(g.consensus_spread)} / ${fmtNum(g.consensus_total)}`
                    : '—'}
                </td>
                <td style={{ padding: '8px', borderBottom: '1px solid #f3f4f6' }}>{fmtNum(g.score)}</td>
                <td style={{ padding: '8px', borderBottom: '1px solid #f3f4f6' }}>{g.pick_side ?? '—'}</td>
                <td style={{ padding: '8px', borderBottom: '1px solid #f3f4f6' }}>
                  {g.cover_prob != null ? `${Math.round(g.cover_prob * 100)}%` : '—'}
                </td>
                <td style={{ padding: '8px', borderBottom: '1px solid #f3f4f6', maxWidth: 420 }}>
                  {(g.reasons as string[]).slice(0, 3).join(' · ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    );
  } catch (e: any) {
    // Render the error so we can see it in the page instead of a generic digest
    return (
      <pre style={{ padding: 16, whiteSpace: 'pre-wrap' }}>
        Board error: {e?.message || String(e)}
      </pre>
    );
  } finally {
    client.release();
  }
}
