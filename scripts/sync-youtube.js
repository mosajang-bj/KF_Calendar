// scripts/sync-youtube.js
// YouTube Data API로 공방 출연진 수집 → Supabase upsert
// Usage: YOUTUBE_API_KEY=xxx node scripts/sync-youtube.js
//
// 소스:
//   뮤직뱅크:    KBS WORLD TV (UC5BMQOsAB8hKUyHu9KI6yig) — "This Week on Music Bank"
//               description: "🎤 This week's lineup: GROUP1, GROUP2, GROUP3"
//   인기가요:    UCfr3JYfElqMDbC30LpbXCJA — "Episode XXXX - [Date] line-up of today's broadcast"
//               description: "- ARTIST [song]\n- ARTIST [song]"
//   엠카운트다운: Mnet K-POP (UCbD8EppRX3ZwJSou-TVo90A) — "알려주는 이번 주 엠카운트다운 라인업"
//               description: "ARTIST ✶ ARTIST ✶ ARTIST"

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const SUPA_URL         = 'https://kzffotlfdtubkbxsjqiv.supabase.co';
const SUPA_SERVICE_KEY = process.env.SUPA_SERVICE_KEY;

const YT = 'https://www.googleapis.com/youtube/v3';

// ─── 방송 설정 ───────────────────────────────────────
const SHOWS = [
  {
    show_name:  'music_bank',
    channelId:  'UC5BMQOsAB8hKUyHu9KI6yig', // KBS WORLD TV
    searchQ:    'This Week Music Bank',
    titleMatch: v => v.includes('Week') && v.includes('Music Bank'),
    parseLineup: desc => {
      // "🎤 This week's lineup: GROUP1, GROUP2, GROUP3"
      const m = desc.match(/lineup\s*:\s*([^\n\r]+)/i);
      if (!m) return [];
      return m[1].split(/[,&]/).map(s => s.replace(/and\s*/i,'').trim()).filter(s => s.length > 1);
    },
    // 영상 제목 끝에 날짜 코드: "260130" → 2026-01-30
    parseDate: (title, publishedAt) => {
      const m = title.match(/(\d{2})(\d{2})(\d{2})\s*$/);
      if (m) {
        const [,yy,mm,dd] = m;
        return `20${yy}-${mm}-${dd}`;
      }
      // publishedAt 기준 가장 가까운 금요일(방영일)
      return nearestWeekday(publishedAt, 5);
    },
  },
  {
    show_name:  'inkigayo',
    channelId:  'UCfr3JYfElqMDbC30LpbXCJA', // SBS Inkigayo lineup uploader
    searchQ:    'Inkigayo line-up',
    titleMatch: v => v.includes('Inkigayo') && (v.includes('line-up') || v.includes('lineup')),
    parseLineup: desc => {
      // "- ARTIST [song]" 형태 or "- ARTIST(한국명) [song]"
      const lines = desc.split('\n');
      const artists = [];
      for (const line of lines) {
        const m = line.match(/^[-–]\s*(.+?)\s*[\[\(]/);
        if (m) {
          // 영어명만 추출: "화사(HWASA)" → "HWASA", "다영 (DAYOUNG)" → "DAYOUNG"
          let name = m[1].trim();
          const enMatch = name.match(/\(([A-Z][A-Z0-9 &'.\-]+)\)/);
          if (enMatch) name = enMatch[1];
          artists.push(name);
        } else {
          // 괄호 없이 영어만: "- KISS OF LIFE [Who is she]"
          const m2 = line.match(/^[-–]\s*([A-Za-z0-9 &'.()\-]+?)\s*\[/);
          if (m2) artists.push(m2[1].trim());
        }
      }
      return artists.filter(s => s.length > 1);
    },
    parseDate: (title, publishedAt) => {
      // "Episode 1306 - April 12th at 3:20 PM KST"
      const m = title.match(/(\w+)\s+(\d+)(?:st|nd|rd|th)\s+at/);
      if (m) {
        const months = {January:1,February:2,March:3,April:4,May:5,June:6,July:7,August:8,September:9,October:10,November:11,December:12};
        const mo = months[m[1]];
        const yr = new Date(publishedAt).getFullYear();
        if (mo) return `${yr}-${String(mo).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}`;
      }
      return nearestWeekday(publishedAt, 0); // 일요일
    },
  },
  {
    show_name:  'mcountdown',
    channelId:  'UCbD8EppRX3ZwJSou-TVo90A', // Mnet K-POP
    searchQ:    '엠카운트다운 라인업',
    titleMatch: v => v.includes('라인업') && v.includes('엠카'),
    parseLineup: desc => {
      const artists = new Set();
      const SKIP = /^(COMEBACK|최초\s*공개|HOT\s*DEBUT|SPECIAL|MC\s|K-POP|달콤|스페셜|공연|K-|NEW\s|UNIT|솔로|STEP|1\.|2\.|3\.|①|②|③|✨|💗|🆕|M\s*COUNTDOWN|World\s|Every\s|매주|티빙)/i;

      // 형식 1: "ARTIST ✶ ARTIST ✶ ARTIST"
      const lines = desc.split('\n');
      for (const line of lines) {
        if (!line.includes('✶')) continue;
        const parts = line.split('✶').map(s => s.trim());
        for (const p of parts) {
          if (!p || p.length < 2) continue;
          if (SKIP.test(p)) continue;
          let name = p.replace(/\s*\([^)]+\)/g, '').trim(); // 괄호 제거
          name = name.replace(/^(COMEBACK|최초\s*공개|HOT\s*DEBUT|SPECIAL\s*STAGE|솔로\s*퀸|청량|치명적\s*매력|다채로운\s*매력|와일드한\s*매력|글로벌\s*라틴\s*보이\s*그룹|소년美|당돌한\s*하이틴\s*걸|심쿵|스킬|킬러|청춘)\s*/i, '').trim();
          if (name.length > 1 && name.length < 40) artists.add(name);
        }
      }

      // 형식 2: "#태그" 방식 (EP.922 이하)
      if (artists.size === 0) {
        const tagMatches = desc.matchAll(/#([A-Za-z가-힣0-9][A-Za-z가-힣0-9\s&.'_()\-]{1,30}?)(?=\s|$|#)/g);
        for (const m of tagMatches) {
          let name = m[1].trim();
          if (SKIP.test(name)) continue;
          if (/^(엠카|엠넷|티빙|MCD|mcountdown)/i.test(name)) continue;
          name = name.replace(/\s*\([^)]+\)/g, '').trim();
          if (name.length > 1) artists.add(name);
        }
      }

      return Array.from(artists).filter(s => s.length > 1);
    },
    parseDate: (title, publishedAt) => {
      // EP.927 기준 날짜 역산: EP.1 = 2012-03-01(목), 매주 목요일
      const epMatch = title.match(/EP\.(\d+)/i);
      if (epMatch) {
        const ep = parseInt(epMatch[1], 10);
        // EP.927 = 2026-05-07 기준 역산: EP.1 = 2008-08-07 (목)
        const base = new Date('2008-08-07');
        base.setDate(base.getDate() + (ep - 1) * 7);
        return `${base.getFullYear()}-${String(base.getMonth()+1).padStart(2,'0')}-${String(base.getDate()).padStart(2,'0')}`;
      }
      return nearestWeekday(publishedAt, 4); // 목요일
    },
  },
];

// ─── 날짜 유틸 ────────────────────────────────────────
// 업로드일 기준 가장 가까운 방송일 (앞뒤 모두 고려)
function nearestWeekday(isoStr, targetDay) {
  const d = new Date(isoStr);
  const dow = d.getDay();
  const fwd = (targetDay - dow + 7) % 7;
  const bwd = (dow - targetDay + 7) % 7;
  d.setDate(d.getDate() + (fwd <= bwd ? fwd : -bwd));
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ─── 아티스트 → 그룹 ID 매핑 ─────────────────────────
const ARTIST_TO_GROUP = {
  'BTS': 'bts', '방탄소년단': 'bts', 'RM': 'bts', 'SUGA': 'bts', 'j-hope': 'bts', 'j-Hope': 'bts',
  'Jimin': 'bts', 'V': 'bts', 'Jungkook': 'bts', 'Jung Kook': 'bts',
  'SEVENTEEN': 'seventeen', 'ENHYPEN': 'enhypen',
  'aespa': 'aespa', 'IVE': 'ive', 'LE SSERAFIM': 'lesserafim',
  'NewJeans': 'newjeans', 'TWICE': 'twice', 'BLACKPINK': 'blackpink',
  'EXO': 'exo', 'NCT 127': 'nct127', 'NCT DREAM': 'nctdream', 'NCT WISH': 'nctwish', 'NCT': 'nct',
  'WayV': 'wayv', 'SUPER JUNIOR': 'superjunior', 'SHINee': 'shinee',
  'MONSTA X': 'monstax', 'ATEEZ': 'ateez', 'Stray Kids': 'straykids', 'STRAY KIDS': 'straykids',
  'TXT': 'txt', 'TOMORROW X TOGETHER': 'txt', '투모로우바이투게더': 'txt',
  'BTOB': 'btob', '2PM': '2pm', 'GOT7': 'got7', 'DAY6': 'day6',
  'ITZY': 'itzy', 'NMIXX': 'nmixx', 'PLAVE': 'plave',
  'ZEROBASEONE': 'zerobaseone', 'ZB1': 'zerobaseone', 'BOYNEXTDOOR': 'boynextdoor',
  'TWS': 'tws', 'KISS OF LIFE': 'kissoflife', 'QWER': 'qwer',
  'ILLIT': 'illit', 'BABYMONSTER': 'babymonster', '&TEAM': 'andteam',
  'INI': 'ini', 'EVNNE': 'evnne', 'CRAVITY': 'cravity', 'XIKERS': 'xikers',
  'THE BOYZ': 'theboyz', 'ONEUS': 'oneus', 'tripleS': 'triples',
  'Kep1er': 'kep1er', 'KEP1ER': 'kep1er', '케플러': 'kep1er',
  'NEXZ': 'nexz', 'KATSEYE': 'katseye', 'Xdinary Heroes': 'xdinaryheroes',
  'ALPHA DRIVE ONE': 'alphadriveone', 'KickFlip': 'kickflip', 'TREASURE': 'treasure',
  'ASTRO': 'astro', 'INFINITE': 'infinite', 'OMEGA X': 'omegax',
  'B1A4': 'b1a4', 'DRIPPIN': 'drippin', 'VERIVERY': 'verivery',
  'HWASA': 'hwasa', '화사': 'hwasa', 'DAYOUNG': 'chunga',
  'AMPERS&ONE': 'ampersandone', '앰퍼샌드원': 'ampersandone',
  '82MAJOR': '82major', 'YOUNG POSSE': 'youngposse', '영파씨': 'youngposse',
  'Hearts2Hearts': 'hearts2hearts', 'MODYSSEY': 'modyssey',
  'KiiiKiii': 'kiikikii', 'UNCHILD': 'unchild', 'CORTIS': 'cortis',
  '코르티스': 'cortis',
};

function mapToGroupIds(artists) {
  const ids = new Set();
  for (const a of artists) {
    const g = ARTIST_TO_GROUP[a];
    if (g) ids.add(g);
  }
  return Array.from(ids);
}

// ─── YouTube API 유틸 ─────────────────────────────────
async function ytGet(path) {
  const res = await fetch(`${YT}/${path}&key=${YOUTUBE_API_KEY}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`YT API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchLineupVideos(show) {
  console.log(`\n[${show.show_name}] 영상 수집 중...`);
  const videos = [];
  let pageToken = '';
  let page = 0;

  while (page < 10) { // 최대 10페이지 (500개)
    const q = encodeURIComponent(show.searchQ);
    let url = `search?part=snippet&type=video&channelId=${show.channelId}&q=${q}&order=date&maxResults=50`;
    if (pageToken) url += `&pageToken=${pageToken}`;

    const data = await ytGet(url);
    const items = data.items || [];
    const matched = items.filter(i => show.titleMatch(i.snippet.title));
    videos.push(...matched);

    pageToken = data.nextPageToken || '';
    if (!pageToken || items.length === 0) break;
    page++;
  }

  console.log(`  ${videos.length}개 라인업 영상 발견`);
  return videos;
}

async function fetchDescriptions(videoIds) {
  const results = {};
  // 50개씩 나눠서
  for (let i = 0; i < videoIds.length; i += 50) {
    const chunk = videoIds.slice(i, i + 50);
    const data = await ytGet(`videos?part=snippet&id=${chunk.join(',')}`);
    for (const item of data.items || []) {
      results[item.id] = item.snippet;
    }
  }
  return results;
}

// ─── Supabase upsert ──────────────────────────────────
async function upsertRow(row) {
  // PATCH로 기존 row 업데이트 (날짜+show_name 기준)
  const delRes = await fetch(
    `${SUPA_URL}/rest/v1/music_show_lineups?show_name=eq.${row.show_name}&broad_date=eq.${row.broad_date}`,
    { method: 'DELETE', headers: { apikey: SUPA_SERVICE_KEY, Authorization: `Bearer ${SUPA_SERVICE_KEY}` } }
  );
  const insRes = await fetch(`${SUPA_URL}/rest/v1/music_show_lineups`, {
    method: 'POST',
    headers: {
      apikey: SUPA_SERVICE_KEY,
      Authorization: `Bearer ${SUPA_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify([row]),
  });
  return insRes.ok;
}

// ─── 메인 ─────────────────────────────────────────────
(async () => {
  for (const show of SHOWS) {
    try {
      const videos = await fetchLineupVideos(show);
      if (videos.length === 0) { console.log('  영상 없음, 스킵'); continue; }

      // description 가져오기
      const ids = videos.map(v => v.id.videoId);
      const snippets = await fetchDescriptions(ids);

      let inserted = 0, skipped = 0;
      const seen = new Set();

      for (const video of videos) {
        const vid = video.id.videoId;
        const snippet = snippets[vid];
        if (!snippet) continue;

        const title = snippet.title;
        const desc = snippet.description || '';
        const publishedAt = snippet.publishedAt;

        const broadDate = show.parseDate(title, publishedAt);
        if (seen.has(broadDate)) continue;
        seen.add(broadDate);

        const artists = show.parseLineup(desc);
        const groups = mapToGroupIds(artists);

        if (groups.length === 0 && artists.length === 0) { skipped++; continue; }

        console.log(`  ${broadDate} | ${artists.slice(0,5).join(', ')}${artists.length>5?'...':''} → [${groups.join(',')}]`);

        const ok = await upsertRow({
          show_name:      show.show_name,
          episode_number: null,
          broad_date:     broadDate,
          groups,
          raw_title:      artists.join(' · '),
          source:         'youtube_api',
        });
        if (ok) inserted++; else skipped++;
      }
      console.log(`  완료: ${inserted}행 upsert, ${skipped}행 스킵`);
    } catch (err) {
      console.error(`[${show.show_name}] 오류:`, err.message);
    }
  }
  console.log('\n전체 완료!');
})();
