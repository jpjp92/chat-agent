# generator.ts 리팩토링 계획 — 2026-06-21

> 작성일: 2026-06-21
> 상태: **1·2·4-A·3-A순위 구현·검증 완료**(1·2 커밋 `04d291c`·`cce3baf`·4-A `0fec111`, 3-A 커밋대기). generator.ts 1148→685줄(-40%). 3-B 다음.
> 대상: [server/agent/nodes/generator.ts](../../server/agent/nodes/generator.ts)
> 구현 기록: [docs/logs/DEV_260621.md §10](../logs/DEV_260621.md)

---

## 0. 배경 & 원칙

1148줄 단일 클로저 함수(`createGeneratorNode`)에 SDK 경로·LangChain 경로·검색 게이트·재시도가 응집 → 가독성/테스트 난항. 버그픽스 주석(Fix A/B·tool_code·MALFORMED·partial-stream 등)이 빼곡한 **행동-임계** 코드라, **동작 변경 0** 을 최우선으로 단계 분리.

**검증 철학**: 가능하면 "추출 모듈 vs 커밋 전 인라인 로직" deep-equal 동등성 테스트(`scripts/test-generator-refactor.mts`, tsx)로 증명. 불가능하면 tsc + 코드리뷰 + dev E2E.

---

## 1. 진행 현황 & 권장 순서

| 단계 | 내용 | 상태 | 위험 | 검증 |
|---|---|---|---|---|
| 1 | 순수함수 3모듈 — `pill-messages.ts`·`sdk-contents.ts`·`generation-config.ts` | ✅ `04d291c` | — | tsc + 동등성 223 |
| 2 | 검색게이트 `search-gate.ts` (`decideGoogleSearch`) | ✅ `cce3baf` | — | tsc + 동등성 19,200 |
| **4-A** | **에러 분류/로테이션 공통화 (완전 동일분만)** → `retry.ts` | ✅ 완료 | **낮음** | tsc + byte-identity diff |
| **3-A** | **LangChain 경로 분리** → `langchain-path.ts` (가장 안전한 슬라이스) | ✅ 완료 | 중 | tsc + move-identity diff + dev E2E 4종 |
| **3-B** | **SDK 경로 + YouTube 폴백 분리** → `sdk-path.ts` | ⬜ **다음** | **높음** | tsc + 리뷰 + **dev E2E 필수** |
| 4-B | 에러 술어 드리프트 수렴 통합 (선택·동작변경) | ⬜ 보류 | 중 | tsc + dev E2E |

> **확정 순서: 4-A → 3-A → 3-B → (선택)4-B.** 장기 안전성·관리 효율 기준. 근거: ① 중복(에러 분류)은 두 catch가 **같은 파일에 나란히 있는 지금** 합치는 게 가장 쌈 — 3-A/3-B로 파일이 갈라지면 대조·통합 비용 증가. ② 4-A는 증명 가능(무위험·E2E 불요), 3은 dev E2E 필수. ③ 4-A로 `retry.ts`를 먼저 두면 3-A/3-B가 catch를 경로 파일로 옮길 때 이미 공통 헬퍼 import 상태라 깔끔.

1·2순위 결과: generator.ts **1148 → 895줄(-22%)**, 신규 4모듈, 동등성 19,423 케이스 0 fail.

---

## 2. 현재 남은 구조 (895줄 기준)

| 블록 | 위치(대략) | 규모 | 비고 |
|---|---|---|---|
| 셋업(인스트럭션 조립·라우팅·플래그·이미지검색가드) | L25–100 | ~75 | 잔류 |
| `let sdkSuccess = false` | L95 | — | 경로 간 공유 플래그 |
| **SDK 경로** `if (!useLangChain){ while … }` | L101–637 | **~537** | buildSdkContents·decideGoogleSearch·two-track·single-pass·tool_code 가드·catch 재시도 |
| **YouTube 폴백** | L639–686 | ~48 | SDK 전소진 시 3.5-flash 재시도 |
| **LangChain 경로** `while(lcAttempt…)` | L688–857 | ~170 | fast-pass(pharmacy/hospital/…)·direct pill lookup·tool 바인딩 |
| 최종 throw | L859 | — | 잔류 |

