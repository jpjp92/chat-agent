# PLAN — 검색 판정 재설계: 증거(Signal) → 정책(Policy) 2단 분리

> 작성: 2026-08-15
> 상태: **Step 0~4·6 완료 + dev 배포. Step 5·7 구조 정리 남음**
> 배포 검증: ✅ **B2(유일한 위험 방향 변경) 해소 확인** — [DEV_260815_DEPLOY_CHECK](../logs/2026/08/DEV_260815_DEPLOY_CHECK.md) C1·C2
> 진단: [DEV_260815](../logs/2026/08/DEV_260815.md)
> 대체 대상: [PLAN_LATENCY_SEARCH_ROUTING](./PLAN_LATENCY_SEARCH_ROUTING.md) §6-2 게이트 우선순위 · §6-3 멀티턴 가드 · §9-B(A안)

---

## 문제

`"그럼 모티프 모델 구체적으로 찾아서 정리해보자"`에 검색이 붙지 않았다. 사용자가 `"검색해서 찾아보자"`라고 **단어를 직접 쓰자** 그제서야 동작했다.

정규식 2줄로 이 증상은 막을 수 있다. 하지만 원인은 정규식이 아니다 — **판정 권한이 3개 레이어에 흩어져 서로를 덮어쓰는 구조**다. 같은 유형이 반복해서 난다.

### 세 가지 구조적 병리

1. **권한 분산** — `router.ts`가 `needsSearch`를 정하면 `search-gate.ts`의 7개 게이트가 순차적으로 덮어쓴다. 우선순위는 **if문의 물리적 배치 순서**로만 존재한다.
2. **정보 손실이 재분석을 부른다** ← 진짜 원인
   `needsSearch`가 **boolean**이라 "왜"가 state를 건너오며 사라진다. 그래서 search-gate는 근거를 모른 채 원문을 정규식으로 **다시** 분석한다(`explicitSearchRequested` 재판정, `prevSearched` 근사, `classifySearchNeed` 재호출). 이 재분석이 원판정과 어긋나는 순간이 버그다.
3. **휴리스틱이 사용자 명시 요청을 이긴다** — 계층이 없으니 "API 물리 제약"과 "정리라는 단어가 있네"가 동등하게 경쟁한다.

> **원칙: boolean으로 좁힌 결정을 하위 레이어에 넘기면, 하위 레이어는 반드시 추측을 시작한다.**

---

## 설계 결정 (승인됨)

| 질문 | 결정 | 탈락안 |
|---|---|---|
| 최종 권한 | **증거→정책 2단 분리** | Router LLM 단일 결정자(무료티어 503에 품질 직결) · 현 구조 유지 |
| 멀티턴 근거 | **실제 검색 여부 영속화** | 정규식 근사 유지 · 가드 제거 |
| 범위 | **검색 판정만 먼저** | weather/movie 후속 판정 동시 통합 |

---

## 1. 핵심 구조 — 신호와 계층

모든 판정 주체가 boolean을 **덮어쓰는** 대신, 근거를 담은 신호를 **제출**한다.

```ts
type SearchSignal = {
  tier: Tier;           // 권한 계층
  verdict: 'on' | 'off';
  source: string;       // 'user-explicit' | 'url-content' | 'router-llm' | ...
  reason: string;       // 로그용 근거
};
```

계층은 **"왜 이 판정이 다른 판정을 이기는가"**에 대한 답이며, 코드가 아닌 **데이터**다.

| Tier | 이름 | 낼 수 있는 판정 | 근거 |
|---:|---|:---:|---|
| 400 | `HARD_CONSTRAINT` | **off만** | 이미지·멀티모달 동반 시 Gemini API가 grounding을 물리적으로 거부. **Gemini 턴에서만 낸다** — 아래 정정 참조 |
| 300 | `USER_EXPLICIT` | **on만** | 사용자가 검색·출처를 명시 요청 — 시스템이 뒤집을 권리 없음 |
| 200 | `CONTEXT_GROUNDED` | off | 답변 근거가 이미 제공됨 (URL·첨부문서·영상 자막/요약) |
| 100 | `CLASSIFIER` | on/off | 룰 판정, 라우터 LLM `needs_search`, **멀티턴 follow-up 가드** |
| 0 | `DEFAULT` | on | 검색 누락 방어 |

