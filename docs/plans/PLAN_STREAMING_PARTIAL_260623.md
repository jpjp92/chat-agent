# 기획: SDK 경로 부분 스트리밍 전환 (general 산문 한정)

> 작성일: 2026-06-23
> 상태: **설계 기획 — 구현 대기**
> 트리거: "3.5 + ground search 체감 지연" + "월드컵 표·병원·약국은 스트리밍이 필요 없잖아"
> 선행 분석: [PLAN_THINKING_LATENCY_260602.md](PLAN_THINKING_LATENCY_260602.md)

---

## 0. TL;DR

- 느림의 **실제 총시간**은 무료티어에서 이미 최적(Stage1 `thinkingBudget:0`, ~48% 단축). 더 줄일 무료 레버 없음.
- 남은 건 **체감(TTFT)** — 현재 SDK 경로 전체가 비스트리밍이라 3회 순차 콜이 끝날 때까지 백지.
- **스트리밍은 `general` 산문에만 붙인다.** 렌더러 JSON·LangChain 카드는 스트리밍 대상이 아니며, 그중 병원·약국·월드컵(sports)은 **애초에 다른 경로(카드 렌더)**라 손댈 것도 없다.

---

## 1. 현재 구조 (왜 백지 시간이 긴가)

전 구간 `generateContent`(비스트리밍) — [generator.ts](../../server/agent/nodes/generator.ts) 의 222·259·336·387·430·454·491·538·662 전부. `generateContentStream` 미사용. 응답 텍스트가 완성된 뒤 한 번에 emit → 3회 콜 합계가 끝날 때까지 사용자 화면 백지.

