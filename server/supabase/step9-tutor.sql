-- AI W.E.P T3(이론): AI 학습 보조 '웰디'와 대화 기록
-- Supabase > SQL Editor 에 통째로 붙여넣고 Run. 여러 번 실행해도 안전합니다.
-- (step7-textbook.sql, step8-daily.sql 을 먼저 실행해 두어야 합니다)

-- 웰디에게 물은 말과 대답 (근거 쪽·장, 신고)
create table if not exists public.tutor_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  book_id uuid references public.textbooks(id) on delete cascade,
  lang text not null default 'ko',
  question text not null default '',
  answer text not null default '',
  pages int[] not null default '{}',            -- 근거 PDF 쪽
  unit_key text,                                -- 어느 장 이야기인지
  kind text not null default '',                -- explain / outside / offtopic / open / quiz / limit / failed / blocked
  ai boolean not null default false,            -- AI 를 쓴 질문 (하루 한도에 셈)
  reported boolean not null default false,      -- "답이 이상해요" 신고
  report_note text not null default '',
  reported_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists tutor_messages_user_day on public.tutor_messages (user_id, created_at desc);
create index if not exists tutor_messages_reported on public.tutor_messages (reported) where reported;

-- 웰디가 대화 중에 낸 문제와 맞았는지 (연습용: 매일 문제 점수에는 안 들어감, 약한 장 찾기에는 씀)
create table if not exists public.tutor_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  book_id uuid references public.textbooks(id) on delete cascade,
  question_id uuid references public.quiz_questions(id) on delete cascade,
  unit_key text,
  kind text not null default '',
  answer int,
  correct boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists tutor_answers_user on public.tutor_answers (user_id, created_at desc);

-- 앱(휴대폰)이 직접 읽지 못하게 잠그고, 서버(비밀 키)만 사용
alter table public.tutor_messages enable row level security;
alter table public.tutor_answers enable row level security;
grant select, insert, update, delete on public.tutor_messages, public.tutor_answers to service_role;
