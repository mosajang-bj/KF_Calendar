// api/lineup-upsert.js
// admin.html 수동 입력 → service_role key로 music_show_lineups upsert
// POST /api/lineup-upsert  body: { show_name, broad_date, episode_number?, groups, raw_title }

const SUPA_URL         = 'https://kzffotlfdtubkbxsjqiv.supabase.co';
const SUPA_SERVICE_KEY = process.env.SUPA_SERVICE_KEY;
const SYNC_SECRET      = process.env.SYNC_SECRET || '';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'DELETE') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id 필수' });
    const delRes = await fetch(`${SUPA_URL}/rest/v1/music_show_lineups?id=eq.${id}`, {
      method: 'DELETE',
      headers: {
        apikey: SUPA_SERVICE_KEY,
        Authorization: `Bearer ${SUPA_SERVICE_KEY}`,
        Prefer: 'return=minimal',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!delRes.ok) return res.status(delRes.status).json({ error: await delRes.text() });
    return res.status(200).json({ ok: true });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // 간단한 secret 체크 (SYNC_SECRET 미설정 시 열려있음)
  const auth = (req.headers.authorization || '').replace('Bearer ', '');
  const qs   = req.query.secret || '';
  if (SYNC_SECRET && auth !== SYNC_SECRET && qs !== SYNC_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (!SUPA_SERVICE_KEY) return res.status(500).json({ error: 'SUPA_SERVICE_KEY 없음' });

  const body = req.body;
  if (!body?.show_name || !body?.broad_date) {
    return res.status(400).json({ error: 'show_name, broad_date 필수' });
  }

  const row = {
    show_name:      body.show_name,
    broad_date:     body.broad_date,
    episode_number: body.episode_number || null,
    groups:         body.groups || [],
    raw_title:      body.raw_title || '',
    source:         'manual',
  };

  const upRes = await fetch(`${SUPA_URL}/rest/v1/music_show_lineups`, {
    method: 'POST',
    headers: {
      apikey:          SUPA_SERVICE_KEY,
      Authorization:   `Bearer ${SUPA_SERVICE_KEY}`,
      'Content-Type':  'application/json',
      Prefer:          'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(15000),
  });

  if (!upRes.ok) {
    const txt = await upRes.text();
    return res.status(upRes.status).json({ error: txt });
  }
  return res.status(200).json({ ok: true });
};
