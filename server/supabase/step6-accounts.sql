-- AI W.E.P 6-1단계: 계정·로그인·과정
-- Supabase > SQL Editor 에 통째로 붙여넣고 Run. 여러 번 실행해도 안전합니다.
-- (admin 계정은 이 파일에 없습니다. 비밀번호가 공개 저장소에 올라가지 않도록 채팅으로 따로 안내합니다.)

create extension if not exists pgcrypto with schema extensions;

-- 과정(반). 6-2단계에서 시스템관리자 화면으로 추가·수정합니다.
create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

insert into public.courses (name, sort) values
  ('뉴딜2기', 1), ('뉴딜3기', 2), ('뉴딜4기', 3), ('특기병', 4), ('페루반', 5)
on conflict (name) do nothing;

-- 회원. 비밀번호는 원문이 아니라 bcrypt 암호화 값만 저장합니다.
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  login_id text not null,                 -- 화면에 보이는 아이디 (가입할 때 쓴 그대로)
  login_key text not null unique,         -- 중복 확인용: 앞뒤 공백 빼고 소문자
  password_hash text not null,
  name text not null,                     -- 실명
  role text not null check (role in ('student', 'teacher', 'staff', 'admin')),
  email text,                             -- 선택. 아이디·비밀번호 찾기에 사용
  status text not null default 'active' check (status in ('active', 'pending', 'disabled')),
  must_change_password boolean not null default false,  -- 첫 로그인·초기화 후 새 비밀번호 정하기
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create index if not exists users_email_idx on public.users (lower(email));

-- 교육생 = 과정 1개, 교사 = 담당 과정 여러 개
create table if not exists public.user_courses (
  user_id uuid not null references public.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  primary key (user_id, course_id)
);

-- 로그인 상태 (로그아웃·계정 삭제·비밀번호 초기화 때 지움). 토큰 원문은 저장하지 않습니다.
create table if not exists public.sessions (
  token_hash text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  device_id text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists sessions_user_idx on public.sessions (user_id);

-- 이메일로 보낸 비밀번호 재설정 번호 (15분 유효)
create table if not exists public.email_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  used boolean not null default false,
  attempts int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists email_codes_user_idx on public.email_codes (user_id, created_at desc);

-- 분석 기록·리포트를 계정에 연결 (계정을 삭제하면 기록도 함께 삭제)
alter table public.submissions add column if not exists user_id uuid references public.users(id) on delete cascade;
alter table public.reports add column if not exists user_id uuid references public.users(id) on delete cascade;
create index if not exists submissions_user_created_idx on public.submissions (user_id, created_at desc);
create index if not exists reports_user_created_idx on public.reports (user_id, created_at desc);

-- 가입 승인 설정 (둘 다 기본 꺼짐 = 바로 가입)
insert into public.app_settings (key, value) values
  ('signup', '{"student_approval": false, "staff_approval": false}'::jsonb)
on conflict (key) do nothing;

-- 비밀번호 규칙 (기본: 규칙 없음) + 관리자가 초기화할 때 쓰는 기본 비밀번호
insert into public.app_settings (key, value) values
  ('auth', '{"password_min_length": 0, "reset_password": "0000"}'::jsonb)
on conflict (key) do nothing;

-- 앱은 이 표들에 직접 접근하지 않습니다. 분석 서버(비밀 키)만 읽고 씁니다.
alter table public.courses enable row level security;
alter table public.users enable row level security;
alter table public.user_courses enable row level security;
alter table public.sessions enable row level security;
alter table public.email_codes enable row level security;
grant select, insert, update, delete on public.courses, public.users, public.user_courses,
  public.sessions, public.email_codes to service_role;

-- 결과 확인: 과정 5개가 보이면 성공
select name, active from public.courses order by sort;
