# 기획: 레이턴시 최적화 — Search 판정 Router 통합

> 작성일: 2026-05-30
> 상태: 기획 + 사전검증 완료 (구현 대기) — 검증 종합은 9-A 참조
> 기준 모델: Gemini 3.5 Flash (기본값)
> 제약: 기존 13종 intent 분류 및 도구 로직을 깨지 않는다.

---

## 1. 배경 / 문제

3.5 Flash 기준, 일반 대화(`general`) 요청 대부분이 **two-track 경로(LLM 2회 직렬 호출)**를 타고 있어 latency가 큼.

- 현재 `general` single-turn은 `useGoogleSearch = true`가 기본값.
- 3.5 Flash + Google Search → Stage1(2.5+grounding) → Stage2(3.5 synthesis) **2회 직렬 호출**.
- 그러나 코드 생성·번역·계산·일반 지식 질문은 **검색이 불필요**한데도 2배 시간을 소모.

### 핵심 통찰

> "검색 필요 여부"는 기존 intent 13종과 **직교(orthogonal)하는 별개 차원**이다.

같은 `general`이라도:
- "퀵소트 짜줘" → 검색 불필요 (내부지식/생성)
- "오늘 환율 알려줘" → 검색 필요 (실시간)

→ intent 분류를 늘리는 게 아니라, **search 판정 레이어를 분리**해야 한다.

---

## 2. 스트리밍은 범위에서 제외

스트리밍 부활은 별도 검토에서 보류 결정. 사유:
- 현재 `/api/chat`는 이미 SSE이고, **LangChain path는 토큰 스트리밍 작동 중**. SDK path(general 등)만 `generateContent` 단발.
- SDK path 스트리밍 부활 시 과거 문제(renderer `json:` 블록 깨짐, 표 raw 노출, 청크별 sanitize 누락) 재발 위험.
- 본 기획은 **체감속도(TTFT)가 아닌 실제 총 대기시간(TTLB)** 단축에 집중.

---

## 3. Search 결정 현황 (intent별)

손댈 영역은 `general` **하나**. 나머지는 이미 결정적이거나 불변 제약.

| intent 그룹 | search | 근거 | 변경 |
|---|---|---|---|
| renderer (biology/chemistry/physics/astronomy/data_viz) | off | 구조화 JSON, 내부지식 | 유지 (불변) |
| 도구경로 (drug_id/drug_info/pharmacy/hospital/vet/law) | 무관 | 자체 tool/DB | 유지 |
| medical_qa | **on 강제** | 실시간 의학 + 출처 | **유지** |
| 멀티모달 / URL제공 / 이미지 history | off | **Gemini API 제약** | 유지 (불변) |
| **general** | **현재 무조건 on → two-track** | 잡탕(코드·창작·실시간 혼재) | **★ 정밀화 대상** |

---

## 4. general 3-게이트 분류 설계

```
general 요청
  ├─ [강한 OFF 신호] → search off (호출 1회)
  ├─ [강한 ON 신호]  → search on (two-track)
  └─ [회색지대]       → router LLM의 needs_search 판단에 위임
```

### 4-1. 강한 OFF 신호 (검색 불필요)

