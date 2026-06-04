# 이미지 생성 기능 서비스 통합 구현 명세 — 2026-06-03

> 선행 문서: [PLAN_OPENAI_IMAGE2_INFOGRAPHIC_TEST_260602.md](PLAN_OPENAI_IMAGE2_INFOGRAPHIC_TEST_260602.md) (테스트·정책·라우팅 설계)
> 이 문서: 위 정책을 **chat-agent 코드베이스에 실제로 통합하는 방법**
> 대상 모델: `gpt-image-2-2026-04-21` (fallback 체인 유지)
> 구조화 모델: `gemini-2.5-flash-lite`

---

## 0. 결정 사항 (확정)

| 항목 | 결정 | 비고 |
|---|---|---|
| 목표 범위 | **운영형 풀세트** | 원장/쿼터/계측/차감/전체 layout 라우팅 포함 |
| 실행 모델 | **A: 동기 스트리밍 + Supabase 원장 게이트** | 워커 없이 시작, 스키마는 B 승격 호환 |
| 트리거 | **자동감지 → 확인 칩 → 사용자 클릭 생성** | 비용·latency 큰 작업 자동 실행 방지 |
| tier/크레딧 | `users` 테이블 기반 **논리적 일일 쿼터** | 실결제 시스템 없음, 후속 과제 |
| 기본 품질 | low + 1536×1024 + normal | medium은 명시적 재생성만, high 보류 |

---

## 1. 현 아키텍처와 통합 지점

기존 흐름 (LangGraph):

```
/api/chat (SSE) → router → (vision) → generator → tools → END
```

- `router`는 intent를 타입으로 분류(`server/agent/state.ts`의 `IntentType`).
- 기존 7종 렌더러는 **코드/SVG 기반** 시각화. 이번 기능은 **래스터 이미지 생성**으로 별개 경로.
- SSE 패턴: `app/api/chat/route.ts`의 `ReadableStream` + `sendEvent(data)` + 8초 heartbeat.
- 스토리지: `supabaseAdmin.storage.from(bucket).createSignedUploadUrl()` / `getPublicUrl()`, 버킷 `chat-imgs`/`chat-videos`/`chat-docs`.
- Gemini 키 로테이션: `server/config.ts`의 `getNextApiKey`, `markKeyRateLimited`, `markKeyDailyExhausted`, `isDailyQuotaError`.

통합 결정:

- **`image_gen`은 별도 API 경로**(`/api/image-gen`)로 둔다. LangGraph 본 흐름에 노드로 넣지 않는다. 이유: 생성은 25~60초 단일 작업이고 tool 루프가 불필요하며, 쿼터/원장 게이트를 라우트 레벨에서 통제해야 함.
- `router`는 **감지만** 한다. 감지 시 생성하지 않고 확인 칩 이벤트만 스트리밍한다.

---

## 2. 신규/변경 파일

```
server/image/
  pipeline.ts      # 테스트 스크립트에서 추출·서버화
  routers.ts       # intent/layout/language/guardrail 룰
  schema.ts        # 생성 JSON 스키마 + 검증/자동 축소
  prompt-builder.ts# deterministic prompt 문장화
  jobs.ts          # image_jobs 원장 read/write + 쿼터/동시성 RPC 호출
  cost.ts          # quality별 단가 추정/계측
app/api/image-gen/
  route.ts         # SSE 엔드포인트 (maxDuration 300)
components/
  GeneratedImageRenderer.tsx   # 결과 + 재생성(medium) 버튼
  ImageGenChip.tsx             # router 감지 시 확인 칩
server/agent/nodes/router.ts   # image_gen 의도 감지 추가 (생성 안 함)
server/agent/intentRules.ts    # image_gen rule 트리거 추가
```

추출 매핑 (테스트 스크립트 → 서버 모듈):

| `scripts/openai-image2-pipeline-test.mjs` | → | `server/image/` |
|---|---|---|
| `buildStructuringPrompt` | → | `pipeline.ts` |
| `structureWithGemini` | → | `pipeline.ts` (키 로테이션을 `server/config.ts`로 교체) |
| `buildImagePrompt` | → | `prompt-builder.ts` |
| `generateOpenAIImage` | → | `pipeline.ts` (fallback 체인 유지) |
| `STYLE_CASES`/subtype 정의 | → | `routers.ts` 룰 테이블 |

