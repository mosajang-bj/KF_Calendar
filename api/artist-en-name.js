// api/artist-en-name.js
// 한국어 아티스트명 → 공식 영문명 변환
// 우선순위: 수동 맵 → Supabase 캐시 → Melon 검색 → 원본 유지

const SUPA_URL         = process.env.SUPA_URL || 'https://kzffotlfdtubkbxsjqiv.supabase.co';
const SUPA_SERVICE_KEY = process.env.SUPA_SERVICE_KEY;

// ── 수동 맵: 멜론에 영문명 없는 경우 직접 지정 ──
const MANUAL_EN_MAP = {
  '가비엔제이': 'Gavy NJ',
  '이예준': 'Lee Ye-jun',
  '크레이즈엔젤': "Craze'N'Angel",
  '오션': 'O3ean',
  '영파씨': 'YOUNG POSSE',
  '하이키': 'H1-KEY',
  '빌리': 'Billlie',
  '케플러': 'Kep1er',
  '앰퍼샌드원': 'AMPERS&ONE',
  '엑스디너리히어로즈': 'Xdinary Heroes',
  '보이넥스트도어': 'BOYNEXTDOOR',
  '제로베이스원': 'ZEROBASEONE',
  '투어스': 'TWS',
  '베이비몬스터': 'BABYMONSTER',
  '앤팀': '&TEAM',
  '더보이즈': 'THE BOYZ',
  '크래비티': 'CRAVITY',
};

function supaHeaders() {
  return {
    apikey: SUPA_SERVICE_KEY,
    Authorization: `Bearer ${SUPA_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
}

function isKorean(str) {
  return /[가-힣]/.test(str);
}

// Supabase 캐시 일괄 조회
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

// Supabase 캐시 저장 (중복 무시)
async function saveCache(entries) {
  if (!entries.length) return;
  await fetch(`${SUPA_URL}/rest/v1/artist_name_map`, {
    method: 'POST',
    headers: { ...supaHeaders(), Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(entries),
    signal: AbortSignal.timeout(8000),
  }).catch(() => {});
}

// Melon 검색으로 영문명 조회
// ARTISTNAME 필드가 "KIIRAS (키라스)" 형태면 영문 부분 추출
async function searchMelon(krName) {
  try {
    const q = encodeURIComponent(krName);
    const url = `https://www.melon.com/search/keyword/index.json?query=${q}&section=all&startIndex=1&pageSize=5`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.melon.com/',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const artists = data.ARTISTCONTENTS || [];

    for (const a of artists) {
      const raw = (a.ARTISTNAME || '').trim();
      // "KIIRAS (키라스)" → "KIIRAS"
      const m = raw.match(/^([A-Za-z0-9 &!.\-']+?)\s*[（\(][가-힣]/);
      if (m) return m[1].trim();

      // 순수 영문명인데 검색어(한국어)가 포함된 ARTISTNAMEDP에 있으면 사용
      if (/^[A-Za-z0-9 &!.\-']+$/.test(raw) && (a.ARTISTNAMEDP || '').includes(krName)) {
        return raw;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// 메인: 이름 목록 → { 원본: 영문명 } 맵 반환
async function resolveEnNames(names) {
  const koreanNames = [...new Set(names.filter(isKorean))];
  if (!koreanNames.length) {
    return Object.fromEntries(names.map(n => [n, n]));
  }

  // 1. 수동 맵 먼저 확인
  const resolved = {};
  const needLookup = [];
  for (const n of koreanNames) {
    if (MANUAL_EN_MAP[n]) resolved[n] = MANUAL_EN_MAP[n];
    else needLookup.push(n);
  }

  // 2. Supabase 캐시 조회
  const cached = await fetchCached(needLookup);
  const needSearch = [];
  for (const n of needLookup) {
    if (cached[n]) resolved[n] = cached[n];
    else needSearch.push(n);
  }

  // 3. Melon 검색 (캐시 미스)
  const toSave = [];
  await Promise.all(needSearch.map(async krName => {
    const enName = await searchMelon(krName);
    resolved[krName] = enName || krName;
    if (enName) toSave.push({ kr_name: krName, en_name: enName });
  }));

  // 4. 새로 찾은 것 Supabase에 저장
  if (toSave.length) await saveCache(toSave);

  // 5. 전체 이름 맵 반환 (영문은 그대로)
  return Object.fromEntries(names.map(n => [n, isKorean(n) ? (resolved[n] || n) : n]));
}

module.exports = { resolveEnNames, isKorean };
