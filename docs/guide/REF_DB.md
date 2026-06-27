# DB Schema — 현재 구조 스냅샷

> 작성일: 2026-05-25  
> 목적: DB 테이블 변경 전 현재 구조 기록. 마이그레이션 계획은 하단 섹션 참조.

---

## 연결 정보

| 항목 | 값 |
|---|---|
| 플랫폼 | Supabase (PostgreSQL) |
| 클라이언트 키 | `service_role` JWT — **RLS 전면 비활성화 상태** |
| 인증 방식 | 커스텀 `users` 테이블 (nickname 기반) — Supabase Auth 미사용 |

> `SUPABASE_KEY`가 `service_role`이므로 현재 모든 테이블에 RLS가 적용되지 않는다.  
> IDOR 취약점(IDOR-1, IDOR-2)의 근본 원인. Supabase Auth 마이그레이션 이후 일괄 해소 예정.

---

## 테이블

### `users`

사용자 계정. nickname 기반 로그인, Supabase Auth 미사용.

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | `bigint` | PK, auto-increment | 사용자 고유 ID (프론트에서 `number`로 취급) |
| `nickname` | `text` | UNIQUE, NOT NULL | 로그인 식별자. 한 번 설정 후 변경 불가 |
| `display_name` | `text` | | 표시 이름. 초기값 = nickname |
| `avatar_url` | `text` | nullable | 프로필 이미지 Supabase Storage URL |
| `created_at` | `timestamptz` | DEFAULT now() | |

**API 접근:** `app/api/auth/route.ts`  
**조작:** POST(login/signup), PATCH(display_name, avatar_url)  
**보안 이슈:** PATCH에 소유권 검증 없음 → 누구든 임의 id로 타 사용자 수정 가능 (IDOR-1)

---

### `chat_sessions`

채팅 세션 (대화 묶음).

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | `uuid` | PK, DEFAULT gen_random_uuid() | 세션 고유 ID |
| `user_id` | `bigint` | FK → users.id | 세션 소유자 |
| `title` | `text` | DEFAULT 'New Chat' | 세션 제목 (AI 자동 생성) |
| `created_at` | `timestamptz` | DEFAULT now() | |
| `updated_at` | `timestamptz` | | 마지막 메시지 시각. 사이드바 정렬 기준 |

**API 접근:** `app/api/sessions/route.ts`, `app/api/chat/route.ts`  
**조작:** GET(user_id로 목록, offset/limit 페이지네이션), POST(생성), DELETE(삭제), PATCH(title 변경)  
**보안 이슈:** 세션 ID만 알면 타 사용자 세션 전체 열람·수정·삭제 가능 (IDOR-2)

---

### `chat_messages`

개별 메시지. user/assistant 턴 모두 저장.

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | `uuid` or `bigint` | PK | 메시지 고유 ID |
| `session_id` | `uuid` | FK → chat_sessions.id | 소속 세션 |
| `role` | `text` | NOT NULL | `'user'` \| `'assistant'` |
| `content` | `text` | NOT NULL | 메시지 본문. 마크다운 포함 |
| `attachment_url` | `text` | nullable | 첨부파일 첫 번째 항목의 Storage URL |
| `grounding_sources` | `jsonb` | nullable | Google Search 출처 칩. `[{title, uri}]` 배열 |
| `created_at` | `timestamptz` | DEFAULT now() | 메시지 시각. 조회 정렬 기준 |

**API 접근:** `app/api/sessions/route.ts`(조회), `app/api/chat/route.ts`(삽입)  
**조작:** GET(session_id로 목록, created_at ASC), INSERT(user 메시지, assistant 메시지)

**현재 미저장 항목 (로컬 only):**
- `Message.attachments[]` 전체 — DB에는 `attachment_url` 1개만 저장. 첨부 상세(mimeType, extractedText 등)는 localStorage
- `Message.isCutOff` — 클라이언트 메모리만
- `ChatSession.lastActiveDoc` — 세션 문서 컨텍스트, 현재 localStorage. 영구 저장은 백로그

---

### `url_cache`

URL 프리페치 결과 캐시. browserless/ScrapingBee/ScraperAPI 유닛 절약 목적.

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `url_key` | `text` | PK | 정규화된 URL (fragment 제거) |
| `content` | `text` | NOT NULL | 추출된 본문 |
| `status` | `text` | NOT NULL, DEFAULT `'ok'` | `'ok'` (성공 응답만 저장) |
| `provider` | `text` | nullable | `'direct'` \| `'scrapingbee'` \| `'scrapingbee-static'` \| `'browserless'` \| `'scraperapi'` |
| `fetched_at` | `timestamptz` | NOT NULL, DEFAULT now() | 캐시 기록 시각 |

**TTL:** 14일 (애플리케이션 레벨 판정 — `fetch-url/route.ts`에서 `fetched_at < now() - 14 days` 체크).  
오래된 행 수동 정리:
```sql
delete from public.url_cache where fetched_at < now() - interval '30 days';
```

**DDL:**
```sql
create table if not exists public.url_cache (
  url_key    text primary key,
  content    text not null,
  status     text not null default 'ok',
  provider   text,
  fetched_at timestamptz not null default now()
);
```

**API 접근:** `app/api/fetch-url/route.ts` — 캐시 조회(SELECT) 및 성공 결과 upsert(INSERT ON CONFLICT)

---

## Storage 버킷

