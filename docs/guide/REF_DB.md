# DB Schema — 현재 구조

> 작성일: 2026-05-25 · 최종 수정: 2026-08-23
>
> 실제 DDL과 실행 순서의 유일한 출처: [db/README.md](db/README.md)

---

## 연결 정보

| 항목 | 값 |
|---|---|
| 플랫폼 | Supabase (PostgreSQL) |
| 인증 | Supabase Auth 익명 세션 → Google identity linking |
| 사용자 라우트 | Bearer access token + anon key로 user-scoped client 생성 |
| 인가 | `profiles`, `chat_sessions`, `chat_messages`, Storage에 RLS 적용 |
| 서버 전용 | 공유 `url_cache`, `mfds_pills`와 `drug-cache/` Storage 쓰기에 `service_role` 사용 |

`app/api/sessions`, `app/api/chat`, `app/api/create-signed-url`, `app/api/parse-document`는 요청의
Bearer 토큰으로 `createRouteClient()`를 만들며 DB/Storage가 JWT와 소유권을 검증한다. API가 요청
body의 `user_id`를 신뢰하지 않는다. 2026-08-17 이전의 nickname 인증과 service-role 전면 사용은
아래 레거시 설명이 아니라 [인증 계획](../plans/PLAN_AUTH_MVP_260709.md)과 개발 이력에서만 참조한다.

---

## 테이블

### `profiles`

`auth.users`와 1:1인 표시 정보와 게스트 사용량. 로그인 식별과 provider identity는 Supabase Auth가 담당한다.

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | `uuid` | PK, FK → `auth.users.id` | 사용자 고유 ID |
| `display_name` | `text` | NOT NULL | 표시 이름. 익명 사용자는 자동 생성, identity 연결 시 조건부 동기화 |
| `avatar_url` | `text` | nullable | 프로필 이미지 Supabase Storage URL |
| `is_guest` | `boolean` | DEFAULT true | 익명/정식 계정 상태 |
| `message_count` | `integer` | DEFAULT 0 | 삭제로 줄지 않는 게스트 메시지 제한 카운터 |
| `created_at` | `timestamptz` | DEFAULT now() | |
| `updated_at` | `timestamptz` | DEFAULT now() | |

**생성/동기화:** `auth.users` INSERT와 `auth.identities` INSERT 트리거

**RLS:** 본인 행만 SELECT, `display_name`/`avatar_url`만 UPDATE 가능. `is_guest`와 `message_count`는 클라이언트가 변경할 수 없다.

---

### `chat_sessions`

채팅 세션 (대화 묶음).

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | `uuid` | PK, DEFAULT gen_random_uuid() | 세션 고유 ID |
| `user_id` | `uuid` | DEFAULT auth.uid(), FK → auth.users.id | 세션 소유자. API 요청값으로 받지 않음 |
| `title` | `text` | DEFAULT 'New Chat' | 세션 제목 (AI 자동 생성) |
| `created_at` | `timestamptz` | DEFAULT now() | |
| `updated_at` | `timestamptz` | | 마지막 메시지 시각. 사이드바 정렬 기준 |

**API 접근:** `app/api/sessions/route.ts`, `app/api/chat/route.ts`  
**조작:** GET(offset/limit 페이지네이션), POST, DELETE, PATCH

**RLS:** `auth.uid() = user_id`. 타 사용자 세션은 조회·수정·삭제되지 않는다.

---

### `chat_messages`

개별 메시지. user/assistant 턴 모두 저장.

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | `uuid` | PK, DEFAULT gen_random_uuid() | 메시지 고유 ID |
| `session_id` | `uuid` | FK → chat_sessions.id | 소속 세션 |
| `role` | `text` | NOT NULL | `'user'` \| `'assistant'` |
| `content` | `text` | NOT NULL | 메시지 본문. 마크다운 포함 |
| `attachment_url` | `text` | nullable | 첨부파일 첫 번째 항목의 Storage URL |
| `grounding_sources` | `jsonb` | nullable | Gemini/OpenAI 웹 출처 칩. `[{title, uri}]` 배열 |
| `created_at` | `timestamptz` | DEFAULT now() | 메시지 시각. 조회 정렬 기준 |

