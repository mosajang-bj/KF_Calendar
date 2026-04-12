// api/image.js — Vercel Serverless Function (CommonJS)
// 번장 이미지 프록시: hotlink protection 우회용

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).end();
  }

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url 파라미터 필요' });

  // 번장 이미지 도메인만 허용
  let parsed;
  try { parsed = new URL(url); } catch { return res.status(400).json({ error: '잘못된 URL' }); }

  const ALLOWED_HOSTS = ['media.bunjang.co.kr', 'media1.bunjang.co.kr', 'media2.bunjang.co.kr'];
  if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
    return res.status(403).json({ error: '허용되지 않은 도메인' });
  }

  try {
    const upstream = await fetch(url, {
      headers: {
        'Referer': 'https://bunjang.co.kr/',
        'User-Agent': 'Mozilla/5.0 (compatible; BunjangGlobal/1.0)',
      },
    });
    if (!upstream.ok) return res.status(upstream.status).end();

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await upstream.arrayBuffer());

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).send(buffer);
  } catch (err) {
    return res.status(502).json({ error: '이미지 로드 실패', detail: err.message });
  }
};
