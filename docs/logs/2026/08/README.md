# 2026년 8월 작업 인덱스

`DEV_*.md`만 보면 8월 15일 다음이 23일로 보이지만, 17·18·22일 작업은 통합 이력이나 계획서에 기록되어 있다. 파일이 누락된 표시 문제가 아니라 당시 날짜별 DEV 로그를 별도로 만들지 않은 기록 방식의 차이다.

| 날짜 | 날짜 로그 | 관련 기록 | 비고 |
|---|---|---|---|
| 08-01 | [DEV_260801](DEV_260801.md) | — | 배포 검증, 렌더링·날씨·영화 후속 작업 |
| 08-05 | [DEV_260805](DEV_260805.md) | — | 화면 검증, 수식·다국어 작업 |
| 08-08 | [DEV_260808](DEV_260808.md) | — | 업로드 미디어와 모델 capability 수정 |
| 08-15 | [DEV_260815](DEV_260815.md), [배포 점검](DEV_260815_DEPLOY_CHECK.md) | [검색 정책 계획](../../../plans/PLAN_SEARCH_POLICY_260815.md) | 검색 의도분류와 종단 검증 |
| 08-17 | 별도 DEV 파일 없음 | [3.7 모델](../../../plans/PLAN_MODEL_3_7_MIGRATION_260817.md), [모델 API](../../../plans/PLAN_MODEL_API_REVIEW_260817.md), [우선순위](../../../plans/PLAN_PRIORITY_260817.md) | 구현·검증 상세는 [DEV_HISTORY](../../../DEV_HISTORY.md#최근-작업-로그)에 통합 기록 |
| 08-18 | 별도 DEV 파일 없음 | [테스트 문서](../../../../tests/README.md), [DEV_HISTORY](../../../DEV_HISTORY.md#최근-작업-로그) | `scripts/`에서 `tests/`로 회귀 하니스 이전, 알약/DDG 수정 |
| 08-22 | 별도 DEV 파일 없음 | [하드닝 계획](../../../plans/PLAN_HARDENING_260822.md) | 서버 경계·인증·쿼터·SSRF 점검 및 URL 장애 분석 시작 |
| 08-23 | [DEV_260823](DEV_260823.md) | [멀티 공급자 라우팅](../../../plans/PLAN_MULTI_PROVIDER_ROUTING_260823.md) | URL 공급자 실측, 모델 UI, GPT 멀티턴·로컬 function calling, 약품 공급자 검색, OpenAI 번호 citation UI |
| 08-24 | [DEV_260824](DEV_260824.md) | [멀티 공급자 라우팅](../../../plans/PLAN_MULTI_PROVIDER_ROUTING_260823.md) | 카드 후속 결함 3건, 심평원 진료시간 연동, 동물병원 인허가 고지·검색, Gemini 인용 번호화, 자정 직후 날짜 |

앞으로 의미 있는 코드 변경이 있는 날은 날짜 로그를 만들고, 계획만 작성한 날도 이 월별 인덱스에 표시한다.