**API 접근:** `app/api/sessions/route.ts`(조회), `app/api/chat/route.ts`(삽입)  
**조작:** GET(session_id로 목록, created_at ASC), INSERT(user 메시지, assistant 메시지)

**현재 미저장 항목 (로컬 only):**
- `Message.attachments[]` 전체 — DB에는 `attachment_url` 1개만 저장. 첨부 상세(mimeType, extractedText 등)는 localStorage
- `Message.isCutOff` — 클라이언트 메모리만
- `ChatSession.lastActiveDoc` — 세션 문서 컨텍스트, 현재 localStorage. 영구 저장은 백로그

---

### `url_cache`

URL 프리페치 결과 캐시. direct 성공을 재사용하고 ScrapingBee/browserless 유닛을 절약한다.

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `url_key` | `text` | PK | 정규화된 URL (fragment 제거) |
| `content` | `text` | NOT NULL | 추출된 본문 |
| `status` | `text` | NOT NULL, DEFAULT `'ok'` | `'ok'` (성공 응답만 저장) |
| `provider` | `text` | nullable | 현재 신규 값: `'direct'` \| `'scrapingbee'` \| `'scrapingbee-static'` \| `'browserless'` \| `'openai-web-search'`(flag ON); 과거 행에는 제거된 provider 값이 남을 수 있음 |
| `fetched_at` | `timestamptz` | NOT NULL, DEFAULT now() | 캐시 기록 시각 |

**TTL:** 14일 (애플리케이션 레벨 판정 — `fetch-url/route.ts`에서 `fetched_at < now() - 14 days` 체크).  
오래된 행 수동 정리:
```sql
delete from public.url_cache where fetched_at < now() - interval '30 days';
```

**DDL:** → `docs/guide/db/url-cache.sql` (멱등)

> 🔴 **2026-08-17: DDL 을 레포로 되돌렸다.** 원본 `supabase/migrations/url_cache.sql` 은
> 2026-06-26 에 "이 문서로 대체"하며 삭제됐는데, 그 뒤 인증 MVP 가 **빈 Supabase 프로젝트**를
> 새로 세우면서 **이 테이블이 따라오지 못했다**(`auth-mvp-schema.sql` 은 3개 테이블만 만든다).
> dev 에서 캐시가 약 한 달 반 죽어 있었고 `fetch-url` 이 실패를 삼켜 **아무도 몰랐다.**
> **스키마의 출처가 문서뿐이면 새 환경에서 재현되지 않는다.**

**RLS:** 켜져 있고 **정책이 없다 — 의도된 것이다.** 공유 캐시라 `auth.uid()` 로 나눌 수 없고,
anon 에 INSERT 를 열면 임의 `url_key` 에 본문을 심어 모델에 주입하는 **간접 프롬프트 인젝션**이 된다.
`service_role` 만 통과하므로 **이 라우트는 `SUPABASE_SERVICE_ROLE_KEY` 가 필요하다.**

**API 접근:** `app/api/fetch-url/route.ts` — 캐시 조회(SELECT) 및 성공 결과 upsert(INSERT ON CONFLICT)

---

### `mfds_pills`

식약처 낱알 식별 정보의 로컬 사본. **이미지 약품 식별의 1순위 경로**다
(2순위는 pharm.or.kr 스크래핑 — `server/agent/tools.ts` `identifyPillTool`).

> 🔴 **2026-08-17 신설 문서.** 이 테이블은 여태 이 문서에 **항목 자체가 없었고**, DDL 은
> `docs/guide/db/sync-mfds-pills.mjs` **상단 주석 안에만** 있었는데 그 파일은 `.gitignore` 의
> `scripts/sync-*` 에 걸려 **레포에 없었다** — 즉 **스키마의 출처가 어디에도 없었다.**
> 실측: main(PoC-prd)에는 있고 **dev(poc-test)에는 없다.**

**DDL:** → `docs/guide/db/mfds-pills.sql` (멱등) · **적재:** `node docs/guide/db/sync-mfds-pills.mjs`

**행 수 (2026-08-17):** dev **25,345** / main **재적재 필요**(아래 참조)