---

## 3. Supabase 스키마 (Phase 1)

### 3.1 `image_jobs` 테이블 (원장 + 계측)

```sql
create table public.image_jobs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references public.users(id),
  session_id      uuid,
  status          text not null default 'reserved',
    -- reserved | running | succeeded | failed | refunded | canceled
  -- 입력
  source_text     text,
  model           text not null,
  quality         text not null default 'low',
  size            text not null default '1536x1024',
  layout_type     text,
  text_language   text,
  language_reason text,
  term_policy     text,
  canonical_terms text[],
  prompt_hash     text,
  -- 결과/계측
  image_url       text,
  input_prompt_tokens  int,
  output_image_tokens  int,
  total_tokens         int,
  latency_ms      int,
  estimated_cost_usd numeric(10,5),
  credits_charged int default 0,
  error_code      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_image_jobs_user_day on public.image_jobs (user_id, created_at);
create index idx_image_jobs_active on public.image_jobs (status) where status in ('reserved','running');
```

> `status` 머신과 `reserved/running` 인덱스는 **B(워커) 승격 시 큐 드레인 쿼리에 그대로 재사용**된다. 지금은 동기 실행이라 워커가 없을 뿐, 스키마는 큐 호환.

### 3.2 쿼터/동시성 원자적 예약 RPC

레이스 컨디션(동시 요청으로 한도 초과)을 막기 위해 게이트는 **단일 RPC 트랜잭션**에서 처리한다.

```sql
create or replace function public.reserve_image_job(
  p_user_id uuid,
  p_session_id uuid,
  p_source_text text,
  p_model text,
  p_quality text,
  p_size text,
  p_daily_limit int,
  p_concurrency_limit int,
  p_credits int
) returns public.image_jobs
language plpgsql as $$
declare
  v_today_count int;
  v_active_count int;
  v_row public.image_jobs;
begin
  -- 일일 한도
  select count(*) into v_today_count
  from public.image_jobs
  where user_id = p_user_id
    and created_at >= date_trunc('day', now())
    and status in ('reserved','running','succeeded');
  if v_today_count >= p_daily_limit then
    raise exception 'DAILY_LIMIT' using errcode = 'P0001';
  end if;

  -- 사용자당 동시 실행 (burst)
  select count(*) into v_active_count
  from public.image_jobs
  where user_id = p_user_id and status in ('reserved','running');
  if v_active_count >= p_concurrency_limit then
    raise exception 'BUSY' using errcode = 'P0002';
  end if;

  insert into public.image_jobs
    (user_id, session_id, source_text, model, quality, size, status, credits_charged)
  values
    (p_user_id, p_session_id, p_source_text, p_model, p_quality, p_size, 'reserved', p_credits)
  returning * into v_row;

  return v_row;
end;
$$;
```

- 전역 동시성(global concurrency = 2)은 1차에선 **앱 레벨 in-memory 세마포어 + 전역 active count 쿼리**로 근사. 정밀 전역 제어가 필요해지면 B로 승격.
- 차감 모델: 예약 시 `credits_charged` 기록 → OpenAI 호출 전 취소면 `refunded`. 429/5xx 자동 재시도 1회는 무료. 정책 위반/사용자 취소/품질 실패는 환불 안 함 (선행 문서 차감 기준 준수).

### 3.3 스토리지 버킷

- 신규 버킷 `chat-gen-imgs` (public read). `app/api/create-signed-url/route.ts`의 `ALLOWED_BUCKETS`에 추가.
- 경로: `${user_id}/${job_id}.png`.

---

## 4. tier별 쿼터 (Phase 4, `users` 기반 논리 쿼터)

실결제 없음 → `users`에 `tier` 컬럼(`guest|free|premium|admin`) 추가, 한도는 코드 상수.

| tier | daily_limit | concurrency | 기본 품질 | medium |
|---|---:|---:|---|---|
| guest(비로그인) | 0~1 | 1 | low | 불가 |
| free | 3 | 1 | low | 불가 |
| premium | 30 | 1 | low | 선택(크레딧 3~4 차감) |
| admin | 100 | 2 | low/medium | 가능 |

전역: `global concurrency = 2`, `global rate ≈ 4 images/min` 부터 시작.

---

## 5. API 이벤트 계약 (`/api/image-gen` SSE)