가장 느린 경로 = **3.5 + 검색 → two-track** ([generator.ts:219](../../server/agent/nodes/generator.ts#L219)):

| 단계 | 모델 | 소요(실측, budget0 후) |
|---|---|---|
| Router | 2.5-flash-lite | (분류) |
| Stage1 | 2.5-flash + grounding | ~4.5s |
| Stage2 | 3.5-flash (minimal) 종합 | ~1.4~2.0s |

→ Stage1(~4.5s)이 끝나기 전엔 출력할 게 없지만, **Stage2 산문은 토큰단위로 흘릴 수 있다.** Stage1 직후부터 글자가 흐르면 체감 지연이 크게 줄어든다.

---

## 2. 인텐트 경로 분리 (스트리밍 적합성)

[generator.ts:74](../../server/agent/nodes/generator.ts#L74) `LANGCHAIN_INTENTS = drug_id, drug_info, pharmacy_search, hospital_search, vet_search, law_search, movie_search, sports`

| 경로 | intent | 출력 | 스트리밍 |
|---|---|---|---|
| **LangChain** | 병원·약국·동물병원·법령·영화·약품·**월드컵(sports)** | 툴 JSON → **카드 렌더** (`on_tool_end` SSE) | ❌ 해당 없음 (이미 "한 방 카드", two-track·스트리밍 개념 없음) |
| **SDK / 렌더러** | data_viz·chemistry·biology·physics·astronomy | **JSON 블록** | ❌ 통째로 와야 함 (토큰단위면 파싱 깨짐) |
| **SDK / general** | 일반 대화 + 검색종합(날씨·뉴스·주가…) | 자연어 prose | ✅ **스트리밍 대상** |

→ 사용자가 "스트리밍 필요 없다"고 한 월드컵·병원·약국은 **LangChain 카드 경로**라 이번 변경 범위 밖. 막을 것도 없음.

---

## 3. 게이팅 설계

```
스트리밍 ON  ⟺  state.intent === 'general'        (검색종합/일반대화 산문)
스트리밍 OFF ⟺  렌더러 intent (JSON 블록)
             +  LangChain 카드 (별도 경로, 무관)
             +  youtube 영상 턴 (현 2.5 핀 유지 — 별도 판단)
```

- 단일 기준 = `intent === 'general'`. 렌더러/멀티모달/youtube는 자동 제외.
- 안전판: 스트리밍 경로에서 응답 첫 청크에 ` ```json ` 패턴이 감지되면 스트리밍 중단·버퍼링 폴백(렌더러 오분류 방어).

## 4. 구현 포인트 (개념, byte 단위 설계는 구현 시)

1. **Two-track Stage2** ([generator.ts:336](../../server/agent/nodes/generator.ts#L336)) → `generateContentStream` 전환. `general`이 곧 two-track 진입 조건이므로 게이팅 자연 일치. Stage1(검색) 완료 직후부터 청크 emit.
2. **단일패스 general 비검색** ([generator.ts:430](../../server/agent/nodes/generator.ts#L430)) → `general && !렌더러`일 때 stream. 렌더러 intent는 현행 `generateContent` 유지.
3. **출처(groundingSources) 첨부 타이밍** — 현재 응답 끝에 붙임. 스트리밍이면 텍스트 청크 전부 흘린 뒤 `sources` SSE 이벤트를 별도로 전송하도록 분리.
4. **emit 경로** — route.ts의 현행 단일 emit 지점을 청크 루프로. 비스트리밍 intent는 기존 단일 emit 유지(이중 경로).

## 5. 회귀 검증 체크리스트 (구현 후 필수)

- [ ] 렌더러 5종(chemistry/biology/physics/astronomy/data_viz) JSON 무손상 — **비스트리밍 유지 확인**
- [ ] LangChain 카드 7종(병원·약국·동물병원·법령·영화·약품·sports) 변동 없음
- [ ] general 검색종합(날씨·뉴스·주가) 스트리밍 + **출처 정상 첨부**
- [ ] 마크다운 **표가 토큰 경계로 쪼개져도** 프론트 렌더 정상 (doc §7 후속과제)
- [ ] 스트리밍 도중 에러/키로테이션 시 폴백 (현 retry 로직과 호환)
- [ ] youtube 영상 턴 2.5 핀 경로 영향 없음

## 6. 기대 효과 / 한계

- **체감 TTFT 대폭 개선** (Stage1 ~4.5s 후 즉시 글자 흐름). **실제 총시간은 동일** — 스트리밍은 perceived latency 레버지 throughput 레버 아님.
- 렌더러·카드는 무변화 (원래 한 방 출력이라 스트리밍 무의미).

---

## 7. 부록: "리팩토링하면서 느려진 느낌" — 진단

체감 지연의 원인은 **move-only 리팩토링이 아니라 모델 기본값 변경**이다. (시기가 겹쳐 혼동되기 쉬움)

### 7-1. 리팩토링은 무죄 (동작 불변 검증됨)

순수함수 추출(04d291c)·search-gate 분리(cce3baf)·retry 분리(0fec111)·langchain-path 분리(21e2f29) 전부 **move-only**:
- 커밋 메시지에 byte-identity diff + 동등성 테스트 **19,200~19,423 케이스 0 fail** 명시.
- JS 함수호출 오버헤드는 ns 단위 — 체감 불가. **런타임 동작 변화 없음.**
- 이번 세션 router `thinkingBudget:0` 추가는 라우터를 **더 빠르게** 함(느리게가 아님).

### 7-2. 진짜 원인: DEFAULT_CHAT_MODEL 2.5 → 3.5 (5/30, 커밋 1cd48c2)

[models.ts:13](../../server/models.ts#L13) `DEFAULT_CHAT_MODEL = FLASH_3_5`. general 대화 기본이 2.5→3.5로 바뀌면서:

1. **검색 질의**: 2.5는 **단일패스 grounding(~4.5s)** 이었으나, 3.5는 무료티어 grounding 불가 → **two-track(Stage1+Stage2, +Stage2 1.4~2s)**. 검색 답변마다 콜 1회 + ~1.5s 추가.
2. **비검색 일반 대화**: 3.5 general은 `thinkingLevel: "low"` ([generation-config.ts:56](../../server/agent/nodes/generation-config.ts#L56)). 실측상 low는 minimal 대비 thinking 토큰 폭증(MoE 설명: low 12.8s/th1409 vs minimal 6.4s/th0, [PLAN_THINKING_LATENCY_260602.md §3-3](PLAN_THINKING_LATENCY_260602.md)). 2.5(thinking 거의 없음) 시절보다 느려질 수 있음.

→ 5/30 모델 전환의 **의도된 트레이드오프**(3.5 추론 품질 ↔ 지연). 이미 외부 API·drug·youtube·sports는 2.5로 되돌려 방어했고(321386a, 8075618), 남은 건 general. general을 2.5로 되돌리면 빨라지지만 품질 후퇴 → 대신 **체감을 줄이는 스트리밍(본 플랜)** 이 정공법.

### 7-3. 후속 검토 후보 (이번 범위 아님)

- [보류] general 비검색 `low` → `minimal` ([generation-config.ts:56](../../server/agent/nodes/generation-config.ts#L56)): 코드·수학·다단계 추론 품질 검증 선행 필수 (doc §5-2). minimal이면 비검색 general도 빨라질 수 있음.

---

## 8. 진행 순서 (결정됨 2026-06-23)

**두 레버를 묶지 않는다 — 각각 독립 검증.** 섞으면 회귀 시 원인 격리 불가.

1. **[Phase 1] 스트리밍 전환** (본 플랜 §3~5) — 체감 TTFT. 동작 동등성 회귀(렌더러·카드 무손상)만 통과하면 됨. 품질 리스크 낮음.
2. **[Phase 2] general `low → minimal` 검증** ([generation-config.ts:56](../../server/agent/nodes/generation-config.ts#L56)) — 실시간 단축. **품질 리스크 있음, 별도 테스트 선행 필수.** Phase 1 완료·안정화 후 착수.

### Phase 2 리스크: "minimal로 내리면 얼마나 멍청해지나"

기존 실측([PLAN_THINKING_LATENCY_260602.md §3-3](PLAN_THINKING_LATENCY_260602.md))으로 **이미 안전 확인된 영역**과 **미검증 영역**이 갈린다:

| 영역 | minimal vs low | 상태 |
|---|---|---|
| 검색 사실(날씨) | minimal 동급, 더 빠름 | ✅ 안전 |
| 개념 설명(MoE) | minimal 동급(구조·정확도 동일), 6.4s vs 12.8s | ✅ 안전 |
| 최신 정보(신모델) | minimal이 **더 충실**(출처·디테일↑) | ✅ 안전 |
| 렌더러 JSON 4종 | minimal 무손상 | ✅ 안전 (이미 production minimal) |
| **코드 생성** | — | ❓ **미검증** |
| **수학·다단계 추론** | — | ❓ **미검증** |

→ general `low`가 **지배하는 영역이 바로 비검색 코드·작문·번역·추론**(검색은 이미 two-track Stage2=minimal). 즉 minimal 전환의 영향이 **정확히 미검증 영역에 집중**된다. 그래서 Phase 2는 **코드·수학·다단계 추론 전용 minimal-vs-low 품질 테스트**(별도 스크립트)를 먼저 돌려, "멍청해지는지"를 정량 확인한 뒤에만 적용한다. 검증 전 변경 금지.

- Phase 2 테스트 설계(예정): 코드생성(알고리즘·디버깅)·수학(다단계 계산)·논리추론(다홉) 케이스 × low/minimal, 정답률·완결성 비교. doc §3-3 포맷 재사용.

---

## 9. 진행 현황 (2026-06-24)

### 적용 완료 (dev, 미커밋)

| # | 변경 | 파일 | 상태 |
|---|---|---|---|
| 1 | **Phase 2: general `low → minimal`** | [generation-config.ts](../../server/agent/nodes/generation-config.ts) `resolveThinkingConfig` 3.5 분기 전체 minimal 통합 (RENDERER_INTENTS 상수 제거) | ✅ 적용 + tsc 0 |
| 2 | **Stage2 503/429 분리** | [generator.ts](../../server/agent/nodes/generator.ts) Stage2 catch | ✅ 적용 + tsc 0 |

**#1 근거** — 비검색 코드·수학·추론 5케이스 측정([scripts/test-low-vs-minimal-reasoning.ts](../../scripts/test-low-vs-minimal-reasoning.ts), prod 프롬프트, search OFF, 2런):

| 케이스 | low | minimal | 단축 | 정답 |
|---|---|---|---|---|
| 코드생성(LRU) | 10700ms/th945 | 4530ms/th0 | −6170ms (58%) | 양쪽 ✅ |
| 코드디버깅 | 5530/th222 | 4244/th0 | −1286ms | 양쪽 ✅ |
| 수학(다단계) | 6117/th433 | 4333/th0 | −1784ms | 양쪽 ✅ |
| 추론(그리디) | 6324/th0 | 8689/th0 | +2365ms(노이즈, 양쪽 th0) | 양쪽 ✅ |
| 논리(다홉) | 9583/th686 | 6943/th0 | −2640ms | 양쪽 ✅ |

→ **평균 −1903ms(25%), 품질 저하 0.** thinking 토큰 쓰는 곳(코드/논리/수학)에서 큰 이득. (스크립트 논리퍼즐 기대정답 라벨은 B가 정답 — C로 오기, 모델은 양쪽 B 정답)

**#2 근거** — 날씨 테스트(검색) 28.6s 로그 분석: Stage2 3.5가 503(모델 폭주)인데 429처럼 **12개 키 전부 로테이션**(~24s 낭비) 후 2.5 폴백. 503은 모델 전체 현상이라 키 교체 무의미. → daily-quota/503/429 3분기로 재작성: **503 = 백오프 최대 2회(400·800ms) 후 즉시 2.5 폴백**, 429/timeout만 키 로테이션 유지.

### ⚠️ 측정 오염 주의 (중요)

테스트 시점에 **Google Gemini 전역 503 "high demand" 이벤트** 진행 중이었음 — 라우터(2.5-flash-lite)까지 503. 이 때문에:
- 비검색 단일패스가 minimal인데도 **18.8s**(로테이션 로그 없음 = Google 측 스로틀링).
- **minimal 본래 효과(~4.5s)·Stage2 fix 효과(28s→6s)는 폭주가 가신 뒤 재측정해야 정확.**

이 503 폭주가 사용자가 보고한 **"모바일에서 갑자기 느림/빠름" 변동의 핵심 원인**으로 확인됨(Google 건강 시 ~5s ↔ 503 시 18~28s).

## 10. 재점검 목록 (이후)

### 즉시 (폭주 가신 뒤)
- [ ] **minimal + Stage2 fix 재측정** — Google 503 정상화 후. 비검색 일반(코드 등) 체감, 검색(날씨) 503 시 28s→6s 확인.
- [ ] **§8 Phase 2 테스트 체크리스트 A~D 실측** — 사용자 prod 검증.

### 503 처리 확장 점검 (Stage2 외)
- [ ] **Stage1**(검색 grounding) 503 처리 — 현재 빈응답 1회 재시도만, 503 전용 분기 없음. 503 throw 시 바깥 루프 거동 확인.
- [ ] **단일패스**(비검색) 503/지연 — 18.8s가 우리 재시도 탓인지 순수 Google 스로틀링인지 로그 재확인. 바깥 키-로테이션 루프 존재 여부.
- [ ] **라우터**([router.ts](../../server/agent/nodes/router.ts)) 503 — 현재 2회 재시도. 폭주 시 거동 적정한지.
- [ ] (후속/보류) **서킷 브레이커** — 3.5 503 직후 ~30s간 요청 2.5 우회. 매 요청 폭주 재발견 방지. 상태관리 복잡 → 별도 판단.

### Phase 1 스트리밍 (미착수)
- [ ] general 산문 스트리밍 전환(§3~5). minimal로 실시간은 줄였으나 **체감(TTFT)·모바일 셀룰러 대형 페이로드**는 여전히 스트리밍이 정답.

### 기타 관찰 (앞 대화에서 제기)
- [ ] **제목 미생성**(모바일 간헐) — summarize-title fetch가 스트림 완료 후 실행 → 모바일 백그라운딩 시 suspend, 또는 updateSessionTitle DB write 실패. 로그로 갈래 판별 필요.
- [ ] **날씨 등 단순 사실질의 maxTokens/장황구조** — 현재 32768 cap + 첫턴 구조 강제([generator.ts](../../server/agent/nodes/generator.ts) synthesisInstruction). cap보다 "문맥 인지 간결화"가 본질. 단순질의 판별 정확도 검증 선행.

---

## 11. 최적화 방안 종합 (2026-06-24)

[DEV_260624 §3·§4](../logs/DEV_260624.md) 측정으로 확정된 전제 위에서 가능한 레버 전체 정리.

**전제(확정)**: ① 체감 지연 주범 = 무료티어 3.5 throughput **변동**(20~30s 스파이크, [§4-1 head-to-head](../logs/DEV_260624.md)). ② **파라미터 튜닝 여지 0** (Tier1에서 3.5는 어떤 설정이든 4~9s). ③ 60s Vercel 천장, minimal·Stage2 503분리 이미 적용. ④ 무료 vs Tier1 = "고정 배수"가 아니라 "변동성"(무료는 한가하면 동급, 부하 시 3~6배/실패).

### ⓪ 근본 — 모델/티어 선택 (최대 레버, 트레이드오프 결정 필요)
| 방안 | 효과 | 비용/리스크 | 노력 |
|---|---|---|---|
| **A1. `DEFAULT_CHAT_MODEL` 3.5→2.5** | 변동 즉시 제거(2.5 0.6~2.2s 건강) | 3.5 품질 포기 | 한 줄 |
| A2. Tier1 유료 전환 | 변동 제거 + 3.5 품질 유지 | 돈 | 키 교체 |
| A3. 하이브리드(3.5 기본+조건부 2.5) | 절충 | 복잡도↑ | 중 |

→ **선결 분기: 3.5 품질 ↔ 안정성.** 안정 우선이면 A1 즉효, 품질 유지면 A2/A3.

### ① 체감 — 스트리밍 (Phase 1, §3~5)
- general 산문 TTFT 급감(모바일 셀룰러). 총시간 불변. 렌더러 JSON·LangChain 카드 제외.
- ⚠️ 한계: "200 OK인데 20~30s 큐잉"은 첫 토큰 자체가 늦어 스트리밍도 못 구함 → ②와 병행.
- ⚠️ **마크다운 표/코드블록 스트리밍 깨짐** — 부분 토큰이 표를 행 단위로 렌더해 깜빡임/붕괴. 클라이언트 측 **미완성 블록 버퍼링** 필요(§11-1 참조, Phase 1 설계 포함).

### ② 변동성 방어 (무료티어 유지 시 실효 대책)
| 방안 | 핵심 | 비고 |
|---|---|---|
| **C1. 타임아웃 레이스** | 3.5 시작, N초 내 무응답 시 2.5 병렬 발사→먼저 오는 쪽 채택 | **"20~30s OK" 잡는 유일 방법**(에러 폴백 불가). 느린 경우 추가 호출 비용 |
| C2. 헬스 인지 키/모델 선택·서킷 브레이커 | 429/느린 키 회피 | §10 503확장과 연계 |
| C3. 503/429 확장 | Stage2만 됨 → Stage1·단일패스·라우터 | 일관성 |

### ③ 작업량 축소 (60s 천장 내 마진)
- D1. 구글서치 과다 요약 억제 (grounding cap / 요약길이 제한) — 일부 [DEV_260624 §6](../logs/DEV_260624.md)에서 Stage2 제거로 해소, Stage1 슬림(lean notes+cap)은 후속.
- D2. 단순질의 간결화 프롬프트 — 출력 토큰↓ = 생성시간↓ (cap이 아니라 실제 생성 길이가 지연 좌우)
- **D3. ✅ 완료(2026-06-24, [DEV §6](../logs/DEV_260624.md))** — two-track Stage2(3.5 재합성) 전면 제거 → 검색은 2.5 single-pass. Tier1 측정 30~45%↑ + throttled 3.5 회피. `generator.ts` −161줄.

### 권장 순서
1. **⓪ 결정 먼저** (3.5 품질 vs 안정성).
2. **① 스트리밍** — 모델 무관 체감 개선, 독립 가치.
3. **② C1 레이스** — 무료 유지 시 변동성 핵심.
4. ③ 부수 마진.

→ 효과/노력비 최선 = **①스트리밍 + ②C1 레이스**(무료 유지하며 체감·변동 동시 공략). 최간단·확실 = **⓪A1**(3.5 품질 포기 전제).

### 11-1. 스트리밍 시 마크다운 표/코드블록 깨짐 제어 (Phase 1 필수 설계)

**문제**: [useChatStream.ts:400](../../src/hooks/useChatStream.ts) `modelResponse += chunk` 누적 → [ChatMessage.tsx:684](../../components/ChatMessage.tsx) 매 청크 ReactMarkdown 재파싱. 표는 `|---|` 구분행 도착 전까지 일반 텍스트, 이후 행이 하나씩 붙으며 들썩임. 코드펜스·KaTeX 동일 + react-syntax-highlighter 매 토큰 재하이라이트(성능 손해).

**제어는 클라이언트 렌더 단에서** (서버는 모델 freeform 토큰 스트림이라 "표만 빼고" 불가).

| 방안 | 방식 | 산문 | 채택 |
|---|---|---|---|
| **B. 블록 인지 억제** | 꼬리가 열린 표(연속 `\|`행이 빈줄/비표행으로 미마감)·열린 코드펜스(``` 홀수) 감지해 **그 영역만** 완성까지 숨김 | 단어 단위 유지 | **권장** |
| A. 완성블록 flush | 마지막 `\n\n`까지만 파싱, 꼬리 plain | 문단 단위(덩어리짐) | 간단 대안 |
| C. 서버 구조 마커 | 모델 freeform이라 불가 | — | ✗ |

**구현 포인트**:
- `isStreaming` 플래그를 ChatMessage에 전달 → **스트리밍 중에만** 게이팅, 종료 시 전체 원본 렌더(최종 출력 1바이트 불변).
- 표는 블록 마감(`|---|` + 빈 줄/비표 행 또는 스트림 종료) 시 **통째로** 출현.
- 회귀 주의: 종료 시 렌더 결과가 비스트리밍과 동일해야 함.

**구현 완료 (2026-06-24, dev 미커밋)** — 방안 B:
- [utils/streamingMarkdown.ts](../../utils/streamingMarkdown.ts) `gateStreamingTables(text, isStreaming)` — 꼬리의 미완성 표(연속 `|`행, 빈 줄 미마감) 제거. `isStreaming=false`면 원본 그대로(no-op).
- [ChatMessage.tsx](../../components/ChatMessage.tsx): `isStreaming` prop 추가, `renderContent`의 remaining 텍스트에 게이트 적용(기존 bold/코드펜스/viz 보정과 동일 위치).
- [ChatArea.tsx](../../components/ChatArea.tsx): `isStreaming = isTyping && 마지막 메시지 && role===MODEL` 전달.
- 검증: [scripts/test-table-streaming.ts](../../scripts/test-table-streaming.ts) (`npx tsx`) — 동일 파서 스택으로 **RAW 14프레임(BROKEN 5+PARTIAL 9) → GATED 0** 확인. tsc 0.
- 남은 폴리시(선택): 표 숨김 구간(서브초)엔 로딩 표시 없음(현 타이핑 닷은 마지막이 USER일 때만). 코드펜스는 기존 "append ``` " 방식 유지(별도). 표 외 블록 게이팅은 추후.
