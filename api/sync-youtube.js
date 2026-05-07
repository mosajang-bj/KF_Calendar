// api/sync-youtube.js
// 뮤직뱅크(KBS) + 인기가요(SBS) + 엠카운트다운(Mnet) YouTube 라인업 수집 → Supabase upsert
// Vercel Cron: 매일 0:00 UTC = 9:00 KST

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const SUPA_URL        = 'https://kzffotlfdtubkbxsjqiv.supabase.co';
const SUPA_SERVICE_KEY = process.env.SUPA_SERVICE_KEY;
const SYNC_SECRET     = process.env.SYNC_SECRET || '';
const YT              = 'https://www.googleapis.com/youtube/v3';

const SHOWS = [
  {
    show_name:   'music_bank',
    dayOfWeek:   5, // 금
    channelId:   'UC5BMQOsAB8hKUyHu9KI6yig', // KBS WORLD TV
    searchQ:     'This Week Music Bank',
    titleMatch:  t => t.includes('Week') && t.includes('Music Bank'),
    parseLineup: desc => {
      const m = desc.match(/lineup\s*:\s*([^\n\r]+)/i);
      if (!m) return [];
      return m[1].split(/[,&]/).map(s => s.replace(/and\s*/i, '').trim()).filter(s => s.length > 1);
    },
    parseDate: (title, publishedAt) => {
      const m = title.match(/(\d{2})(\d{2})(\d{2})\s*$/);
      if (m) return `20${m[1]}-${m[2]}-${m[3]}`;
      return nearestWeekday(publishedAt, 5);
    },
  },
  {
    show_name:   'inkigayo',
    dayOfWeek:   0, // 일
    channelId:   'UCfr3JYfElqMDbC30LpbXCJA', // SBS Inkigayo
    searchQ:     'Inkigayo line-up',
    titleMatch:  t => t.includes('Inkigayo') && (t.includes('line-up') || t.includes('lineup')),
    parseLineup: desc => {
      const artists = [];
      for (const line of desc.split('\n')) {
        const m = line.match(/^[-–]\s*(.+?)\s*[\[\(]/);
        if (m) {
          let name = m[1].trim();
          const enM = name.match(/\(([A-Z][A-Z0-9 &'.\-]+)\)/);
          if (enM) name = enM[1];
          artists.push(name);
        } else {
          const m2 = line.match(/^[-–]\s*([A-Za-z0-9 &'.()\-]+?)\s*\[/);
          if (m2) artists.push(m2[1].trim());
        }
      }
      return artists.filter(s => s.length > 1);
    },
    parseDate: (title, publishedAt) => {
      const m = title.match(/(\w+)\s+(\d+)(?:st|nd|rd|th)\s+at/);
      if (m) {
        const months = {January:1,February:2,March:3,April:4,May:5,June:6,July:7,August:8,September:9,October:10,November:11,December:12};
        const mo = months[m[1]];
        const yr = new Date(publishedAt).getFullYear();
        if (mo) return `${yr}-${String(mo).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}`;
      }
      return nearestWeekday(publishedAt, 0);
    },
  },
  {
    show_name:   'mcountdown',
    dayOfWeek:   4, // 목
    channelId:   'UCbD8EppRX3ZwJSou-TVo90A', // Mnet K-POP
    searchQ:     '엠카운트다운 라인업',
    titleMatch:  t => t.includes('라인업') && t.includes('엠카'),
    parseLineup: desc => {
      const artists = new Set();
      const SKIP = /^(COMEBACK|최초\s*공개|HOT\s*DEBUT|SPECIAL|MC\s|K-POP|달콤|스페셜|공연|K-|NEW\s|UNIT|솔로|STEP|1\.|2\.|3\.|①|②|③|✨|💗|🆕|M\s*COUNTDOWN|World\s|Every\s|매주|티빙)/i;
      for (const line of desc.split('\n')) {
        if (!line.includes('✶')) continue;
        for (const p of line.split('✶').map(s => s.trim())) {
          if (!p || p.length < 2 || SKIP.test(p)) continue;
          let name = p.replace(/\s*\([^)]+\)/g, '').trim();
          name = name.replace(/^(COMEBACK|최초\s*공개|HOT\s*DEBUT|SPECIAL\s*STAGE|솔로\s*퀸|청량|치명적\s*매력|다채로운\s*매력|와일드한\s*매력|글로벌\s*라틴\s*보이\s*그룹|소년美|당돌한\s*하이틴\s*걸|심쿵|스킬|킬러|청춘)\s*/i, '').trim();
          if (name.length > 1 && name.length < 40) artists.add(name);
        }
      }
      if (artists.size === 0) {
        for (const m of desc.matchAll(/#([A-Za-z가-힣0-9][A-Za-z가-힣0-9\s&.'_()\-]{1,30}?)(?=\s|$|#)/g)) {
          let name = m[1].trim();
          if (SKIP.test(name) || /^(엠카|엠넷|티빙|MCD|mcountdown)/i.test(name)) continue;
          name = name.replace(/\s*\([^)]+\)/g, '').trim();
          if (name.length > 1) artists.add(name);
        }
      }
      return Array.from(artists).filter(s => s.length > 1);
    },
    parseDate: (title, publishedAt) => {
      const epMatch = title.match(/EP\.(\d+)/i);
      if (epMatch) {
        const ep = parseInt(epMatch[1], 10);
        const base = new Date('2008-08-07');
        base.setDate(base.getDate() + (ep - 1) * 7);
        return `${base.getFullYear()}-${String(base.getMonth()+1).padStart(2,'0')}-${String(base.getDate()).padStart(2,'0')}`;
      }
      return nearestWeekday(publishedAt, 4);
    },
  },
];

const ARTIST_TO_GROUP = {
  'BTS':'bts','방탄소년단':'bts','RM':'bts','SUGA':'bts','j-hope':'bts','j-Hope':'bts',
  'Jimin':'bts','V':'bts','Jungkook':'bts','Jung Kook':'bts',
  'SEVENTEEN':'seventeen','세븐틴':'seventeen',
  'ENHYPEN':'enhypen','엔하이픈':'enhypen',
  'aespa':'aespa','에스파':'aespa',
  'IVE':'ive','아이브':'ive',
  'LE SSERAFIM':'lesserafim','르세라핌':'lesserafim',
  'NewJeans':'newjeans','뉴진스':'newjeans',
  'TWICE':'twice','트와이스':'twice',
  'BLACKPINK':'blackpink','블랙핑크':'blackpink',
  'EXO':'exo',
  'NCT 127':'nct127','NCT DREAM':'nctdream','NCT WISH':'nctwish','NCT':'nct',
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
  'ITZY':'itzy','있지':'itzy',
  'NMIXX':'nmixx',
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
  '이채연':'leechaeyeon',
  '휘인':'wheein','WHEEIN':'wheein',
  '박지훈':'parkjihoon',
  'NEXZ':'nexz','넥스지':'nexz',
  'KATSEYE':'katseye',
  'Xdinary Heroes':'xdinaryheroes',
  'ALPHA DRIVE ONE':'alphadriveone',
  'Kep1er':'kep1er','케플러':'kep1er',
  '82MAJOR':'82major',
  'AMPERS&ONE':'ampersandone','앰퍼샌드원':'ampersandone',
  'SOOJIN':'soojin','수진':'soojin',
  'PENTAGON':'pentagon','펜타곤':'pentagon',
  '(G)I-DLE':'gidle','여자아이들':'gidle','GIDLE':'gidle',
  'MAMAMOO':'mamamoo','마마무':'mamamoo',
  'Red Velvet':'redvelvet','레드벨벳':'redvelvet',
  'TREASURE':'treasure',
  'HWASA':'hwasa','화사':'hwasa',
  'YOUNG POSSE':'youngposse','영파씨':'youngposse',
  'KiiiKiii':'kiikikii',
  'SHOWNU X HYUNGWON':'monstax',
  'OMEGA X':'omegax',
};

function mapToGroupIds(artists) {
  const ids = new Set();
  const keys = Object.keys(ARTIST_TO_GROUP).sort((a, b) => b.length - a.length);
  for (const a of artists) {
    const g = ARTIST_TO_GROUP[a];
    if (g) { ids.add(g); continue; }
    for (const k of keys) {
      if (a.includes(k)) { ids.add(ARTIST_TO_GROUP[k]); break; }
    }
  }
  return Array.from(ids);
}

function nearestWeekday(isoStr, targetDay) {
  const d = new Date(isoStr);
  const diff = (targetDay - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function dKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function futureDatesForDay(dayOfWeek) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today.getFullYear(), today.getMonth() + 2, 0);
  const dates = [];
  const cur = new Date(today);
  while (cur <= end) {
    if (cur.getDay() === dayOfWeek) dates.push(dKey(new Date(cur)));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

async function ytGet(path) {
  const res = await fetch(`${YT}/${path}&key=${YOUTUBE_API_KEY}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`YT ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchLineupVideos(show, publishedAfter) {
  const videos = [];
  let pageToken = '';
  const q = encodeURIComponent(show.searchQ);
  const after = encodeURIComponent(publishedAfter);

  for (let page = 0; page < 5; page++) {
    let url = `search?part=snippet&type=video&channelId=${show.channelId}&q=${q}&order=date&maxResults=50&publishedAfter=${after}`;
    if (pageToken) url += `&pageToken=${pageToken}`;
    const data = await ytGet(url);
    const matched = (data.items || []).filter(i => show.titleMatch(i.snippet.title));
    videos.push(...matched);
    pageToken = data.nextPageToken || '';
    if (!pageToken || (data.items || []).length === 0) break;
  }
  return videos;
}

async function fetchDescriptions(videoIds) {
  const results = {};
  for (let i = 0; i < videoIds.length; i += 50) {
    const chunk = videoIds.slice(i, i + 50);
    const data = await ytGet(`videos?part=snippet&id=${chunk.join(',')}`);
    for (const item of data.items || []) {
      results[item.id] = item.snippet;
    }
  }
  return results;
}

async function upsertRows(rows) {
  if (rows.length === 0) return 0;
  const CHUNK = 50;
  let ok = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const res = await fetch(`${SUPA_URL}/rest/v1/music_show_lineups`, {
      method: 'POST',
      headers: {
        apikey: SUPA_SERVICE_KEY,
        Authorization: `Bearer ${SUPA_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(chunk),
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) { ok += chunk.length; continue; }
    for (const row of chunk) {
      const ins = await fetch(`${SUPA_URL}/rest/v1/music_show_lineups`, {
        method: 'POST',
        headers: {
          apikey: SUPA_SERVICE_KEY,
          Authorization: `Bearer ${SUPA_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify([row]),
        signal: AbortSignal.timeout(10000),
      });
      if (ins.ok) ok++;
    }
  }
  return ok;
}

module.exports = async function handler(req, res) {
  const secret = req.query.secret || (req.headers.authorization || '').replace('Bearer ', '');
  if (SYNC_SECRET && secret !== SYNC_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!SUPA_SERVICE_KEY) return res.status(500).json({ error: 'SUPA_SERVICE_KEY 없음' });
  if (!YOUTUBE_API_KEY)  return res.status(500).json({ error: 'YOUTUBE_API_KEY 없음' });

  // 60일 전부터 검색 (최근 데이터 + 약간의 여유)
  const publishedAfter = new Date(Date.now() - 60 * 86400 * 1000).toISOString();

  const log = [];
  let totalUpserted = 0;

  for (const show of SHOWS) {
    try {
      // ① 미래 날짜 뼈대 생성
      const futureDates = futureDatesForDay(show.dayOfWeek);
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

      // ② YouTube 라인업 영상 수집 및 업데이트
      const videos = await fetchLineupVideos(show, publishedAfter);
      if (videos.length === 0) {
        log.push(`[${show.show_name}] YouTube 영상 없음`);
        totalUpserted += skelOk;
        continue;
      }

      const ids = videos.map(v => v.id?.videoId || v.id).filter(Boolean);
      const snippets = await fetchDescriptions(ids);

      const dataRows = [];
      const seen = new Set();

      for (const video of videos) {
        const vid = video.id?.videoId || video.id;
        const snippet = snippets[vid];
        if (!snippet) continue;

        const title = snippet.title;
        const desc  = snippet.description || '';
        const broadDate = show.parseDate(title, snippet.publishedAt);
        if (!broadDate || seen.has(broadDate)) continue;
        seen.add(broadDate);

        const artists = show.parseLineup(desc);
        const groups  = mapToGroupIds(artists);

        dataRows.push({
          show_name: show.show_name,
          broad_date: broadDate,
          groups,
          raw_title: artists.join(' · '),
          episode_number: null,
          source: 'youtube_api',
        });
      }

      const dataOk = await upsertRows(dataRows);
      log.push(`[${show.show_name}] YouTube 업데이트 ${dataOk}/${dataRows.length}개`);
      totalUpserted += skelOk + dataOk;
    } catch (err) {
      log.push(`[${show.show_name}] 오류: ${err.message}`);
    }
  }

  return res.status(200).json({ ok: true, log, totalUpserted, ts: new Date().toISOString() });
};
