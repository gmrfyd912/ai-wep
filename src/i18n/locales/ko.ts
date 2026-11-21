// 기준 언어 파일. 다른 언어 파일은 이 파일과 키가 정확히 같아야 한다(타입 검사로 확인).
const ko = {
  // 공통
  common_appSubtitle: "AI 용접 교육 플랫폼",
  common_comingSoon: "{{step}}단계에서 연결됩니다",
  common_previewNotice: "미리보기 화면입니다. 실제 데이터가 아닙니다.",
  common_all: "전체",
  common_score: "점수",
  common_points: "{{score}}점",
  common_save: "저장",
  common_cancel: "취소",
  common_back: "뒤로",
  common_select: "선택",
  common_settings: "설정",
  common_toLogin: "로그인",

  // 역할
  role_student: "교육생",
  role_teacher: "교사",
  role_staff: "행정 관리자",
  role_admin: "시스템 관리자",

  // 언어 선택
  language_title: "언어 선택",
  language_subtitle: "사용할 언어를 선택하세요",

  // 로그인
  login_id: "아이디",
  login_password: "비밀번호",
  login_button: "로그인",
  login_noAccount: "계정이 없으신가요?",
  login_signup: "회원가입",
  login_previewTitle: "역할 미리보기 (임시)",
  login_previewDesc: "로그인 기능이 연결되기 전까지 각 역할의 화면을 둘러보는 임시 버튼입니다.",

  // 회원가입
  signup_title: "회원가입",
  signup_roleLabel: "가입 유형",
  signup_name: "이름",
  signup_passwordConfirm: "비밀번호 확인",
  signup_course: "과정",
  signup_coursePlaceholder: "과정을 선택하세요",
  signup_teacherCourses: "담당 과정 (여러 개 선택 가능)",
  signup_submit: "가입하기",
  signup_errorRequired: "이름, 아이디, 비밀번호를 모두 입력하세요.",
  signup_errorPasswordMatch: "비밀번호가 일치하지 않습니다.",
  signup_errorCourse: "교육생은 과정을 반드시 선택해야 합니다.",

  // 승인 대기
  pending_title: "승인 대기 중",
  pending_desc: "관리자가 가입을 승인하면 앱을 사용할 수 있습니다.",
  pending_backToLogin: "로그인 화면으로",

  // 탭 이름
  tab_home: "홈",
  tab_gallery: "갤러리",
  tab_upload: "사진 업로드",
  tab_ranking: "랭킹",
  tab_records: "내 기록",
  tab_teacherBoard: "교사 보드",
  tab_courseBoard: "과정 보드",
  tab_adminHome: "시스템 관리",

  // 교육생 홈
  home_greeting: "{{name}}님, 안녕하세요",
  home_uploadCta: "용접 사진 분석하기",
  home_uploadCtaDesc: "아루코 마커와 함께 찍은 사진을 올리세요",
  home_recentResult: "최근 분석 결과",
  home_theory: "이론 학습",
  home_theoryDesc: "실습 과정이 끝난 뒤 추가됩니다",

  // 갤러리 · 랭킹
  gallery_title: "갤러리",
  gallery_filter: "과정",
  ranking_title: "랭킹",
  ranking_rank: "{{rank}}위",
  ranking_basis: "AI 점수 기준",

  // 사진 업로드
  upload_guideTitle: "촬영 가이드",
  upload_guide1: "30mm 아루코 마커를 비드 바로 옆, 같은 판 위에 놓으세요.",
  upload_guide2: "비드 전체와 마커 4개 모서리가 모두 보이게 찍으세요.",
  upload_guide3: "그림자와 반사가 적은 곳에서 위에서 수직으로 찍으세요.",
  upload_takePhoto: "카메라로 촬영",
  upload_pickPhoto: "갤러리에서 선택",
  upload_infoTitle: "용접 정보",
  upload_process: "공정",
  upload_position: "자세",
  upload_material: "재질",
  upload_analyze: "분석 시작",

  // 내 기록
  records_title: "내 기록",
  records_trend: "점수 추이 그래프",

  // 분석 결과
  result_title: "분석 결과",
  result_tabMetrics: "측정 결과",
  result_tabReport: "AI 리포트",
  result_imagePlaceholder: "분석 이미지",
  result_width: "비드 폭 편차",
  result_straightness: "직진도 편차",
  result_defects: "결함",
  result_reportPlaceholder: "AI 종합리포트가 이곳에 선택한 언어로 표시됩니다.",

  // 3단계: 업로드·실제 결과
  upload_permissionDenied: "카메라·사진 접근을 허용해 주세요. 휴대폰 설정에서 바꿀 수 있습니다.",
  upload_analyzing: "분석 중입니다…",
  upload_wakeHint: "서버가 쉬고 있었다면 첫 분석은 1분쯤 걸릴 수 있어요.",
  error_network: "서버에 연결하지 못했습니다. 인터넷을 확인하고 다시 시도하세요.",
  status_processing: "분석 중",
  status_marker_not_found: "마커를 찾지 못했어요. 마커의 네 모서리가 모두 보이게 다시 찍어 주세요.",
  status_no_bead: "비드를 찾지 못했어요. 비드 전체가 화면 가득 보이게 다시 찍어 주세요.",
  status_roboflow_failed: "비드 인식 서비스에 연결하지 못했어요. 잠시 후 다시 시도하세요.",
  status_error: "분석하지 못했어요. 다시 찍어 주세요.",
  status_short_failed: "실패",
  result_checkImage: "확인 그림",
  result_widthMean: "비드 폭 평균",
  result_widthMin: "최소 폭",
  result_widthMax: "최대 폭",
  result_widthStd: "폭 편차(표준편차)",
  result_straightMax: "직진도(최대 벗어남)",
  result_length: "비드 길이",
  result_warnings: "주의",
  result_tryAgain: "다시 찍기",
  result_betaNote: "정확도 검증 전 시험 버전 수치입니다.",
  records_empty: "아직 분석 기록이 없어요. 업로드 탭에서 첫 사진을 올려 보세요.",
  warn_bead_box_only: "비드 윤곽 대신 상자 모양으로 계산했어요. 정확도가 낮을 수 있어요.",
  warn_multiple_beads: "비드가 여러 개 보여요. 가장 큰 비드만 측정했어요.",
  warn_rectify_too_large: "사진이 너무 비스듬해서 확인 그림을 만들지 못했어요.",

  // 교사 보드
  teacher_title: "교사 보드",
  teacher_myCourses: "담당 과정",
  teacher_students: "교육생",
  teacher_lastScore: "최근 점수",
  teacher_submissions: "제출 {{count}}회",
  teacher_frequentDefect: "자주 나오는 결함",
  teacher_avgScore: "평균 점수",
  teacher_studentCount: "교육생 {{count}}명",

  // 과정 보드 (행정 관리자)
  staff_title: "과정 보드",
  staff_weeklySubmissions: "이번 주 제출",
  staff_homeroom: "담임",
  staff_openBoard: "교사 보드 보기",

  // 결함 이름 (데이터는 영어 코드, 화면은 번역)
  defect_porosity: "기공",
  defect_undercut: "언더컷",
  defect_overlap: "오버랩",
  defect_spatter: "스패터",
  defect_crack: "균열",
  defect_none: "없음",

  // 시스템 관리자
  admin_title: "시스템 관리",
  admin_courses: "과정 관리",
  admin_coursesDesc: "과정 추가, 종료",
  admin_members: "회원 관리",
  admin_membersDesc: "가입 승인, 역할 변경",
  admin_permissions: "권한 설정",
  admin_permissionsDesc: "역할별 권한 부여",
  admin_signupSettings: "가입 방식 설정",
  admin_signupSettingsDesc: "자동 가입 또는 승인 후 가입",
  admin_localOnly: "지금은 화면 확인용입니다. 저장은 6단계에서 연결됩니다.",

  admin_courseNew: "새 과정 이름",
  admin_courseAdd: "추가",
  admin_courseActive: "운영 중",
  admin_courseEnded: "종료",
  admin_courseEnd: "종료하기",
  admin_courseReopen: "다시 열기",

  admin_memberApprove: "승인",
  admin_memberApproved: "승인됨",
  admin_memberPending: "승인 대기",

  admin_permViewAllCourses: "모든 과정 보기",
  admin_permViewOthersResults: "다른 교육생 결과 보기",
  admin_permManageCourses: "과정 관리",
  admin_permManageMembers: "회원 관리",

  admin_approveStudents: "교육생 가입 시 승인 필요",
  admin_approveStaff: "교사·행정 관리자 가입 시 승인 필요",
  admin_approveHint: "끄면 가입 즉시 사용할 수 있습니다(기본값).",

  // 설정
  settings_title: "설정",
  settings_language: "언어",
  settings_profile: "내 정보",
  settings_privacy: "개인정보처리방침",
  settings_deleteAccount: "계정 삭제",
  settings_logout: "로그아웃",
  settings_currentRole: "현재 역할",

  privacy_title: "개인정보처리방침",
  privacy_draft: "개인정보처리방침은 앱 배포 전에 작성해 이곳에 게시합니다. 수집 항목(이름, 아이디, 과정, 용접 사진, 분석 결과), 이용 목적, 보관 기간, 삭제 방법을 안내합니다.",

  delete_title: "계정 삭제",
  delete_warning: "계정을 삭제하면 내 정보와 모든 분석 기록이 영구히 삭제되며 되돌릴 수 없습니다.",
  delete_button: "계정 영구 삭제",

  profile_title: "내 정보",
} as const;

export default ko;
export type TranslationKey = keyof typeof ko;
export type Translation = { [K in TranslationKey]: string };
