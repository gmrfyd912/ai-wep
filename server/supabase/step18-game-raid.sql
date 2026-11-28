-- AI W.E.P G2c-2(게임): 웰디의 조선소 — 상륙 대원
-- Supabase > SQL Editor 에 통째로 붙여넣고 Run. 여러 번 실행해도 안전합니다.
-- (step17-game-defense.sql 다음에)

-- 상륙 대원 수와 훈련 점수 {"welder": 3, "fitter": 1, "forklift": 0, "transporter": 1, "pts": 2}
alter table public.game_bases add column if not exists crews jsonb not null default '{}'::jsonb;
