# PLAN: Gemini/OpenAI 멀티 공급자 라우팅 안정화

> 작성: 2026-08-23  
> 상태: OpenAI 일반 생성·로컬 function calling·Gemini 키 분리는 구현 완료. 공급자별 initial router와 모델 전환 UX는 후속.

## 1. 목표 계약

1. 사용자가 선택한 공급자는 해당 턴의 intent 분류와 최종 생성을 담당한다.
2. 공급자 간 자동 전환은 모델 능력상 처리할 수 없는 modality에만 허용한다.
3. 쿼터·결제·인증·일시 장애는 다른 공급자로 숨겨서 전환하지 않고 사용자에게 정제된 안내를 표시한다.
4. 공급자 오류 원문과 코드는 로그에만 남긴다.
5. 실제 응답 모델과 사용자가 선택한 모델이 다르면 관측 가능한 메타데이터로 기록한다.

## 2. 목표 라우팅

```text
결정론적 fast-path (YouTube URL, 신규 알약 이미지 등)
  ├─ Gemini 선택 → Gemini 2.5 Flash Lite router
  └─ GPT 선택    → GPT-5.6 Luna router (reasoning none, store false)

분류 결과
  ├─ 일반 텍스트/URL 본문/검색/이미지 → 선택 모델
  ├─ YouTube 자막 텍스트              → 선택 모델
  ├─ YouTube 원본 영상                → Gemini 2.5 capability fallback
  ├─ 업로드 영상/오디오               → Gemini 2.5 capability fallback
  └─ 로컬 도구 intent                 → 선택 공급자 function calling
```

GPT router는 strict structured output으로 아래 최소 계약만 반환한다.

```json
{
  "intent": "general",
  "needs_search": true,
  "follow_up": "unrelated"
}
```

## 3. 현재 충돌 지점

### P0 — Gemini 소진 후 GPT 전환 차단

- [x] `/api/chat`의 무조건적인 `API_KEYS.length === 0` 게이트 제거
- [x] generator 시작부의 Gemini 키 선취득 제거
- [x] Gemini 키는 Gemini 생성·drug_id·영상/오디오 capability fallback 진입 직전에만 획득
- [x] GPT 분기가 Gemini 키 취득보다 먼저 실행되는 회귀 계약 추가

### P0 — 초기 router 공급자 종속

- [ ] `state.model` 기준으로 router 공급자 선택
- [ ] GPT 선택 시 GPT-5.6 Luna + `reasoning.effort=none` + `store=false`
- [ ] strict JSON schema 및 100~200 output token 예산 적용
- [ ] GPT router의 영구 quota 오류는 Gemini router로 전환하지 않음
- [ ] 일시 router 오류는 로컬 `classifyIntentByRules`로 복구

### P1 — 로컬 도구 intent

- [x] 약품·약국·병원·동물병원·법령·영화·스포츠·날씨 8종 strict 스키마를 서버 레지스트리로 분리
- [x] OpenAI Responses API function calling 연결(`strict:true`, exact `tool_choice`, 병렬 호출 OFF)
- [x] 카드형 6종은 결과 fast-pass, 약품·스포츠는 선택 GPT가 도구 결과를 최종 종합
- [x] GPT 약품은 로컬 MFDS 조회 뒤 OpenAI `web_search`로 공식 근거를 보강하고, 법령은 GPT가 만든 인자를 로컬 API가 사용

### P1 — 모델 전환 UI와 요청 스냅샷

- [ ] 응답 생성 중 모델 선택을 잠그거나 `다음 메시지부터 적용` 표시
- [ ] 요청 시작 시 선택 모델을 로컬 변수로 고정하고 자동 재시도에서도 같은 모델 유지
- [ ] 메시지에 `selectedModel`, `resolvedModel`, `fallbackReason` 메타데이터 저장 검토
- [ ] 세션을 바꿔도 전역 선호 모델을 유지할지, 세션별 모델을 저장할지 제품 정책 확정

## 4. 오류 분류 계약

| 종류 | 재시도 | 다른 공급자 자동 전환 | UI |
|---|---:|---:|---|
| RPM/TPM 429 | 제한적 backoff | 안 함 | 잠시 후 재시도 |
| credit/spend/usage quota | 안 함 | 안 함 | GPT 할당량 소진 |
| 401/403 | 안 함 | 안 함 | 인증/관리자 문의 |
| 503/504/timeout | 1회 제한 검토 | 안 함 | 일시 불안정 |
| unsupported video/audio | 해당 없음 | Gemini 2.5 허용 | 정상 응답 |

사용자 UI에는 status/code/type/raw message를 절대 넣지 않는다. 서버 로그에는 prompt·API key·Authorization
헤더를 제외하고 다음만 남긴다.

```text
provider, selectedModel, resolvedModel, status, code, type, elapsedMs, fallbackReason
```

## 5. 검증 시나리오

- [x] Gemini 정상 + GPT 정상: 기존 전체 회귀 + GPT 모델별 일반 멀티턴
- [ ] Gemini 키 없음 + GPT 정상: GPT 일반 텍스트 성공
- [ ] Gemini 전 키 cooldown + GPT 정상: GPT 일반 텍스트 성공
- [ ] OpenAI 영구 quota + Gemini 정상: GPT 안내만 표시, 자동 Gemini 답변 없음
- [ ] GPT 선택 + YouTube 원본: Gemini 2.5 fallback 및 이유 로그
- [ ] GPT 선택 + YouTube 자막: GPT 유지
- [ ] GPT 선택 + 업로드 이미지: GPT 유지
- [ ] GPT 선택 + 업로드 영상/오디오: Gemini 2.5 fallback
- [ ] 응답 중 모델 선택 시 현재 응답과 다음 요청의 모델이 섞이지 않음
- [x] 모든 오류에서 UI에 내부 code/message 미노출

## 7. 2026-08-23 구현 결과

- `tests/test-chat-models.mts`: **66/66** — strict schema, forced function, fast-pass, reasoning/function output 보존, citation 보존
- `npm test`: 회귀 하니스 10종 전체 통과
- `npm run typecheck`: 통과
- `npm run test:openai-live`: GPT-5.4 mini **2.731s**, GPT-5.6 Luna **2.598s**, 각 모델의 멀티턴+실 function call 통과
- OpenAI 응답은 generator에서 직접 중복 전송하지 않고 route 종료 이벤트 한 곳에서 전송·저장한다.
- Gemini의 가짜 숫자 인용 제거 정규식과 OpenAI의 실제 `[N](url)` 인용을 공급자 메타데이터로 분리했다.

남은 최우선은 initial router의 공급자 분리와 dev UI에서 8개 intent 카드/종합 응답을 실제로 확인하는 것이다.

## 6. 완료 기준

- Gemini 키 상태가 GPT 일반 요청의 가용성에 영향을 주지 않는다.
- 영구 quota와 일시 rate limit이 테스트로 분리된다.
- capability fallback 외에는 공급자 자동 변경이 없다.
- 로그만으로 선택 모델과 실제 모델을 구분할 수 있다.
- 모바일/데스크톱 모델 전환 UX가 동일하다.
