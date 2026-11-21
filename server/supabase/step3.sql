-- AI W.E.P 3단계: 분석 기록 표 + 사진 저장 공간
-- Supabase > SQL Editor 에 통째로 붙여넣고 Run. 여러 번 실행해도 안전합니다.

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,            -- 로그인 전 임시 번호 (6단계에서 계정으로 교체)
  process text,                       -- SMAW, GTAW ...
  position text,                      -- 1G, 2F ...
  material text,                      -- CS, SS, AL
  status text not null default 'processing',
  photo_path text,                    -- photos 저장 공간 안의 위치
  check_path text,                    -- results 저장 공간 안의 확인 그림 위치
  result jsonb,                       -- 엔진 결과 전체
  width_mean_mm numeric,
  straight_max_dev_mm numeric,
  defect_count int,
  created_at timestamptz not null default now()
);

create index if not exists submissions_device_created_idx
  on public.submissions (device_id, created_at desc);

-- 앱은 이 표에 직접 접근하지 않습니다. 분석 서버(비밀 키)만 읽고 씁니다.
alter table public.submissions enable row level security;
grant select, insert, update, delete on public.submissions to service_role;

-- 비공개 저장 공간 2개
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false), ('results', 'results', false)
on conflict (id) do nothing;
