-- AI W.E.P T5 보강: 반 정답률이 낮았던 돌발 OX 를 다음 날 매일 문제에 다시 내기
-- Supabase > SQL Editor 에 통째로 붙여넣고 Run. 여러 번 실행해도 안전합니다.
-- (step13-live-ox.sql 다음에 실행)

-- 그날 매일 문제 중 '돌발 OX 다시 풀기'로 더한 문제 id (매일 문제 개수와 따로 셈)
alter table public.daily_sets add column if not exists review_ids jsonb not null default '[]'::jsonb;
