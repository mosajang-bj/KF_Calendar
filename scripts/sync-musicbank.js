// scripts/sync-musicbank.js
// KBS Kpop 유튜브 채널에서 뮤직뱅크 출연 그룹 수집 → Supabase upsert
//
// 제목 패턴:
//   "[얼빡직캠 4K] 아일릿 'Magnetic' @뮤직뱅크(Music Bank) 260501"
//   "아일릿 (ILLIT) [뮤직뱅크/Music Bank] | KBS 260501"
//   "It's Me - 아일릿 (ILLIT) [뮤직뱅크/Music Bank] | KBS 260501"
//
// 날짜 추출: 제목 마지막 6자리 YYMMDD → 20YY-MM-DD
// 그룹 추출: 제목에서 괄호/영문 그룹명 파싱 → ARTIST_TO_GROUP 매핑

const YOUTUBE_API_KEY  = process.env.YOUTUBE_API_KEY;
const SUPA_URL         = 'https://kzffotlfdtubkbxsjqiv.supabase.co';
const SUPA_SERVICE_KEY = process.env.SUPA_SERVICE_KEY;

const CHANNEL_ID = 'UCeLPm9yH_a_QH8n6445G-Ow'; // KBS Kpop
const YT = 'https://www.googleapis.com/youtube/v3';

// 뮤직뱅크 영상인지 확인
function isMusicBankVideo(title) {
  return title.includes('뮤직뱅크') || title.includes('Music Bank');
}

// 제목에서 날짜 추출: "260501" → "2026-05-01"
function parseDateFromTitle(title) {
  // 끝에 6자리 숫자
  let m = title.match(/(\d{2})(\d{2})(\d{2})\s*$/);
  if (m) return `20${m[1]}-${m[2]}-${m[3]}`;
  // "| KBS YYMMDD" 패턴
  m = title.match(/KBS\s+(\d{2})(\d{2})(\d{2})/);
  if (m) return `20${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

const ARTIST_TO_GROUP = {
  'BTS':'bts','방탄소년단':'bts','방탄':'bts',
  'RM':'bts','Jin':'bts','진':'bts','SUGA':'bts','슈가':'bts',
  'j-hope':'bts','j-Hope':'bts','제이홉':'bts',
  'Jimin':'bts','지민':'bts','V':'bts','뷔':'bts',
  'Jung Kook':'bts','Jungkook':'bts','정국':'bts',
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
  'Stray Kids':'straykids','스트레이키즈':'straykids',
  'TXT':'txt','TOMORROW X TOGETHER':'txt','투모로우바이투게더':'txt',
  'BTOB':'btob',
  'INFINITE':'infinite','인피니트':'infinite',
  'GOT7':'got7',
  'DAY6':'day6',
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
  'DRIPPIN':'drippin',
  'VERIVERY':'verivery',
  'THE BOYZ':'theboyz','더보이즈':'theboyz',
  'ONEUS':'oneus','원어스':'oneus',
  'OMEGA X':'omegax',
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
  'SHOWNU X HYUNGWON':'monstax',
  '선미':'sunmi','SUNMI':'sunmi',
  'PENTAGON':'pentagon','펜타곤':'pentagon',
  '여자아이들':'gidle','(G)I-DLE':'gidle','GIDLE':'gidle',
  'MAMAMOO':'mamamoo','마마무':'mamamoo',
  'Red Velvet':'redvelvet','레드벨벳':'redvelvet',
  'Girls Generation':'snsd','소녀시대':'snsd',
};

// 제목에서 아티스트명 추출
// 패턴1: "아일릿 (ILLIT) [뮤직뱅크..." → 앞부분 KR/EN 그룹명
// 패턴2: "[직캠] 그룹명 '곡명' @뮤직뱅크..." → 그룹명
// 패턴3: "곡명 - 그룹명 (EN명) [뮤직뱅크..." → 그룹명
function parseArtistFromTitle(title) {
  // 제목에서 날짜 코드 이전까지만 사용
  const cleaned = title.replace(/\d{6}\s*$/, '').trim();

  // [직캠...] 태그 제거
  const noTag = cleaned.replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ').trim();

  // "@뮤직뱅크" 이전 부분
  let artistPart = noTag;
  const atIdx = cleaned.indexOf('@뮤직뱅크');
  if (atIdx !== -1) {
    artistPart = cleaned.slice(0, atIdx).replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ');
  }
  // "| KBS" 이전 부분
  const kbsIdx = cleaned.indexOf('| KBS');
  if (kbsIdx !== -1 && atIdx === -1) {
    artistPart = cleaned.slice(0, kbsIdx).replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ');
  }

  // " - " 뒤에 아티스트가 있는 경우 (곡명 - 아티스트)
  const dashIdx = artistPart.indexOf(' - ');
  if (dashIdx !== -1) {
    artistPart = artistPart.slice(dashIdx + 3);
  }

  // 곡명 제거: 따옴표/홑따옴표 안 내용 제거
  artistPart = artistPart.replace(/['"''][^'''\"\"]*['"'']/g, ' ').trim();

  // 남은 텍스트에서 ARTIST_TO_GROUP 매핑
  const found = new Set();
  // 긴 키부터 매칭 (NCT 127 > NCT 등)
  const keys = Object.keys(ARTIST_TO_GROUP).sort((a,b) => b.length - a.length);
  for (const k of keys) {
    if (artistPart.includes(k)) {
      found.add(ARTIST_TO_GROUP[k]);
      artistPart = artistPart.replace(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'g'), ' ');
    }
  }
  return { artistName: Object.keys(ARTIST_TO_GROUP).find(k => title.includes(k) && ARTIST_TO_GROUP[k] === [...found][0]) || artistPart.trim(), groupIds: [...found] };
}

// YouTube search — 페이지네이션으로 최대 maxPages 페이지
async function fetchVideos(maxPages = 20) {
  const videos = [];
  let pageToken = '';
  for (let p = 0; p < maxPages; p++) {
    const url = `${YT}/search?part=snippet&channelId=${CHANNEL_ID}&q=뮤직뱅크&type=video&order=date&maxResults=50&key=${YOUTUBE_API_KEY}${pageToken ? '&pageToken='+pageToken : ''}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) { console.error('YT API error:', data.error.message); break; }
    for (const item of (data.items || [])) {
      const title = item.snippet.title;
      if (isMusicBankVideo(title)) {
        videos.push({ title, publishedAt: item.snippet.publishedAt });
      }
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
    process.stdout.write('.');
  }
  console.log(`\n총 뮤직뱅크 영상: ${videos.length}개`);
  return videos;
}

