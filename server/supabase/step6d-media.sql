-- AI W.E.P 6-3 수정: 프로필 사진, 목록·랭킹용 비드 이미지(확인 그림 작은 것)
-- Supabase > SQL Editor 에 통째로 붙여넣고 Run. 여러 번 실행해도 안전합니다.
-- (step6c-gallery.sql 을 먼저 실행해 두어야 합니다)

-- 프로필 사진 경로 (photos 저장 공간의 avatars/...)
alter table public.users add column if not exists avatar_path text;

-- 목록·랭킹에 보이는 비드 이미지 (새 사진부터 바로, 예전 사진은 처음 볼 때 서버가 만들어 둠)
alter table public.submissions add column if not exists check_thumb_path text;

-- 결과 확인: 프로필 사진이 있는 회원 수 (처음엔 0)
select count(*) filter (where avatar_path is not null) as with_photo, count(*) as members from public.users;
