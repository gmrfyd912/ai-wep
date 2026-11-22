-- AI W.E.P 6-3단계: 갤러리·반응·댓글·알림
-- Supabase > SQL Editor 에 통째로 붙여넣고 Run. 여러 번 실행해도 안전합니다.
-- (step6-accounts.sql, step6b-boards.sql 을 먼저 실행해 두어야 합니다)

-- 갤러리: 성공한 분석은 자동으로 올라가고, 교사·관리자가 내리면 hidden = true
alter table public.submissions add column if not exists hidden boolean not null default false;
-- 갤러리용 작은 사진 (새로 올린 사진부터. 예전 것은 원본으로 보임)
alter table public.submissions add column if not exists thumb_path text;
create index if not exists submissions_gallery_idx on public.submissions (created_at desc) where status = 'ok' and hidden = false;
create index if not exists submissions_rank_idx on public.submissions (process, position, created_at);

-- 반응 (한 사람이 한 글에 하나): heart, thumbs, check, smile, wow, sad
create table if not exists public.reactions (
  submission_id uuid not null references public.submissions(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  emoji text not null check (emoji in ('heart', 'thumbs', 'check', 'smile', 'wow', 'sad')),
  created_at timestamptz not null default now(),
  primary key (submission_id, user_id)
);

-- 댓글 (parent_id 가 있으면 대댓글, 한 단계까지)
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  parent_id uuid references public.comments(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists comments_submission_idx on public.comments (submission_id, created_at);

-- 앱 안 알림 (댓글 → 글쓴이, 대댓글 → 댓글쓴이)
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('comment', 'reply')),
  submission_id uuid references public.submissions(id) on delete cascade,
  comment_id uuid references public.comments(id) on delete cascade,
  actor_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

-- 앱(휴대폰)이 직접 읽지 못하게 잠그고, 서버(비밀 키)만 사용
alter table public.reactions enable row level security;
alter table public.comments enable row level security;
alter table public.notifications enable row level security;
grant select, insert, update, delete on public.reactions, public.comments, public.notifications to service_role;

-- 결과 확인: 갤러리에 보일 분석 수가 나오면 성공
select count(*) as gallery_count from public.submissions where status = 'ok' and hidden = false and user_id is not null;
