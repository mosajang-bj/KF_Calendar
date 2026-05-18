// api/sync-naver.js
// 전체 5개 음악방송 — Naver 회차정보 탭 크롤링 → Supabase upsert (최우선 소스)
// Vercel Cron: 0 0 * * * (매일 09:00 KST)

const { resolveEnNames } = require('./artist-en-name');

const SUPA_URL         = 'https://kzffotlfdtubkbxsjqiv.supabase.co';
const SUPA_SERVICE_KEY = process.env.SUPA_SERVICE_KEY;
const SYNC_SECRET      = process.env.SYNC_SECRET || '';
const TG_BOT_TOKEN     = process.env.TG_BOT_TOKEN || '';
const TG_CHAT_ID       = process.env.TG_CHAT_ID || '';

// os: Naver 내부 프로그램 ID (회차정보 탭 URL에서 확인)
// descFormat: 'dt_dd' = <dt>출연</dt><dd>..., 'span_desc' = <span class="desc _text">...
const SHOWS_NAVER = [
  { show_name: 'music_bank',    dayOfWeek: 5, label: '뮤직뱅크',    navOs: '659774', navQuery: '뮤직뱅크' },
  { show_name: 'show_champion', dayOfWeek: 3, label: '쇼챔피언',    navOs: '669613', navQuery: '쇼 챔피언' },
  { show_name: 'music_core',    dayOfWeek: 6, label: '음악중심',    navOs: '658837', navQuery: '음악중심' },
  { show_name: 'mcountdown',    dayOfWeek: 4, label: '엠카운트다운', navOs: '659252', navQuery: '엠카운트다운' },
  { show_name: 'inkigayo',      dayOfWeek: 0, label: '인기가요',    navOs: '658960', navQuery: '인기가요', descFormat: 'span_desc' },
];

const ARTIST_TO_GROUP = {
  'BTS':'bts','방탄소년단':'bts','RM':'bts','Jin':'bts','진':'bts',
  'SUGA':'bts','j-hope':'bts','j-Hope':'bts',
  'Jimin':'bts','지민':'bts','V':'bts','뷔':'bts',
  'Jung Kook':'bts','Jungkook':'bts','정국':'bts',
  'SEVENTEEN':'seventeen','세븐틴':'seventeen',
  'ENHYPEN':'enhypen','엔하이픈':'enhypen',
  'aespa':'aespa','AESPA':'aespa','에스파':'aespa',
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
  'EVNNE':'evnne','이븐':'evnne','EVNNE(이븐)':'evnne',
  'CRAVITY':'cravity','크래비티':'cravity',
  'XIKERS':'xikers','자이커스':'xikers',
  'DRIPPIN':'drippin','VERIVERY':'verivery',
  'THE BOYZ':'theboyz','더보이즈':'theboyz',
  'ONEUS':'oneus','원어스':'oneus',
  'NEXZ':'nexz','넥스지':'nexz',
  'KATSEYE':'katseye',
  'Xdinary Heroes':'xdinaryheroes','엑스디너리히어로즈':'xdinaryheroes',
  'ALPHA DRIVE ONE':'alphadriveone',
  'Kep1er':'kep1er','케플러':'kep1er',
  '82MAJOR':'82major',
  'AMPERS&ONE':'ampersandone','앰퍼샌드원':'ampersandone',
  'SOOJIN':'soojin','수진':'soojin',
  'PENTAGON':'pentagon','펜타곤':'pentagon',
  '(G)I-DLE':'gidle','여자아이들':'gidle',
  'MAMAMOO':'mamamoo','마마무':'mamamoo',
  'Red Velvet':'redvelvet','레드벨벳':'redvelvet',
  'TREASURE':'treasure',
  'YOUNG POSSE':'youngposse','영파씨':'youngposse',
  'HWASA':'hwasa','화사':'hwasa',
  'ORBIT':'orbit','오르빗':'orbit',
  'B1A4':'b1a4',
  'AB6IX':'ab6ix',
  'P1Harmony':'p1harmony','P1HARMONY':'p1harmony',
  'EVERGLOW':'everglow',
  'H1-KEY':'h1key','하이키':'h1key',
  'KiiiKiii':'kiikikii',
  'Billlie':'billlie','빌리':'billlie',
  '82MAJOR':'82major',
  'YOUNITE':'younite','유나이트':'younite',
  'NAZE':'naze','네이즈':'naze',
  'UNCHILD':'unchild',
  'CORTIS':'cortis',
  'CrazAngel':'crazangel','크레이즈엔젤':'crazangel',
  'KIIRAS':'kiiras',
  'FLARE U':'flareu','플레어 유':'flareu',
  'H//PE Princess':'hpeprincess',
  'XngHan&Xoul':'xnghananxoul',
  '자두':'jadu',
  '차동협':'chadonghyup',
};

