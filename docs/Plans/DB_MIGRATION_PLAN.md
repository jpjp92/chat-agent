# DB Migration Plan — 신규 Supabase 프로젝트 이전

> 작성일: 2026-05-25  
> 목적: 기존 Supabase 프로젝트(구 계정)의 테이블·Storage를 신규 프로젝트(신 계정)로 이전

---

## 전체 흐름

```
1. 신규 프로젝트 테이블 생성 (DDL)
2. Storage 버킷 생성
3. 기존 데이터 이전 (구 → 신)
4. 환경변수 교체
5. 동작 검증
```

---

## Step 1 — 테이블 생성 (DDL)

신규 Supabase 프로젝트의 **SQL Editor**에서 아래 순서대로 실행.  
(FK 의존 순서: users → chat_sessions → chat_messages)

### 1-1. `users`

```sql
CREATE TABLE public.users (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nickname     text   NOT NULL UNIQUE,
  display_name text,
  avatar_url   text,
  created_at   timestamptz DEFAULT now() NOT NULL
);
```

### 1-2. `chat_sessions`

```sql
CREATE TABLE public.chat_sessions (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    bigint      NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title      text        DEFAULT 'New Chat',
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- 세션 목록 조회 시 user_id + updated_at 정렬에 사용
CREATE INDEX idx_chat_sessions_user_id ON public.chat_sessions(user_id, updated_at DESC);
```

### 1-3. `chat_messages`

```sql
CREATE TABLE public.chat_messages (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id         uuid        NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  role               text        NOT NULL CHECK (role IN ('user', 'assistant')),
  content            text        NOT NULL DEFAULT '',
  attachment_url     text,
  grounding_sources  jsonb,
  created_at         timestamptz DEFAULT now() NOT NULL
);

-- 메시지 조회 시 session_id + created_at ASC 정렬에 사용
CREATE INDEX idx_chat_messages_session_id ON public.chat_messages(session_id, created_at ASC);
```

> **주의**: 기존 프로젝트의 정확한 컬럼 타입이 위와 다를 수 있음.  
> 이전 전에 구 Supabase 대시보드 → Table Editor 또는 `pg_dump --schema-only`로 실제 DDL 확인 권장.

---

## Step 2 — Storage 버킷 생성

신규 프로젝트 **Storage** 탭 또는 SQL Editor에서 생성.

### SQL로 한 번에 생성

```sql
-- chat-imgs: 이미지 업로드 + 약품 이미지 캐시
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-imgs', 'chat-imgs', true);

-- chat-videos: 동영상 업로드
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-videos', 'chat-videos', true);

-- chat-docs: 문서 업로드 (PDF, DOCX 등)
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-docs', 'chat-docs', true);
```

### 버킷별 파일 경로 패턴 (참고)

| 버킷 | 경로 패턴 | 생성 주체 |
|---|---|---|
| `chat-imgs` | `{timestamp}_{safe-name}.{ext}` | api/upload.ts, api/create-signed-url.ts |
| `chat-imgs` | `drug-cache/{urlHash}.jpg` | api/sync-drug-image.ts |
| `chat-videos` | `{timestamp}_{safe-name}.{ext}` | api/upload.ts, api/create-signed-url.ts |
| `chat-docs` | `{timestamp}_{safe-name}.{ext}` | api/upload.ts, api/create-signed-url.ts |

### Storage Policy (public read)

현재 service_role 키로 RLS 우회 중이므로 최소한 public read 정책 적용.

```sql
-- chat-imgs public read
CREATE POLICY "Public read chat-imgs"
ON storage.objects FOR SELECT
USING (bucket_id = 'chat-imgs');

-- chat-videos public read
CREATE POLICY "Public read chat-videos"
ON storage.objects FOR SELECT
USING (bucket_id = 'chat-videos');

-- chat-docs public read
CREATE POLICY "Public read chat-docs"
ON storage.objects FOR SELECT
USING (bucket_id = 'chat-docs');
```

---

## Step 3 — 기존 데이터 이전

### 방법 A — Supabase 대시보드 CSV 내보내기/가져오기 (소량, 간단)

1. 구 프로젝트: Table Editor → 각 테이블 → Export CSV
2. 신 프로젝트: Table Editor → Import CSV
3. 순서: `users` → `chat_sessions` → `chat_messages` (FK 순서 준수)

