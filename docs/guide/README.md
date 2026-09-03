# Guide Index

> 최종 점검: 2026-09-03

현재 동작을 설명하는 레퍼런스와 기능별 테스트 프롬프트의 진입점이다. 전체 프로젝트 현황은 [docs/README](../README.md), 구현 이력은 [DEV_HISTORY](../DEV_HISTORY.md), 실행 순서는 [PLAN_INDEX](../plans/PLAN_INDEX.md)를 따른다.

## 핵심 아키텍처

| 문서 | 범위 | 상태 |
|---|---|---|
| [Architecture](REF_Architecture.md) | LangGraph, 모델·intent 라우팅, URL Fetch, 오류·스트리밍 정책 + **도구 정의가 두 벌인 구조** | 2026-09-03 현행화 |
| [DB](REF_DB.md) | Supabase Auth, RLS, 채팅 테이블, Storage, URL 캐시, MFDS | 2026-08-23 현행화 |
| [Document](REF_Document.md) | 업로드, HWP 파싱, PDF·영상 capability fallback | 2026-09-03 검색 게이트 절 정정 |
| [Search Routing](REF_SearchRouting.md) | 검색 on/off tier 정책(공급자별 400), 이미지+검색 탈출구, 논문↔소프트웨어 산출물 3층 방어 + **테스트 질의 카탈로그** | 2026-09-03 신규 |
| [CI/CD](REF_CICD.md) | GitHub Actions와 dev/main 배포 흐름 | 기능 변경 시 별도 검증 필요 |

## 도구·렌더러

| 영역 | 문서 |
|---|---|
| 날씨 | [Weather](REF_Weather.md) |
| 영화 | [Movie](REF_Movie.md) |
| 의약품·약국·병원·동물병원 | [Drug](REF_Drug.md), [Pharmacy](REF_Pharmacy.md), [Hospital](REF_Hospital.md), [Vet](REF_Vet.md) |
| 법령·스포츠 | [Law](REF_Law.md), [Sports](REF_Sports.md) |
| 논문·근거 (PubMed·arXiv) | [Paper](REF_Paper.md) — **arXiv 검색어 3계약**(AND 조립 · 범용어 금지 · 제목 구절 폴백)과 로컬 확인 체크리스트 A~K · 실측 기록 |
| 차트·과학 시각화 | [Chart](REF_Chart.md), [Biology](REF_Biology.md), [Chemistry](REF_Chemistry.md), [Physics](REF_Physics.md), [Diagram](REF_Diagram.md), [Constellation](REF_Constellation.md) |

## 설계 참고자료

- [App2 Agent 검토](REF_App2_Agent.md)와 [External Agents](REF_ExternalAgents.md)는 외부 에이전트에서 가져올 설계 원칙을 기록한 분석 문서다. 현재 런타임의 최종 계약은 `REF_Architecture.md`가 우선한다.
- [Gemini Prompt Guide](REF_Gemini_Prompt_Guide.md)는 공급자 원문 성격의 참고자료다. 프로젝트의 멀티 공급자 정책을 설명하는 문서가 아니다.
- [Understand Anything](REF_UnderstandAnything.md)는 개발 도구 참고 문서다.
- 추적되는 DB DDL과 실행 순서의 유일한 출처는 [db/README](db/README.md)다.

## 유지 규칙

- 현재 동작을 바꾼 코드 변경은 관련 `REF_*.md`와 수정일을 함께 갱신한다.
- 외부 검토·과거 설계 문서는 역사적 판단을 보존하고, 현재 계약과 다르면 상단에 현행 상태 안내를 둔다.
- `scripts/`의 로컬 프로브는 Git에서 추적되지 않으므로 링크하지 않는다. 재현 가능한 회귀 하니스는 `tests/`, 네트워크 프로브는 `tests/manual/`에 둔다.
