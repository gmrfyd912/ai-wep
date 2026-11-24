-- AI W.E.P T1(이론): 교재 올리기·교재 보기·진도
-- Supabase > SQL Editor 에 통째로 붙여넣고 Run. 여러 번 실행해도 안전합니다.
-- (step6-accounts.sql 을 먼저 실행해 두어야 합니다)
-- 교재 쪽 그림은 기존 비공개 저장 공간 photos 의 textbook/{교재id}/0001.jpg 에 둡니다 (새 저장 공간 필요 없음).
-- 교재 PDF 파일 자체는 저장하지 않습니다 (쪽 그림과 글자만 저장).

create table if not exists public.textbooks (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  pages int not null default 0,                 -- PDF 전체 쪽 수
  processed int not null default 0,             -- 나누기 끝난 쪽 수
  status text not null default 'processing',    -- processing / ready / failed
  error text not null default '',
  page_offset int not null default 0,           -- PDF 쪽 번호 - 책에 인쇄된 쪽 번호
  toc jsonb not null default '[]'::jsonb,       -- 목차 (편 → 장 → 절, 쪽은 책에 인쇄된 번호)
  toc_pages text not null default '',           -- 차례가 있는 PDF 쪽 (예: 5-8)
  is_current boolean not null default false,    -- 지금 쓰는 교재 (하나만)
  show_students boolean not null default true,  -- 교육생에게 쪽 보여 주기
  use_for_ai boolean not null default true,     -- AI 설명 근거로 쓰기 (T3)
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists textbooks_one_current on public.textbooks (is_current) where is_current;

create table if not exists public.textbook_pages (
  book_id uuid not null references public.textbooks(id) on delete cascade,
  page int not null,                            -- PDF 쪽 번호 (1부터)
  image_path text not null,
  width int not null default 0,
  height int not null default 0,
  text text not null default '',                -- 쪽 글자 (AI 찾기용)
  primary key (book_id, page)
);

-- 다 본 쪽 (그 쪽에서 다음 쪽으로 넘기면 다 본 것)
create table if not exists public.textbook_progress (
  user_id uuid not null references public.users(id) on delete cascade,
  book_id uuid not null references public.textbooks(id) on delete cascade,
  page int not null,
  done_at timestamptz not null default now(),
  primary key (user_id, book_id, page)
);

-- 마지막으로 보던 쪽 ("이어서 보기")
create table if not exists public.textbook_last (
  user_id uuid not null references public.users(id) on delete cascade,
  book_id uuid not null references public.textbooks(id) on delete cascade,
  page int not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

-- 앱(휴대폰)이 직접 읽지 못하게 잠그고, 서버(비밀 키)만 사용
alter table public.textbooks enable row level security;
alter table public.textbook_pages enable row level security;
alter table public.textbook_progress enable row level security;
alter table public.textbook_last enable row level security;
grant select, insert, update, delete on public.textbooks, public.textbook_pages,
  public.textbook_progress, public.textbook_last to service_role;

-- 결과 확인: 교재 수 (처음엔 0)
select count(*) as textbooks from public.textbooks;