function mapArtists(names) {
  const ids = new Set();
  const keys = Object.keys(ARTIST_TO_GROUP).sort((a, b) => b.length - a.length);
  for (const n of names) {
    const g = ARTIST_TO_GROUP[n];
    if (g) { ids.add(g); continue; }
    for (const k of keys) {
      if (n.includes(k)) { ids.add(ARTIST_TO_GROUP[k]); break; }
    }
  }
  return [...ids];
}

function dKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function datesForDay(dayOfWeek, sinceDate) {
  // 오늘부터 다음 2주만 뼈대 생성 (불필요한 과거/먼 미래 row 방지)
  const today = new Date(); today.setHours(0,0,0,0);
  const start = sinceDate ? new Date(sinceDate) : today;
  start.setHours(0,0,0,0);
  const end = new Date(today);
  end.setDate(today.getDate() + 14);
  const dates = [];
  const cur = new Date(start);
  while (cur <= end) {
    if (cur.getDay() === dayOfWeek) dates.push(dKey(new Date(cur)));
    cur.setDate(cur.getDate()+1);
  }
  return dates;
}

// Naver 회차정보 탭 HTML 가져오기
// pkid=57 (음악 프로그램), os=프로그램별 ID
async function fetchNaverEpisodeTab(show) {
  const xCsa = encodeURIComponent(JSON.stringify({ pkid: '57', isOpen: false, tab: 'episode_info' }));
  const query = encodeURIComponent(show.navQuery);
  const url = `https://search.naver.com/search.naver?where=nexearch&sm=tab_etc&x_csa=${xCsa}&pkid=57&os=${show.navOs}&qvt=0&query=${query}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9',
      'Referer': 'https://www.naver.com/',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Naver HTTP ${res.status}`);
  return res.text();
}

// HTML에서 회차 데이터 파싱
// descFormat 'dt_dd':   <dt>출연</dt> <dd>[performers]</dd>  (뮤직뱅크·음악중심·엠카·쇼챔)
// descFormat 'span_desc': <span class="desc _text">aespa, NMIXX ... 등</span>  (인기가요)
function parseNaverEpisodes(html, descFormat = 'dt_dd') {
  const episodes = [];
  const seen = new Set();

  const sections = html.split('class="num_txt">');
  for (let i = 1; i < sections.length; i++) {
    const s = sections[i];

    const noM = s.match(/^(\d+)<\/span>회/);
    if (!noM) continue;
    const no = +noM[1];

    const dateM = s.match(/class="date_info">(\d{4})\.(\d{2})\.(\d{2})/);
    if (!dateM) continue;
    const date = `${dateM[1]}-${dateM[2]}-${dateM[3]}`;

    if (seen.has(date)) continue;

    let performers = [];

    if (descFormat === 'span_desc') {
      // 인기가요 포맷: <span class="desc _text">aespa, NMIXX, BOYNEXTDOOR 등</span>
      const descM = s.match(/class="desc _text">([^<]+)/);
      if (!descM) continue;
      performers = descM[1]
        .replace(/\s*등\s*$/, '')
        .split(',')
        .map(p => p.trim())
        .filter(p => p.length > 1 && p.length < 40);
    } else {
      // 기본 포맷: <dt>출연</dt> <dd>...</dd>
      const subM = s.match(/<dt>출연<\/dt>\s*<dd>([\s\S]*?)<\/dd>/);
      if (!subM) continue;

      let ddText = subM[1]
        .replace(/<a[^>]*>([^<]*)<\/a>/g, '$1')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      performers = ddText
        .split(',')
        .map(p => p.trim())
        .filter(p => p.length > 1 && p.length < 40);
    }

    if (performers.length > 0) {
      seen.add(date);
      episodes.push({ no, date, performers });
    }
  }

  return episodes;
}