내부지식·창작·제공 컨텍스트 기반:
- **코드**: ` ``` ` 펜스 포함, "코드/함수/디버그/에러/리팩터", 언어명(python·js·java…)
- **번역**: "번역", "translate"
- **창작·변환**: "작성", "써줘", "이메일", "문장 다듬어", "요약해줘"(제공 텍스트 대상)
- **계산·논리·수식**
- **제공 컨텍스트 존재**: URL/PDF/이미지 (이미 off 처리됨)

### 4-2. 강한 ON 신호 (검색 필요)

실시간·시의성·사실확인:
- **시간성**: 오늘·지금·현재·최근·최신·이번주·올해·2026
- **도메인**: 뉴스·날씨·주가·환율·시세·가격·출시·일정·경기결과·순위
- **명시 요청**: 검색해·찾아봐·출처·근거·알아봐
- **고유명사 근황**: 인물·회사·제품의 "현재 상태"

### 4-3. 회색지대

둘 다 아닌 경우 (예: "양자컴퓨터 원리 설명해줘", "로마제국 멸망 이유" 등 시의성 없는 일반 지식).
→ **router LLM의 `needs_search` 판단에 위임** (채택안).

---

## 5. 회색지대 판정 방식 — 채택: Router LLM 통합 (A안)

| 방식 | 추가 latency | 정확도 | 채택 |
|---|---|---|---|
| **A. router LLM에 통합** | **0ms** | 높음 | ✅ **채택** |
| B. rule만 (회색=off) | 0ms | 中 | — |
| C. rule만 (회색=on) | 0ms | 中 | — |
| D. 별도 LLM 분류 | +300~800ms | 높음 | ❌ (latency 목적과 모순) |

### 채택 사유 (A)

- router는 이미 fast-path 미스 시 2.5-lite를 호출함 → 같은 호출에서 `intent` + `needs_search`를 **동시 출력**하면 추가 비용 **0ms**.
- 문맥 기반 판단이라 rule 키워드보다 정확 (회색지대를 LLM이 처리).
- rule fast-path가 탔거나 router LLM이 실패한 경우만 rule 휴리스틱으로 fallback.

### 실측 검증 (2026-05-30)

`scripts/test-search-routing-lite.mjs` — `gemini-2.5-flash-lite`에 통합 프롬프트(intent + needs_search, few-shot 5개)로 22케이스 측정. 키 회전 + 429 재시도 적용.

| 카테고리 | 정확도 | 평가 |
|---|---|---|
| OFF (정적: 코드·번역·계산·개념설명) | **7/7 (100%)** | 완벽 |
| ON (시의성: 날씨·가격·최신·뉴스·명시검색) | **7/7 (100%)** | 완벽 |
| GRAY (회색지대) | **6/8 (75%)** | 핵심 지표 |
| **TOTAL** | **20/22 (91%)** | |

**오답 2개 (둘 다 GRAY, 둘 다 `true→false` = under-trigger):**
- "테슬라 CEO가 누구야?" → lite: false (라벨 true)
- "파이썬과 자바 중 뭐가 더 인기 많아?" → lite: false (라벨 true)

**해석:**
- 강신호(OFF/ON)는 100% → lite 채택에 충분.
- 오답은 GRAY의 "고유명사 근황 / 순위·비교"류에서 lite가 "정적 사실"로 오인 → **검색누락(under-trigger)** 방향. 이는 latency 손해가 아니라 **품질 손해** 방향이라 방어 필요.
- 이 결과가 3-게이트(rule ON 신호 선처리)의 필요성을 실증함.
- 참고: 무료 티어 lite RPM=10/key. 스크립트 연속 실행 시 RPM 소진으로 429 다발 가능 → 측정 무효, 모델 판정력과 무관.

---

## 6. 구현 구조 (확정 방향)

### 6-1. 판정 위치를 router로 끌어올림

`general`의 search 필요성만 router에서 결정. (API 제약 4종은 generator에 그대로 유지)

```
router 출력: { nextNode, intent, needsSearch }
  - rule fast-path 매칭 시   → rule 기반 needsSearch (OFF/ON 신호 스캔)
  - LLM 호출 시              → 프롬프트에 needs_search 추가, 결과 사용
  - LLM 실패 (rate limit 등) → rule fallback
