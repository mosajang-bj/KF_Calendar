// api/lineup-upsert.js
// admin.html 수동 입력 → service_role key로 music_show_lineups upsert
// POST /api/lineup-upsert  body: { show_name, broad_date, episode_number?, groups, raw_title }

const SUPA_URL         = 'https://kzffotlfdtubkbxsjqiv.supabase.co';
const SUPA_SERVICE_KEY = process.env.SUPA_SERVICE_KEY;
const SYNC_SECRET      = process.env.SYNC_SECRET || '';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'DELETE') {
    if (!SUPA_SERVICE_KEY) return res.status(500).json({ error: 'SUPA_SERVICE_KEY 없음' });
    // ?cleanup=1 : 오래된/잘못된 날짜 데이터 일괄 삭제
    if (req.query.cleanup === '1') {
      const auth = (req.headers.authorization || '').replace('Bearer ', '');
      const qs   = req.query.secret || '';
      if (SYNC_SECRET && auth !== SYNC_SECRET && qs !== SYNC_SECRET) {
        return res.status(401).json({ error: 'unauthorized' });
      }
      const hdrs = { apikey: SUPA_SERVICE_KEY, Authorization: `Bearer ${SUPA_SERVICE_KEY}`, Prefer: 'return=minimal' };
      const [r1, r2] = await Promise.all([
        fetch(`${SUPA_URL}/rest/v1/music_show_lineups?broad_date=lt.2020-01-01`, { method:'DELETE', headers: hdrs, signal: AbortSignal.timeout(30000) }),
        fetch(`${SUPA_URL}/rest/v1/music_show_lineups?broad_date=gt.2027-12-31`, { method:'DELETE', headers: hdrs, signal: AbortSignal.timeout(30000) }),
      ]);
      return res.status(200).json({ ok: true, old: r1.ok, future: r2.ok });
    }
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id 필수' });
    const delRes = await fetch(`${SUPA_URL}/rest/v1/music_show_lineups?id=eq.${id}`, {
      method: 'DELETE',
      headers: { apikey: SUPA_SERVICE_KEY, Authorization: `Bearer ${SUPA_SERVICE_KEY}`, Prefer: 'return=minimal' },
      signal: AbortSignal.timeout(10000),
    });
    if (!delRes.ok) return res.status(delRes.status).json({ error: await delRes.text() });
    return res.status(200).json({ ok: true });
  }
  if (req.method === 'PATCH') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id 필수' });
    if (!SUPA_SERVICE_KEY) return res.status(500).json({ error: 'SUPA_SERVICE_KEY 없음' });
    const body = req.body;
    const raw_title = (body.raw_title && body.raw_title.includes(' - '))
      ? body.raw_title
      : `${body.show_name} - ${body.raw_title || ''}`;
    const patchRes = await fetch(`${SUPA_URL}/rest/v1/music_show_lineups?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        apikey: SUPA_SERVICE_KEY,
        Authorization: `Bearer ${SUPA_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        show_name:      body.show_name,
        broad_date:     body.broad_date,
        episode_number: body.episode_number || null,
        groups:         body.groups || [],
        raw_title,
        source: 'manual',
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!patchRes.ok) return res.status(patchRes.status).json({ error: await patchRes.text() });
    return res.status(200).json({ ok: true, updated: true });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST/PATCH/DELETE only' });

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
    // raw_title은 반드시 "show_name - artist1, artist2, ..." 포맷이어야 파싱됨
    raw_title: (body.raw_title && body.raw_title.includes(' - '))
      ? body.raw_title
      : `${body.show_name} - ${body.raw_title || ''}`,
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

  if (upRes.status === 409 || upRes.status === 400) {
    // 중복 시 PATCH로 업데이트
    const patchRes = await fetch(
      `${SUPA_URL}/rest/v1/music_show_lineups?show_name=eq.${encodeURIComponent(row.show_name)}&broad_date=eq.${row.broad_date}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SUPA_SERVICE_KEY,
          Authorization: `Bearer ${SUPA_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ groups: row.groups, raw_title: row.raw_title, episode_number: row.episode_number, source: 'manual' }),
        signal: AbortSignal.timeout(15000),
      }
    );
    if (!patchRes.ok) return res.status(patchRes.status).json({ error: await patchRes.text() });
    return res.status(200).json({ ok: true, updated: true });
  }

  if (!upRes.ok) {
    const txt = await upRes.text();
    return res.status(upRes.status).json({ error: txt });
  }
  return res.status(200).json({ ok: true });
};