> 🔴 **적재 스크립트에 버그가 있었다.** `flush()` 가 500건 배치로 upsert 하는데 **배치 안에
> 같은 `item_seq` 가 있으면 Postgres 가 그 문장 전체를 거부**한다
> (`ON CONFLICT DO UPDATE command cannot affect row a second time`) — **중복 1건 때문에
> 정상 499건이 같이 날아갔다.** 배치 6개가 거부돼 **약품 3,000건이 빠져 있었고**, 재실행마다
> 배치 경계가 달라져 **어느 약이 빠지는지가 매번 바뀌었다**(22,359↔22,362).
> 수정 후 25,362(API) = **25,345**(고유) + 11(배치내중복) + 6(배치간중복) 으로 딱 맞는다.
> ⚠️ **main 은 수정 전 스크립트로 적재했으므로 같은 구멍이 있다** — 컷오버 때 재적재할 것.
> (`.env.local` 을 프로덕션으로 바꾸는 순간이 위험 지점이다.)

| 컬럼 | 설명 |
|---|---|
| `item_seq` | PK — 품목일련번호 |
| `item_name` · `entp_name` | 품목명 · 업체명 |
| `mark_codes` `text[]` | 🔴 정규화된 각인 변형 배열. **GIN 인덱스가 각인 검색의 핵심**이다 |
| `drug_shape` · `color_class1` · `color_class2` | 모양 · 색상앞/뒤 |
| `form_code_name` · `class_name` · `etc_otc_name` | 제형 · 분류 · 전문/일반 |
| `item_image` · `mark_code_*_img` | 이미지 URL |
| `leng_long` · `leng_short` · `thick` | 크기(mm) |
| `synced_at` | 마지막 동기화 시각 |

**RLS:** `url_cache` 와 같다 — 켜고 정책 없음(`service_role` 전용). 공개 데이터라 기밀은 아니지만
**쓰기를 열면 약품 정보를 조작할 수 있고**, 이 앱에서 가장 해로운 실패가 그것이다.

🔴 **실패가 조용하다.** `server/mfds-logic.ts` 가 `const { data } = …` 로 **`error` 를 버려서**,
테이블이 없어도 예외 없이 `match_type: 'none'` 을 반환하고 스크래핑 폴백으로 내려간다.
그마저 실패하면 *"시각적 유사성을 기반으로 답변하되…"* 경로다.

**API 접근:** `server/mfds-logic.ts` `searchMfdsPills` — 3단계(각인+색+모양 → 각인만 → 색+모양)

---

## Storage 버킷

허용 버킷 화이트리스트: `ALLOWED_BUCKETS = ['chat-imgs', 'chat-videos', 'chat-docs']`  
(`app/api/create-signed-url/route.ts` 에 하드코딩)

> 🔴 **경로 규약이 바뀌었다 (2026-08-17)** — 이제 `${auth.uid()}/{timestamp}_{safe-name}` 이다.
> 아래 표의 평면 경로(`{timestamp}_...`)는 **레거시**로, 그대로 남겨두되 새로 만들지 않는다.
> Storage RLS 가 첫 폴더 세그먼트를 `auth.uid()` 와 대조한다(`docs/guide/db/storage-user-prefix-rls.sql`).

---

### `chat-imgs`

**용도:** 사용자 업로드 이미지 + 약품 이미지 캐시

| 업로더 | 파일 경로 패턴 | 비고 |
|---|---|---|
| `app/api/create-signed-url/route.ts` (클라이언트 PUT) | `{uid}/{timestamp}_{safe-name}` | `.` 허용, 소문자화 |
| ~~`app/api/upload/route.ts`~~ | ~~`{timestamp}_{safe-name}.{ext}`~~ | **삭제됨(2026-08-17)** — 아래 "업로드 경로 비교" 참조 |
| `app/api/sync-drug-image/route.ts` (약품 이미지 캐시) | `drug-cache/{urlHash}.jpg` | URL SHA256 해시 기반. 중복 요청 in-flight dedup |

**접근:** `app/api/proxy-image/route.ts`가 이 버킷의 이미지를 외부 URL 대신 프록시로 제공

---

### `chat-videos`

**용도:** 사용자 업로드 동영상

| 업로더 | 파일 경로 패턴 |
|---|---|
| `app/api/create-signed-url/route.ts` | `{uid}/{timestamp}_{safe-name}` |

---

### `chat-docs`

