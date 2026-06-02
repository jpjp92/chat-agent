# 변경 요약 — Latency Search Routing (general 검색 판정)

> 작성: 2026-05-31 · 기획: [PLAN_LATENCY_SEARCH_ROUTING.md](./PLAN_LATENCY_SEARCH_ROUTING.md)

## 목적
`general` intent에서 **검색이 불필요한 질문(코드·번역·개념·계산 등)에 Google Search를 끄고**, 필요한 질문(날씨·뉴스·최신·인물·시세 등)에만 켜서 불필요한 2-track 지연을 제거한다. 기존 13-intent 분류·tool 로직·image/url/video/renderer/medical 분기는 **전부 보존**.

## 핵심 설계
- 검색 필요 여부는 13-intent와 **직교(orthogonal)**. `general`만 모호하므로 `general`에 한해 판정.
- 3-게이트 룰: **강한 OFF** / **강한 ON** / **회색지대(gray)** → 회색지대는 router LLM(lite) 판정, 누락 시 **default-on**(검색누락 방어 우선).
- 멀티턴 가드: 직전 턴 검색 발생 + 현재 메시지가 follow-up 가공형(요약·정리·비교·방금 등)이면 재검색 억제. 단 "더 최신 걸로" 같은 **새 최신요구(temporal/domain ON & not past-ref)**는 ON 유지.
- `prevSearched`는 grounding 마커가 히스토리에 영속되지 않으므로(route.ts가 content만 복원) **직전 human 메시지에 `classifySearchNeed`를 재적용한 근사(A안)**로 판정.

## 파일별 변경

### 1. `server/agent/intentRules.ts` (추가)
- `type SearchDecision = "on" | "off" | "gray"`
- `SEARCH_OFF_PATTERNS` (코드·번역·창작·계산·개념설명), `SEARCH_ON_PATTERNS` (temporal·domain·explicit·person·ranking·finance)
- `FOLLOWUP_REF_PATTERN`, `PAST_REF_PATTERN`
- `classifySearchNeed(text)`, `isFollowupReference(text)`, `isPastReference(text)`, `shouldSuppressSearchForFollowup(currentText, prevSearched)`
- 기존 export(`classifyIntentByRules` 등) 불변.

### 2. `server/agent/state.ts` (필드 추가)
```ts
needsSearch: Annotation<boolean>({
    reducer: (x, y) => y ?? x,   // ?? 필수 — boolean이라 || 금지 (false 보존)
    default: () => true,          // default-on 안전판
})
```

### 3. `server/agent/nodes/router.ts` (수정)
- import에 `classifySearchNeed` 추가.
- router LLM 프롬프트 출력에 `needs_search` 필드 추가 → `{"intent": "...", "needs_search": true}` (추가 LLM 호출 없음, intent 판정과 동일 콜).
- `general`에 한해 `needsSearch` 산출: rule이 `on`/`off`면 그 값, `gray`면 LLM의 `needs_search`, 둘 다 없으면 `true`(default-on).
- 반환에 `needsSearch` 포함. fast-path(YouTube/drug)는 early-return 유지(generator 게이트가 별도 제어).

### 4. `server/agent/nodes/generator.ts` (수정)
- import에 `classifySearchNeed`, `shouldSuppressSearchForFollowup` 추가.
- renderer 게이트 직후, **`intent==='general' && useGoogleSearch===true`**("순수 general")일 때만:
  - 게이트7: `useGoogleSearch = state.needsSearch`
  - 게이트6: 직전 human 메시지로 `prevSearched` 근사 → `shouldSuppressSearchForFollowup`이면 `useGoogleSearch = false`
- image/url/video/renderer는 이미 `useGoogleSearch=false`라 제외, medical_qa는 `intent!=='general'`이라 제외 → **기존 동작 무손상**. `useGoogleSearch=false`면 기존 로직상 single-pass 자동 전환.

## 검증 스크립트 (신규)
| 스크립트 | 대상 | 결과 |
|---|---|---|
| `scripts/test-search-rules.mjs` | 룰 프로토타입(LLM-free) | 단일턴 22/22, FP 0, 가드 4/4 |
| `scripts/test-search-routing-multilingual.mjs` | lite 다국어(en/es/fr) | 14/14 |
| `scripts/verify-intentrules-search.mts` | 프로덕션 `intentRules.ts` export ↔ 프로토타입 일치 | 22/22, FP 0, 가드 4/4 |
| `scripts/verify-search-integration.mts` | router+generator 합성 결정 시뮬레이션 | **15/15** |

- 타입: `npx tsc --noEmit` → **0 errors** (state/router/generator 전체).

## 추가 버그픽스 (동일 세션, 테스트 중 발견)

### `generator.ts` — MALFORMED_FUNCTION_CALL 빈응답 2.5 폴백
- **원인**: 3.5-flash가 tool 없이도 function-call 토큰을 흉내내다 깨짐(MALFORMED) + `thinkingLevel:low` 토큰 소진 → 빈 텍스트 → LangChain 폴백(bindTools → 또 빈응답) 연쇄.
- **수정**: single-pass 빈응답 블록에 `finishReason === 'MALFORMED_FUNCTION_CALL'` 분기 추가 → 2.5-flash 1회 폴백(`thinkingBudget:0`, tool 없이). MALFORMED일 때만 동작, 기존 SAFETY/정상 경로 무영향.

### `generator.ts` — Two-track stage1 empty 키교체 재시도
- **원인**: 2.5+search가 grounding은 하되 텍스트만 비우는 간헐적 케이스 → 즉시 `throw` → LangChain 폴백 → 또 빈응답 → 사용자 에러. stage1에 재시도 로직이 없었음.
- **수정**: stage1 empty 감지 시 다른 키로 1회 재시도. 성공하면 정상 stage2 진행, 실패 시에만 기존 throw.
- **연관**: needsSearch=true → 3.5 free-tier grounding 불가 → 항상 two-track(2회 호출) → 빈응답 확률 누적. 두 수정 적용 후 테스트에서 MALFORMED·stage1 empty 모두 해소 확인.
- **검증**: `npx tsc --noEmit` → 0 errors.

## 잔여 (비차단, post-impl)
- 실측 지연 측정(#6)
- prevContext ↔ needs_search 상호작용 재확인(#2)
- medical_qa 멀티턴은 의도적 비최적화(#5)
- 3.5 single-pass `thinkingLevel: "low"` → `"minimal"` 검토 (MALFORMED 발생 빈도 근원 차단, 품질 trade-off 있음)
- LangChain 폴백에서 general은 `bindTools` 생략 검토 (이중 방어)
