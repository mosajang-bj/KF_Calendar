// api/goods.js — Vercel Serverless Function (CommonJS)
// 그룹명 + 공방/역조공/공방포/사녹 키워드로 번장 검색 → 최신순 반환
// GET /api/goods?artist=방탄소년단&n=30

const BUNJANG_API = 'https://api.bunjang.co.kr/api/1/find_v2.json';
const KEYWORDS = ['공방포', '역조공', '공방', '사녹'];

// 상품명에 artist가 실제로 포함되는지 확인 (단어 경계 기준)
// EXO → 엑소(XO) 안에 있는 EXO를 오매칭하는 경우 방지
function nameMatchesArtist(productName, artist) {
  const name = productName.toLowerCase();
  const a = artist.toLowerCase();
  // 앞뒤가 영숫자/한글이 아닌 경계에서 매칭되어야 함
  const re = new RegExp(`(?<![\\w가-힣])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w가-힣])`, 'i');
  return re.test(productName);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const artist = (req.query.artist || '').trim();
  if (!artist) return res.status(400).json({ error: 'artist 파라미터 필요' });

  const n = Math.min(parseInt(req.query.n || '50', 10), 100);

  try {
    // 각 키워드로 검색 → 합치기
    const results = await Promise.allSettled(
      KEYWORDS.map(kw => {
        const q = encodeURIComponent(`${artist} ${kw}`);
        const url = `${BUNJANG_API}?q=${q}&order=date&n=${n}&page=0`;
        return fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(10000),
        }).then(r => r.ok ? r.json() : { list: [] });
      })
    );

    // 중복 제거 (pid 기준), 최신순 정렬
    const seen = new Set();
    const items = [];
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const p of (r.value.list || [])) {
        if (seen.has(p.pid)) continue;
        seen.add(p.pid);
        items.push({
          id:         p.pid,
          name:       p.name,
          price:      parseInt(p.price, 10) || 0,
          imageUrl:   p.product_image
            ? p.product_image.replace('{res}', '360')
            : '',
          updatedAt:  p.update_time || 0,
          status:     p.status, // '0'=판매중
        });
      }
    }

    // 판매중인 것만, artist명 실제 포함 확인, 최신순
    const live = items
      .filter(i => i.status === '0' && nameMatchesArtist(i.name, artist))
      .sort((a, b) => b.updatedAt - a.updatedAt);

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    return res.status(200).json({ artist, items: live });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
};