---

## 3. ⚠️ 3순위가 1·2순위와 다른 점 (위험 요인)

1. **순수 move-only가 아님 — 제어흐름 계약 필요**
   SDK 경로는 성공 시 노드 결과를 직접 `return`, 실패 시 break→fall-through(→YouTube폴백→LangChain) + `sdkSuccess` 변이로 흐름이 얽힘. 함수로 빼려면 "결과를 냈는가 / fall-through 신호인가"를 표현하는 **discriminated 반환 계약**을 새로 설계해야 함:
   ```ts
   type PathResult =
     | { done: true; value: { messages: AIMessage[]; groundingSources?: any[] } }
     | { done: false };   // 다음 단계로 넘김 (sdkSuccess=false 대응)
   ```
2. **검증 그물이 약함**
   두 경로 모두 `new GoogleGenAI().models.generateContent()` 네트워크 I/O라 deep-equal 하니스로 못 돌림. 안전망 = `tsc(타입·와이어링) + 코드리뷰(문자 단위 대조) + dev E2E 실측`. **dev E2E가 선택이 아니라 필수.**
3. **공유 closure 폭이 큼**: `apiKey`·`state`·`finalInstruction`(LangChain에서 변이)·`sendEvent`·`isYoutubeRequest`·`resolvedModel`·`needsSearchFallback`·`SEARCH_FALLBACK_MODEL`·`hasVideoData`·`latestUserText`·`MAX_KEY_RETRIES`·`sdkSuccess` 등 → 명시 인자/반환으로 끌어내야 함.

→ 위험/이득 비율이 1·2순위보다 나쁨. 단, generator.ts를 ~120줄 오케스트레이터로 만드는 **가독성 이득은 큼**.

---

## 4. 3순위 — 경로 분리 (단계별)

신규 모듈 후보(sibling): `sdk-path.ts`, `langchain-path.ts`. (또는 향후 `generator/` 폴더 재편)

### 3-A. LangChain 경로 먼저 (가장 안전한 슬라이스)
- 범위: L688–857(~170줄). 자체 `while`+`return`으로 끝나고 뒤는 최종 throw뿐이라 **제어흐름 얽힘이 가장 적음**.
- 인터페이스(초안):
  ```ts
  async function runLangChainPath(args: {
    state; finalInstruction; resolvedModel; apiKey; isYoutubeRequest; systemInstructionBase; sdkSuccess; useLangChain;
  }): Promise<{ messages: BaseMessage[] }>   // 또는 throw
  ```
- `finalInstruction`은 direct-pill-lookup에서 append → 함수 내부 지역 변수로 받아 변이.
- fast-pass 반환들(`json:pharmacy/hospital/vet/law/movie`, pill no-match/error/candidate)·tool 바인딩 분기 그대로 이동. pill 헬퍼는 이미 `pill-messages.ts`에서 import.

### 3-B. SDK 경로 + YouTube 폴백
- 범위: L101–686. `runSdkPath(...)` → `PathResult` 반환, `sdkSuccess`는 반환값으로 표현(`done` 여부).
- YouTube 폴백(L639–686)은 `runSdkPath` 내부에 포함하거나 별도 `runYoutubeFallback()`로. 내부 포함이 closure 공유가 적어 단순.
- two-track(stage1/stage2)·single-pass·tool_code 가드·catch 재시도 전부 동반 이동. buildSdkContents·decideGoogleSearch 호출도 함께.
- partial-stream 중복 가드(`if (responseText)` in catch)·500-multimodal 재시도(`hadMultimodalContent`) 동작 보존 주의.

### 3-C. generator.ts 잔류
- 셋업(인스트럭션 조립·라우팅·이미지검색가드) + `const r = await runSdkPath(...); if (r.done) return r.value;` + `return await runLangChainPath(...)` 형태의 ~120줄 오케스트레이터.

**순서**: 3-A(LangChain) → tsc → dev E2E(drug_id/pharmacy/hospital 카드) → 커밋 → 3-B(SDK) → tsc → dev E2E(일반/이미지/PDF/YouTube/URL/검색/medical/renderer) → 커밋.