**최고 tier의 신호가 이긴다.** 동 tier 내 충돌은 명시된 순서로 해소한다: `rule-on > rule-off > llm > default`.

### 이 구조가 버그를 없애는 방식

- 멀티턴 가드가 **tier 100으로 강등**된다 → `"검색해서 정리해줘"`(tier 300)를 **원리적으로 이길 수 없다.**
  현재는 두 정규식이 같은 층에서 싸우다 나중에 실행되는 쪽이 이겼다.
- tier 400이 300 위인 것도 의도적이다 — 이미지가 붙어 있으면 사용자가 검색을 요청해도 API가 거부하므로, **물리 제약이 사용자 의사보다 위**다. 이건 정책이 아니라 사실이다.

> 🔴 **정정(2026-09-02).** 위 문장은 참이지만 **주어가 빠져 있었다** — 거부하는 것은 *Gemini* API 다.
> OpenAI Responses 는 `input_image` 와 `web_search` 를 한 요청에 같이 보낸다. 그런데 400 은 공급자를
> 가리지 않고 발동해, GPT 턴에서 *"지금은 실시간 검색 없이 학습된 지식 기준으로만 답할 수 있어요"* 가
> 나갔다(대화에 이미지가 한 번이라도 있으면 그 뒤 모든 턴). `decideGoogleSearch` 에 `provider` 를 넘겨
> **400 두 신호를 Gemini 턴에서만** 내도록 고쳤다. 200·100 은 공급자와 무관한 판단이라 그대로다.
> 상세: [DEV_260902_SEARCH_ROUTING](../logs/2026/09/DEV_260902_SEARCH_ROUTING.md)
>
> **남는 규칙: tier 는 "누가 더 센가"를 적은 것이지 "어디서 성립하는가"를 적은 것이 아니다.**
> 계층에 전제를 함께 적지 않으면, 전제가 사라진 곳까지 규칙이 따라간다.

**정규식은 사라지지 않는다.** "결정"에서 "증거"로 강등되고, 우선순위가 선언적 데이터가 된다.

---

## 2. 구성 요소와 데이터 흐름

### 신규: `server/agent/search-policy.ts`

순수 함수 2개. 부작용 없음 → LLM·네트워크 없이 전량 테스트 가능.

```ts
export const collectSearchSignals = (ctx: SearchContext): SearchSignal[]
export const decideSearch = (signals: SearchSignal[]): SearchDecisionResult
// SearchDecisionResult = { useGoogleSearch, winner: SearchSignal, trace: SearchSignal[] }
```

### 단일 출처화

`"명시적 검색 요청"`을 `detectExplicitSearchRequest(text)` **단 하나의 함수**로 통합한다.

