-- ─────────────────────────────────────────
--  music_show_lineups 테이블
--  공방(음악방송) 회차별 출연 그룹 저장
-- ─────────────────────────────────────────
create table if not exists public.music_show_lineups (
  id              bigserial primary key,
  show_name       text        not null,   -- 'music_core' | 'inkigayo' | 'music_bank' | 'mcountdown' | 'show_champion' | 'the_show'
  episode_number  text,                   -- 회차 번호 (예: '944')
  broad_date      date        not null,   -- 방송일 (예: 2026-05-02)
  groups          text[]      not null default '{}',  -- 출연 그룹 ID 배열 (예: '{bts,ive,lesserafim}')
  raw_title       text,                   -- 원본 출연진 문자열 (음악중심: ContentTitle 그대로)
  source          text        default 'manual',  -- 'imbc_api' | 'manual'
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),

  -- 같은 날 같은 방송 중복 방지
  unique (show_name, broad_date)
);

-- 날짜 조회용 인덱스
create index if not exists idx_lineups_date      on public.music_show_lineups (broad_date);
create index if not exists idx_lineups_show_date on public.music_show_lineups (show_name, broad_date);
-- 그룹 필터용 GIN 인덱스
create index if not exists idx_lineups_groups    on public.music_show_lineups using gin (groups);

-- updated_at 자동 갱신 트리거
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_lineups_updated_at on public.music_show_lineups;
create trigger trg_lineups_updated_at
  before update on public.music_show_lineups
  for each row execute function public.set_updated_at();

-- anon 읽기 허용 (RLS)
alter table public.music_show_lineups enable row level security;

create policy "public read"
  on public.music_show_lineups for select
  using (true);

-- service_role은 모든 권한 (서버리스 함수에서 upsert 시 사용)
create policy "service write"
  on public.music_show_lineups for all
  using (auth.role() = 'service_role');

-- ─────────────────────────────────────────
--  artist_name_map 테이블
--  한국어 아티스트명 → 공식 영문명 캐시
-- ─────────────────────────────────────────
create table if not exists public.artist_name_map (
  kr_name   text primary key,   -- 한국어 원본명 (예: '가비엔제이')
  en_name   text not null,      -- 공식 영문명 (예: 'Gavy NJ')
  verified  boolean default false, -- 수동 검증 여부
  created_at timestamptz default now()
);

-- service_role 쓰기 허용
alter table public.artist_name_map enable row level security;

create policy "public read artist_name_map"
  on public.artist_name_map for select
  using (true);

create policy "service write artist_name_map"
  on public.artist_name_map for all
  using (auth.role() = 'service_role');
