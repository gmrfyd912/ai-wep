-- AI W.E.P 웰디의 조선소 — 주간 반 대항전 (박사 승인 2026-11-28)
-- Supabase > SQL Editor 에 통째로 붙여넣고 Run. 여러 번 실행해도 안전합니다.
-- (step21-graduated.sql 다음에)
-- 안 돌려도 게임은 그대로 동작하고, 조선소의 대항전 칸에만 "준비 중"이 보입니다.

-- 한 주에 반마다 한 줄: 상대 반(혼자면 비어 있고 지난주 점수 target 에 도전), 끝나면 점수·승패·사람별 점수
create table if not exists public.game_contest (
  week date not null,                                                   -- 그 주 월요일 (한국 날짜)
  course_id uuid not null references public.courses(id) on delete cascade,
  rival_id uuid references public.courses(id) on delete set null,
  target numeric,                                                       -- 혼자인 반: 넘어야 할 지난주 점수
  start_at timestamptz not null,
  end_at timestamptz not null,
  score numeric,
  rival_score numeric,
  won boolean,
  done boolean not null default false,
  detail jsonb not null default '{}'::jsonb,                            -- {active, people: {교육생: {study, battle}}}
  created_at timestamptz not null default now(),
  primary key (week, course_id)
);
create index if not exists game_contest_open on public.game_contest (done, end_at);
create index if not exists game_contest_course on public.game_contest (course_id, week desc);

alter table public.game_contest enable row level security;
grant select, insert, update, delete on public.game_contest to service_role;