| 현재 | 정규식 | 문제 |
|---|---|---|
| [intentRules.ts:117](../../server/agent/intentRules.ts#L117) `explicit` 태그 | `검색해\|검색 해\|찾아봐\|찾아 줘\|알아봐\|출처\|근거\|cite\|search` | `찾아서`·`찾아줘`·`찾아보자`·`조사`를 놓침 |
| [search-gate.ts:120](../../server/agent/nodes/search-gate.ts#L120) `explicitSearchRequested` | `검색\|찾아\|조사\|출처\|근거\|최신\|최근\|실시간\|뉴스\|…` | 훨씬 넓음 — 두 정의가 불일치 |

통합 정규식은 **넓은 쪽 기준**으로 하되, `최신/최근/실시간/뉴스`는 명시 요청이 아니라 **시의성 신호**이므로 `temporal`/`domain` 태그로 분리한다. 명시 요청과 시의성은 다른 개념이고, tier도 다르다(300 vs 100).

### 흐름

```
router.ts       → 신호 제출: rule 판정, LLM needs_search        (tier 100)
                  state.searchSignals[] 에 누적
      ↓
search-gate.ts  → 신호 제출: 멀티모달(400), 명시요청(300),
                  URL/문서/영상(200), 멀티턴 가드(100), 기본(0)
      ↓
decideSearch()  → 최고 tier 승자 결정 + trace 반환
      ↓
generator.ts    → useGoogleSearch 사용 (변경 없음)
```

`state.needsSearch`(boolean)는 소비자가 search-gate 하나뿐이므로 `searchSignals`로 교체한다. 외부 영향 없음.

### 관측성 — 로그 한 줄에 전체 근거

현재는 게이트별로 로그가 흩어져 있어 조합 추적이 불가능하다. 재설계 후:

```
[SearchPolicy] ON by user-explicit(300) "찾아서 요청"
  | trace: hard=none, explicit=on(300), context=none,
           rule=gray, llm=on(100), followup-guard=off(100), default=on(0)
```

**이 한 줄이면 이번 버그를 로그만 보고 3초 만에 특정할 수 있었다.**

---

## 3. 멀티턴 근거 영속화

기존 `prevSearched`는 **직전 human 메시지에 정규식을 재적용한 근사**다([PLAN_LATENCY_SEARCH_ROUTING](./PLAN_LATENCY_SEARCH_ROUTING.md) §9-B A안). 근사가 오발의 원인이다.

**실제 grounding 발생 여부를 되돌려받는다.**

### 구현 시 단순화 (설계 변경 — 배선 3단계 생략)

초안은 `generator → 응답 메타 → geminiService → route.ts` 왕복을 새로 깔 계획이었다.
구현 중 **그 값이 이미 왕복하고 있다**는 걸 확인해서 새 배선을 깔지 않았다:

```
generator → SSE `sources` → 클라이언트 Message.groundingSources → 다음 요청 history
                                                                    ↓
                              route.ts  deriveLastTurnSearched(history)
                                                                    ↓
                                                    state.lastTurnSearched
                                                                    ↓
                            search-gate  prevSearched = state값 ?? 정규식 근사
```

DB 복원 세션도 `useChatSessions`가 `grounding_sources`를 같은 필드로 되살리므로 그대로 동작한다.
**클라이언트 코드 변경이 없다** → C4(비변경 경계에서 클라이언트를 빼야 한다)가 **무효가 됐다. 경계 유지.**

| | 초안 | 구현 |
|---|---|---|
| 측정 대상 | grounding **부착 여부** | grounding **출처 반환 여부** |
| 변경 파일 | generator·geminiService·route·state·gate (5) | history·route·state·gate (4, 클라 0) |
| 구버전 클라 | 폴백 필요 | 해당 없음(서버만 봄) |

> **트레이드오프**: 검색을 켰는데 출처가 0건이면 `false`로 잡힌다.
> 가드의 목적이 "직전 **검색 결과**를 가공해달라는 요청인가"이므로 출처 유무가 오히려 더 맞는 측정이고,
> 틀리는 방향도 안전하다(억제 실패 = 검색 한 번 더, 검색 누락 아님).

선례: [router.ts:63](../../server/agent/nodes/router.ts#L63) `state.activeCards?.weather ?? weatherCardInWindow` — 클라이언트 값 우선, 없으면 서버 추정 폴백. **동일 폴백 구조를 유지**하므로 구버전 클라이언트도 깨지지 않는다.

### 왜 Step 5보다 먼저 하는가 (2026-08-15 배포 테스트에서 확정)

근사가 **틀리는 정도**가 아니라 **특정 대화에서는 아예 서지 않는다**는 것이 확인됐다:

```
prev="인공타액제 알려줘" → classifySearchNeed=gray → prevSearched=false   (실제로는 검색됨)
prev="오늘 AI 뉴스 알려줘" → classifySearchNeed=on   → prevSearched=true
```

`medical_qa`는 **tier로 검색을 강제**해서 켜진다 — 정규식이 `on`을 내서 켜지는 게 아니다.
룰이 아니라 intent로 검색이 결정되는 경로(medical_qa · 카드 계열)는 전부 같은 구멍을 갖는다.
현재 이 조합을 막고 있는 건 가드가 아니라 **라우터 LLM의 `needs_search=false` 반환**이다 —
무료티어 503이면 그대로 재검색이 붙는다. 상세: [DEV_260815_DEPLOY_CHECK](../logs/2026/08/DEV_260815_DEPLOY_CHECK.md)

---

## 4. ⚠️ 기존 문서와의 충돌 (검토 결과)

이 계획은 기존 기획의 일부를 **의도적으로 폐기**한다. 문서 간 모순을 남기지 않기 위해 명시한다.

| # | 기존 문서 | 내용 | 이 계획 | 조치 |
|---|---|---|---|---|
| C1 | LATENCY §6-2 | 게이트6(멀티턴 가드)이 게이트7(라우터 판정)**보다 위** | 가드를 tier 100으로 **강등**, 명시요청(300)에 종속 | **폐기**. LATENCY §6-2에 상호참조 주석 추가 |
| C2 | LATENCY §4-2 | `explicit`은 `SEARCH_ON_PATTERNS`의 **한 태그** | `USER_EXPLICIT` **전용 tier 300** 신설 | **승격**. 이번 버그의 근본 |
| C3 | LATENCY §9-B | `prevSearched` 정규식 근사(A안) | **실제 검색 여부 영속화** | **폐기** |
| C4 | LATENCY §7 | 비변경 경계에 **"클라이언트 코드"** 포함 | C3 때문에 클라이언트 변경 **필요** | **경계 갱신**. 범위는 플래그 1개 전달뿐 |
| C5 | CHANGES 검증표 | `verify-intentrules-search.mts` **22/22** | 실행 결과 **20/22 · `❌ MISMATCH`** | **문서가 스테일. 아래 참조** |

### C5 상세 — 검증 하니스가 이미 RED다

2026-08-15 실행 결과:

```
❌ exp=off got=gray | 광합성 과정을 설명해줘
❌ exp=off got=gray | TCP 핸드셰이크가 어떻게 작동하는지 설명해줘
단일턴: 20/22 → ❌ MISMATCH — 프로토타입과 불일치
```

**이건 프로덕션 버그가 아니다.** [intentRules.ts:101-103](../../server/agent/intentRules.ts#L101-L103)이 `설명해/원리/개념`을 강한 OFF에서 **의도적으로 제외**했다(DEV_260624 §5 A안 — `"gpt 5.5 설명해줘"` 같은 최근 엔티티 설명은 검증 검색이 필요하므로 gray로 위임). 프로덕션이 옳고, **테스트 기대값이 낡았다.**

문제는 **왜 아무도 몰랐나**다:

- `test-search-rules.mjs`는 정규식을 **프로덕션에서 import하지 않고 파일 상단에 복사**해 두고 있다(`scripts/test-search-rules.mjs#L15-L40`).
  → 프로덕션이 바뀌어도 **프로토타입은 그대로 22/22 초록**. 실제로 지금도 초록이다.
- 드리프트를 잡으라고 만든 `verify-intentrules-search.mts`는 RED가 됐지만, **CI에 물려 있지 않아** 아무도 보지 않았다.

> **교훈: 규칙을 복사한 테스트는 규칙이 바뀐 걸 알려주지 못한다.** 신규 하니스는 프로덕션 모듈을 **직접 import**한다. 예외 없음.

---

## 5. 개선 작업 구성 (구현 순서)

TDD 순서를 지킨다 — **Step 0의 테스트가 RED인 것을 눈으로 확인한 뒤** 구현에 들어간다.

| Step | 작업 | 산출물 | 완료 기준 | 상태 |
|---:|---|---|---|---|
| **0** | 테스트 하니스 신설 | `scripts/test-search-policy.mts` | 버그 케이스가 **RED**로 뜬다 | ✅ BUG 0/4 RED 확인 |
| 1 | 스테일 기대값 정리 | `verify-intentrules-search.mts` 2건 갱신 | GREEN 복구 | ✅ 22/22, exit 0 |
| 2 | 명시요청 단일화 | `detectExplicitSearchRequest()` | 두 정규식 → 하나 | ✅ 함수 신설 16/16. **호출부 교체는 Step 4** |
| 3 | 정책 엔진 | `server/agent/search-policy.ts` | 순수 함수. 계약 테스트 GREEN | ✅ 계약 7/7 |
| **4** | **search-gate 배선** | `search-signals.ts` 신설 + `search-gate.ts` → 신호 제출 + `decideSearch()` 1회 | 기존 게이트 동작 전부 보존 + BUG 4/4 GREEN | ✅ BUG 4/4 · 게이트 회귀 19/19 |
| **6** | **영속화 (순서 앞당김)** | `deriveLastTurnSearched()` + `state.lastTurnSearched` | 클라이언트 폴백 유지 | ✅ 게이트 23/23 · history 증거 7/7 |
| 5 | router 전환 | `needsSearch` → `searchSignals` 제출 | `state.ts` 필드 교체 | ⬜ |
| 7 | 프로토타입 복사본 제거 | `test-search-rules.mjs` 폐기 또는 import 전환 | 드리프트 원천 차단 | ⬜ |

> **Step 0~3은 순수 추가였다 — 프로덕션 동작이 하나도 바뀌지 않았다.** 새 함수·새 모듈을 만들었을 뿐
> 아무도 호출하지 않았고, `BUG 0/4` RED가 그 증거였다.
> **Step 4에서 스위치를 올렸다.** 회귀 위험도 여기 집중된다 → 게이트 통합 회귀(Part C) 19건 신설.

### 현재 테스트 상태 (2026-08-15, Step 4 완료 시점)

```
scripts/test-search-policy.mts        exit 0
  BUG   : 4/4    ← 해소 (tier 300)
  GAP   : 3/3    ← 이제 안전판이 아니라 tier 300이 구제한다
  GUARD : 5/5    ← 회귀 방어
  OFF   : 4/4
  ON    : 3/3
  명시요청 탐지 : 16/16   (Step 2)
  정책 계약     : 7/7     (Step 3)
  게이트 회귀   : 23/23   (Step 4 신설 + Step 6 4건)
  history 증거  : 7/7     (Step 6 — deriveLastTurnSearched)

scripts/verify-intentrules-search.mts exit 0   22/22, FP 0, 가드 4/4
node scripts/test-search-rules.mjs    exit 0   (⚠️ 복사본 채점 — Step 7에서 처리)
npx tsc --noEmit                      exit 0
npm run build                         exit 0
```

> **계약 테스트가 설계 오류를 하나 잡았다.** 초안의 계약 6번을 `rule-on > followup-guard`로 적었는데,
> 가드의 존재 이유가 바로 과거참조("최근 검색한")의 temporal ON을 **정정**하는 것이라 반대여야 했다.
> 그대로 구현했다면 `GUARD` 회귀 3건이 깨졌다. 동 tier 순서는 `followup-guard > rule > router-llm`이며,
> 이번 결함을 막는 것은 동 tier 순서가 아니라 **tier 300**이다.

**Step 4까지만 해도 이번 버그는 해소된다.** Step 5~7은 구조 정리이며 별도 커밋으로 분리 가능하다.

### 회귀 방어 대상 (반드시 보존)

| 항목 | 근거 |
|---|---|
| 멀티모달/이미지 history → off | Gemini API 제약 (불변) |
| URL_CONTENT → off | 해외 IP에서 짧은 HTML 반환 시 엉뚱한 기사 요약 방지 |
| YouTube transcript/video/summary → off | 1턴·2턴+ 모두 |
| renderer intent(5종) → off | 구조화 JSON 블록 유실 방지 |
| medical_qa → on 강제 | 실시간 의학 + 출처 정책 |
| 첨부 문서 → off (명시요청 시 예외) | 레이턴시·환각 방지 |
| `historyHasUrl` Fix A 동작 | URL 1회 첨부 후 검색이 영구히 꺼지던 회귀 |

7개 항목 전부 `Part C` 케이스로 고정했다(19/19). 예외 케이스(`renderer + 명시요청`, `문서 + 명시요청`,
`Fix A 새 질의`, `medical_qa + 이미지`)도 함께 넣어 **탈출구가 살아 있는지**까지 본다.

### Step 4가 의도적으로 바꾼 동작 3건

기존 코드의 우선순위는 if문 배치 순서였고, 그 순서에는 **의도한 것과 우연히 그렇게 된 것이 섞여 있었다.**
tier로 옮기면서 다음 3건은 값이 달라진다. 모두 의식적 선택이다.

| # | 상황 | 기존 | Step 4 | 이유 |
|---|---|:---:|:---:|---|
| B1 | `medical_qa` + URL/영상 근거 | ON | **OFF** | 기존엔 medical_qa가 URL 게이트 **뒤**에 있어서 이겼다. 그런데 **첨부문서 게이트는 그 뒤**라 문서일 땐 OFF였다 — 근거 종류에 따라 답이 갈리는 건 설계가 아니라 배치 사고다. "근거가 제공되면 그걸 쓴다"로 통일했다. |
| B2 | URL 첨부 + 사용자가 검색 명시 요청 | OFF | **ON** | 승인된 계층(계약 #2)의 직접 귀결이다. URL 게이트가 막던 실제 사고(엉뚱한 기사 요약)는 **사용자가 요청하지 않았을 때** 일어났다. 요청했다면 뒤집지 않는다. |
| B3 | renderer·문서 게이트의 "명시요청" 판정 범위 | `최신\|최근\|실시간\|뉴스` 포함한 넓은 정규식 | `detectExplicitSearchRequest() \|\| classifySearchNeed()==='on'` | 시의성 어휘를 tier 300에 섞으면 계층이 무의미해진다(§2). 대신 게이트 탈출구에서는 `wantsExternalVerification()`으로 동일 범위를 유지 — **탈출구 범위는 안 좁아졌다.** |

> B2는 이 재설계에서 **유일하게 위험 방향으로 움직이는 변경**이다. 프로덕션에서 URL + 명시검색 조합의
> 응답 품질을 확인할 것. 문제가 생기면 `url-content`를 tier 400으로 올리는 게 아니라,
> **grounding과 URL 본문을 함께 주는 프롬프트**를 손대는 쪽이 맞다.
>
> ### ✅ 검증됨 (2026-08-16 dev, 체크리스트 C1·C2)
>
> 네이버 뉴스 기사(KIST 암 악액질 연구)로 2턴 검증. **기준선을 먼저 잡은 것이 판정을 쉽게 만들었다** —
> 1턴 `요약해줘`(검색 OFF, `Web Link` 칩)로 정확한 수치 집합을 확보한 뒤,
> 2턴 `검색해서 팩트체크 해줘`에서 그것이 유지되는지만 보면 됐다.
>
> 결과: **출처 10개가 붙었는데도 수치가 하나도 바뀌지 않았다**(80% · 20% · 4000여 종 ·
> 근육량 34% / 근력 31% · 포카이콜라 불가투스 · 사이클로펩타이드 11종).
> **grounding이 URL 본문을 밀어내지 않았다** — 우려하던 실패 모드가 재현되지 않았다.
>
> 게다가 검색이 값을 더했다: 연구자 직함 · 발표일 · 학술지 게재 정보 · **"동물실험 단계, 임상 연구 필요"**.
> 마지막 항목이 특히 중요하다 — 팩트체크의 본질은 틀린 것을 잡는 것보다 **주장의 범위를 짚는 것**인데
> 모델이 스스로 한계를 달았다.
>
> ⚠️ 단, 검색이 *추가한* 정보는 원문 대조가 불가능하다(게재일 `2026-05-05`, 직함 표기).
> **이번 검증에서 유일하게 대조군이 없는 부분**으로 남긴다 — 틀렸다는 근거는 없다.
>
> → tier 300(명시 요청) > 200(URL 본문) 계층은 **유지한다.** 프롬프트 수정 불필요.

---

## 6. 범위 밖 (YAGNI)

- **weather/movie 카드 후속 판정 통합** — 같은 병리(3분기 우선순위 하드코딩)를 갖지만 이번 범위 아님. 검색 판정에서 패턴이 검증되면 동일 엔진으로 이전한다.
- **13종 intent 분류 로직** — 검색 필요 여부는 intent와 직교한다는 기존 통찰 유지.
- **two-track 아키텍처 자체** — 발동 빈도만 바뀐다.
- **다국어 확장** — 현 ko + 핵심 en 유지. 회색지대는 라우터 LLM 담당.
