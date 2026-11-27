-- AI W.E.P G1(게임): 웰디의 조선소 — 내 조선소
-- Supabase > SQL Editor 에 통째로 붙여넣고 Run. 여러 번 실행해도 안전합니다.
-- (step8-daily.sql 다음이면 언제든)

-- 교육생마다 조선소 하나
create table if not exists public.game_bases (
  user_id uuid primary key references public.users(id) on delete cascade,
  tutorial_done boolean not null default false,    -- 처음 따라 하기 끝/끄기
  last_seen_at timestamptz not null default now(), -- '공사 끝!' 표시 기준
  created_at timestamptz not null default now()
);

-- 건물 (공사 중이면 busy_until 에 끝나는 시각, 새로 짓는 중이면 level 0)
create table if not exists public.game_buildings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null,                               -- hq / yard / rodstore / cutting / welding / academy / dock
  level int not null default 0,
  x int not null default 0,
  y int not null default 0,
  busy_until timestamptz,
  finished_at timestamptz,
  collected_at timestamptz,                         -- 공장: 마지막으로 생산분 받은 시각
  created_at timestamptz not null default now()
);
create index if not exists game_buildings_user on public.game_buildings (user_id);

-- 배 건조 (공정 0~4: 블록 제작 → 대조립 → 도크 탑재 → 진수 → 인도)
create table if not exists public.game_ships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null,                               -- barge / bulk / container / lng / offshore
  stage int not null default 0,
  stage_until timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists game_ships_user on public.game_ships (user_id, created_at desc);

-- 자원 장부: 공부로 받은 것(+)과 쓴 것(−). 열쇠(key)가 같은 줄은 한 번만 (두 번 받기 방지)
create table if not exists public.game_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  key text not null,
  steel int not null default 0,
  rods int not null default 0,
  tech int not null default 0,
  passes int not null default 0,
  fame int not null default 0,
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, key)
);
create index if not exists game_ledger_user on public.game_ledger (user_id, created_at);

-- 서버(비밀 키)만 읽고 쓴다
alter table public.game_bases enable row level security;
alter table public.game_buildings enable row level security;
alter table public.game_ships enable row level security;
alter table public.game_ledger enable row level security;

-- 서버(service_role)가 읽고 쓸 수 있게 권한 주기 (이게 없으면 "permission denied for table game_bases")
grant select, insert, update, delete on public.game_bases, public.game_buildings,
  public.game_ships, public.game_ledger to service_role;
