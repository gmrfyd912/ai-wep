-- AI W.E.P 6-4b: 선급규정 (규정 세트 저장, 하나만 적용)
-- Supabase > SQL Editor 에 통째로 붙여넣고 Run. 여러 번 실행해도 안전합니다.
-- (step6-accounts.sql 을 먼저 실행해 두어야 합니다)

create table if not exists public.rule_sets (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  society text not null default '',
  items jsonb not null default '{}'::jsonb,      -- 사진으로 판정하는 항목 (기공·언더컷·폭 변화 등)
  manual jsonb not null default '[]'::jsonb,     -- 사진으로 판정 못 하는 항목 (교사 확인)
  files jsonb not null default '[]'::jsonb,      -- 올린 규정 파일 (photos 저장 공간의 rules/...)
  notes text not null default '',
  active boolean not null default false,         -- 교육원 전체에 적용 중인 세트 (하나만)
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 적용 중인 세트는 하나만
create unique index if not exists rule_sets_one_active on public.rule_sets (active) where active;

-- 앱(휴대폰)이 직접 읽지 못하게 잠그고, 서버(비밀 키)만 사용
alter table public.rule_sets enable row level security;
grant select, insert, update, delete on public.rule_sets to service_role;

-- 결과 확인: 규정 세트 수 (처음엔 0)
select count(*) as rule_sets from public.rule_sets;
