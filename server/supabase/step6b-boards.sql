-- AI W.E.P 6-2단계: 담임·부담임, 행정 관리자 추가 권한, 교사가 만든 AI 리포트 구분
-- Supabase > SQL Editor 에 통째로 붙여넣고 Run. 여러 번 실행해도 안전합니다.
-- (step6-accounts.sql 을 먼저 실행해 두어야 합니다)

-- 과정 안에서 교사의 역할: homeroom = 담임(과정마다 1명), assistant = 부담임(여러 명)
alter table public.user_courses add column if not exists course_role text
  check (course_role in ('homeroom', 'assistant'));

-- 지금까지 가입한 교사의 담당 과정은 일단 부담임으로 (시스템관리자가 과정 관리에서 담임을 정함)
update public.user_courses uc set course_role = 'assistant'
from public.users u
where u.id = uc.user_id and u.role = 'teacher' and uc.course_role is null;

-- 행정 관리자 추가 권한 (시스템관리자가 사람마다 부여): {"manage_courses": true, "manage_members": true}
alter table public.users add column if not exists permissions jsonb not null default '{}'::jsonb;

-- AI 리포트를 누가 만들었는지 (교사가 학생 리포트를 만들면 학생 하루 한도에 세지 않음)
alter table public.reports add column if not exists created_by uuid references public.users(id) on delete set null;
create index if not exists reports_creator_created_idx on public.reports (created_by, created_at desc);

-- 결과 확인: 교사 담당 과정 목록이 보이면 성공 (아직 교사가 없으면 빈 표)
select u.name, c.name as course, uc.course_role
from public.user_courses uc join public.users u on u.id = uc.user_id join public.courses c on c.id = uc.course_id
where u.role = 'teacher';
