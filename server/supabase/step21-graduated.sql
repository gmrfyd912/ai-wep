-- AI W.E.P 수료생 계정: 2주(예시) 넘게 접속하지 않은 수료생은 로그인을 막음 (박사 요청 2026-11-28)
-- Supabase > SQL Editor 에 통째로 붙여넣고 Run. 여러 번 실행해도 안전합니다.
-- (step20-game-live.sql 다음에)
-- 안 돌려도 막기는 동작합니다. 돌리면 계정 상태가 '수료'로 남아 관리자 화면에서 보이고, [다시 사용하기]로 열 수 있습니다.

alter table public.users drop constraint if exists users_status_check;
alter table public.users add constraint users_status_check
  check (status in ('active', 'pending', 'disabled', 'graduated'));
