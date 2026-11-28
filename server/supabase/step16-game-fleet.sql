-- AI W.E.P G2a(게임): 웰디의 조선소 — 함대와 간척
-- Supabase > SQL Editor 에 통째로 붙여넣고 Run. 여러 번 실행해도 안전합니다.
-- (step15-game.sql 다음에)
-- 전투함은 기존 game_ships 표를 그대로 씀 (kind = patrol / frigate / ..., 진수 끝나면 군항 부두에 정박)
-- 군항 부두는 기존 game_buildings 표 (type = pier)

-- 간척 단계 (0 = 14×14, 1 = 16×16, 2 = 18×18 ...) 와 간척 공사가 끝나는 시각
alter table public.game_bases add column if not exists reclaim int not null default 0;
alter table public.game_bases add column if not exists reclaim_until timestamptz;

-- 서버(service_role) 권한 (step15 에서 이미 줬지만 한 번 더, 안전)
grant select, insert, update, delete on public.game_bases, public.game_buildings,
  public.game_ships, public.game_ledger to service_role;
