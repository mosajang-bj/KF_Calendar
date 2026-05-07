// scripts/insert-shows.js
// Local script to fetch & insert music show lineups into Supabase
// Usage: node scripts/insert-shows.js

const SUPA_URL = 'https://kzffotlfdtubkbxsjqiv.supabase.co';
// service_role key - required for writes
const SUPA_SERVICE_KEY = process.env.SUPA_SERVICE_KEY;

const IMBC_PAGE_SIZE = 50;

const SHOWS = [
  { name: 'music_core',    programId: '1000788100000100000' }, // 음악중심
  { name: 'show_champion', programId: '1003864100000100000' }, // 쇼챔피언
];

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
};

function parseArtists(contentTitle) {
  if (!contentTitle) return [];
  return contentTitle.split(/\s*[·.]\s*/).map(s => s.trim()).filter(s => s.length > 0);
}

function mapToGroupIds(artists) {
  const ids = new Set();
  for (const a of artists) {
    const g = ARTIST_TO_GROUP[a];
    if (g) ids.add(g);
  }
  return Array.from(ids);
}

async function fetchAllEpisodes(programId) {
  const episodes = [];
  let page = 1;
  let total = null;
  while (true) {
    const url = `https://playvod.imbc.com/api/PreviewList?programId=${programId}&curPage=${page}&pageSize=${IMBC_PAGE_SIZE}`;
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

async function deleteAndInsert(rows) {
  // Delete existing rows for these (show_name, broad_date) pairs first
  // Then insert fresh — avoids 409 conflict issues
  const CHUNK = 50;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);

    // Try upsert with POST + merge-duplicates
    const res = await fetch(`${SUPA_URL}/rest/v1/music_show_lineups`, {
      method: 'POST',
      headers: {
        'apikey': SUPA_SERVICE_KEY,
        'Authorization': `Bearer ${SUPA_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(chunk),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`  Chunk ${i}-${i+chunk.length} 실패 (${res.status}): ${body}`);

      // Fallback: upsert one by one via DELETE + INSERT
      console.log(`  Fallback: 개별 삽입 시도...`);
      for (const row of chunk) {
        // Delete existing
        const delRes = await fetch(
          `${SUPA_URL}/rest/v1/music_show_lineups?show_name=eq.${encodeURIComponent(row.show_name)}&broad_date=eq.${row.broad_date}`,
          {
            method: 'DELETE',
            headers: {
              'apikey': SUPA_SERVICE_KEY,
              'Authorization': `Bearer ${SUPA_SERVICE_KEY}`,
            },
          }
        );
        // Insert new
        const insRes = await fetch(`${SUPA_URL}/rest/v1/music_show_lineups`, {
          method: 'POST',
          headers: {
            'apikey': SUPA_SERVICE_KEY,
            'Authorization': `Bearer ${SUPA_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify([row]),
          signal: AbortSignal.timeout(10000),
        });
        if (!insRes.ok) {
          const b = await insRes.text();
          console.error(`    ${row.broad_date} 실패: ${b}`);
        } else {
          inserted++;
        }
      }
    } else {
      inserted += chunk.length;
      process.stdout.write('.');
    }
  }
  return inserted;
}

async function syncShow(show) {
  console.log(`\n[${show.name}] 에피소드 수집 중...`);
  const episodes = await fetchAllEpisodes(show.programId);
  console.log(`  ${episodes.length}회차 수집완료`);

  const rows = episodes.map(ep => {
    const artists = parseArtists(ep.ContentTitle);
    const groups = mapToGroupIds(artists);
    return {
      show_name:      show.name,
      episode_number: ep.ContentNumber || null,
      broad_date:     (ep.BroadDate || '').slice(0, 10),
      groups,
      raw_title:      ep.ContentTitle || '',
      source:         'imbc_api',
    };
  }).filter(r => r.broad_date);

  console.log(`  유효 행: ${rows.length}개`);
  const inserted = await deleteAndInsert(rows);
  console.log(`\n  완료: ${inserted}/${rows.length}행 upsert`);
}

(async () => {
  for (const show of SHOWS) {
    try {
      await syncShow(show);
    } catch (err) {
      console.error(`[${show.name}] 오류:`, err.message);
    }
  }
  console.log('\n전체 완료!');
})();
