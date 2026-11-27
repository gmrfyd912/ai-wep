-- AI W.E.P T5(이론): 수업 중 돌발 OX
-- Supabase > SQL Editor 에 통째로 붙여넣고 Run. 여러 번 실행해도 안전합니다.
-- (step8-daily.sql, step10-tutor-bank.sql 을 먼저 실행해 두어야 합니다)

-- 교사가 반에 보낸 돌발 OX (지금 내는 문제는 서버 메모리, 끝나면 결과를 여기에)
create table if not exists public.live_ox (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references public.courses(id) on delete cascade,
  teacher_id uuid references public.users(id) on delete set null,
  book_id uuid references public.textbooks(id) on delete set null,
  question_id uuid references public.quiz_questions(id) on delete set null,  -- 교재가 없을 때 직접 친 문제는 비어 있음
  question text not null default '',
  answer int,                                   -- 0 = O, 1 = X
  seconds int not null default 20,
  targets int not null default 0,               -- 보낼 때 반 교육생 수
  answered int not null default 0,
  correct int not null default 0,
  explain text not null default '',             -- 웰디가 설명하기 (한국어)
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists live_ox_course on public.live_ox (course_id, started_at desc);

-- 교육생 답 (학습 보드에 다른 문제처럼 들어감: 맞으면 10점)
create table if not exists public.live_ox_answers (
  quiz_id uuid not null references public.live_ox(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  question_id uuid references public.quiz_questions(id) on delete cascade,
  book_id uuid references public.textbooks(id) on delete set null,
  answer int,
  correct boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (quiz_id, user_id)
);
create index if not exists live_ox_answers_book on public.live_ox_answers (book_id, created_at);
create index if not exists live_ox_answers_user on public.live_ox_answers (user_id, created_at desc);

-- 앱(휴대폰)이 직접 읽지 못하게 잠그고, 서버(비밀 키)만 사용
alter table public.live_ox enable row level security;
alter table public.live_ox_answers enable row level security;
grant select, insert, update, delete on public.live_ox, public.live_ox_answers to service_role;