// 날짜별 그룹 집계
function aggregateByDate(videos) {
  const byDate = {}; // date → Set of groupIds, Set of artistNames
  for (const v of videos) {
    const date = parseDateFromTitle(v.title);
    if (!date) continue;
    if (!byDate[date]) byDate[date] = { groupIds: new Set(), artistNames: new Set() };
    const { artistName, groupIds } = parseArtistFromTitle(v.title);
    groupIds.forEach(g => byDate[date].groupIds.add(g));
    if (artistName) byDate[date].artistNames.add(artistName);
  }
  return byDate;
}

// Supabase upsert
async function upsertRow(date, groups, rawTitle) {
  // 기존 raw_title 보존: 이미 값 있으면 덮어쓰지 않음
  const existing = await fetch(
    `${SUPA_URL}/rest/v1/music_show_lineups?show_name=eq.music_bank&broad_date=eq.${date}&select=id,raw_title,groups`,
    { headers: { apikey: SUPA_SERVICE_KEY, Authorization: `Bearer ${SUPA_SERVICE_KEY}` } }
  ).then(r => r.json());

  if (existing.length > 0) {
    // PATCH — groups 합치기
    const merged = [...new Set([...(existing[0].groups || []), ...groups])];
    const res = await fetch(
      `${SUPA_URL}/rest/v1/music_show_lineups?id=eq.${existing[0].id}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SUPA_SERVICE_KEY,
          Authorization: `Bearer ${SUPA_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ groups: merged, raw_title: rawTitle }),
      }
    );
    return res.ok;
  } else {
    // INSERT
    const res = await fetch(`${SUPA_URL}/rest/v1/music_show_lineups`, {
      method: 'POST',
      headers: {
        apikey: SUPA_SERVICE_KEY,
        Authorization: `Bearer ${SUPA_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        show_name: 'music_bank',
        broad_date: date,
        groups,
        raw_title: rawTitle,
        source: 'youtube_titles',
      }),
    });
    return res.ok;
  }
}

(async () => {
  console.log('KBS Kpop 채널에서 뮤직뱅크 영상 수집 중...');
  const videos = await fetchVideos(20);

  console.log('날짜별 그룹 집계 중...');
  const byDate = aggregateByDate(videos);

  const dates = Object.keys(byDate).sort();
  console.log(`\n집계된 날짜: ${dates.length}개`);

  // 샘플 출력
  console.log('\n[샘플 (최근 5개)]');
  dates.slice(-5).forEach(d => {
    const e = byDate[d];
    console.log(`  ${d}: groups=[${[...e.groupIds].join(',')}] artists=[${[...e.artistNames].slice(0,5).join(',')}]`);
  });

  // upsert
  console.log('\nSupabase 업데이트 중...');
  let ok = 0, fail = 0;
  for (const date of dates) {
    const { groupIds, artistNames } = byDate[date];
    const groups = [...groupIds];
    const rawTitle = [...artistNames].join(' · ');
    const success = await upsertRow(date, groups, rawTitle);
    if (success) { ok++; process.stdout.write('.'); }
    else { fail++; process.stdout.write('x'); }
  }
  console.log(`\n완료: ${ok}개 성공, ${fail}개 실패`);
})();