---

## 5. 4순위 — 에러 재시도 공통화

SDK catch(L593~)와 LangChain catch(L860~)가 에러 분류 + 키 로테이션을 중복. **단, 술어 대조 결과 "진짜 동일한 부분"은 절반뿐**(나머지는 우발적 드리프트):

| 플래그 | SDK (L593–597) | LangChain (L860–886) | 동일? |
|---|---|---|---|
| `isTimeout` | `504 ‖ DEADLINE_EXCEEDED ‖ '504' ‖ ERR_STREAM_DESTROYED` | 동일 | ✅ 완전 동일 |
| `isAuth` | `401‖403 ‖ /api key not valid/` | 동일 | ✅ 완전 동일 |
| `isRateLimit` | `429 ‖ msg.'429' ‖ 'RESOURCE_EXHAUSTED'` | `429 ‖ statusText==='Too Many Requests'` | ❌ 드리프트 |
| `isUnavailable` | `503 ‖ msg.'503' ‖ 'UNAVAILABLE'` | `503 ‖ 'UNAVAILABLE'` | ❌ 드리프트 |
| `isStreamError` | — | `'Failed to parse stream' ‖ 'INTERNAL' ‖ '503'` | LangChain 전용 |

→ 그래서 두 갈래로 분리:

### 4-A. 엄격 move-only (먼저, 무위험)
- `retry.ts` 신규: 완전 동일한 `isTimeout(err)`·`isAuth(err)` 순수 분류 + `markKeyForError(key, err)` 로테이션 헬퍼(`isDailyQuotaError`→`markKeyDailyExhausted` / else `markKeyRateLimited`, 이미 양쪽 동일 패턴).
- 드리프트 플래그(`isRateLimit`/`isUnavailable`)·SDK 전용(500-multimodal·partial-stream 중복가드)·LangChain 전용(`isStreamError`)은 **각 site에 그대로 둠**.
- 동등성 테스트(err 샘플 → 플래그 deep-equal)로 증명 가능.

### 4-B. 드리프트 수렴 통합 (선택·보류)
- `isRateLimit`/`isUnavailable`을 superset로 일치(예: 양쪽 다 msg+statusText 검사). 양쪽이 같은 에러에 키 회전하게 되는 **잠재 버그픽스 성격**.
- ⚠️ 이건 **리팩토링이 아니라 의도적 동작 변경** → move-only 아님, deep-equal 증명 불가. tsc + dev E2E + 문서에 "동작 수렴"으로 명시. 무리하면 스킵 가능.

---

## 6. 검증 체크리스트 (3·4순위 공통)

- [ ] `npx tsc --noEmit` 0
- [ ] 코드리뷰: 신규 모듈 본문이 기존 인라인과 문자 단위 동일(제어흐름 계약 부분만 신규)
- [ ] dev E2E(`npx vercel dev`) — 경로별:
  - SDK: 일반 텍스트 / 이미지 분석 / PDF 분석 / YouTube 요약 / URL 요약 / "검색해줘"(grounding) / medical_qa / data_viz·astronomy(renderer) / 멀티턴 follow-up
  - LangChain: 알약 이미지(no-match·후보·exact) / 약국·병원·동물병원·법령·영화·월드컵 카드
  - 재시도: (가능하면) 키 회전·타임아웃 폴백 경로
- [ ] 회귀 시 즉시 롤백(단계별 커밋이라 격리 용이)

---

## 7. 의사결정 노트

- **확정 순서**: **4-A → 3-A → 3-B → (선택)4-B.** 장기 안전성·관리 효율 기준. 중복은 흩어지기 전(같은 파일)에 통합하는 게 효율적이라 4-A가 먼저, 그다음 가장 안전한 슬라이스인 3-A(LangChain), 마지막 위험한 3-B(SDK).
- 1·2순위로 큰 이득(가독성 -22%·검색게이트 격리)은 이미 확보. 3순위(경로 분리)·4-B(수렴 통합)는 **필수 아님** — 안 해도 generator.ts는 충분히 정리된 상태.
- 3순위 착수 시: 3-A(LangChain 경로, 가장 안전) 먼저 + dev E2E 예산 필수.
