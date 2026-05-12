// api/sync-shows.js
// 매일 오전 9시(KST) Vercel Cron으로 자동 실행
// 역할:
//   1. 오늘~다음달 말까지 쇼챔(수), 음악중심(토) 날짜 뼈대 INSERT (없으면)
//   2. iMBC API에서 최근 에피소드 가져와 groups/raw_title 업데이트

const SUPA_URL         = 'https://kzffotlfdtubkbxsjqiv.supabase.co';
const SUPA_SERVICE_KEY = process.env.SUPA_SERVICE_KEY;
const SYNC_SECRET      = process.env.SYNC_SECRET || '';

const IMBC = 'https://playvod.imbc.com/api/PreviewList';
const SHOWS_IMBC = [
  { show_name: 'music_core',    programId: '1000788100000100000', dayOfWeek: 6 }, // 토
  { show_name: 'show_champion', programId: '1003864100000100000', dayOfWeek: 3 }, // 수
];

// ── 아티스트 → 그룹ID 매핑
const ARTIST_TO_GROUP = {
  'BTS':'bts','방탄소년단':'bts','RM':'bts','Jin':'bts','진':'bts',
  'SUGA':'bts','슈가':'bts','j-hope':'bts','j-Hope':'bts',
  'Jimin':'bts','지민':'bts','V':'bts','뷔':'bts',
  'Jung Kook':'bts','Jungkook':'bts','정국':'bts',
  'SEVENTEEN':'seventeen','세븐틴':'seventeen',
  'ENHYPEN':'enhypen','엔하이픈':'enhypen',
  'aespa':'aespa','AESPA':'aespa',
  'IVE':'ive','아이브':'ive',
  'LE SSERAFIM':'lesserafim','르세라핌':'lesserafim',
  'NewJeans':'newjeans','NEWJEANS':'newjeans','뉴진스':'newjeans',
  'TWICE':'twice','트와이스':'twice',
  'BLACKPINK':'blackpink','블랙핑크':'blackpink',
  'EXO':'exo',
  'NCT':'nct','NCT 127':'nct127','NCT DREAM':'nctdream','NCT WISH':'nctwish',
  'WayV':'wayv',
  'SUPER JUNIOR':'superjunior','슈퍼주니어':'superjunior',
  'SHINee':'shinee','샤이니':'shinee',
  'MONSTA X':'monstax',
  'ASTRO':'astro',
  'ATEEZ':'ateez','에이티즈':'ateez',
  'Stray Kids':'straykids','STRAY KIDS':'straykids',
  'TXT':'txt','TOMORROW X TOGETHER':'txt','투모로우바이투게더':'txt',
  'BTOB':'btob','INFINITE':'infinite','인피니트':'infinite',
  '2PM':'2pm','GOT7':'got7','DAY6':'day6',
  'ITZY':'itzy','있지':'itzy','NMIXX':'nmixx',
  'tripleS':'triples',
  'PLAVE':'plave','플레이브':'plave',
  'ZEROBASEONE':'zerobaseone','ZB1':'zerobaseone','제로베이스원':'zerobaseone',
  'BOYNEXTDOOR':'boynextdoor','보이넥스트도어':'boynextdoor',
  'TWS':'tws','투어스':'tws',
  'KISS OF LIFE':'kissoflife',
  'QWER':'qwer',
  'ILLIT':'illit','아일릿':'illit',
  'BABYMONSTER':'babymonster','베이비몬스터':'babymonster',
  '&TEAM':'andteam','앤팀':'andteam',
  'INI':'ini',
  'EVNNE':'evnne','이븐':'evnne',
  'CRAVITY':'cravity','크래비티':'cravity',
  'XIKERS':'xikers','자이커스':'xikers',
  'DRIPPIN':'drippin','VERIVERY':'verivery',
  'THE BOYZ':'theboyz','더보이즈':'theboyz',
  'ONEUS':'oneus','원어스':'oneus',
  '청하':'chunga','CHUNG HA':'chunga',
  '이채연':'leechaeyeon','휘인':'wheein','WHEEIN':'wheein',
  '박지훈':'parkjihoon',
  'NEXZ':'nexz','넥스지':'nexz',
  'KATSEYE':'katseye',
  'Xdinary Heroes':'xdinaryheroes',
  'ALPHA DRIVE ONE':'alphadriveone',
  'Kep1er':'kep1er','케플러':'kep1er',
  '82MAJOR':'82major',
  'AMPERS&ONE':'ampersandone','앰퍼샌드원':'ampersandone',
  'SOOJIN':'soojin',
  'SHOWNU X HYUNGWON':'monstax',
  'PENTAGON':'pentagon','펜타곤':'pentagon',
  '(G)I-DLE':'gidle','여자아이들':'gidle',
  'MAMAMOO':'mamamoo','마마무':'mamamoo',
  'Red Velvet':'redvelvet','레드벨벳':'redvelvet',
};

