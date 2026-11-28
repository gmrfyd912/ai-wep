-- AI W.E.P 웰디의 조선소 — 월 시즌 배지 (박사 승인 2026-11-28)
-- Supabase > SQL Editor 에 통째로 붙여넣고 Run. 여러 번 실행해도 안전합니다.
-- (step22-game-contest.sql 다음에)
-- 안 돌려도 명성 순위·이달의 해적 선단은 동작하고, 시즌이 끝날 때 주는 배지만 빠집니다.

-- 끝낸 시즌 ('2026-11' 처럼 달). test = 관리자가 시험으로 미리 끝내 본 것 (진짜 달이 끝나면 다시 계산)
create table if not exists public.game_seasons (
  season text primary key,
  done_at timestamptz not null default now(),
  test boolean not null default false
);

-- 시즌 배지: 반마다 1·2·3등 gold·silver·bronze, 명성을 얻은 사람은 join
create table if not exists public.game_season_badges (
  season text not null,
  user_id uuid not null references public.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  rank int not null default 0,
  fame int not null default 0,
  badge text not null default 'join',
  created_at timestamptz not null default now(),
  primary key (season, user_id)
);
create index if not exists game_season_badges_user on public.game_season_badges (user_id, season desc);

alter table public.game_seasons enable row level security;
alter table public.game_season_badges enable row level security;
grant select, insert, update, delete on public.game_seasons, public.game_season_badges to service_role;