허용 버킷 화이트리스트: `ALLOWED_BUCKETS = ['chat-imgs', 'chat-videos', 'chat-docs']`  
(`app/api/upload/route.ts`, `app/api/create-signed-url/route.ts` 양쪽에 하드코딩)

---

### `chat-imgs`

**용도:** 사용자 업로드 이미지 + 약품 이미지 캐시

| 업로더 | 파일 경로 패턴 | 비고 |
|---|---|---|
| `app/api/upload/route.ts` (서버 base64) | `{timestamp}_{safe-name}.{ext}` | 특수문자 → `-` 치환, 소문자화 |
| `app/api/create-signed-url/route.ts` (클라이언트 PUT) | `{timestamp}_{safe-name}` | `.` 허용, 소문자화 |
| `app/api/sync-drug-image/route.ts` (약품 이미지 캐시) | `drug-cache/{urlHash}.jpg` | URL SHA256 해시 기반. 중복 요청 in-flight dedup |

**접근:** `app/api/proxy-image/route.ts`가 이 버킷의 이미지를 외부 URL 대신 프록시로 제공

---

### `chat-videos`

**용도:** 사용자 업로드 동영상

| 업로더 | 파일 경로 패턴 |
|---|---|
| `app/api/upload/route.ts` | `{timestamp}_{safe-name}.{ext}` |
| `app/api/create-signed-url/route.ts` | `{timestamp}_{safe-name}` |

---

### `chat-docs`

**용도:** 사용자 업로드 문서 (PDF, DOCX 등)

| 업로더 | 파일 경로 패턴 | 비고 |
|---|---|---|
| `app/api/upload/route.ts` | `{timestamp}_{safe-name}.{ext}` | |
| `app/api/create-signed-url/route.ts` | `{timestamp}_{safe-name}` | |

**자동 라우팅:** `useChatStream.ts`에서 1MB 이상 문서는 인라인 base64 대신 이 버킷에 업로드 후 URL만 전달 → Vercel 4.5MB payload 초과 방지

---

### 업로드 경로 비교

| 경로 | API | 방식 | 본문 한도 |
|---|---|---|---|
| 서버 경유 | `app/api/upload/route.ts` | 서버가 base64 수신 → Buffer 변환 → Storage PUT | Vercel 함수 본문 4.5MB (App Router라 `bodyParser` 설정 없음; `runtime=nodejs`, `maxDuration=60`) |
| 클라이언트 직접 | `app/api/create-signed-url/route.ts` → 클라이언트 PUT | Signed URL 발급 → 브라우저가 Storage 직접 PUT | 없음 (브라우저 제한) |

현재 이미지는 클라이언트 직접 경로(`create-signed-url`), 문서 1MB+ 도 동일. `api/upload.ts`는 서버사이드 처리가 필요한 케이스용 레거시 경로이며, Vercel 4.5MB 본문 캡 때문에 대용량은 클라이언트 직접 경로로 흐른다.

---

## 로컬스토리지 전용 (DB 미저장)

| 키 | 내용 | 위치 |
|---|---|---|
| `preferred_model` | 선택된 AI 모델 (기본 `gemini-3.5-flash`) | `App.tsx` |
| `language` | UI 언어 (ko/en/es/fr) | `App.tsx` |
| `chat_user` | 로그인 사용자 정보 캐시 | `useAuthSession.ts` |
| `chat_sessions_cache` | 세션 목록 로컬 캐시 | `useChatSessions.ts` |

---

## 현재 구조의 제약 및 문제점

| 구분 | 내용 |
|---|---|
| **RLS 비활성** | service_role 키 사용으로 전 테이블 RLS 우회. 인증 없이 타 사용자 데이터 접근 가능 |
| **IDOR-1** | `api/auth.ts` PATCH — 소유권 검증 없음 |
| **IDOR-2** | `api/sessions.ts` GET/DELETE/PATCH — 세션 소유자 확인 없음 |
| **attachment 단일 저장** | 첫 번째 첨부만 `attachment_url`에 저장. 멀티 첨부 히스토리 복원 불가 |
| **nickname 기반 인증** | UUID/이메일이 아닌 평문 nickname으로 사용자 식별. 충돌 위험, Auth 연동 불가 |

---

## 마이그레이션 계획 (예정)

> 아직 구체적 일정 미확정. 변경 전 이 문서 업데이트 필요.

### 단기 검토

- **`chat_messages.attachment_url` → `attachments` JSONB 배열**  
  현재 첫 번째 첨부만 저장 → `[{url, mimeType, fileName}]` 배열로 확장  
  → 멀티 첨부 히스토리 복원 가능

- **`chat_sessions.model` 컬럼 추가**  
  세션별 사용 모델 기록 (TODO: M6 세션별 모델 기억)

### 중기 검토 (Supabase Auth 전환 전제)

- **`users` 테이블 → Supabase Auth 연동**  
  - `auth.users.id` (UUID) 기반으로 전환  
  - 기존 `users.nickname` 기반 레코드 마이그레이션 필요  
  - RLS 정책 활성화 → IDOR-1/2 자동 해소

- **`chat_sessions.user_id`** `bigint` → `uuid` (auth.users.id 참조)

### 장기 후보 (Agentic 업그레이드 연계)

- **`session_summaries`** — 세션 종료 시 AI 요약 저장 (TODO C1)
- **`user_memories`** — 유저가 명시한 선호·사실 저장 (TODO C2)
