// scripts/insert-other-shows.js
// 뮤직뱅크, 인기가요, 엠카운트다운, 더쇼 방영일 생성 + Supabase upsert
// 공개 API 없으므로 요일 규칙으로 날짜 생성 (그룹 출연진은 admin에서 추가)
//
// 방영 요일:
//   뮤직뱅크(music_bank):    금요일 (5)
//   인기가요(inkigayo):      일요일 (0)
//   엠카운트다운(mcountdown): 목요일 (4)
//   더쇼(the_show):          화요일 (2)
//
// 커버 기간: 2020-01-01 ~ 2026-06-30

const SUPA_URL = 'https://kzffotlfdtubkbxsjqiv.supabase.co';
const SUPA_SERVICE_KEY = process.env.SUPA_SERVICE_KEY;

const SHOWS = [
  { name: 'music_bank',  dayOfWeek: 5, label: '뮤직뱅크' },
  { name: 'inkigayo',    dayOfWeek: 0, label: '인기가요' },
  { name: 'mcountdown',  dayOfWeek: 4, label: '엠카운트다운' },
];

const START_DATE = new Date('2020-01-01');
const END_DATE   = new Date('2026-06-30');

function dKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// 특정 요일의 날짜 목록 생성
function generateDates(dayOfWeek, start, end) {
  const dates = [];
  const d = new Date(start);
  // start를 해당 요일로 이동
  while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
  while (d <= end) {
    dates.push(dKey(new Date(d)));
    d.setDate(d.getDate() + 7);
  }
  return dates;
}

async function upsert(rows) {
  const CHUNK = 100;
  let ok = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
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
    if (res.ok) {
      ok += chunk.length;
      process.stdout.write('.');
    } else {
      // fallback: 개별 DELETE + INSERT
      for (const row of chunk) {
        await fetch(
          `${SUPA_URL}/rest/v1/music_show_lineups?show_name=eq.${row.show_name}&broad_date=eq.${row.broad_date}`,
          { method: 'DELETE', headers: { 'apikey': SUPA_SERVICE_KEY, 'Authorization': `Bearer ${SUPA_SERVICE_KEY}` } }
        );
        const ins = await fetch(`${SUPA_URL}/rest/v1/music_show_lineups`, {
          method: 'POST',
          headers: {
            'apikey': SUPA_SERVICE_KEY,
            'Authorization': `Bearer ${SUPA_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify([row]),
        });
        if (ins.ok) { ok++; process.stdout.write('.'); }
        else {
          const b = await ins.text();
          console.error(`\n  ${row.broad_date} ${row.show_name} 실패: ${b}`);
        }
      }
    }
  }
  return ok;
}

(async () => {
  for (const show of SHOWS) {
    const dates = generateDates(show.dayOfWeek, START_DATE, END_DATE);
    console.log(`\n[${show.label}] ${dates.length}회차 생성 (${dates[0]} ~ ${dates[dates.length-1]})`);

    const rows = dates.map((d, i) => ({
      show_name:      show.name,
      episode_number: null,
      broad_date:     d,
      groups:         [],
      raw_title:      '',
      source:         'date_rule',
    }));

    const inserted = await upsert(rows);
    console.log(`\n  완료: ${inserted}/${rows.length}행`);
  }
  console.log('\n전체 완료!');
})();
