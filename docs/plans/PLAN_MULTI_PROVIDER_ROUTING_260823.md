# PLAN: Gemini/OpenAI 멀티 공급자 라우팅 안정화

> 작성: 2026-08-23  
> 상태: 모델 선택·OpenAI 일반 생성은 연결됨. 공급자 독립 라우터와 OpenAI 로컬 도구 호출은 미구현.

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

- [ ] `/api/chat`의 무조건적인 `API_KEYS.length === 0` 게이트를 선택 공급자·필요 modality 기준으로 변경
- [ ] generator 시작부의 Gemini 키 선취득 제거
- [ ] Gemini 키는 Gemini 생성, 로컬 Gemini 도구, 영상/오디오 fallback 직전에만 획득
- [ ] Gemini 키가 모두 cooldown이어도 GPT 일반 텍스트/이미지 요청이 성공하는 회귀 테스트 추가

### P0 — 초기 router 공급자 종속

- [ ] `state.model` 기준으로 router 공급자 선택
- [ ] GPT 선택 시 GPT-5.6 Luna + `reasoning.effort=none` + `store=false`
- [ ] strict JSON schema 및 100~200 output token 예산 적용
- [ ] GPT router의 영구 quota 오류는 Gemini router로 전환하지 않음
- [ ] 일시 router 오류는 로컬 `classifyIntentByRules`로 복구

### P1 — 로컬 도구 intent

- [ ] 약품·약국·병원·동물병원·법령·영화·스포츠·날씨 도구 스키마를 공급자 중립 형태로 분리
- [ ] OpenAI Responses API function calling 연결
- [ ] 도구 실행 결과를 선택한 GPT가 최종 설명하도록 연결
- [ ] 구현 전까지는 Gemini 2.5 사용 사실을 로그의 `selectedModel`/`resolvedModel`로 구분

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

- [ ] Gemini 정상 + GPT 정상: 모델별 일반 텍스트 1회
- [ ] Gemini 키 없음 + GPT 정상: GPT 일반 텍스트 성공
- [ ] Gemini 전 키 cooldown + GPT 정상: GPT 일반 텍스트 성공
- [ ] OpenAI 영구 quota + Gemini 정상: GPT 안내만 표시, 자동 Gemini 답변 없음
- [ ] GPT 선택 + YouTube 원본: Gemini 2.5 fallback 및 이유 로그
- [ ] GPT 선택 + YouTube 자막: GPT 유지
- [ ] GPT 선택 + 업로드 이미지: GPT 유지
- [ ] GPT 선택 + 업로드 영상/오디오: Gemini 2.5 fallback
- [ ] 응답 중 모델 선택 시 현재 응답과 다음 요청의 모델이 섞이지 않음
- [ ] 모든 오류에서 UI에 내부 code/message 미노출

## 6. 완료 기준

- Gemini 키 상태가 GPT 일반 요청의 가용성에 영향을 주지 않는다.
- 영구 quota와 일시 rate limit이 테스트로 분리된다.
- capability fallback 외에는 공급자 자동 변경이 없다.
- 로그만으로 선택 모델과 실제 모델을 구분할 수 있다.
- 모바일/데스크톱 모델 전환 UX가 동일하다.
