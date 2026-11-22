-- AI W.E.P 6-5: 평판/배관 구분과 배관 외경
-- Supabase > SQL Editor 에 통째로 붙여넣고 Run. 여러 번 실행해도 안전합니다.
-- 지난 기록은 모두 평판(plate)으로 들어갑니다.

alter table public.submissions add column if not exists work_type text not null default 'plate';
alter table public.submissions add column if not exists pipe_od_mm numeric;

do $$ begin
  alter table public.submissions add constraint submissions_work_type_check check (work_type in ('plate', 'pipe'));
exception when duplicate_object then null;
end $$;

-- 랭킹·갤러리가 평판/배관별로 빨리 찾도록
create index if not exists submissions_work_type_created_idx on public.submissions (work_type, created_at desc);

-- 결과 확인: 평판·배관 기록 수 (처음엔 배관 0)
select work_type, count(*) from public.submissions group by work_type;
