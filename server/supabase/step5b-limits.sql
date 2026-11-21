-- AI W.E.P 5단계 추가 (박사 요청 2026-11-21)
-- 1) 교육생 AI 리포트 하루 한도 2건 → 5건
-- 2) 지금까지 사진을 올린 휴대폰(= 박사님 시험용 휴대폰)은 한도 없이 리포트를 만들 수 있게
-- Supabase > SQL Editor 에 통째로 붙여넣고 Run. 여러 번 실행해도 안전합니다.
-- 나중에 다른 시험용 휴대폰에서 사진을 올린 뒤 다시 Run 하면 그 휴대폰도 추가됩니다.
update public.app_settings
set value = value || jsonb_build_object(
      'report_daily_limit', 5,
      'report_unlimited_devices',
      (select coalesce(jsonb_agg(distinct device_id), '[]'::jsonb) from public.submissions)
    ),
    updated_at = now()
where key = 'criteria';

-- 결과 확인: 아래 줄에 휴대폰 번호 목록과 5 가 보이면 성공
select value->'report_daily_limit' as daily_limit, value->'report_unlimited_devices' as unlimited_devices
from public.app_settings where key = 'criteria';