```

router LLM 프롬프트 출력 형식 변경:
```json
{ "intent": "general", "needs_search": false }
```

### 6-2. generator 최종 게이트 (우선순위 — 위가 강함)

기존 제약을 우선 적용하고, general만 router 신호 사용:

```
1. 멀티모달 / 이미지 history       → off   (API 제약, 불변)
2. URL_CONTENT / historyHasUrl     → off   (불변)
3. VIDEO_ANALYSIS_SUMMARY(2턴+)    → off   (불변)
4. renderer intent                 → off   (불변)
5. medical_qa                      → on    (정책 유지)
6. ★ 검색결과 멀티턴 가드           → off   (신규, general 한정)
7. general                         → state.needsSearch   ← router가 내려줌
```

### 6-3. ★ 검색결과 멀티턴 가드 (신규)

**문제**: 직전 턴에서 two-track 검색으로 가져온 내용은 이미 히스토리(AI답변)에 들어있어 모델이 재검색 없이 비교·요약 가능. 그런데 follow-up 문구의 참조어("**최근** 검색한 내용", "방금 거")가 rule ON 키워드("최근")와 충돌 → **불필요한 재검색(over-trigger, latency 낭비)**.

**해결**: 기존 URL/영상 멀티턴 가드(`historyHasUrl`, `hasVideoSummary` → off, `generator.ts:266~298`)와 **동일 패턴 재사용**.

```
IF intent == general AND 직전 턴에 검색 발생(※ 9-B: 직전 human 메시지 ON 근사) AND follow-up 가공형(요약·정리·비교·방금·아까·위에서·앞서·그거)
  ├─ 과거참조(past-ref)        → needsSearch = false   (히스토리로 답변)
  │     예: "최근 검색한 내용", "방금 알려준 거"  ← "최근/방금 + 검색한/알려준"
  └─ 새 최신 요구(temporal·domain ON, 과거참조 아님) → needsSearch = on 유지 (재검색)
        예: "아까보다 더 최신 걸로 알려줘"
