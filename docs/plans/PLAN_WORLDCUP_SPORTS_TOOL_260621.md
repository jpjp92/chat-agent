# PLAN — World Cup Sports Tool (football-data.org 연동)

> 작성일: 2026-06-21
> 상태: 설계 승인 대기 → 구현 계획 전환 예정
> 배경 진단: `docs/logs/DEV_260620.md` §5 (grounding 한계 + API 검증 결과)

---

## 1. 목적 / 배경

Gemini grounding(`googleSearch`)은 실시간 스포츠 순위에 **구조적으로 부적합**함이 검증됨:
- organic 웹페이지(`groundingChunks[].web.uri`)만 봄 — 구글 스포츠 지식 패널(위젯) 접근 불가
- 페이지마다 갱신 시점이 달라(6/14~6/20 혼재) 조별 신선도·완전성 불균질, 소스 수도 5~25로 비결정적

**해결**: 전용 sports API(football-data.org)를 LangGraph tool로 연동. 정형·최신·완전 데이터를 LLM에 권위 소스로 주입 → grounding 우회, 할루시네이션·신선도 문제 원천 차단.

API 검증 완료 (현재 `SPORTS_API_KEY`, plan=TIER_ONE): 월드컵 12조 순위 232ms, 득점왕·104경기·knockout 전 단계 호출 가능. 제약: 과거 시즌 403, **rate limit 분당 6회**.

---

## 2. 범위 (확정)

| 항목 | 결정 |
|---|---|
| 대회 | **월드컵(WC)만** (확장은 추후) |
| 기능 | **standings**(조별 순위) · **matches**(대진/일정) · **scorers**(득점왕) |
| 렌더 | drug-tool 패턴 — tool이 정형 데이터 텍스트 반환, **LLM이 사용자 질문에 맞춰 유연하게 답**(표/추론/요약). movie식 고정 카드 아님 |
| 현재 대회 | football-data.org API |
| 과거 대회(2022 등) | **LLM 학습지식**으로 답변 + 실시간 아님 고지 (API 403이므로). grounding/API 안 씀 — 안정적 역사 데이터라 신선도 무관 |

### 렌더 경로 (확정)
- **마크다운 경로** 사용 — tool이 마크다운 표를 내보내면 `ChatMessage.tsx:296`의 `table` 오버라이드가 기존 스타일(rounded-2xl·다크모드·`prose dark:prose-invert`) 자동 적용. 새 UI 컴포넌트 0개. 다른 텍스트 의도와 동일 배경/스타일.
- 영화식 **전용 카드(MovieRenderer 패턴)는 추후 고려** — 자유 질문 유연성 위해 현재는 마크다운 채택.

### 비범위 (YAGNI)
- WC 외 리그(EPL/CL 등) — 추후 확장 여지만 남김
- 과거 시즌 API 유료 업그레이드
- head2head, teams, persons 등 기타 엔드포인트
- 전용 카드 UI 컴포넌트 (crest 로고/하이라이트 등) — 추후

---

## 3. 아키텍처

기존 tool 패턴(movie/drug) 100% 재사용. 신규 파일 2개 + 기존 3곳 수정.

```
router (sports 의도 감지)
  → intent = "sports"   (LANGCHAIN_INTENTS 등록 → google search OFF, tool-calling 경로)
  → generator: worldCupTool 바인딩된 LLM
  → LLM이 질문 분석 → worldCupTool 호출 (resource 인자 선택)
  → ToolNode: lib/sports 데이터 계층 호출 (캐시 경유) → [WORLDCUP_DATA] 텍스트 반환
  → generator: 그 데이터만 근거로 사용자 질문에 답 (표/추론)
```

### 변경 파일
| 파일 | 변경 |
|---|---|
| `lib/sports/football-data.ts` | **신규** — fetch + 멀티그룹 파서(reference CL 패턴 이식) + 캐시 |
| `server/agent/worldcup-tool.ts` | **신규** — LangChain `tool`, movie/drug-tool 동형 |
| `server/agent/graph.ts` | ToolNode 배열에 `worldCupTool` 추가 |
| `server/agent/nodes/router.ts` | `sports` intent 감지 (시맨틱 + 키워드). 과거 대회 질문은 `general`로 분기 |
| `server/agent/nodes/generator.ts` | `LANGCHAIN_INTENTS`(line 147)에 `"sports"` 추가 |

---

## 4. 컴포넌트 상세

