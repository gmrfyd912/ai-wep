-- AI W.E.P T3(이론) 보강: 웰디로 만든 문제를 문제 은행에, 같은 질문은 저장된 답으로
-- Supabase > SQL Editor 에 통째로 붙여넣고 Run. 여러 번 실행해도 안전합니다.
-- (step8-daily.sql, step9-tutor.sql 을 먼저 실행해 두어야 합니다)

-- 문제를 누가 만들었나: admin(관리자 문제 은행) / tutor(교육생이 웰디에게 요청)
alter table public.quiz_questions add column if not exists source text not null default 'admin';
alter table public.quiz_questions add column if not exists created_by uuid references public.users(id) on delete set null;
create index if not exists quiz_questions_book_page on public.quiz_questions (book_id, page);

-- 저장된 답을 준 대화면 원래 대답(AI 가 한 대답)의 id
alter table public.tutor_messages add column if not exists cache_of uuid;
create index if not exists tutor_messages_cache on public.tutor_messages (book_id, lang, created_at desc) where ai;

-- 대화 중 단답형 문제는 글로 답하므로 답 칸을 글자로
alter table public.tutor_answers alter column answer type text using answer::text;