**용도:** 사용자 업로드 문서 (PDF, DOCX 등)

| 업로더 | 파일 경로 패턴 | 비고 |
|---|---|---|
| `app/api/create-signed-url/route.ts` | `{uid}/{timestamp}_{safe-name}` | RLS가 첫 경로 세그먼트를 `auth.uid()`와 대조 |

**자동 라우팅:** `useChatStream.ts`에서 1MB 이상 문서는 인라인 base64 대신 이 버킷에 업로드 후 URL만 전달 → Vercel 4.5MB payload 초과 방지

---

### 업로드 경로 비교

| 경로 | API | 방식 | 본문 한도 |
|---|---|---|---|
| **클라이언트 직접** (현행) | `app/api/create-signed-url/route.ts` → 클라이언트 PUT | Signed URL 발급 → 브라우저가 Storage 직접 PUT | 없음 (브라우저 제한) |
| ~~서버 경유~~ | ~~`app/api/upload/route.ts`~~ | ~~base64 수신 → Buffer → Storage PUT~~ | **삭제됨** |

**업로드는 서명 URL 하나만 쓴다.** 파일이 Vercel 함수를 **거치지 않는 것**이 핵심이다 —
서버 경유는 ⓐ 본문 4.5MB 한도(base64 는 원본보다 33% 커져 실질 ~3.4MB) ⓑ 전송이 함수 실행
시간을 잡아먹어 타임아웃 ⓒ 파일 전체가 함수 메모리에 올라감, 셋 다 걸렸다.

> 🔴 **`/api/upload` 는 2026-08-17 에 삭제했다.** 2026-03-09(`40ff02e` "Implement signed URL
> uploads")에 호출부가 사라졌는데 라우트만 남았고, 2026-05-26 Next.js 이관 때 **쓰는지 확인 없이
> 12개 엔드포인트와 함께 옮겨졌다.** 그 뒤 5개월간 죽은 코드였고 **무인증으로 열려 있었다**
> (누구나 공개 버킷에 파일을 쌓을 수 있었다). 이관 시 사용처를 확인하지 않은 것이 뿌리다.

---

## 로컬스토리지 전용 (DB 미저장)

| 키 | 내용 | 위치 |
|---|---|---|
| `preferred_model` | 선택된 AI 모델 (기본 `gemini-3.6-flash`) | `App.tsx` |
| `gemini_language` | UI 언어 (ko/en/es/fr) | `App.tsx` |
| `theme` | 다크/라이트 테마 | `components/Header.tsx` |
| `chat_sessions_cache_v1` | owner id와 세션 메타데이터 캐시 | `src/hooks/useChatSessions.ts` |

---

## 현재 구조의 제약 및 문제점

| 구분 | 내용 |
|---|---|
| **공개 Storage 읽기** | 버킷은 아직 public. RLS가 쓰기·열거는 막지만 URL을 아는 제3자의 읽기는 막지 못함(Phase 2 대기) |
| **attachment 단일 저장** | 첫 번째 첨부만 `attachment_url`에 저장. 멀티 첨부 히스토리 복원 불가 |
| **모델 메타데이터 미저장** | `selectedModel`, `resolvedModel`, capability fallback 이유가 메시지 행에 저장되지 않음 |
| **레거시 공개 URL** | 비공개 버킷 전환 전에 기존 `attachment_url` 백필과 서명 다운로드 경로가 필요 |

---

## 후속 마이그레이션

### 단기 검토

- **`chat_messages.attachment_url` → `attachments` JSONB 배열**  
  현재 첫 번째 첨부만 저장 → `[{url, mimeType, fileName}]` 배열로 확장  
  → 멀티 첨부 히스토리 복원 가능

- **메시지 모델 메타데이터**

  `selected_model`, `resolved_model`, `fallback_reason` 저장 여부 결정. 응답 중 모델 전환 관측과 세션 복원에 필요.

- **Storage Phase 2**

  세 버킷 비공개 전환, 기존 공개 `attachment_url` 백필, 표시 시 signed download URL 발급.

### 장기 후보 (Agentic 업그레이드 연계)

- **`session_summaries`** — 세션 종료 시 AI 요약 저장 (TODO C1)
- **`user_memories`** — 유저가 명시한 선호·사실 저장 (TODO C2)
