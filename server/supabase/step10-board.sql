-- T4 학습 보드: 웰디 질문 '주제' 칸 + 빠른 조회용 색인
-- Supabase → SQL Editor 에 붙여 넣고 Run (여러 번 실행해도 괜찮음)

alter table public.tutor_messages add column if not exists topic text;   -- 비슷한 질문 묶음 (AI 가 붙임, 한국어 짧은 말)

create index if not exists tutor_messages_book on public.tutor_messages (book_id, created_at desc);
create index if not exists tutor_answers_book on public.tutor_answers (book_id, created_at);
create index if not exists daily_answers_book on public.daily_answers (book_id, created_at);
create index if not exists daily_answers_day on public.daily_answers (day);
