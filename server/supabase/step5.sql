-- AI W.E.P 5단계: AI 리포트 저장 표 + 시스템 설정 표
-- Supabase > SQL Editor 에 통째로 붙여넣고 Run. 여러 번 실행해도 안전합니다.

-- 만든 AI 리포트 (같은 사진·같은 언어는 1개만 저장 → 다시 열면 비용 0)
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  device_id text not null,            -- 하루 한도 계산용 (6단계에서 계정으로 교체)
  lang text not null,                 -- ko, en, vi, th, fil, uz, id, es
  model text,                         -- 만든 AI 모델 이름
  report jsonb not null,              -- 총평·잘한 점·고칠 점·연습 방법·비교
  score int,                          -- 만들 때의 점수 (기록용)
  verdict text,                       -- pass / fail (AI 예비판정)
  input_tokens int,                   -- 비용 확인용
  output_tokens int,
  created_at timestamptz not null default now(),
  unique (submission_id, lang)
);

create index if not exists reports_device_created_idx
  on public.reports (device_id, created_at desc);

-- 시스템 설정 (검사기준·하루 리포트 한도). 6단계 시스템관리자 화면이 이 값을 고칩니다.
-- 그전에는 Supabase > Table Editor > app_settings 에서 value 를 직접 고쳐도 됩니다(5분 안에 반영).
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value) values ('criteria', '{
  "width":    {"points": 40, "full_mm": 1.0, "zero_mm": 4.0},
  "straight": {"points": 30, "full_mm": 0.5, "zero_mm": 3.0},
  "defects":  {"points": 30,
               "deduct": {"porosity": 10, "undercut": 10, "overlap": 10, "spatter": 0},
               "deduct_default": 10},
  "fail_types": ["crack"],
  "fail_score_cap": 59,
  "pass_score": 80,
  "report_daily_limit": 5,
  "report_unlimited_devices": []
}'::jsonb)
on conflict (key) do nothing;

-- 앱은 이 표들에 직접 접근하지 않습니다. 분석 서버(비밀 키)만 읽고 씁니다.
alter table public.reports enable row level security;
alter table public.app_settings enable row level security;
grant select, insert, update, delete on public.reports to service_role;
grant select, insert, update, delete on public.app_settings to service_role;
