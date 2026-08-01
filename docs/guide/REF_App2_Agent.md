# REF_App2_Agent — 통신 부가서비스 에이전트(`app2`) 코어 검토

> 정리: 2026-07-31 · 대상: `reference/Wireless-Value-Added-Agent-main/app2` (Python, LangGraph, 69,672줄)
> 선행 검토: [REF_ExternalAgents.md](REF_ExternalAgents.md) / [DEV_260724](../logs/2026/07/DEV_260724.md) — 그때는 `Master-Agent-main`(오케스트레이터)과 상담봇을 봤고, **`app2` 는 미검토 영역**이었다.
>
> ⚠️ **전제 차이(이식 판단의 기준선)**
> | | app2 | chat-agent |
> |---|---|---|
> | 실행 | 상주 서버(FastAPI) + 세션 상태 | **stateless 서버리스, 60s 캡** [[chat-agent-vercel-60s-cap]] |
> | 상태 | 세션·체크포인터에 누적 | 매 턴 히스토리에서 재구성 |
> | 관측 | OTEL + log_server(자체 백엔드) | Vercel Hobby 런타임 로그 **1시간 휘발** |
> | 모델 | GPT 계열 | Gemini (프롬프트 기법 재검증 필수) |
>
> 상태를 서버에 쌓는 패턴은 통째로 이식 불가. **개념만** 가려 받는다.

---

## 1. 구조 요약

```
app2/core/
├─ interfaces/   node.py(BaseNode) · step.py(PreProcessStep/@parallel) · agent.py · service.py
├─ schemas/      base_dto.py(BaseStateDto) · context/{inquiry,exploration,processing}_context.py
│                slot/(15종) · tool_call.py · *_config.py
├─ agents/       generic_agent.py(727) · inquiry_agent.py(ReAct) · slot_driven_agent.py
├─ nodes/        generic/ inquiry/ recommend/ slot_driven/ steps/
├─ services/     slot_*(9) · llm_json_repair · llm_ui_stream_parser · tool_executor · session_progress_manager
├─ observability/ trace · log_client · lamp · trace_callback
└─ prompts/py/   ask_selection · csf · json_repair · slot_extraction
domains/{billing2,datacharge,wireless_vas}/
├─ prompts/yaml/ primary_intent_* · tool_* · inquiry_response_*   (각 system_prompt + user_prompt)
├─ prompts/py/   response_guide.py (의도별 RESPONSE_GUIDE 상수, 447줄)
└─ subgraphs/{inquiry,processing}/nodes/steps/
```

핵심 설계 축 3개: **① 상태 = 공통 DTO + 의도유형 믹스인**, **② 노드 = BaseNode 추상 + Step 파이프라인**, **③ 프롬프트 = 단계별 파일 + 의도별 가이드 런타임 주입**.

---

## 2. 상태(State) 설계

### 2-1. 공통 DTO + 컨텍스트 믹스인
`core/schemas/base_dto.py`의 `BaseStateDto`(88줄)에 공통 필드만 둔다 — `query` / `history_messages` / `session_id` / `transaction_id` / `intents` / `route_key` / `extracted_entities` / 토큰 회계(`input_token`·`output_token`·`total_token`) / `context_data`(도메인 자유 영역) / `intent_queue`·`intent_idx`(멀티인텐트 순차 처리).

의도 **유형별**로 믹스인을 따로 두고 다중 상속으로 조립한다:

| 믹스인 | 대표 필드 |
|---|---|
| `InquiryContext` | `tool_calls` · `tool_executed` · `loop_count` · `active_tools` · `tool_choice` · `awaiting_slot_input` · `slot_suspended` |
| `ExplorationContext` | `phase` · `is_refinement` · `reset_context` · `conditions` · `filters_applied` · `results` · `filtered_results` · `turn_count` · `next_node` |
| `ProcessingContext` | (가입/변경 처리 흐름 전용) |

→ `class Billing2ExplorationStateDto(Billing2BaseStateDto, ExplorationContext)` 식으로 조립.

**우리 대비**: [state.ts](../../server/agent/state.ts)는 flat Annotation 한 덩어리다. 카드가 늘 때마다 필드가 붙는다(`movieContext`·`movieFollowup`·`weatherFollowup` — 카드 2종에 3필드). 약국·병원·법령까지 같은 패턴을 가면 조합 폭발.

### 2-2. `phase` — 대화 단계를 상태로 명시
```python
class ExplorationPhase(str, Enum):
    SEARCHING / PRESENTING / FILTERING / COMPARING / DETAIL_VIEW / SELECTED / FALLBACK
```
"결과가 화면에 제시된 상태인가, 그걸 좁히는 중인가"를 **상태로 들고 간다**.

