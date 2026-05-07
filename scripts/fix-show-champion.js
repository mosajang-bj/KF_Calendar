// scripts/fix-show-champion.js
// 쇼챔피언 raw_title 재파싱 → groups 업데이트
// 형식: "Show Champion (쇼 챔피언) - CRAVITY, TWS (투어스), NEXZ, 82MAJOR"

const SUPA_URL = 'https://kzffotlfdtubkbxsjqiv.supabase.co';
const SUPA_SERVICE_KEY = process.env.SUPA_SERVICE_KEY;

const ARTIST_TO_GROUP = {
  'BTS': 'bts', '방탄소년단': 'bts', 'RM': 'bts', 'Jin': 'bts', '진': 'bts',
  'SUGA': 'bts', '슈가': 'bts', 'j-hope': 'bts', 'j-Hope': 'bts',
  'Jimin': 'bts', '지민': 'bts', 'V': 'bts', '뷔': 'bts',
  'Jung Kook': 'bts', 'Jungkook': 'bts', '정국': 'bts',
  'SEVENTEEN': 'seventeen', '세븐틴': 'seventeen',
  'ENHYPEN': 'enhypen', '엔하이픈': 'enhypen',
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
  // 추가
  'Kep1er': 'kep1er', 'KEP1ER': 'kep1er', '케플러': 'kep1er',
  'B1A4': 'b1a4',
  'SOOJIN': 'soojin',
  'CIX': 'cix',
  'DAYOUNG': 'dayoung', 'DAYOUNG(청하)': 'chunga',
  'AMPERS&ONE': 'ampersandone', '앰퍼샌드원': 'ampersandone',
  '82MAJOR': '82major',
};

// 쇼챔피언 raw_title 파싱:
// "Show Champion (쇼 챔피언) - CRAVITY, TWS (투어스), NEXZ, 82MAJOR"
// → 앞부분 제거 후 쉼표 split, 괄호 안 한국어 제거
function parseShowChampionTitle(raw) {
  if (!raw) return [];
  // " - " 이후만 취함
  const dashIdx = raw.indexOf(' - ');
  if (dashIdx === -1) return [];
  let artists = raw.slice(dashIdx + 3);
  // " 등" 같은 접미어 제거
  artists = artists.replace(/\s+등\s*$/, '').trim();
  return artists
    .split(',')
    .map(s => {
      // 괄호 안 내용 제거: "TWS (투어스)" → "TWS"
      return s.replace(/\s*\([^)]*\)/g, '').trim();
    })
    .filter(s => s.length > 0);
}

function mapToGroupIds(artists) {
  const ids = new Set();
  for (const a of artists) {
    const g = ARTIST_TO_GROUP[a];
    if (g) ids.add(g);
  }
  return Array.from(ids);
}

async function fetchAllShowChampion() {
  const rows = [];
  let page = 1;
  const limit = 1000;
  while (true) {
    const res = await fetch(
      `${SUPA_URL}/rest/v1/music_show_lineups?show_name=eq.show_champion&select=id,broad_date,raw_title&limit=${limit}&offset=${(page-1)*limit}`,
      {
        headers: {
          'apikey': SUPA_SERVICE_KEY,
          'Authorization': `Bearer ${SUPA_SERVICE_KEY}`,
        }
      }
    );
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    rows.push(...data);
    if (data.length < limit) break;
    page++;
  }
  return rows;
}

(async () => {
  console.log('쇼챔피언 rows 불러오는 중...');
  const rows = await fetchAllShowChampion();
  console.log(`총 ${rows.length}행`);

  // 샘플 파싱 확인
  console.log('\n[파싱 샘플]');
  rows.slice(0, 5).forEach(r => {
    const artists = parseShowChampionTitle(r.raw_title);
    const groups = mapToGroupIds(artists);
    console.log(`  ${r.broad_date} | ${r.raw_title}`);
    console.log(`    → artists: ${artists.join(', ')}`);
    console.log(`    → groups:  ${groups.join(', ') || '(없음)'}`);
  });

  // 각 row PATCH로 groups 업데이트
  let updated = 0, skipped = 0;
  for (const row of rows) {
    const artists = parseShowChampionTitle(row.raw_title);
    const groups = mapToGroupIds(artists);

    const res = await fetch(
      `${SUPA_URL}/rest/v1/music_show_lineups?id=eq.${row.id}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SUPA_SERVICE_KEY,
          'Authorization': `Bearer ${SUPA_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ groups }),
      }
    );
    if (res.ok) { updated++; process.stdout.write('.'); }
    else {
      const b = await res.text();
      console.error(`\n  ${row.broad_date} PATCH 실패: ${b}`);
      skipped++;
    }
  }
  console.log(`\n완료: ${updated}행 업데이트, ${skipped}행 실패`);

  // 결과 확인
  const check = await fetch(
    `${SUPA_URL}/rest/v1/music_show_lineups?show_name=eq.show_champion&groups=neq.%7B%7D&select=broad_date,groups,raw_title&order=broad_date.desc&limit=5`,
    { headers: { 'apikey': SUPA_SERVICE_KEY, 'Authorization': `Bearer ${SUPA_SERVICE_KEY}` } }
  );
  const sample = await check.json();
  console.log('\n[업데이트 결과 샘플]');
  sample.forEach(r => console.log(`  ${r.broad_date}: ${JSON.stringify(r.groups)} | ${r.raw_title}`));
})();