function mapArtists(names) {
  const ids = new Set();
  for (const n of names) {
    const g = ARTIST_TO_GROUP[n];
    if (g) ids.add(g);
  }
  return [...ids];
}

function dKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// since 날짜부터 다음달 말일까지 특정 요일의 날짜 목록 (기본: 30일 전부터)
function datesForDay(dayOfWeek, sinceDate) {
  const start = sinceDate ? new Date(sinceDate) : new Date(Date.now() - 30 * 86400000);
  start.setHours(0,0,0,0);
  const today = new Date(); today.setHours(0,0,0,0);
  const end = new Date(today.getFullYear(), today.getMonth()+2, 0);

  const dates = [];
  const cur = new Date(start);
  while (cur <= end) {
    if (cur.getDay() === dayOfWeek) dates.push(dKey(new Date(cur)));
    cur.setDate(cur.getDate()+1);
  }
  return dates;
}

// iMBC에서 최근 에피소드 가져오기 (최대 3페이지)
async function fetchImbcEpisodes(programId) {
  const episodes = [];
  for (let page = 1; page <= 3; page++) {
    try {
      const res = await fetch(
        `${IMBC}?programId=${programId}&curPage=${page}&pageSize=50`,
        { signal: AbortSignal.timeout(15000) }
      );
      if (!res.ok) break;
      const data = await res.json();
      const list = data?.ContList || [];
      if (!list.length) break;
      episodes.push(...list);
    } catch { break; }
  }
  return episodes;
}

// 음악중심 파싱: "휘인 . 박지훈 . LE SSERAFIM ..."
function parseMusicCore(ep) {
  const raw = ep.ContentTitle || ep.contentTitle || '';
  const artists = raw.split(/\s*[·.]\s*/).map(s=>s.trim()).filter(s=>s && s !== 'EVNNE(이븐)'.replace(/\([^)]*\)/g,'').trim());
  // 괄호 안 한국어 제거
  const cleaned = artists.map(s => s.replace(/\s*\([^)]*\)/g,'').trim()).filter(Boolean);
  return { raw, artists: cleaned };
}

// 쇼챔피언 파싱: "Show Champion (쇼 챔피언) - CRAVITY, TWS (투어스), ..."
function parseShowChampion(ep) {
  const raw = ep.ContentTitle || ep.contentTitle || '';
  const dashIdx = raw.indexOf(' - ');
  if (dashIdx === -1) return { raw, artists: [] };
  const artists = raw.slice(dashIdx+3)
    .replace(/\s+등\s*$/, '')
    .split(',')
    .map(s => s.replace(/\s*\([^)]*\)/g,'').trim())
    .filter(Boolean);
  return { raw, artists };
}