// Supabase upsert (naver source는 기존 imbc/youtube_api 덮어쓰기)
async function upsertRows(rows) {
  if (!rows.length) return 0;
  const CHUNK = 50;
  let ok = 0;
  const hdrs = {
    apikey: SUPA_SERVICE_KEY,
    Authorization: `Bearer ${SUPA_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  };
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const res = await fetch(`${SUPA_URL}/rest/v1/music_show_lineups`, {
      method: 'POST', headers: hdrs, body: JSON.stringify(chunk),
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) { ok += chunk.length; continue; }
    for (const row of chunk) {
      const ex = await fetch(
        `${SUPA_URL}/rest/v1/music_show_lineups?show_name=eq.${row.show_name}&broad_date=eq.${row.broad_date}&select=id,source`,
        { headers: { apikey: SUPA_SERVICE_KEY, Authorization: `Bearer ${SUPA_SERVICE_KEY}` } }
      ).then(r => r.json()).catch(() => []);
      if (ex.length > 0) {
        if (row.source === 'date_rule' && ex[0].source !== 'date_rule') { ok++; continue; }
        await fetch(`${SUPA_URL}/rest/v1/music_show_lineups?id=eq.${ex[0].id}`, {
          method: 'PATCH',
          headers: { ...hdrs, Prefer: 'return=minimal' },
          body: JSON.stringify({ groups: row.groups, raw_title: row.raw_title, episode_number: row.episode_number, source: row.source }),
        });
        ok++;
      } else {
        const ins = await fetch(`${SUPA_URL}/rest/v1/music_show_lineups`, {
          method: 'POST', headers: hdrs, body: JSON.stringify([row]),
          signal: AbortSignal.timeout(10000),
        });
        if (ins.ok) ok++;
      }
    }
  }
  return ok;
}

// ── 텔레그램 노티 ──
async function sendTelegram(text) {
  if (!TG_BOT_TOKEN || !TG_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: 'HTML' }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    console.error('[sync-naver] TG 전송 실패:', e.message);
  }
}

// 이번 주 + 다음 주 방송일(월~일) 범위 반환
function thisAndNextWeekRange() {
  const now = new Date();
  // 이번 주 월요일
  const mon = new Date(now);
  mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  mon.setHours(0, 0, 0, 0);
  // 다음 주 일요일
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 13);
  return { from: dKey(mon), to: dKey(sun) };
}

// 이번 주/다음 주 방송별 lineup 건수를 Supabase에서 조회
async function fetchWeekCounts(from, to) {
  const url = `${SUPA_URL}/rest/v1/music_show_lineups` +
    `?broad_date=gte.${from}&broad_date=lte.${to}` +
    `&select=show_name,broad_date,groups,source`;
  const res = await fetch(url, {
    headers: { apikey: SUPA_SERVICE_KEY, Authorization: `Bearer ${SUPA_SERVICE_KEY}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Supabase fetch HTTP ${res.status}`);
  return res.json();
}

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization || '';
  const secret = req.query.secret || '';
  if (SYNC_SECRET && secret !== SYNC_SECRET && authHeader !== `Bearer ${SYNC_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!SUPA_SERVICE_KEY) return res.status(500).json({ error: 'SUPA_SERVICE_KEY 없음' });

  const since = req.query.since || null;
  const log = [];
  let totalUpserted = 0;

  for (const show of SHOWS_NAVER) {
    try {
      // ① 날짜 뼈대 (skeleton rows)
      const dates = datesForDay(show.dayOfWeek, since);
      const skelRows = dates.map(d => ({
        show_name: show.show_name, broad_date: d,
        groups: [], raw_title: '', episode_number: null, source: 'date_rule',
      }));
      const skelOk = await upsertRows(skelRows);
      log.push(`[${show.show_name}] 뼈대 ${skelOk}/${dates.length}개`);

      // ② Naver 회차정보 크롤링
      const html = await fetchNaverEpisodeTab(show);
      const episodes = parseNaverEpisodes(html, show.descFormat || 'dt_dd');

      if (episodes.length === 0) {
        log.push(`[${show.show_name}] Naver 에피소드 없음 (HTML ${html.length}자)`);
        totalUpserted += skelOk;
        continue;
      }

      // 한국어 performer명 → 공식 영문명 변환
      const allPerformers = [...new Set(episodes.flatMap(ep => ep.performers))];
      const enNameMap = await resolveEnNames(allPerformers);

      const dataRows = episodes.map(ep => {
        const enPerformers = ep.performers.map(p => enNameMap[p] || p);
        return {
          show_name: show.show_name,
          broad_date: ep.date,
          groups: mapArtists(ep.performers),
          raw_title: `${show.show_name} - ${enPerformers.join(', ')}`,
          episode_number: ep.no || null,
          source: 'naver',
        };
      });

      const dataOk = await upsertRows(dataRows);
      log.push(`[${show.show_name}] Naver 업데이트 ${dataOk}/${dataRows.length}개`);
      totalUpserted += skelOk + dataOk;

    } catch (err) {
      log.push(`[${show.show_name}] 오류: ${err.message}`);
    }
  }

  // ── 텔레그램 노티 ──
  // Cron 실행(Authorization 헤더 없음)이거나 ?notify=1 일 때만 전송
  const isCron = !req.headers.authorization && !req.query.secret;
  const forceNotify = req.query.notify === '1';
  if ((isCron || forceNotify) && TG_BOT_TOKEN && TG_CHAT_ID) {
    try {
      const { from, to } = thisAndNextWeekRange();
      const rows = await fetchWeekCounts(from, to);

      // 방송별 집계
      const counts = {};
      const warns = [];
      for (const show of SHOWS_NAVER) counts[show.show_name] = { total: 0, withLineup: 0 };
      for (const r of rows) {
        if (!counts[r.show_name]) continue;
        counts[r.show_name].total++;
        if (r.groups && r.groups.length > 0) counts[r.show_name].withLineup++;
      }

      // 로그에서 오류 줄 추출
      const errLines = log.filter(l => l.includes('오류') || l.includes('없음'));

      // 5개 이하 경고 (뼈대만 있고 출연진 없는 방송)
      for (const [show_name, c] of Object.entries(counts)) {
        if (c.withLineup <= 5) warns.push(`⚠️ <b>${show_name}</b>: 출연진 있는 일정 ${c.withLineup}개`);
      }

      const hasIssue = errLines.length > 0 || warns.length > 0;
      const icon = hasIssue ? '🚨' : '✅';
      const lines = [
        `${icon} <b>sync-naver 실행 완료</b> (${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })})`,
        `📊 총 upsert: ${totalUpserted}건 | 대상기간: ${from} ~ ${to}`,
        '',
      ];

      if (errLines.length > 0) {
        lines.push('❌ <b>크롤링 실패/없음:</b>');
        errLines.forEach(l => lines.push(`  ${l}`));
        lines.push('');
      }
      if (warns.length > 0) {
        lines.push('📉 <b>출연진 적은 방송 (≤5개):</b>');
        warns.forEach(w => lines.push(`  ${w}`));
        lines.push('');
      }

      lines.push('<b>방송별 현황:</b>');
      for (const [sn, c] of Object.entries(counts)) {
        const label = SHOWS_NAVER.find(s => s.show_name === sn)?.label || sn;
        lines.push(`  ${label}: 전체 ${c.total}회 / 출연진 ${c.withLineup}회`);
      }

      await sendTelegram(lines.join('\n'));
    } catch (notifyErr) {
      log.push(`[notify] 텔레그램 전송 오류: ${notifyErr.message}`);
    }
  }

  return res.status(200).json({ ok: true, log, totalUpserted, ts: new Date().toISOString() });
};
