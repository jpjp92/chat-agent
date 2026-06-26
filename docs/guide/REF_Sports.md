# Sports (World Cup): Test Prompt Guide

`sports` intent와 `worldCupTool`(football-data.org 연동) 테스트용 레퍼런스. 현재 진행 중인 FIFA 월드컵의 조별 순위·대진/일정·득점왕을 실시간 조회한다.

> 기술 상세(grounding 한계 진단·API 검증·구현): [`../logs/DEV_260620.md`](../logs/2026/06/DEV_260620.md) §5, [`../logs/DEV_260621.md`](../logs/2026/06/DEV_260621.md)
> 설계/계획: [`../plans/PLAN_WORLDCUP_SPORTS_TOOL_260621.md`](../plans/PLAN_WORLDCUP_SPORTS_TOOL_260621.md), [`../plans/PLAN_WORLDCUP_IMPL_260621.md`](../plans/PLAN_WORLDCUP_IMPL_260621.md)
> ⚠️ `SPORTS_API_KEY`(football-data.org v4, TIER_ONE) 필요. rate limit **분당 6회** → 인메모리 캐시 필수.

---

## 왜 전용 API인가 (grounding 우회)

Gemini Search grounding은 실시간 스포츠 순위에 **구조적으로 부적합**하다 — organic 웹페이지(`groundingChunks[].web.uri`)만 보고 구글 스포츠 지식 패널(위젯)엔 접근 못 한다. 그 결과 조마다 다른 페이지를 긁어 신선도가 불균질(기준일 6/14~6/20 혼재)하고, 소스 수도 매 실행 5~25로 비결정적이다. 전용 API는 정형·최신·완전 데이터를 한 번에 준다(WC 12조 ~232ms).

```
스포츠 질의 → router(sports) → generator(worldCupTool)
   → lib/sports/football-data.ts (fetch + 캐시) → [WORLDCUP_DATA] 마크다운 + 지시문
   → LLM이 데이터만 근거로 답(표/추론), 팀명 한글화, 미확정은 안내
```

다른 렌더러와 달리 **전용 카드가 없다.** tool이 마크다운 표 데이터를 반환하면 LLM이 그대로/가공해 출력하고, `ChatMessage.tsx`의 기존 마크다운 table 스타일로 렌더된다.

---

## Tool Schema — `worldCupTool`

| 인자 | 값 | 설명 |
|---|---|---|
| `resource` | `standings` \| `matches` \| `scorers` | 조회 종류 (LLM이 질문 보고 선택 → 선택적 fetch) |
| `stage` | `GROUP_STAGE`·`LAST_32`·`LAST_16`·`QUARTER_FINALS`·`SEMI_FINALS`·`THIRD_PLACE`·`FINAL` | matches 단계 필터 (예: 16강=`LAST_16`) |
| `status` | `SCHEDULED`·`TIMED`·`FINISHED`·`IN_PLAY`·`PAUSED` | matches 상태 필터 |
| `limit` | number (기본 10) | scorers 표시 인원 |

반환: `[WORLDCUP_DATA]\n<마크다운>\n[지시사항]`. 지시문 = 데이터만 근거·숫자 변형 금지·팀명 한글화·`[NOT_DETERMINED]` 시 안내 문구로 답.

데이터 계층 함수: `getStandings()`, `getScorers(limit)`, `getMatches({stage,status})`. 캐시 TTL standings/scorers 300s, matches 600s, 에러/429 시 stale 폴백.

---

## 테스트 프롬프트

### 1. 조별 순위
```
월드컵 조별리그 전체 순위 알려줘
```
→ `intent=sports`, 12조 A~L 마크다운 표(순위·경기·승무패·득실·승점), 한글 팀명, **1회 일관 응답**.

### 2. 특정 조 / 자유 추론
```
월드컵 A조 순위는?
한국 16강 진출 가능성 어때?
```
→ standings 받아 해당 조만 보여주거나, 순위+남은 경기로 추론.

### 3. 득점왕
```
월드컵 득점왕 누구야?
```
→ scorers Top 10 표(득점·PK·출전수). ⚠️ WC는 **어시스트·평점 미제공**(assists null, rating 없음).

### 4. 대진 / 경기 일정
```
월드컵 16강 대진표 보여줘     # resource=matches, stage=LAST_16
오늘 월드컵 경기 뭐 있어?      # resource=matches, status=SCHEDULED/TIMED
```
→ 확정 대진이면 표, **미확정이면** "아직 경기가 진행되지 않았습니다" 안내(`[NOT_DETERMINED]`, 미정 표 환각 방지).

### 5. 과거 대회 (API 미지원 → 학습지식)
```
2022 월드컵 우승팀 알려줘
```
→ router가 `Sports: 과거 대회 질의 → general`로 분기(연도/`지난`·`역대` 감지). API는 현재 대회만(무료 티어 과거시즌 403)이라 학습지식으로 답하고 실시간 아님을 고지.

---

## Tips

- **현재 대회만**: 진행 중인 월드컵 한정. 과거는 general 분기로 학습지식.
- **신선도 신뢰**: 동점 순위 정렬·경기수까지 API가 확정한 값 그대로 — LLM이 재계산·추정하지 않게 지시문이 강제.
- **rate limit**: 분당 6회. 캐시 히트가 다수 사용자 흡수. 경기 시간대 빈번 조회 시 TTL 재점검.
- **확장 여지**: 같은 키(TIER_ONE)로 CL·EPL·라리가 등 13개 대회 호출 가능 → `worldCupTool`을 범용 `sportsTool`로 일반화 가능(`docs/TODO.md` ⑤-확장). reference `chat_w_AI/utils/football.py`의 CL 멀티그룹 파서 패턴 참고.
