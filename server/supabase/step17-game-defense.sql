-- AI W.E.P G2b(게임): 웰디의 조선소 — 방어 시설·무기·해적 연습 전투
-- Supabase > SQL Editor 에 통째로 붙여넣고 Run. 여러 번 실행해도 안전합니다.
-- (step16-game-fleet.sql 다음에)
-- 방어 시설(해안포대·미사일 기지·기뢰밭·대잠 기지·레이더 탑·방파 장벽)은 기존 game_buildings 표를 그대로 씀

-- 연구한 무기와 레벨 {"gun": 1, "torpedo": 2, ...} (함포는 처음부터 1레벨)
alter table public.game_bases add column if not exists weapons jsonb not null default '{}'::jsonb;

-- 전투함: 선체 레벨, 단 무기, 파손(깎인 체력), 수리 끝나는 시각
alter table public.game_ships add column if not exists hull int not null default 1;
alter table public.game_ships add column if not exists weapons jsonb not null default '[]'::jsonb;
alter table public.game_ships add column if not exists damage int not null default 0;
alter table public.game_ships add column if not exists repair_until timestamptz;

-- 게임 안에서 푼 문제 (자재 조달·승급 시험) → 방어 시설 힘(연결된 장 정답률)에 들어감
create table if not exists public.game_answers (
  id bigserial primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  book_id uuid,
  question_id uuid not null,
  correct boolean not null,
  source text not null default 'supply',
  created_at timestamptz not null default now()
);
create index if not exists game_answers_user on public.game_answers (user_id, book_id);

-- 전투 기록 (해적 연습 전투 다시 보기)
create table if not exists public.game_battles (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null default 'pirate',
  stage int not null default 1,
  stars int not null default 0,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists game_battles_user on public.game_battles (user_id, created_at desc);

alter table public.game_answers enable row level security;
alter table public.game_battles enable row level security;

grant select, insert, update, delete on public.game_bases, public.game_buildings,
  public.game_ships, public.game_ledger, public.game_answers, public.game_battles to service_role;
grant usage, select on sequence public.game_answers_id_seq to service_role;
