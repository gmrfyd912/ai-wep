-- AI W.E.P G2c-3(게임): 웰디의 조선소 — 교육생끼리 공격·보호막·방어 기록
-- Supabase > SQL Editor 에 통째로 붙여넣고 Run. 여러 번 실행해도 안전합니다.
-- (step18-game-raid.sql 다음에)

-- 공격받은 조선소 보호막 (이 시각까지 공격 못 받음)
alter table public.game_bases add column if not exists shield_until timestamptz;

-- 전투 기록: 공격받은 교육생, 그 사람이 봤는지(웰디 알림), 복수했는지
alter table public.game_battles add column if not exists defender_id uuid references public.users(id) on delete cascade;
alter table public.game_battles add column if not exists defender_seen boolean not null default false;
alter table public.game_battles add column if not exists revenge_used boolean not null default false;
create index if not exists game_battles_defender on public.game_battles (defender_id, created_at desc);
create index if not exists game_battles_kind_day on public.game_battles (user_id, kind, created_at desc);
