-- AI W.E.P T2(이론): 매일 문제 + 교재 화질 단계
-- Supabase > SQL Editor 에 통째로 붙여넣고 Run. 여러 번 실행해도 안전합니다.
-- (step7-textbook.sql 을 먼저 실행해 두어야 합니다)

-- 교재 쪽 그림 화질 단계 (1 = 예전 1100px, 2 = 1600px). 예전 쪽은 "화질 올려 다시 나누기"로 바꿈
alter table public.textbook_pages add column if not exists quality int not null default 1;

-- 문제 은행 만들기 진행
alter table public.textbooks add column if not exists quiz_status text not null default '';  -- '' / running / ready / failed
alter table public.textbooks add column if not exists quiz_done int not null default 0;
alter table public.textbooks add column if not exists quiz_total int not null default 0;
alter table public.textbooks add column if not exists quiz_error text not null default '';

-- 문제 은행 (AI 가 교재 장마다 만든 문제)
create table if not exists public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.textbooks(id) on delete cascade,
  unit_key text not null,                       -- 장 (편 번호-장 번호)
  unit_title text not null default '',
  kind text not null,                           -- mc(객관식) / short(주관식)
  question text not null,
  choices jsonb not null default '[]'::jsonb,   -- 객관식 보기 4개 / 주관식은 채점 핵심 내용
  answer int,                                   -- 객관식 정답 번호 (0~3)
  model_answer text not null default '',        -- 주관식 모범 답
  explanation text not null default '',
  page int,                                     -- 근거 쪽 (PDF 쪽 번호)
  status text not null default 'active',        -- active / hidden
  report_count int not null default 0,
  translations jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists quiz_questions_book on public.quiz_questions (book_id, unit_key);

-- 그날 교육생에게 낸 문제
create table if not exists public.daily_sets (
  user_id uuid not null references public.users(id) on delete cascade,
  day date not null,                            -- 한국 날짜
  book_id uuid references public.textbooks(id) on delete set null,
  question_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- 교육생 답과 채점
create table if not exists public.daily_answers (
  user_id uuid not null references public.users(id) on delete cascade,
  day date not null,
  question_id uuid not null references public.quiz_questions(id) on delete cascade,
  book_id uuid references public.textbooks(id) on delete set null,
  kind text not null,
  answer text,
  correct boolean,
  score int,                                    -- 0~10 (채점 대기면 비어 있음)
  feedback text not null default '',
  graded_by text not null default 'auto',       -- auto / ai / teacher / pending
  created_at timestamptz not null default now(),
  primary key (user_id, day, question_id)
);
create index if not exists daily_answers_user on public.daily_answers (user_id, created_at desc);

-- 이상한 문제 신고
create table if not exists public.question_reports (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.quiz_questions(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  reason text not null default '',
  created_at timestamptz not null default now()
);

-- 앱(휴대폰)이 직접 읽지 못하게 잠그고, 서버(비밀 키)만 사용
alter table public.quiz_questions enable row level security;
alter table public.daily_sets enable row level security;
alter table public.daily_answers enable row level security;
alter table public.question_reports enable row level security;
grant select, insert, update, delete on public.quiz_questions, public.daily_sets,
  public.daily_answers, public.question_reports to service_role;

-- 결과 확인: 문제 수 (처음엔 0)
select count(*) as questions from public.quiz_questions;
