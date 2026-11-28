-- AI W.E.P 웰디의 조선소 — 진행 중 전투 저장 (서버가 다시 켜져도 이어 하기)
-- Supabase > SQL Editor 에 통째로 붙여넣고 Run. 여러 번 실행해도 안전합니다.
-- (step19-game-pvp.sql 다음에)
-- 안 돌려도 게임은 지금처럼 동작합니다 (진행 중 전투를 서버 메모리에만 둠).

-- 시간차 출동 전투: 시작할 때 한 줄, 배를 보낼 때마다 deploys 를 바꿈, 끝나면 done = true
create table if not exists public.game_live (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  target_id uuid references public.users(id) on delete cascade,   -- 교육생끼리 공격일 때 상대
  kind text not null default 'pirate',                            -- pirate | raid
  started_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb,                        -- 전투 입력 (상대 조선소·배·대원)
  deploys jsonb not null default '[]'::jsonb,                     -- 보낸 배 [{t, ship, y}]
  done boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists game_live_user on public.game_live (user_id, done);
create index if not exists game_live_target on public.game_live (target_id, done);
create index if not exists game_live_open on public.game_live (done, started_at);

alter table public.game_live enable row level security;
