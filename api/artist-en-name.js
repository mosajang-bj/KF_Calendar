// api/artist-en-name.js
// 한국어 아티스트명 → 공식 영문명 변환 (Supabase 캐시 + DuckDuckGo 검색)

const SUPA_URL         = process.env.SUPA_URL || 'https://kzffotlfdtubkbxsjqiv.supabase.co';
const SUPA_SERVICE_KEY = process.env.SUPA_SERVICE_KEY;

function supaHeaders() {
  return {
    apikey: SUPA_SERVICE_KEY,
    Authorization: `Bearer ${SUPA_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
}

// 한국어 포함 여부
function isKorean(str) {
  return /[가-힣]/.test(str);
}

// Supabase에서 캐시 일괄 조회
async function fetchCached(krNames) {
  if (!krNames.length) return {};
  const inList = krNames.map(n => `"${n.replace(/"/g, '\\"')}"`).join(',');
  const url = `${SUPA_URL}/rest/v1/artist_name_map?kr_name=in.(${encodeURIComponent(inList)})&select=kr_name,en_name`;
  try {
    const res = await fetch(url, { headers: supaHeaders(), signal: AbortSignal.timeout(8000) });
    if (!res.ok) return {};
    const rows = await res.json();
    const map = {};
    for (const r of rows) map[r.kr_name] = r.en_name;
    return map;
  } catch {
    return {};
  }
}

// Supabase에 캐시 저장 (중복 무시)
async function saveCache(entries) {
  if (!entries.length) return;
  await fetch(`${SUPA_URL}/rest/v1/artist_name_map`, {
    method: 'POST',
    headers: { ...supaHeaders(), Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(entries),
    signal: AbortSignal.timeout(8000),
  }).catch(() => {});
}

// DuckDuckGo Instant Answer API로 영문명 검색
async function searchEnName(krName) {
  try {
    const query = encodeURIComponent(`${krName} kpop official english name`);
    const url = `https://api.duckduckgo.com/?q=${query}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();

    // Heading이 영문이면 사용
    if (data.Heading && /^[A-Za-z0-9 &!.\-']+$/.test(data.Heading.trim())) {
      return data.Heading.trim();
    }

    // RelatedTopics에서 "ENGLISH NAME (한국어)" 패턴 추출
    for (const topic of (data.RelatedTopics || [])) {
      const text = topic.Text || '';
      const m = text.match(/^([A-Za-z0-9 &!.\-']{2,})\s*[(\（]/);
      if (m) return m[1].trim();
    }

    // AbstractText에서 추출
    const m2 = (data.AbstractText || '').match(/^([A-Za-z0-9 &!.\-']{2,})\s*[(\（]/);
    if (m2) return m2[1].trim();

    return null;
  } catch {
    return null;
  }
}

// 메인: 이름 목록 → { 원본: 영문명 } 맵 반환
// 영문 이름은 그대로, 한국어만 캐시→검색 순으로 처리
async function resolveEnNames(names) {
  const koreanNames = [...new Set(names.filter(isKorean))];
  if (!koreanNames.length) {
    return Object.fromEntries(names.map(n => [n, n]));
  }

  // 1. Supabase 캐시 일괄 조회
  const cached = await fetchCached(koreanNames);

  // 2. 캐시 미스 → DuckDuckGo 검색 (병렬)
  const missing = koreanNames.filter(n => !cached[n]);
  const toSave = [];

  await Promise.all(missing.map(async krName => {
    const enName = await searchEnName(krName);
    cached[krName] = enName || krName; // 검색 실패 시 원본 유지
    if (enName) toSave.push({ kr_name: krName, en_name: enName });
  }));

  // 3. 새로 찾은 것 캐시 저장
  if (toSave.length) await saveCache(toSave);

  // 4. 전체 이름 → 영문명 맵 반환
  return Object.fromEntries(names.map(n => [n, isKorean(n) ? (cached[n] || n) : n]));
}

module.exports = { resolveEnNames, isKorean };