```jsonc
// 요청 (POST)
{ "session_id": "...", "user_id": "...", "source_text": "...",
  "quality": "low", "regenerate": false, "language": "ko" }

// 스트리밍 이벤트 (data: {...})
{ "stage": "gate",        "status": "reserved", "job_id": "..." }
{ "stage": "structuring", "status": "running" }
{ "stage": "structured",  "layout_type": "diagram", "image_text_language": "en" }
{ "stage": "generating",  "status": "running", "attempt": 1 }
{ "heartbeat": true }                       // 8초 간격, 기존 패턴 재사용
{ "stage": "done", "image_url": "...", "job_id": "...",
  "usage": { "output_image_tokens": 158, "latency_ms": 31000, "estimated_cost_usd": 0.017 } }
// 에러
{ "error": "DAILY_LIMIT|BUSY|RATE_LIMIT|SAFETY|GENERATION_FAILED", "job_id": "..." }
```

- `maxDuration = 300`, `runtime = 'nodejs'`. low 25~45s / medium 60s+ 를 단일 요청 내 완결.
- 에러 코드는 `app/api/chat/route.ts`의 `CHAT_ERRORS` 다국어 패턴을 차용해 `IMAGE_ERRORS` 추가.

---

## 6. 클라이언트 통합

1. **확인 칩** (`ImageGenChip.tsx`): `/api/chat` 응답에서 `image_gen_suggested` 이벤트를 받으면 "🖼 이미지로 만들기" 칩 렌더. 자동 생성하지 않음.
2. 칩 클릭 → `/api/image-gen` SSE 호출 → 진행 상태(`stage`)를 단계 표시.
3. **`GeneratedImageRenderer.tsx`**: 완료 시 이미지 + "medium으로 재생성"(premium/admin) 버튼. 이미지는 `chat_messages`에 `attachment_url`로 영속(기존 컬럼 재사용).
4. 진행 중 취소 버튼 → 큐/실행 상태면 best-effort 취소 + `reserved`였으면 환불.

---

## 7. 단계별 로드맵

| Phase | 내용 | 완료 기준 |
|---|---|---|
| **P0** | `server/image/` 코어 모듈 추출 + 단위 테스트 (스크립트와 동일 출력 확인) | 기존 테스트 케이스 재현 |
| **P1** | `image_jobs` 테이블 + `reserve_image_job` RPC + `chat-gen-imgs` 버킷 + 계측 필드 | 쿼터 초과/동시성 차단 동작 |
| **P2** | `/api/image-gen` SSE + low 생성 + fallback/재시도 + Supabase 영속 | admin 계정 E2E 1장 생성 |
| **P3** | router `image_gen` 감지 → 확인 칩 + `GeneratedImageRenderer` + 진행 UI | 사용자가 칩 클릭으로 생성 |
| **P4** | tier별 쿼터 + medium 재생성 + 전체 layout/언어 라우팅 코드화 + QA 플래그 | 운영형 완성, free/premium 한도 적용 |

---

## 8. 리스크 / 미결

- **동기 실행 한계**: 연결 끊기면 결과 유실(채팅과 동일). 빈도 높아지면 B(워커+Realtime)로 승격 — 스키마는 이미 호환.
- **전역 동시성 근사**: 1차는 active count 쿼리로 근사, 멀티 인스턴스에서 완벽 보장 X. tier1 rate limit 보호가 우선.
- **medium 단가 추적**: output image token이 low 158 → medium 1372로 급증. `image_jobs.estimated_cost_usd`에 quality별 단가 분리 기록 필수.
- **인체/손 anatomy 리스크**: 기본 prompt에서 사람 손/팔 제외, 필요 시 medium + 별도 QA (선행 문서 준수).
- **Gemini 503**: 구조화 단계 키 로테이션/재시도 — 기존 `server/config.ts` 정책 재사용.

---

## 9. 구현 시작 전 체크

- [ ] `users.tier` 컬럼 추가 마이그레이션
- [ ] `image_jobs` 테이블 + RPC 마이그레이션
- [ ] `chat-gen-imgs` 버킷 생성 + `ALLOWED_BUCKETS` 갱신
- [ ] `OPENAI_API_KEY` Vercel 환경변수 확인 (이미 공통 환경변수에 존재)
- [ ] `maxDuration=300`이 현재 Vercel 플랜에서 허용되는지 확인
```