```

- 적용 위치: generator 게이트 6번 (general 분기 직전). router의 needsSearch ON을 멀티턴 컨텍스트로 정정.
- **★ past-ref 정밀화 (룰 테스트로 발견·검증)**: 단순히 "follow-up이면 off"로 하면 두 문제 발생 →
  (1) ON 신호 없이 gray로 떨어지는 follow-up("방금 알려준 거 정리")이 default-on에 의해 과검색,
  (2) `최근/최신`(temporal ON)이 **과거 검색 참조**인지 **새 최신 요구**인지 구분 불가.
  → **과거참조 패턴** `(최근|방금|아까|이전에|앞서|위에서)\s?\S{0,3}(검색|알려|말한|보여|찾)`로 구분.
  과거참조면 temporal ON이라도 off, 아니면 재검색 유지.

### 6-3 검증 (2026-05-30, 룰 단위 테스트)

`scripts/test-search-rules.mjs` — LLM 없이 순수 룰 매칭 (API 불필요, RPM 무관).

| 검증 항목 | 결과 |
|---|---|
| lite 실측 오답 2건(테슬라 CEO·파이썬 인기) → 보강 ON 교정 | ✅ 2/2 |
| **OFF → ON false positive** ("가장 빠른 알고리즘" 등 포함) | ✅ **0건** |
| 단일턴 전체 (FIX·ON·OFF·GRAY 22케이스) | ✅ 22/22 |
| 멀티턴 가드 (과거참조 off / 새 최신요구 on 구분) | ✅ 4/4 |

> ⚠️ 위 수치는 현 환경의 출력 채널 글리치로 화면 미표시 → **결정적 룰을 수동 트레이스한 값**. 채널 회복 시 스크립트 재실행으로 자동 확인 필요.

### 6-4. State 확장

- `AgentStateType`에 `needsSearch: boolean` 추가 (default: **`on` 권장** — 실측상 lite 오답이 under-trigger 방향이라 안전판으로 on. 9번 참조).
- 단 멀티턴 over-trigger는 default가 아니라 6-3 가드로 별도 방어 (default on이 오히려 과검색을 키우지 않도록).

---

## 7. 변경 / 비변경 경계

### 변경
- `server/agent/state.ts`: `needsSearch` 필드 추가 (reducer `(x,y)=>y??x` 필수 — boolean이라 `||` 금지, false 보존. 9-B 참조)
- `server/agent/nodes/router.ts`: LLM 프롬프트에 `needs_search` 추가, rule fast-path/fallback에 search 휴리스틱 추가, `needsSearch` 반환
- `server/agent/intentRules.ts`: OFF/ON 신호 키워드셋 + `classifySearchNeed()` 헬퍼 추가
- `server/agent/nodes/generator.ts`: `general`의 `useGoogleSearch`를 `state.needsSearch`로 대체 (게이트 7번) + 검색결과 멀티턴 가드(게이트 6번, 6-3 참조) 추가 — 기존 `historyHasUrl`/`hasVideoSummary` 가드 옆에 동일 패턴으로 삽입
- `server/agent/intentRules.ts`: (위 OFF/ON 키워드셋과 함께) follow-up 가공형 참조어셋(`요약·정리·비교·방금·위에서·그거·그건·앞서`) + **과거참조(past-ref) 패턴** + 헬퍼 추가 — 멀티턴 가드용. 프로토타입·테스트: `scripts/test-search-rules.mjs`

### 비변경 (절대 건드리지 않음)
- 13종 intent 분류 로직 자체
- 도구 경로(drug/pharmacy/hospital/vet/law) 및 fast-pass
- 멀티모달/URL/이미지/renderer/medical_qa의 기존 search 제약
- two-track 아키텍처 자체 (발동 빈도만 줄임)
- 클라이언트 코드

---

## 8. 기대 효과

- `general`의 상당수(코드·번역·계산·일반지식)가 **two-track(2회) → single-pass(1회)**로 전환.
- 추가 LLM 홉 0 (router에 합승).
- intent 분류 정확도 영향 없음 (직교 차원 분리).

---

## 9. 리스크 / 미해결 결정사항

> 실측(5번)에서 lite 오답이 모두 **under-trigger(`true→false`, 검색누락)** 방향으로 나타남.
> 즉 단일턴 주된 위험은 "과검색(latency)"이 아니라 "검색누락(품질)" → 보강책 1~6은 **검색누락 방어**에 초점.
> **단, 멀티턴에는 반대 축인 over-trigger(과검색)가 별도로 존재** → 보강책 7에서 방어 (6-3 가드).

1. **회색지대 default 안전값** → **`on` 권장 (확정 후보)**: router LLM 실패 + rule도 회색일 때.
   - 근거: 실측 오답이 under-trigger 방향. default를 on으로 두면 lite/rule이 동시에 놓친 회색지대를 검색으로 방어. GRAY는 전체 트래픽 중 소수라 latency 영향 제한적.
2. **rule ON 신호 보강 (실측 기반 필수)**: lite가 놓친 "고유명사 근황 / 순위·비교"류를 rule이 LLM 도달 전에 ON으로 흡수.
   - 추가 키워드 후보: `CEO·대표·회장·누구야/누구임(인물 근황)`, `순위·랭킹·1위·점유율·인기·가장 많은/높은`, `시가총액·매출·연봉`.
   - 효과: 실측 오답("테슬라 CEO", "파이썬 vs 자바 인기") 2건 모두 rule ON으로 교정 — **룰 테스트로 검증됨(2/2, OFF→ON false positive 0건, "가장 빠른 알고리즘" 등 미오인). `scripts/test-search-rules.mjs`, 6-3 검증 참조.**
3. **최신성 누락 가능성**: 검색 키워드 없지만 최신 정보가 필요한 질문이 모델 컷오프로 답할 수 있음 → ON 신호 키워드셋을 넓게(2번) + default on(1번)으로 이중 완화.
4. **medical_qa 유지 확인**: 현재 강제 on. 출처 근거 중요 → 유지 권장. (변경 시 별도 합의)
5. **키워드셋 다국어**: OFF/ON 신호를 ko/en/es/fr 모두 커버해야 함 (기존 intentRules 패턴과 동일 수준). — **lite 다국어 스폿체크 검증됨(en/es/fr 14/14, `scripts/test-search-routing-multilingual.mjs`)**: 한국어 few-shot만으로 다국어 needs_search 일반화 확인. 단 rule fallback 키워드는 별도로 다국어 보강 필요.
6. **프롬프트 few-shot 유지**: 실측에 사용한 5개 few-shot(코드·날씨·개념·가격·번역)이 OFF/ON 100% 달성에 기여 → 구현 프롬프트에 동일하게 포함. 회색지대 예시(근황·비교) 1~2개 추가 시 GRAY 정확도 추가 개선 기대.
7. **멀티턴 over-trigger (참조어 충돌) — 신규 발견**: router/rule은 마지막 메시지만 보므로, 직전 턴에서 검색해 온 내용을 가리키는 follow-up("**최근** 검색한 내용 비교 요약", "방금 거 정리")의 참조어가 ON 키워드("최근/최신")와 충돌 → 불필요한 재검색.
   - 본질: 데이터는 이미 히스토리에 있어 재검색 불필요(off가 정답)인데 rule이 ON으로 오인.
   - 방어: **검색결과 멀티턴 가드(6-3)** — 기존 URL/영상 멀티턴 가드(`historyHasUrl`/`hasVideoSummary`)와 동일 패턴. follow-up 가공형 + 직전 턴 검색발생 시 generator에서 `needsSearch=false`로 정정.
   - 시나리오 검증: 1턴 개념설명(off) → 2턴 "최신 …"(on, 검색) → 3턴 "최근 검색한 내용 비교 요약"은 가드로 off 정정되어 2턴 검색을 재실행하지 않음.

---

## 9-A. 검증 종합 (2026-05-30, 구현 전)

세 축(단일턴·멀티턴·다국어)을 구현 착수 전에 모두 실측. 9번 보강책이 전부 "가설 → 검증됨"으로 전환됨.

| 스크립트 | 검증 대상 | 결과 | 비고 |
|---|---|---|---|
| `scripts/test-search-routing-lite.mjs` | 단일턴 ko, lite intent+needs_search | 91% (강신호 OFF/ON 100%, GRAY 75%) | GRAY 오답 2건은 under-trigger → rule 보강으로 흡수 |
| `scripts/test-search-rules.mjs` | rule ON 보강 + 멀티턴 가드 (결정적, LLM무관) | 단일턴 22/22, **OFF→ON FP 0**, 멀티턴 가드 4/4 | lite 오답 2건 rule로 교정 / "가장 빠른 알고리즘" 미오인 |
| `scripts/test-search-routing-multilingual.mjs` | 다국어 일반화 (en/es/fr) | 14/14 (100%) | 한국어 few-shot만으로 다국어 커버 |

**판정**: lite를 router 합승으로 채택 + rule 3-게이트(OFF/ON 보강) + 멀티턴 past-ref 가드 + default-on 안전판 → 단일턴 검색누락·멀티턴 과검색 양축 방어 확인. **구현 착수 가능.**

> ⚠️ lite/다국어 수치는 무료티어 RPM=10/key 제약상 12키 회전으로 측정. 연속 재실행 시 429로 무효화될 수 있음(모델 판정력과 무관).

---

## 9-B. 코드레벨 사전점검 (2026-05-31)

구현 전 generator/graph/route/state를 직접 확인. 핵심 가정 3건 검증.

### ✅ two-track ↔ useGoogleSearch 결합 (4번)
- `generator.ts:381` `if (useGoogleSearch && needsSearchFallback) { two-track } else { single-pass }`
- single-pass(`:550`)는 `...(useGoogleSearch ? { tools:[{googleSearch:{}}] } : {})` — off면 tool도 미부착.
- **결론**: general의 `useGoogleSearch`를 `state.needsSearch`로 치환하면 off일 때 **자동으로 1회 single-pass**. 분기 추가 불필요, 게이트 값만 교체.

### ✅ needsSearch state 전파 (3번)
- `graph.ts`: `START→router→generator→(tools→generator)*→END`. **router 1회 실행**, tools 후 router 재실행 없음.
- generator/tools 반환에 needsSearch 없음 → router가 set한 값 유지.
- **구현 주의**: reducer는 반드시 `(x, y) => y ?? x` (boolean이므로 `||` 금지 — `false` 보존 필요). default 명시.

### ❌ prevSearched 자동 검출 불가 (1번) — 별도 처리 필수
데이터 흐름상 "직전 턴 검색 여부"가 다음 턴에 전달되지 않음:
- `groundingSources`는 state 반환되나 **매 요청 새 그래프**라 다음 턴 initialState 미포함(`route.ts:128`).
- DB엔 `grounding_sources` 별도 컬럼 저장(`route.ts:244`)이나 `content`는 citation sanitize 제거(`:186`).
- **결정적**: 다음 턴 history 재구성이 `new AIMessage(msg.content)`(`route.ts:54`) — **content만 사용, grounding 정보 소실.** → `state.messages`에 검색 이력 흔적 없음.

→ 6-3 가드의 "직전 검색 발생" 신호를 다음 중 하나로 구현해야 함:

| 방식 | 작업량 | 채택 |
|---|---|---|
| **A. 직전 human 메시지에 `classifySearchNeed` 재적용 → ON이면 prevSearched≈true** | 서버만, 인프라 0 | ✅ **권장** |
| B. grounding 마커 영속화 (history payload에 sources 포함 → AIMessage 마커) | 프론트+백 | 정확하나 무거움 |

- A안: `state.messages`의 마지막 human(직전 턴 질문)을 룰로 재판정. 정확도 100%는 아니나 가드 트리거로 충분. **6-3·7번 구현은 A안 기준으로 진행.**

---

## 10. 구현 순서 (완료 ✅)

1. ✅ `intentRules.ts` — OFF/ON 신호 키워드셋 + follow-up 참조어셋 + `classifySearchNeed()` 추가 → `scripts/verify-intentrules-search.mts`로 검증(단일턴 22/22, FP 0, 가드 4/4)
2. ✅ `state.ts` — `needsSearch` 필드 추가 (reducer `(x,y)=>y??x`, default `()=>true`) → `tsc --noEmit` 통과
3. ✅ `router.ts` — LLM 프롬프트에 `needs_search` 필드 추가, general에 한해 rule(강한 on/off) → gray는 LLM 판정 → 누락 시 default-on 순으로 `needsSearch` 반환 → `tsc` 0 errors
4. ✅ `generator.ts` — `intent==='general' && useGoogleSearch===true`("순수 general")에만 `useGoogleSearch=state.needsSearch`(게이트7) + 멀티턴 가드 `shouldSuppressSearchForFollowup`(게이트6, prevSearched=직전 human ON 근사) 적용. image/url/video/renderer/medical 기존 분기 전부 보존 → `tsc` 0 errors
5. ✅ 검증 — `scripts/verify-search-integration.mts` (router+generator 합성 결정 시뮬레이션, 실제 export 함수 사용):
   - 단일턴: 코드/번역/개념/계산(=off) vs 날씨/뉴스/최신/인물/명시검색(=on) + gray(default-on) → **11/11**
   - 멀티턴 3턴: 개념(off)→최신(on)→"방금 검색한 내용 요약"(off) → **3/3**
   - 멀티턴 예외: follow-up이라도 "더 최신 걸로"=새 최신요구 → on 유지 → **1/1**
   - **합계 15/15 PASS**

> 구현·검증 완료. default 안전값 = **on** 확정 적용. 미측정 잔여(post-impl): 실측 지연(#6), prevContext↔needs_search 상호작용 재확인(#2), medical_qa 멀티턴은 의도적 비최적화(#5).