**우리 대비**: 같은 정보를 매 턴 **히스토리 정규식으로 역추론**한다(`weatherCardShown` = assistant 메시지에서 ` ```json:weather ` 스캔). [DEV_260731](../logs/2026/07/DEV_260731.md) §3-1·§7에서 이 역추론이 두 번(창 크기, 역할 매핑) 깨졌다.

### 2-3. `is_refinement` / `reset_context` — 후속 판정을 구조화 출력으로
`core/nodes/recommend/exploration_entry_node.py:20-40`
```python
class ExplorationEntryResult(BaseModel):
    reasoning: str                     # 판단 근거(가시화)
    is_refinement: bool                # 이전 결과를 좁히는 추가 질문인가
    reset_context: bool                # 맥락 무시하고 새로 시작인가
    search_queries: List[str]
    conditions: List[str]
    clarification: Optional[str]       # 검색 대신 되물어야 할 때의 멘트
```
```python
if result.reset_context:   state.conditions = []; state.results = []
if not result.is_refinement: state.conditions = conditions      # 교체
else:                        state.conditions.extend(conditions) # 누적
```

**우리 대비**: 동일 판정을 정규식 더미로 한다 — `newFetch` / `VAGUE_BEFORE_WEATHER` / `timeShift && weatherWord` / `interpretive`([router.ts:216-245](../../server/agent/nodes/router.ts#L216-L245)). 이번 주에만 두 번 고쳤다.

---

## 3. 노드 설계

- **`BaseNode`** (`interfaces/node.py`): `process(state)` 추상 + `__call__` 래퍼가 **OTEL span·duration·log_server SPAN upsert를 자동 기록**. 노드 = 계측 단위.
- **`get_router()` / `get_route_map()`**: conditional_edges 배선을 노드가 스스로 선언.
- **`stream_immediate_response()`**: Fallback/AMBIGUOUS에서 LLM 없이 즉시 응답 + 상태 기록 — 공통 헬퍼.
- **`PreProcessStep` / `PostProcessStep` + `@parallel` 데코레이터**: 노드 안을 스텝으로 쪼개고, 병렬 가능한 스텝을 데코레이터로 표시.
- **`BaseEvent`**: 스트리밍 이벤트 단일 DTO — `mode`(1 llm / 2 tool message / 3 contents / 4 loading) + `chunk` / `contents` / `loading_message`. `frozen=True`.

**우리 대비**: 우리 노드는 함수 4개(router/vision/generator/tools)뿐이라 추상 클래스·스텝 파이프라인은 과잉. 다만 `BaseEvent`의 **모드 구분(산문/카드/로딩)** 은 우리 SSE(`{text}` / `{sources}` / `{done}`)와 대응되는데, 우리는 로딩 상태를 클라가 자체 추정한다는 차이가 있다.

---

## 4. 프롬프트 분리 구조 (사용자 질문 항목)

### 4-1. 3층 분리
1. **단계(노드)별 파일** — 한 도메인당 3개:
   - `primary_intent_*_prompts.yaml` (의도 분류, 53~161줄)
   - `tool_*_prompts.yaml` (도구 선택, 19~24줄)
   - `inquiry_response_*_prompts.yaml` (응답 생성, 94~98줄)
2. **파일당 2키**: `system_prompt` / `user_prompt` (YAML block scalar)
3. **의도별 응답 가이드**: `prompts/py/response_guide.py`의 `RESPONSE_GUIDE_*` 상수를 응답 프롬프트의 `{RESPONSE_GUIDE}` 자리에 **런타임 주입** — 즉 **의도 분류 결과에 따라 응답 규칙을 통째로 교체**한다.

로더 `PromptManager`(133줄): 싱글톤 + 메모리 캐시 + `warmup_prompts()` 선로딩, PyYAML 없을 때 블록 스칼라 수동 파서 폴백.

### 4-2. 응답 구조 계약 — `opening` / `text_*` / `closing`
```
###UI_JSON###
{
  "opening": "고객님의 **`{마스킹된 번호}`** 회선 기준으로 조회해 드릴게요.",
  "text_1": "",
  "prodInfoListType1Slide": "mblOptlProdInfoList",   ← UI 슬롯(툴 이름 매핑)
  "text_2": "",
  "mergedRecommendSlide": "search_product",
  "closing": "",
  "linkButton": null
}
```
- **Key의 위치·개수·순서 고정**, Top-to-Bottom 순차 생성 강제.
- 산문(`opening`/`text_*`/`closing`)과 **UI 슬롯**(카드·슬라이드·버튼)이 한 JSON에 교대로 배치 → 렌더 순서가 곧 Key 순서.
- UI 슬롯 값은 **문자열(툴 이름)만 허용**하고 객체 직접 출력 금지 — 실제 데이터는 툴 결과에서 매칭해 붙인다(`llm_ui_stream_parser.py`).
- 스트리밍: `###UI_JSON###` **이전만 토큰 스트리밍**, 이후는 버퍼링 후 파싱(`StreamUiSplitter`, 마커가 청크 경계에 걸리면 접미사 hold).
- 케이스 분기(`[Case A]`/`[Case B]`)를 가이드 안에서 처리하고, 각 케이스마다 **어떤 Key를 `""`로, 어떤 Key를 `null`로** 둘지까지 명시.

### 4-3. 우리 구조와의 대비

| | app2 | chat-agent |
|---|---|---|
| 시스템 프롬프트 | 단계별로 **분리된 파일**, 해당 단계 것만 주입 | [prompt.ts](../../server/agent/prompt.ts) **472줄 단일 인스트럭션을 매 턴 전량 주입** |
| 의도별 규칙 | `RESPONSE_GUIDE` **통째 교체** | `getIntentFocusHint(intent)` 한 조각을 **뒤에 덧붙임** (base는 그대로) |
| 저장 위치 | YAML(도메인/단계별) + py 상수 | TS 템플릿 리터럴 1파일 |
| 응답 형식 | 고정 순서 JSON(`opening`/`text`/`closing` + UI 슬롯) | 자유 마크다운 + 인라인 ` ```json:type ` 펜스 |

**실측된 부작용(우리 쪽)**: base에 상주하는 `[WEATHER FORMATTING]`("날씨 정보를 낼 땐 **ALWAYS** 5일 표")이 날씨와 무관한 general 턴까지 오염시켜, 후속 대화에서 표가 재출력됐다([DEV_260731](../logs/2026/07/DEV_260731.md) §3-3, 수정 전 3.5 3/6턴). app2 구조에서는 **응답 가이드가 의도별로 교체되므로 이런 누수가 구조적으로 발생하지 않는다.**

**비용은 우리 문제가 아니다**: 45KB 프롬프트는 암묵 캐싱으로 78~98% 할인 중([DEV_260723](../logs/2026/07/DEV_260723.md)). 문제는 토큰이 아니라 **문맥 오염**이다.

---

## 5. 채택 판정

| 항목 | 판정 | 근거 |
|---|---|---|
| **`is_refinement`/`reset_context` 구조화 판정** | ✅ **1순위 채택** | 라우터가 이미 JSON을 반환 → **추가 왕복 0**. 정규식 더미의 성장을 멈춘다. §6 계획 |
| **`phase` / 활성 카드 일반화** | 🟡 2순위(1순위 안정화 후) | 날씨·영화 가드가 거의 같은 코드 두 벌. 카드가 늘면 값어치 커짐 |
| **의도별 응답 가이드 교체** | 🟡 2순위 | 문맥 오염 실측 사례 있음. 단 프롬프트 전면 재편이라 별도 계획 필요 |
| `clarification` 필드(되묻기 통합) | 🟡 1순위와 함께 검토 | 영화 지역 되묻기 rescue(정규식)를 대체 가능 |
| 컨텍스트 믹스인 상태 설계 | ⏸ 보류 | LangGraph.js Annotation은 믹스인 조립이 부자연스럽고, 2순위를 하면 증식 압력이 줄어듦 |
| `BaseNode` 자동 계측(OTEL/log_server) | ❌ | 수신 백엔드 부재 + Hobby 로그 1시간 휘발. 별도 검토에서 결론 |
| `llm_json_repair` | ❌ | +1 LLM 왕복, 60s 캡에서 손해. 렌더러 JSON 15/15 유효 (DEV_260724 판단 유지) |
| `StreamUiSplitter` 접미사 hold | ❌→⚠️ 값어치 하락 | [ChatMessage.tsx:506-541](../../components/ChatMessage.tsx#L506-L541)이 이미 미완성 viz 블록을 숨기고 로딩 표시. 남는 건 한 프레임 |
| `###UI_JSON###` 고정 JSON 응답 | ❌ | 우리는 펜스 기반 렌더러 7종 위에 서 있고, 구조화 JSON은 **산문 토큰 스트리밍을 포기**해야 함(그들도 마커 뒤는 버퍼링) — 60s 캡에서 체감 지연 악화 |
| `PreProcessStep`/`@parallel` | ❌ | 노드 4개 규모에 과잉 |
| slot filling 15종 | ❌ | 도메인 특화(가입/변경 업무). 우리는 슬롯필링 업무 없음 |

---

## 6. 1순위 적용 계획 — 카드 후속 판정의 LLM 위임

### 6-1. 문제
카드가 화면에 있을 때 후속 발화가 **① 그 카드 해석 ② 새 조회 ③ 무관한 주제** 중 무엇인지를 정규식 4종으로 판정한다. 발화 변형마다 정규식을 덧대는 구조라 이번 주에만 2회 수정했고, 그때마다 회귀 위험이 생긴다.

### 6-2. 방침 — 기존 `needsSearch` 3분기 패턴 재사용
우리 라우터는 이미 **rule(강한 on/off) → gray면 LLM 판정 → default** 3분기로 검색 필요를 정한다([router.ts:293-298](../../server/agent/nodes/router.ts#L293-L298)). 카드 후속 판정에만 이 3분기가 없다. **같은 패턴을 적용한다.**

> 원칙(DEV_260724 파트 E): 결정론적 코드 rescue를 프롬프트로 대체하지 않는다. **강한 신호는 코드가 확정, 회색지대만 LLM.**

### 6-3. 변경 사항

**(1) 라우터 프롬프트에 필드 1개 추가** — [router.ts:88-108](../../server/agent/nodes/router.ts#L88-L108)
```
Also decide "follow_up" — only meaningful when the previous assistant message contains a result card:
- "refine"    : interprets/compares/filters the card already shown (which day is hottest, do I need an umbrella)
- "new"       : asks for a NEW lookup (different city, different day, another theater)
- "unrelated" : the topic moved away from the card
Output: {"intent": ..., "needs_search": ..., "follow_up": "refine"|"new"|"unrelated"}
```
- flash-lite · `thinkingBudget:0` · `responseMimeType: application/json` 그대로 → **지연·비용 증가 없음**.
- 파싱 실패/필드 누락 시 `undefined` → 기존 정규식 경로로 폴백.

**(2) 판정 우선순위** — [router.ts:215-245](../../server/agent/nodes/router.ts#L215-L245) 재구성
```
weatherCardShown 일 때:
  1. 강한 새 조회 신호(코드 확정)  : cityWeatherRequest | "부산은?" | (timeShift && weatherWord)
       → intent = weather
  2. 강한 해석 신호(코드 확정)     : VAGUE_BEFORE_WEATHER 매칭 | interpretive
       → intent = general, weatherFollowup = true
  3. 회색지대                      : follow_up === 'new'       → weather
                                    follow_up === 'refine'    → general + weatherFollowup
                                    follow_up === 'unrelated' → general (검색 유지)
  4. LLM 판정 없음(폴백)           : 현행 정규식 결과 그대로
```
현재 로직을 **대체가 아니라 감싸는** 형태라, LLM이 죽어도 오늘 확정한 동작이 그대로 남는다.

**(3) 영화 경로도 동일 적용** — `MOVIE_FOLLOWUP_QUESTION` / `MOVIE_CONTEXT_TERMS` 정규식이 하는 판정을 같은 `follow_up` 값으로 보강(카드 종류만 다르고 판정은 동일).

### 6-4. 검증
- 기존 [test-weather-multiturn.ts](../../scripts/test-weather-multiturn.ts) 8턴 × 3모델 = **24/24 유지**가 합격선(회귀 없음).
- 신규 케이스 추가: 정규식이 못 잡는 변형 — "그거 말고 딴 데는?", "아까 그 표 다시 보여줘", "여기서 제일 추운 날은?", "이제 영화 얘기하자".
- **A/B 필수**: `follow_up` 필드를 무시하는 플래그로 한 번, 사용하는 걸로 한 번 — 개선 폭을 수치로 남긴다(§7 교훈: "카드 안 뜸"이 아니라 **라우팅 결정**으로 판정).
- 영화용 멀티턴 회귀 테스트가 아직 없다 → (3) 적용 시 `test-movie-multiturn.ts` 신규 필요.

### 6-5. 롤백
필드 하나 추가 + 분기 한 겹이라, 문제 시 `follow_up` 사용 분기만 제거하면 현행 동작으로 즉시 복귀.

### 6-6. 착수 순서
1. (1)+(2) 날씨 경로만 적용 → 회귀 24/24 확인 → 신규 케이스로 개선 폭 측정
2. 안정화 후 (3) 영화 경로 확장 + 영화 회귀 테스트 신설
3. 그 다음 2순위(활성 카드 일반화 / 의도별 프롬프트 교체) 착수 여부 재판단

---

## 7. 1순위 적용 결과 및 평가 (2026-08-01)

### 7-1. 실제 변경
| 파일 | 변경 |
|---|---|
| [router.ts:40-60](../../server/agent/nodes/router.ts#L40-L60) | `weatherCardShown` 계산을 **라우터 LLM 호출 앞으로 이동**하고, 카드가 떠 있으면 프롬프트에 `NOTE: a WEATHER CARD ... is currently displayed` 힌트 주입. 직전 응답 본문이 카드 JSON이라 원문만으로는 "화면에 카드가 있다"는 맥락이 안 읽혔다 |
| [router.ts:110-118](../../server/agent/nodes/router.ts#L110-L118) | 라우터 프롬프트에 `follow_up: "refine" \| "new" \| "unrelated"` 3분류 추가 (기존 JSON 응답에 필드 1개) |
| [router.ts:141-143](../../server/agent/nodes/router.ts#L141-L143) | 화이트리스트 파싱 — 세 값이 아니면 `undefined`(폴백) |
| [router.ts:245-282](../../server/agent/nodes/router.ts#L245-L282) | 판정 4단 우선순위로 재구성: **① 강한 새 조회(규칙) → ② 강한 해석(규칙) → ③ 회색지대(LLM) → ④ 폴백(결정론)**. `DISABLE_LLM_FOLLOWUP=1` A/B 스위치 포함 |
| [test-weather-multiturn.ts](../../scripts/test-weather-multiturn.ts) | 회색지대 케이스 3종 추가(`gray: true`), 회귀/회색지대 점수 분리 집계 |

계획(§6) 대비 **추가로 한 것**: 카드 상태를 프롬프트에 명시(§7-1 첫 행). 초기 실행에서 LLM이 카드 존재를 못 읽어 `unrelated`로 기우는 경향이 있었다.
계획 대비 **안 한 것**: 영화 경로 확장(§6.6 2단계) — 계획대로 날씨 안정화 후로 미룸.

### 7-2. A/B 측정 — 3모델 × 11턴 = 33케이스

| | 전체 | 회귀(기존 8턴) | **회색지대(신규 3턴)** |
|---|---|---|---|
| **A. 규칙만** (`DISABLE_LLM_FOLLOWUP=1`) | 27/33 | **24/24** | **3/9** |
| **B. LLM follow_up ON** | **33/33** | **24/24** | **9/9** |

- 3.6 / 3.5 / 2.5 **전 모델 동일 결과** — 카드 판정 경로가 모델 무관하다는 [DEV_260731](../logs/2026/07/DEV_260731.md) §1 결론과 일관.
- 회색지대 케이스: `대구는 어때?`(도시명만·"날씨" 없음) · `아까 서울 거 다시 보여줘`(재표시 요청) → 규칙은 둘 다 놓쳤고 LLM이 `new`로 정확히 판정. `이제 다른 얘기 하자, 파이썬 리스트 정렬…`(주제 이탈)은 규칙도 통과.
- **회귀 0건**: 기존 8턴은 전부 규칙 단계(①②)에서 확정돼 LLM 판정에 도달하지 않는다 — 설계 의도대로.

**지연**: 턴 평균 ON 4,219ms / OFF 5,166ms(n=33). 라우터 필드 추가로 인한 지연 증가는 관측되지 않았다(같은 호출·같은 JSON 응답, `thinkingBudget:0` 유지). OFF가 오히려 느린 건 **오분류로 툴 경로(LangChain+2.5)를 타기 때문**이지 필드 효과가 아니다 — 즉 이 수치는 "필드 비용 0"의 근거일 뿐 성능 개선 주장으로 쓰면 안 된다.

### 7-3. 측정 과정에서 잡힌 것 2가지

1. **테스트 기준 오류(수정함)** — 카드 렌더 판정을 `on_tool_end` 툴 호출 수로 세고 있었는데, 모델이 **히스토리의 카드 블록을 복사**해도 화면엔 카드가 뜬다. 사용자 기준(최종 텍스트에 ` ```json:weather ` 존재)으로 바꾸고, 툴 미호출 복사는 `(히스토리 복사)`로 표시하게 했다.
2. **잠재 이슈(미해결)** — 재표시 요청에서 모델이 툴을 안 부르고 카드를 복사하면 **수치가 낡을 수 있다**(세션이 길면 몇 시간 전 데이터). 화면 동작은 정상이라 이번 범위 밖으로 두되, 재조회가 필요한 경우를 구분할지는 별도 판단 필요.
3. **모호한 발화는 되묻는 게 옳다** — 초기 케이스 `아까 그 카드 다시 보여줘`는 화면에 서울·부산 카드가 둘 다 있어 봇이 *"부산 날씨 카드인가요, 서울인가요?"* 로 되물었다. 라우팅(`weather`)은 정확했고 되묻기가 올바른 UX라, **케이스 쪽을 명확한 표현으로 교체**했다(테스트가 틀린 것이지 코드가 틀린 게 아니었다).

### 7-4. 평가

**얻은 것**
- 회색지대 정확도 **3/9 → 9/9**, 회귀 0, 추가 왕복·비용·지연 0. app2에서 빌려온 개념 중 **가장 저렴한 축에 속하면서 효과가 즉시 측정된** 항목이다.
- 정규식 더미의 성장이 멈췄다. 새 발화 변형이 나와도 이제 **규칙을 덧대는 대신 LLM 판정에 맡기는 경로**가 있다.
- 실패 모드가 안전하다 — LLM 판정이 없거나(무료티어 503/timeout) 값이 이상하면 `undefined` → 기존 결정론 동작으로 복귀. 최악의 경우도 **적용 전 수준**이다.

**한계 (과대해석 금지)**
- 회색지대 케이스가 **3종뿐**이다. 9/9는 "이 3종에서 3모델이 일관되게 맞았다"는 뜻이지 일반화된 정확도가 아니다.
- `follow_up` 판정은 flash-lite 변동성에 노출된다. 다만 **강한 신호는 규칙이 선점**하므로 영향 범위가 회색지대로 제한된다.
- 카드 힌트(`NOTE:`)가 프롬프트에 상시 들어가진 않는다(카드 있을 때만) — 카드 종류가 늘면 힌트 문자열도 늘어나므로, 2순위(활성 카드 일반화) 때 같이 정리해야 한다.

**다음**
1. ~~영화 경로 확장 + `test-movie-multiturn.ts` 신설 (§6.6 2단계)~~ → §7-5에서 완료
2. 그 다음 프롬프트 재편(§8) — 2순위 활성 카드 일반화는 그 뒤 재판단

---

## 7-5. 영화 경로 확장 (2026-08-01)

같은 3분기 원칙을 영화 상영표 카드에 적용했다. 카드 전달 경로가 날씨와 다르다 — 상영표는 히스토리에 없고, `MovieRenderer`가 `/api/showtimes`로 가져온 걸 클라의 `lib/movieContext`가 모아 다음 요청에 `movieContext`로 동봉한다. 따라서 **`state.movieContext`의 존재 자체가 "카드 표시 중" 신호**이고, 라우터 프롬프트의 `NOTE:` 힌트도 여기서 만든다.

### 7-5-1. 규칙 신호를 강/약으로 쪼갬

기존 `MOVIE_CONTEXT_TERMS` 하나에 영화 도메인 어휘와 일반 비교 어휘가 섞여 있었다. 회색지대를 만들려면 이걸 갈라야 했다.

| 구분 | 패턴 | 처리 |
|---|---|---|
| 강한 후속 어휘 | `MOVIE_FOLLOWUP_QUESTION` (있어/없어/몇시/좌석/매진…) | 규칙으로 후속 확정 |
| 강한 도메인 어휘 | `MOVIE_STRONG_TERMS` (영화/상영/CGV/회차/평점…) | 규칙으로 후속 확정 |
| **약한 어휘** | `MOVIE_WEAK_TERMS` (가장/제일/비교/빠른/늦은) | **회색지대 → LLM** |
| **물음표 단독** | `MOVIE_QUESTION_MARK` | **회색지대 → LLM** |

### 7-5-2. 물음표 단독이 새 조회를 삼키고 있었다

측정 중 드러난 실제 버그다. 기존 `MOVIE_FOLLOWUP_QUESTION`은 첫 항목이 `[?？]`였다 — **물음표만 있으면 무조건 상영표 후속**. 그래서 `신촌은 어때?`(새 지역 카드 요청)가 `movie_search`로 잘 분류되고도 그 규칙에 걸려 `general`로 내려앉았고, 카드 대신 이전 카드를 복사한 답이 나갔다. LLM은 `follow_up: "new"`를 정확히 냈지만 **강한 규칙이 먼저 삼켜서 도달하지 못했다**.

물음표를 목록에서 떼어 약한 신호로 재분류하니 3모델 모두 통과했다. 교훈: *3분기 구조를 붙이는 것보다 **무엇이 강한 신호인지 다시 판정하는 일**이 어렵다.* 강한 규칙에 약한 신호가 섞여 있으면 LLM 위임은 무력화된다.

### 7-5-3. A/B 측정 — 3모델 × 8턴 = 24케이스

| | 전체 | 회귀(5턴) | **회색지대(3턴)** |
|---|---|---|---|
| 규칙만(`DISABLE_LLM_FOLLOWUP=1`) | 18/24 | 15/15 | **3/9** |
| **LLM ON** | **24/24** | 15/15 | **9/9** |

3.6·3.5·2.5 결과 동일. 회색지대 3종:
- `근처에 가장 가까운 지하철역은 어디야?` — 약한 어휘(`가장`) 오탐. 규칙만이면 `movieFollowup=true`가 되어 **검색이 꺼진 채** 상영표로 답하려 한다 → LLM `unrelated`로 교정.
- `신촌은 어때?` — 위 7-5-2. `new`로 새 카드.
- `이제 다른 얘기 하자. 파이썬…` — 규칙만으로도 통과(약한 어휘도 없음).

판정 기준은 날씨 테스트보다 하나 더 엄격하다. 카드 유무·intent에 더해 **`movieFollowup` 값 자체**를 검증한다 — 이 플래그가 잘못 켜지면 카드는 안 뜨더라도 `needsSearch=false`가 되어 답변 품질이 조용히 무너지기 때문이다(위 지하철역 케이스가 정확히 그 모양).

날씨 회귀도 재실행해 확인했다(라우터 프롬프트·카드 힌트를 공유하므로 필수): 3.6·2.5 각 11/11.

### 7-5-4. 평가

- **얻은 것**: 회색지대 3/9 → 9/9, 회귀 0, 추가 왕복 0(같은 `follow_up` 필드 재사용). 덤으로 **물음표 단독 규칙이라는 실제 프로덕션 버그**를 잡았다 — 회색지대 케이스를 만들지 않았다면 드러나지 않았을 종류다.
- **한계**: 회색지대 3종 · `movieContext`를 고정 텍스트로 주입(클라 `/api/showtimes` 경로는 이 테스트가 검증하지 않음).
- **남은 것**: 날씨·영화가 사실상 같은 코드를 두 벌 갖고 있다. 세 번째 카드가 생기면 그때가 2순위(`activeCard`/`cardFollowup` 일반화)를 해야 할 시점이다 — 지금 미리 하지 않는다.

---

## 8. 프롬프트 의도별 분리 (2026-08-01)

§4-3에서 대비했던 "base 전량 주입 vs 의도별 가이드 교체"를 실제로 적용했다. app2의 `RESPONSE_GUIDE` 런타임 교체와 같은 방향이되, 우리 구조(펜스 기반 렌더러 7종)에 맞춰 **렌더러 스펙만 의도별로** 가른다.

### 8-1. 무엇을 갈랐나

[prompt.ts](../../server/agent/prompt.ts)의 렌더러 JSON 스펙 7종(chart·smiles·bio·diagram·constellation·drug·weather)을 base에서 떼어 `RENDERER_SECTIONS`로 옮기고, `INTENT_RENDERERS`가 의도별로 필요한 것만 고른다. 조립 순서는 **base → 렌더러 스펙 → 의도 힌트**(`composeInstruction`) — base가 앞에 고정돼야 암묵 캐싱 프리픽스가 유지된다.

| intent | 주입되는 스펙 | intent | 주입되는 스펙 |
|---|---|---|---|
| general / data_viz / sports | chart | astronomy | constellation |
| chemistry | smiles + chart | drug_id / drug_info | drug |
| biology | bio + smiles | medical_qa | drug + chart |
| physics | diagram + chart | pharmacy·hospital·vet·law·movie | 없음 |
| weather | weather formatting | | |

- **도구 카드 의도에 스펙이 없는 이유**: 도구가 카드 JSON을 통째로 반환하고 focus hint가 "그대로 출력하라"고 지시한다. 스펙을 줄 필요도, 줘서 좋을 것도 없다.
- **`[WEATHER FORMATTING]`을 weather에만 남긴 이유**: 정상 경로는 카드이고 focus hint가 마크다운 표를 금지하지만, **weatherTool 실패 시** 텍스트로 답하는 폴백이 남아 있다. 반대로 general에서 뺀 건 §4-3에 적은 실측 오염(날씨 무관 턴에 5일 표 재출력, DEV_260731 §3-3)이 바로 이 조합이었기 때문이다.
- 프롬프트 크기: base 14.6KB, 의도별 합계 14.9~22.7KB(general 16.5KB). 이전엔 모든 턴이 **동일한 최대 크기**였다. 다만 **비용은 원래 문제가 아니었고**(암묵 캐싱), 노린 건 문맥 오염 제거다.

### 8-2. 리스크와 그 리스크를 치는 테스트

이 변경의 실패 모드는 하나다 — **라우터가 의도를 틀리면 그 턴엔 스펙 자체가 없다.** 전량 주입 시절엔 오분류돼도 스펙은 있었다.

그래서 [scripts/test-prompt-sections.ts](../../scripts/test-prompt-sections.ts)는 스펙을 직접 넣고 보는 게 아니라 **발화 → 라우터 → generator 실그래프**로 친다.
- PART A(API 불필요): 의도별 조립에 기대 섹션이 있고 무관 섹션이 없는지 — 14개 의도 전부 통과.
- PART B(실그래프): 렌더러 5종 발화가 실제로 기대 `json:TYPE`을 내는지 + **오염 회귀**(날씨 무관 general 턴에 5일 예보 표가 끼는지) — 3.6·2.5 각 6/6 통과.
- 카드 멀티턴 회귀도 재실행: 날씨 11/11, 영화 8/8 (3.6·2.5).

### 8-3. 측정 중 잡힌 실제 버그 — `UNEXPECTED_TOOL_CALL` 빈응답

PART B에서 2.5의 data_viz 턴이 **빈 응답**으로 실패했다. 원인은 프롬프트 분리가 아니었다(HEAD에서도 재현). 로그가 정확히 말해줬다:

```
Empty response - finishReason: UNEXPECTED_TOOL_CALL
SDK path failed for intent: data_viz — falling back to LangChain
LangChain path fatal error: Cannot read properties of undefined (reading 'parts')
```

base 프롬프트가 *"실시간 정보엔 **ALWAYS** 'google_search' 도구를 써라"* 라고 못박고 있는데, 렌더러 의도는 search-gate가 검색을 끄므로 **선언된 도구가 없다**. 모델이 지시대로 도구 호출을 시도 → `UNEXPECTED_TOOL_CALL`로 응답 전체가 폐기 → SDK 폴백까지 크래시해 **사용자에겐 아무것도 안 보인다**.

프롬프트에 `[TOOL AVAILABILITY]`를 넣어 "도구는 요청마다 선언되며 없을 수도 있다 · 없으면 호출하지 말고 학습 지식으로 답하되 실시간이 아님을 밝혀라"로 고쳤다.

| | 2.5 data_viz 유효 응답 |
|---|---|
| 수정 전(HEAD) | 4/6 · 나머지는 빈응답 (다른 배치에선 6회 중 5회 `UNEXPECTED_TOOL_CALL` 발생) |
| 수정 후 | **12/12**, `UNEXPECTED_TOOL_CALL` 0회 |

### 8-5. 수식 구분자 — 프롬프트와 렌더러의 불일치 (배포 검증에서 발견)

3순위 검증(렌더러 5종)에서 물리 응답의 수식이 **`$F_g = mg$` 원문 그대로** 노출됐다(백슬래시가 `₩`로 보인 건 한글 폰트의 U+005C 표시일 뿐, 원인이 아니다).

파이프라인을 실제로 돌려 확인했다([ChatMessage.tsx](../../components/ChatMessage.tsx)의 플러그인 구성 그대로):

| 표기 | 렌더 |
|---|---|
| `$$...$$` — 표 셀 · 문장 중간 · 단독 블록 전부 | ✅ |
| `$...$` | ❌ 원문 노출 |
| `$100` (통화) | ✅ 그대로 |

`singleDollarTextMath: false`는 **의도적 설정**이다(b0d7ccc "KaTeX 통화 $ math 오인 수정") — 되돌리면 `$100`이 수식으로 파싱되던 버그가 재발한다. 즉 렌더러는 정상이고, **프롬프트가 "LaTeX으로 쓰라"고만 하고 구분자를 지정하지 않은 것**이 원인이었다. 모델은 관례대로 단일 `$`를 골랐고, 그건 이 앱에서 항상 깨진다.

프롬프트에 `[MATH NOTATION — DELIMITER IS MANDATORY]`를 넣어 `$$` 강제 + 단일 `$` 금지 + 표 셀/문장 중간에서도 `$$`가 동작함을 명시했다. 검증: 3발화(경사면·근의 공식·구심가속도) 전부 **`$$` 12~18개, 단일 `$` 0개**. 렌더러 회귀도 통과.

> 교훈: 프롬프트가 요구하는 출력 형식과 렌더러가 받는 형식이 어긋나면 **모델 품질과 무관하게 100% 깨진다**. 이건 스크립트 테스트로 안 잡혔다 — 텍스트 판정만 했지 화면 렌더를 안 봤기 때문이다. 배포 후 눈으로 보는 검증이 필요한 부류다.

### 8-6. 차트 결측 패딩 — 없는 데이터를 그리고 있었다 (배포 검증에서 발견)

"최근 5년 한국 GDP 성장률 차트로" 응답의 차트가 **0에 붙은 평평한 직선**으로 나왔다. JSON을 보니 카테고리 23개(분기별)에 실제 값은 3개(1.8 / 6.545 / 17.183)뿐이고 나머지 20개가 `null`이었는데, 화면에는 전부 0으로 찍혔다.

원인이 두 겹이었다.

| 층 | 문제 |
|---|---|
| 렌더러 | [ChartRenderer.tsx](../../components/ChartRenderer.tsx)의 `Number(d) \|\| 0` — `Number(null)`이 0이라 **결측이 전부 0**이 됐다 |
| 프롬프트 | `"If data is missing for a point, use 0 instead of null"` — **결측을 0으로 채우라고 지시하고 있었다** |

두 번째가 더 나쁘다. 사용자에게 0은 "측정값 0%"로 읽힌다 — **없는 데이터를 있는 것처럼 그리는 것**이고, 이 앱의 최상위 규칙(출처·수치를 지어내지 말 것)과 정면으로 충돌한다.

- **렌더러**: 결측을 `null`로 보존하도록 고쳤다(ApexCharts는 null을 선 끊김으로 그린다). 진짜 0은 그대로 0으로 남는다.
- **프롬프트**: `[NEVER INVENT DATA POINTS]` — ① 값이 있는 지점만 차트에 넣을 것 ② 긴 축을 만들고 null/0으로 채우지 말 것 ③ 점이 1~2개면 차트 대신 문장으로 답할 것 ④ **한 시리즈 안에서 지표·단위·기준을 섞지 말 것**(원본 응답이 전년동기 명목성장률과 전분기 실질성장률을 한 선에 섞고 있었다).

검증(같은 발화 2회): 카테고리 7개/값 7개, 카테고리 4개/값 4개 — **null 0개·패딩 0 0개**. 렌더러 5종 회귀 통과.

> §8-5와 같은 교훈의 반복이다. 스크립트는 ` ```json:chart `가 나오고 `JSON.parse`가 되면 통과시켰다 — **내용이 진실인지는 보지 않았다.** 렌더러 테스트에 "값의 절반 이상이 결측/0이면 실패" 같은 판정을 넣을 여지가 있다.

### 8-4. 평가

- **얻은 것**: 의도와 무관한 규칙이 프롬프트에서 사라졌다. 오염 회귀 테스트가 생겨 "표가 왜 또 나오지"류를 코드로 잡을 수 있다. 덤으로 빈응답 버그 하나를 실제로 고쳤다 — **분리 작업 자체보다 이쪽이 사용자 체감이 크다.**
- **한계**: PART B는 발화 5종 + 오염 1종이다. 라우터 오분류 리스크를 **없앤 게 아니라 관측 가능하게** 만든 것뿐이다. 의도가 늘거나 라우터 프롬프트를 손대면 이 테스트를 같이 돌려야 한다.
- **안 한 것**: app2식 **단계별 프롬프트 파일 분리**(YAML/파일 단위)는 하지 않았다. 우리 단계는 라우터·generator 둘뿐이고 라우터 프롬프트는 이미 router.ts 안에 격리돼 있다 — 파일로 쪼개면 관리 지점만 늘고 얻는 게 없다. `###UI_JSON###` 고정 응답 구조도 §5 판정대로 채택하지 않는다(산문 스트리밍 포기 비용이 60s 캡에서 너무 크다).
- **다음**: 2순위(`activeCard`/`cardFollowup` 일반화)는 세 번째 카드가 생길 때 재판단.

---

## 9. 언어 매핑 정리 + 카드 상태 이관 (2026-08-01)

§8을 끝내고 "언어 관련 부분이 어떻게 매핑되는지" 점검하다가, **비한국어 사용자에게 카드 후속 판정이 깨져 있다**는 걸 실측했다. 두 건이 한 덩어리로 나왔다.

### 9-1. 언어 표현 단일화

서버 언어 표현이 세 갈래였다 — 클라 코드(`ko`), 프롬프트 키(`Korean`), 그리고 `langchain-path`가 **시스템 프롬프트 본문을 정규식으로 역추출**한 `KOREAN`. 마지막이 특히 나빴다: 프롬프트 첫 문장을 고치면 언어가 조용히 영어로 폴백된다.

[server/agent/lang.ts](../../server/agent/lang.ts) 하나로 모았다 — `LangCode`/`LangName` 타입 + `toLangName`(미지값 → Korean) + `pickByLang`. `prompt.ts`의 `Record<string, …>`를 `Record<LangName, …>`으로 바꿔 **언어 누락이 컴파일 에러로 드러나게** 했고, 역추출은 삭제했다(§8에서 `langName`을 그래프까지 넘기게 돼 가능해진 정리). 하니스도 자체 맵을 버리고 `toLangName`을 쓴다 — `buildHistoryMessages` 때와 같은 함정(테스트가 프로덕션 배선을 우회)을 막기 위해서다.

### 9-2. 영어 멀티턴 실측 — 8/11

`WM_LANG=en` 스위치를 추가해 같은 시나리오를 영어로 돌렸다(한국어 11/11 → **영어 8/11, 회색지대 1/3**).

처음엔 "라우터 규칙이 한국어 전용이라 LLM 단독이 됐고, LLM이 틀렸다"고 판단했다. **틀린 진단이었다.** `weatherCardShown`을 라우터 로그에 노출하자 진짜 그림이 나왔다:

```
턴1 카드 → 턴2~6  weatherCardShown=true
턴7            weatherCardShown=false   ← 카드가 서버 히스토리 창(최근 10개) 밖으로 밀림
턴8~11         전부 false → llmFollowUp=new 가 나와도 블록이 통째로 스킵
```

LLM은 `new`를 정확히 내고 있었고, **그 판정이 쓰이지 않았다.** 한국어가 멀쩡했던 건 후속 발화마다 "날씨"가 반복돼 카드 상태와 무관하게 intent 분류가 weather를 잡아준 덕이다 — 언어가 원인이 아니라, **한국어가 버그를 가리고 있었다.**

> 진단 도구가 없으면 오진한다. `weatherCardShown` 한 줄을 로그에 넣기 전까지 나는 "LLM 판정 품질" 쪽을 고치고 있었고, 실제로 라우터 프롬프트에 다국어 예시를 넣었지만 **효과는 중립이었다**(측정으로 확인). 그 보강은 남겨뒀으나 효과 미검증으로 표시한다.

### 9-3. 처방 — 카드 상태를 클라이언트가 알려준다

화면에 카드가 떠 있는지는 **클라이언트만 정확히 안다**. 서버는 잘린 창으로 추정할 뿐이다. 영화가 이미 이 방식을 쓰고 있었다(`movieContext`) — 그래서 영화 테스트엔 이 증상이 없었다. 날씨도 같은 패턴으로 맞췄다.

| | 내용 |
|---|---|
| 클라 | `useChatStream`이 세션 전체에서 최근 **20개 메시지(10턴)** 를 보고 `activeCards: { weather }` 판정·동봉 |
| 서버 | `state.activeCards` 추가. `weatherCardShown = activeCards.weather ?? 창_내_스캔` — 구버전 클라·하니스는 기존 폴백 |
| 테스트 | 하니스와 날씨 테스트가 **클라와 같은 창 규칙**을 재현(안 그러면 폴백만 타서 프로덕션 경로를 검증 못 함) |

창은 처음 12(6턴)로 잡았다가 실측에서 짧아 20으로 늘렸다 — 카드 뒤 잡담 몇 턴이면 다시 창을 벗어났다. 스크롤하면 카드는 여전히 화면에 있고 사용자는 "아까 그거 다시"라고 말한다.

### 9-4. 결과

| | 전체 | 회귀 | 회색지대 |
|---|---|---|---|
| 영어 (수정 전) | 8/11 | 7/8 | 1/3 |
| **영어 (수정 후)** | **11/11** | 8/8 | 3/3 |
| 한국어 3.6 · 2.5 | 11/11 | 8/8 | 3/3 |
| 영화 3.6 · 2.5 | 8/8 | 5/5 | 3/3 |

**테스트가 틀린 케이스도 하나 나왔다** — 영어 `How about Busan?`는 직전 턴이 "주말 여행 계획을 짜줘"라서 모델이 *여행지 추천*으로 답했다(맥락상 옳은 해석). 한국어 원본 `부산 날씨도 알려줘`가 날씨를 명시하는데 영역할 때 그 단어를 빠뜨린 게 원인이라, 케이스를 `What about the weather in Busan?`으로 고쳤다. 오늘만 두 번째다(§7-3의 "아까 그 카드" 건과 같은 유형) — **모호한 발화를 테스트에 넣으면 코드를 의심하게 된다.**

### 9-5. 평가

- 2순위로 미뤄뒀던 `activeCard` 일반화가 **취향이 아니라 버그 수정**으로 앞당겨졌다. 미룬 판단 자체는 틀리지 않았다 — 근거(비한국어 실패)가 그때는 없었다.
- 남은 리스크: 카드가 20메시지 창 안이면 "화면에 있다"고 본다. 새 조회 신호가 그대로 승격시키므로 갇히지는 않는다.
- 라우터 프롬프트 다국어 예시는 **효과 미검증** 상태다. 지금은 카드 감지가 고쳐져 회색지대가 전부 통과하므로, 이 예시들의 기여를 분리 측정하려면 별도 A/B가 필요하다.
- 아직 안 본 것: `movieContext`는 이미 클라 판정이라 같은 결함이 없지만, **다른 카드(약국·병원·법령)에는 후속 판정 자체가 없다.** 필요해지면 `activeCards`에 키를 늘리면 된다.
