-- AI W.E.P T3(이론) 보강: 웰디 점검 (질문과 정답 쪽을 넣어 두고 실제 웰디로 한꺼번에 확인)
-- Supabase > SQL Editor 에 통째로 붙여넣고 Run. 여러 번 실행해도 안전합니다.
-- 교재가 대외비라 점검 질문은 저장소가 아니라 여기(DB)에 둡니다.

create table if not exists public.tutor_checks (
  id uuid primary key default gen_random_uuid(),
  book_id uuid references public.textbooks(id) on delete cascade,
  question text not null,
  page_from int not null,                       -- 정답 쪽 (책에 인쇄된 쪽)
  page_to int not null,
  note text not null default '',
  last_verdict text not null default '',        -- ok / wrong_page / no_page / said_missing / error_*
  last_pages int[] not null default '{}',       -- 웰디가 댄 근거 쪽 (인쇄 쪽, 서버 확인 후)
  last_found int[] not null default '{}',       -- 교재 전체 검색에서 주제가 나온 쪽
  last_reply text not null default '',
  last_run_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists tutor_checks_book on public.tutor_checks (book_id, created_at);

alter table public.tutor_checks enable row level security;
grant select, insert, update, delete on public.tutor_checks to service_role;