### 4.1 데이터 계층 `lib/sports/football-data.ts`
```
fetchStandings(): 12조 정형  — GET /v4/competitions/WC/standings
fetchMatches({stage?, status?}): 경기/대진 — GET /v4/competitions/WC/matches?stage=&status=
fetchScorers({limit=10}): 득점왕 — GET /v4/competitions/WC/scorers?limit=
```
- **scorers 가용 필드 (WC)**: `goals`(득점), `penalties`(PK골), `playedMatches`(출전수). **`assists`·`rating(평점)`은 WC 미제공**(assists는 null로 옴, rating은 API에 없음) → 득점왕 표는 득점/PK/출전수 컬럼으로 구성.
- 팀명은 영문 원본(+`tla` 약자, `crest` 로고 URL) 그대로 반환 → **한글화는 LLM이 처리**(하드코딩 안 함, 검증 완료).
- 인증: `headers: { 'X-Auth-Token': process.env.SPORTS_API_KEY }`
- 파서: reference `utils/football.py`의 CL 멀티그룹 로직 이식 — `standings[]` 순회 → `group.table[]` → `{순위, 그룹, 팀, 경기, 승, 무, 패, 득점, 실점, 득실차, 승점}`
- 캐시: 리소스별 차등 TTL — **standings/scorers 5분, matches 10분** (분당 6회 제약 대응)
  - 캐시 구현: 1차 인메모리(Map+timestamp, 서버리스 인스턴스 재사용 활용), 필요 시 Supabase `url_cache` 패턴으로 확장
- rate-limit: `X-Requests-Available-Minute` 헤더 감지 → 0 근접 시 stale 캐시 폴백

### 4.2 tool `server/agent/worldcup-tool.ts`
```ts
schema: {
  resource: "standings" | "matches" | "scorers",   // LLM이 질문 보고 선택 → 선택적 fetch
  stage?:   "LAST_32"|"LAST_16"|"QUARTER_FINALS"|"SEMI_FINALS"|"THIRD_PLACE"|"FINAL"|"GROUP_STAGE",
  status?:  "SCHEDULED"|"FINISHED"|"LIVE"|"IN_PLAY",
}
```
- return: `[WORLDCUP_DATA]\n<정형 데이터>\n` + 지시문:
  - "이 데이터만 근거로 답하고 순위·점수·선수명을 지어내지 말 것. 실시간 기준 데이터임"
  - "팀명은 한국어로 번역해 표기할 것"
  - "**미확정 항목(미정 대진 등)은 표로 나열하지 말고 '아직 경기가 진행되지 않았습니다'로 안내**할 것" (16강 대진이 조별리그 진행 중일 때 등 — 검증서 미정 8경기 확인)
- description: "**현재 진행 중인** FIFA 월드컵의 조별 순위/대진·경기일정/득점왕을 조회. 과거 대회는 미지원."

### 4.3 라우팅 `router.ts`
- 시맨틱 라우터 프롬프트에 intent 추가:
  `"sports" : 현재 진행 중인 월드컵 순위/경기/대진/득점왕 (월드컵, world cup, 조별, 16강, 8강, 대진, 득점왕)`
- 과거/완료 대회 명시(예: "2022 월드컵", "지난 월드컵") → `general`로 분기 → LLM 학습지식 답변
- 키워드 보조 정규식: `/(월드컵|world\s?cup|조별|16강|8강|준결승|결승|대진|득점왕)/i`

---

## 5. 에러 처리

| 상황 | 처리 |
|---|---|
| API 실패 / 429 | 캐시된 직전 데이터 있으면 사용(+"갱신 지연" 안내), 없으면 "일시적으로 못 가져옴" 솔직 안내. **grounding 폴백 안 함**(더 나쁨이 입증됨) |
| 과거 시즌(403) | router에서 `general` 분기로 대부분 차단. 혹 tool 호출돼도 description상 LLM이 학습지식으로 전환 |
| 빈 데이터(경기 전) | 빈 표 채우지 말고 "아직 경기 데이터 없음" 표기 (DEV_260620 §5 H조 환각 교훈) |

---

## 6. 테스트

- 데이터 계층: `scripts/test-sports-api.mjs`, `test-sports-capabilities.mjs` (작성·검증 완료)
- 추가:
  - 파서 단위 테스트 — 멀티그룹 JSON → 정형 12조
  - 캐시 TTL 동작 — 2회 호출 시 1회만 네트워크
  - intent 라우팅 — "월드컵 조별 순위" → sports / "2022 월드컵" → general

---

## 7. 성공 기준

1. "월드컵 조별 순위" → 12조 전부 일관 표 출력, 1회 응답 내 (grounding 신선도 불균질 해소)
2. "한국 16강 가능성?", "메시 몇 골?", "16강 대진" 등 자유 질문 커버
3. grounding two-track(10~27s) 대비 대폭 빠른 응답 (캐시 히트 시 즉시)
4. 분당 6회 한도 내 정상 동작 (캐시로 다수 사용자 흡수)
5. 과거 대회 질문 시 학습지식 답변 + 실시간 아님 고지, 가짜 출처 없음

---

## 8. 미해결 / 검토 포인트
- 캐시 TTL 값(5분/10분) — 토너먼트 진행 강도에 따라 조정 가능
- 인메모리 캐시 vs Supabase — 서버리스 다중 인스턴스 환경에서 히트율 확인 후 결정