// 방영일 추출
function parseBroadDate(ep) {
  const raw = ep.BroadDate || ep.broadDate || ep.BroadcastDate || '';
  if (!raw) return null;
  const m = raw.match(/(\d{4})[.\-/]?(\d{2})[.\-/]?(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

// Supabase helpers
async function supaHeaders() {
  return {
    'apikey': SUPA_SERVICE_KEY,
    'Authorization': `Bearer ${SUPA_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates,return=minimal',
  };
}

async function upsertRows(rows) {
  const CHUNK = 50;
  let ok = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i+CHUNK);
    const res = await fetch(`${SUPA_URL}/rest/v1/music_show_lineups`, {
      method: 'POST',
      headers: await supaHeaders(),
      body: JSON.stringify(chunk),
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) { ok += chunk.length; continue; }
    // fallback: 개별 upsert
    for (const row of chunk) {
      // 기존 행 확인
      const existing = await fetch(
        `${SUPA_URL}/rest/v1/music_show_lineups?show_name=eq.${row.show_name}&broad_date=eq.${row.broad_date}&select=id,groups,raw_title`,
        { headers: { apikey: SUPA_SERVICE_KEY, Authorization: `Bearer ${SUPA_SERVICE_KEY}` } }
      ).then(r=>r.json()).catch(()=>[]);

      if (existing.length > 0) {
        // 그룹/raw_title이 있는 행은 덮어쓰지 않음 (뼈대만 채우는 경우)
        if (row.source === 'date_rule' && existing[0].groups?.length > 0) { ok++; continue; }
        await fetch(`${SUPA_URL}/rest/v1/music_show_lineups?id=eq.${existing[0].id}`, {
          method: 'PATCH',
          headers: { apikey: SUPA_SERVICE_KEY, Authorization: `Bearer ${SUPA_SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ groups: row.groups, raw_title: row.raw_title, source: row.source }),
        });
        ok++;
      } else {
        const ins = await fetch(`${SUPA_URL}/rest/v1/music_show_lineups`, {
          method: 'POST',
          headers: { apikey: SUPA_SERVICE_KEY, Authorization: `Bearer ${SUPA_SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify([row]),
        });
        if (ins.ok) ok++;
      }
    }
  }
  return ok;
}

module.exports = async function handler(req, res) {
  // 크론 또는 시크릿 검증
  const authHeader = req.headers.authorization || '';
  const secret = req.query.secret || '';
  if (SYNC_SECRET && secret !== SYNC_SECRET && authHeader !== `Bearer ${SYNC_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const since = req.query.since || null; // 백필용: ?since=2026-05-08

  const log = [];
  let totalUpserted = 0;

  for (const show of SHOWS_IMBC) {
    // ① since~다음달말 범위의 날짜 뼈대 채우기 (기본: 30일 전부터)
    const futureDates = datesForDay(show.dayOfWeek, since);
    const skeletonRows = futureDates.map(d => ({
      show_name: show.show_name,
      broad_date: d,
      groups: [],
      raw_title: '',
      episode_number: null,
      source: 'date_rule',
    }));
    const skelOk = await upsertRows(skeletonRows);
    log.push(`[${show.show_name}] 뼈대 ${skelOk}/${futureDates.length}개`);

    // ② iMBC에서 최근 에피소드 가져와서 groups 업데이트
    const episodes = await fetchImbcEpisodes(show.programId);
    const dataRows = [];
    for (const ep of episodes) {
      const date = parseBroadDate(ep);
      if (!date) continue;
      const { raw, artists } = show.show_name === 'music_core'
        ? parseMusicCore(ep)
        : parseShowChampion(ep);
      const groups = mapArtists(artists);
      dataRows.push({
        show_name: show.show_name,
        broad_date: date,
        groups,
        raw_title: raw,
        episode_number: ep.EpisodeNo || ep.episodeNo || null,
        source: 'imbc',
      });
    }
    const dataOk = await upsertRows(dataRows);
    log.push(`[${show.show_name}] iMBC 업데이트 ${dataOk}/${dataRows.length}개`);
    totalUpserted += skelOk + dataOk;
  }

  return res.status(200).json({ ok: true, log, totalUpserted, ts: new Date().toISOString() });
};