### 방법 B — pg_dump / psql (권장, 데이터 많을 때)

```bash
# 구 프로젝트에서 데이터 덤프 (Supabase 대시보드 → Settings → Database → Connection string)
pg_dump \
  "postgresql://postgres:[PASSWORD]@[OLD_HOST]:5432/postgres" \
  --data-only \
  --table=public.users \
  --table=public.chat_sessions \
  --table=public.chat_messages \
  -f data_dump.sql

# 신 프로젝트에 적재
psql \
  "postgresql://postgres:[PASSWORD]@[NEW_HOST]:5432/postgres" \
  -f data_dump.sql
```

> `GENERATED ALWAYS AS IDENTITY` 컬럼은 dump 시 `--column-inserts` 옵션 필요할 수 있음.

### Storage 파일 이전

현재 Storage 파일을 직접 복사하는 Supabase 공식 CLI 명령은 없음.  
아래 중 선택:

| 방법 | 설명 |
|---|---|
| **Supabase CLI `cp`** | `supabase storage cp -r ss:///chat-imgs ss:///chat-imgs` (프로젝트 전환 후) |
| **수동 재업로드** | 파일 수가 적으면 다운로드 후 신 프로젝트에 재업로드 |
| **`rclone`** | S3 호환 엔드포인트로 버킷 간 직접 복사 (대용량 권장) |

> `drug-cache/` 약품 이미지는 sync-drug-image.ts가 요청 시 자동 재캐시하므로 이전 생략 가능.

---

## Step 4 — 환경변수 교체

`.env.local`과 Vercel 환경변수를 신 프로젝트 값으로 교체.

```bash
# .env.local 수정 대상
SUPABASE_URL=https://[NEW_PROJECT_ID].supabase.co
SUPABASE_KEY=[NEW_SERVICE_ROLE_KEY]         # api/_lib/supabase.ts 에서 supabase 클라이언트용
SUPABASE_ANON_KEY=[NEW_ANON_KEY]            # (사용 중이면)
SUPABASE_SERVICE_KEY=[NEW_SERVICE_ROLE_KEY] # supabaseAdmin 클라이언트용
```

```bash
# Vercel 환경변수도 동일하게 업데이트
vercel env add SUPABASE_URL
vercel env add SUPABASE_KEY
vercel env add SUPABASE_SERVICE_KEY
```

### 변수명 현황 (`api/_lib/supabase.ts` 확인 필요)

| 코드 변수 | env key |
|---|---|
| `supabase` (일반 클라이언트) | `SUPABASE_URL` + `SUPABASE_KEY` |
| `supabaseAdmin` (service role) | `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` or `SUPABASE_SERVICE_ROLE_KEY` |

---

## Step 5 — 동작 검증 체크리스트

```
[ ] 로그인 (nickname 입력 → users 테이블 insert/select)
[ ] 새 채팅 생성 → chat_sessions insert
[ ] 메시지 전송 → chat_messages insert (user + assistant)
[ ] 세션 목록 조회 → chat_sessions select
[ ] 히스토리 로드 → chat_messages select
[ ] 이미지 업로드 → chat-imgs 버킷 upload + URL 반환
[ ] 문서 업로드 → chat-docs 버킷 upload
[ ] 약품 이미지 프록시 → proxy-image.ts → chat-imgs 접근
[ ] 세션 삭제 → chat_sessions delete (cascade → chat_messages)
[ ] 프로필 수정 → users update
```

---

## 주의사항 / 알려진 제약

| 항목 | 내용 |
|---|---|
| `id` 시퀀스 충돌 | pg_dump로 데이터 이전 시 `users.id` IDENTITY 시퀀스가 기존 최댓값부터 시작해야 함. `SELECT setval(...)` 별도 실행 필요 |
| `chat_messages.id` 타입 불확실 | 코드에서 uuid/bigint 혼용 가능성 있음. 구 프로젝트 실제 DDL 확인 후 맞출 것 |
| Storage public URL 변경 | 신 프로젝트의 Storage URL prefix가 달라짐 → DB에 저장된 `attachment_url`, `avatar_url` 값들이 구 URL을 가리킴. 필요 시 URL 일괄 업데이트 |
| RLS 미적용 상태 유지 | 현재 service_role 키 사용 구조 그대로 이전. Supabase Auth 마이그레이션은 별도 작업 |
