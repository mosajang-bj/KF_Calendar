// api/sync-imbc.js
// iMBC PreviewList API → Supabase music_show_lineups upsert
// 수동 호출: GET /api/sync-imbc?secret=YOUR_SECRET
// 또는 Vercel Cron으로 매주 토요일 자동 실행 (vercel.json 참고)

const IMBC_PROGRAM_ID = '1000788100000100000'; // 쇼! 음악중심
const IMBC_PAGE_SIZE  = 50;
const SUPA_URL        = process.env.SUPA_URL  || 'https://zbnronyslswwbwdiuzjg.supabase.co';
const SUPA_SERVICE_KEY = process.env.SUPA_SERVICE_KEY; // service_role key (환경변수 필수)
const SYNC_SECRET     = process.env.SYNC_SECRET || '';

// ── ContentTitle 파싱: "휘인 . 박지훈 . LE SSERAFIM ..." → 배열
function parseArtists(contentTitle) {
  if (!contentTitle) return [];
  return contentTitle
    .split(/\s*[·.]\s*/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

// ── 아티스트 이름 → Bunjang 그룹 ID 매핑
// 정확히 매칭되는 것만 저장; 모르는 아이돌은 raw_title에서 확인 가능
const ARTIST_TO_GROUP = {
  // BTS
  'BTS': 'bts', '방탄소년단': 'bts', 'RM': 'bts', 'Jin': 'bts', '진': 'bts',
  'SUGA': 'bts', '슈가': 'bts', 'j-hope': 'bts', 'j-Hope': 'bts',
  'Jimin': 'bts', '지민': 'bts', 'V': 'bts', '뷔': 'bts',
  'Jung Kook': 'bts', 'Jungkook': 'bts', '정국': 'bts',
  // SEVENTEEN
  'SEVENTEEN': 'seventeen', '세븐틴': 'seventeen',
  // ENHYPEN
  'ENHYPEN': 'enhypen', '엔하이픈': 'enhypen',
  // --- 확장: 주요 K-pop 그룹 ---
  'aespa': 'aespa', 'AESPA': 'aespa',
  'IVE': 'ive',
  'LE SSERAFIM': 'lesserafim',
  'NewJeans': 'newjeans', 'NEWJEANS': 'newjeans',
  'TWICE': 'twice', '트와이스': 'twice',
  'BLACKPINK': 'blackpink', '블랙핑크': 'blackpink',
  'EXO': 'exo',
  'NCT': 'nct', 'NCT 127': 'nct127', 'NCT DREAM': 'nctdream', 'NCT WISH': 'nctwish',
  'WayV': 'wayv',
  'SUPER JUNIOR': 'superjunior', '슈퍼주니어': 'superjunior',
  'SHINee': 'shinee', '샤이니': 'shinee',
  'MONSTA X': 'monstax',
  'ASTRO': 'astro',
  'ATEEZ': 'ateez', '에이티즈': 'ateez',
  'Stray Kids': 'straykids', 'STRAY KIDS': 'straykids',
  'TXT': 'txt', 'TOMORROW X TOGETHER': 'txt', '투모로우바이투게더': 'txt',
  'BTOB': 'btob',
  'INFINITE': 'infinite', '인피니트': 'infinite',
  '2PM': '2pm',
  'GOT7': 'got7',
  'DAY6': 'day6',
  'ITZY': 'itzy', '있지': 'itzy',
  'NMIXX': 'nmixx',
  'tripleS': 'triples',
  'PLAVE': 'plave', '플레이브': 'plave',
  'ZEROBASEONE': 'zerobaseone', 'ZB1': 'zerobaseone',
  'BOYNEXTDOOR': 'boynextdoor',
  'TWS': 'tws',
  'KISS OF LIFE': 'kissoflife',
  'QWER': 'qwer',
  'ILLIT': 'illit', '아일릿': 'illit',
  'BABYMONSTER': 'babymonster',
  '&TEAM': 'andteam',
  'INI': 'ini',
  'EVNNE': 'evnne', '이븐': 'evnne',
  'CRAVITY': 'cravity',
  'XIKERS': 'xikers',
  'DRIPPIN': 'drippin',
  'VERIVERY': 'verivery',
  'THE BOYZ': 'theboyz',
  'ONEUS': 'oneus', '원어스': 'oneus',
  'OMEGA X': 'omegax',
  '청하': 'chunga',
  '이채연': 'leechaeyeon',
  '휘인': 'wheein',
  '박지훈': 'parkjihoon',
  'NEXZ': 'nexz',
  'KATSEYE': 'katseye',
  'Xdinary Heroes': 'xdinaryheroes',
  'ALPHA DRIVE ONE': 'alphadriveone',
};

function mapToGroupIds(artists) {
  const ids = new Set();
  for (const a of artists) {
    const g = ARTIST_TO_GROUP[a];
    if (g) ids.add(g);
  }
  return Array.from(ids);
}

async function fetchAllEpisodes() {
  const episodes = [];
  let page = 1;
  let total = null;

  while (true) {
    const url = `https://playvod.imbc.com/api/PreviewList?programId=${IMBC_PROGRAM_ID}&curPage=${page}&pageSize=${IMBC_PAGE_SIZE}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`iMBC API HTTP ${res.status}`);
    const json = await res.json();

    if (total === null) total = json.TotalCount || 0;
    const list = json.ContList || [];
    if (list.length === 0) break;

    episodes.push(...list);
    if (episodes.length >= total) break;
    page++;
  }
  return episodes;
}

async function upsertToSupabase(rows) {
  const res = await fetch(`${SUPA_URL}/rest/v1/music_show_lineups`, {
    method: 'POST',
    headers: {
      'apikey': SUPA_SERVICE_KEY,
      'Authorization': `Bearer ${SUPA_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase upsert HTTP ${res.status}: ${body}`);
  }
  return res;
}

module.exports = async function handler(req, res) {
  // secret 체크 (SYNC_SECRET 미설정 시 누구나 호출 가능)
  const secret = req.query.secret || (req.headers.authorization || '').replace('Bearer ', '');
  if (SYNC_SECRET && SYNC_SECRET !== '' && secret !== SYNC_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!SUPA_SERVICE_KEY) {
    return res.status(500).json({ error: 'SUPA_SERVICE_KEY 환경변수 없음' });
  }

  try {
    console.log('[sync-imbc] 음악중심 회차 수집 시작...');
    const episodes = await fetchAllEpisodes();
    console.log(`[sync-imbc] 총 ${episodes.length}회차 수집`);

    const rows = episodes.map(ep => {
      const artists = parseArtists(ep.ContentTitle);
      const groupIds = mapToGroupIds(artists);
      return {
        show_name:      'music_core',
        episode_number: ep.ContentNumber || null,
        broad_date:     ep.BroadDate,          // "YYYY-MM-DD"
        groups:         groupIds,
        raw_title:      ep.ContentTitle || '',
        source:         'imbc_api',
      };
    }).filter(r => r.broad_date); // 날짜 없는 항목 제외

    // 50개씩 나눠서 upsert (Supabase 요청 크기 제한 대비)
    const CHUNK = 50;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await upsertToSupabase(rows.slice(i, i + CHUNK));
    }

    console.log(`[sync-imbc] Supabase upsert 완료 (${rows.length}행)`);
    return res.status(200).json({
      ok: true,
      synced: rows.length,
      episodes: rows.slice(0, 5), // 샘플 5개 반환
    });
  } catch (err) {
    console.error('[sync-imbc] 오류:', err.message, err.stack);
    return res.status(500).json({ error: err.message, stack: err.stack, hasSupa: !!SUPA_SERVICE_KEY });
  }
};
