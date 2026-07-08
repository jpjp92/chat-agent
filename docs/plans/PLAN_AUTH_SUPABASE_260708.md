# PLAN — Supabase Auth 전환 (사용자 관리 · 로그인 구성)

> 작성: 2026-07-08 · 상태: **설계 확정(구현 전)**
> 대체 대상: [TODO §장기 계획 — 인증 시스템 전환](../TODO.md) L1~L4 로드맵 중 **L3+L4 직행** (L1/L2 임시 토큰 단계 생략)

---

## 1. 배경 · 현황

| 항목 | 현재 상태 |
|---|---|
| 인증 방식 | 커스텀 `users` 테이블(bigint id + nickname UNIQUE), Supabase Auth 미사용 |
| 게스트 흐름 | 첫 방문 시 `사용자_XXXX` 랜덤 닉네임 자동 생성 → localStorage 저장 ([useAuthSession.ts](../../src/hooks/useAuthSession.ts)) |
| 서버 검증 | **없음** — 클라가 보내는 `user_id`/`id`를 그대로 신뢰 |
| DB 접근 | 전 라우트 `service_role` 키 → RLS 전면 비활성 |
| 보안 이슈 | IDOR-1(`/api/auth` PATCH 임의 id 수정) · IDOR-2(`/api/sessions` 타 유저 세션 열람/삭제) · IDOR-3(`/api/parse-document` filePath 소유권 없음) |
| 데이터 유실 | localStorage 기반이라 기기/브라우저 변경 시 계정·대화 유실 |

## 2. 확정 결정 (2026-07-08 브레인스토밍)

1. **하이브리드 전환**: Supabase Auth 직행 + 게스트 UX 유지 — 게스트는 **Anonymous Sign-in**으로 대체. 가입 없이 즉시 사용은 그대로, 정식 계정 전환(identity linking) 시 **같은 uuid 유지 → 대화 기록 승계**.
2. **1차 로그인 수단**: **Google OAuth + Kakao OAuth + 이메일/비밀번호**. Naver는 Supabase 미지원(비표준 OIDC)이라 커스텀 브릿지 필요 → **2차 별도 플랜**.
3. **데이터**: **클린 스타트** — 새 스키마(uuid)로 재설계. 기존 `users`/`chat_sessions`/`chat_messages`는 백업 후 초기화(대부분 자동 생성 게스트).
4. **아키텍처 A안**: `@supabase/ssr` 쿠키 세션 + **RLS 전면 활성화**. 소유권을 DB 레이어(policy)가 강제 → IDOR-1/2/3 구조적 해소. `service_role`은 `supabaseAdmin`으로 격리해 시스템 테이블(`url_cache`, `mfds_pills` 등)·서버 내부 작업에만 사용.

## 3. 목표 아키텍처

```
브라우저                          Next.js (Vercel icn1)              Supabase
─────────                        ─────────────────────              ────────
createBrowserClient ──쿠키────▶  middleware.ts (세션 refresh)
  · signInAnonymously            createServerClient(cookies)
  · signInWithOAuth                └ getUser() → user.id            auth.users (uuid)
  · linkIdentity                 user-scoped client ──RLS──▶        profiles / chat_sessions / chat_messages
  · signInWithPassword           supabaseAdmin(service_role) ─────▶ url_cache · mfds_pills · Storage 관리
```

- **클라이언트 유틸 신설** `lib/supabase/`:
  - `client.ts` — `createBrowserClient` (브라우저 전용, anon key)
  - `server.ts` — `createServerClient` (Route Handler에서 쿠키 기반, 요청당 생성)
  - 기존 `server/supabase.ts`의 `supabaseAdmin`은 유지하되 **`supabase`(service_role 범용 export)는 단계적 폐기**
- **middleware.ts 신설** — 토큰 만료 시 세션 refresh(쿠키 재발급). 페이지 가드는 불필요(게스트도 로그인 상태이므로 리다이렉트 없음).
- **환경 변수 추가**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (클라 최초 도입 — 현재 클라는 Supabase 직접 접근 없음). Vercel env + `.env.example` 갱신.

## 4. DB 스키마 (클린 스타트)

### 4-1. `public.profiles` (신규 — 기존 `users` 대체)

```sql
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '사용자',
  avatar_url text,
  is_guest boolean not null default true,   -- anonymous 여부 미러 (전환 시 false)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- auth.users 생성 시 자동 프로필
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, is_guest)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', '사용자_' || upper(substr(md5(random()::text), 1, 4))),
    new.is_anonymous
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

- `nickname` 컬럼 폐기 — 로그인 식별자는 auth(이메일/OAuth)가 담당, 표시명만 `display_name`.
- 게스트→정식 전환 시 `is_guest=false` 갱신(클라에서 전환 성공 콜백 시 update, 또는 `auth.users` UPDATE 트리거).

### 4-2. `chat_sessions` / `chat_messages` (재생성)

- `chat_sessions.user_id`: `bigint` → **`uuid not null references auth.users(id) on delete cascade`**
- 나머지 컬럼 현행 유지(title, created_at, updated_at / role, content, attachment_url, grounding_sources).
- 인덱스 재적용: `chat_sessions(user_id, updated_at desc)`, `chat_messages(session_id, created_at)`.

### 4-3. RLS 정책

> ⚠️ **익명 로그인 함정 (Supabase 보안 체크리스트)**: 익명 유저도 Postgres `authenticated` 롤을 갖는다. 따라서 `auth.role() = 'authenticated'`류 검사는 **익명 유저까지 통과시켜 무의미** → 반드시 `TO authenticated` + **소유권 술어(`auth.uid() = user_id`)** 조합으로 작성. `TO authenticated`만 쓰면 인증만 하고 인가는 안 하는 IDOR. UPDATE는 `USING`뿐 아니라 **`WITH CHECK`도 필수**(없으면 행의 `user_id`를 타인으로 재지정 가능). 성능을 위해 `auth.uid()`는 `(select auth.uid())`로 감싼다(플랜당 1회 평가).

```sql
alter table public.profiles enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;

-- profiles: 본인 행만 (SELECT + UPDATE, WITH CHECK로 id 변조 차단)
create policy "own profile select" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "own profile update" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
-- insert는 handle_new_user 트리거(security definer)가 담당 → insert policy 불필요

-- chat_sessions: 본인 세션만 CRUD
create policy "own sessions" on public.chat_sessions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- chat_messages: 소속 세션이 본인 것일 때만
create policy "own messages" on public.chat_messages
  for all to authenticated
  using (
    exists (select 1 from public.chat_sessions s
            where s.id = chat_messages.session_id and s.user_id = (select auth.uid()))
  ) with check (
    exists (select 1 from public.chat_sessions s
            where s.id = chat_messages.session_id and s.user_id = (select auth.uid()))
  );
```

- **Data API GRANT 확인**: 테이블 재생성(클린 스타트) 시 `authenticated` 롤에 자동으로 REST 접근이 부여되지 않을 수 있다. RLS enable와 별개로 `authenticated` 롤의 테이블 접근(GRANT)이 필요 — 마이그레이션 후 `supabase db advisors`로 노출/권한 점검.
- 시스템 테이블(`url_cache`, `mfds_pills`)도 **RLS enable + policy 없음**(= anon/authenticated 접근 전면 차단, `supabaseAdmin`(service_role)만 접근).
- **`is_guest`는 표시용 전용** — 인가 판단(RLS·게이팅)에 쓰지 않는다. Trial 횟수 제한은 `auth.jwt()->>'is_anonymous'` 등 auth 신뢰 필드로 판정.

### 4-4. Storage

- 업로드 경로에 **유저 prefix 강제**: `${user.id}/${timestamp}_${safeName}` (chat-imgs/chat-videos/chat-docs 3버킷 공통) → IDOR-3 근본 해소(경로 자체가 소유권).
- `storage.objects` policy: `(storage.foldername(name))[1] = auth.uid()::text` 기준 select/insert/delete.
- 단, 서버 라우트(upload/create-signed-url)는 admin 클라이언트를 유지하되 **쿠키에서 얻은 `user.id`로 prefix를 서버가 조립**(클라 지정 불가).

## 5. 게스트 · 계정 전환 플로우

| 시나리오 | 처리 |
|---|---|
| 첫 방문 | `getUser()` 없음 → `supabase.auth.signInAnonymously()` → trigger가 profiles 자동 생성. 이후 재방문은 쿠키 세션 복원(기존 localStorage 게스트보다 견고) |
| 게스트 → Google/Kakao | `supabase.auth.linkIdentity({ provider })` — **같은 uuid에 identity 연결** → 세션·메시지 승계. 대시보드 **Manual Linking 활성화 필수** |
| 게스트 → 이메일/비번 | `updateUser({ email })` → 확인 메일 인증 → `updateUser({ password })` (anonymous → permanent 공식 경로) |
| 정식 로그인(재방문) | 로그인 모달: `signInWithOAuth({ provider, options: { redirectTo: '/auth/callback' } })` 또는 `signInWithPassword` |
| OAuth 콜백 | **`app/auth/callback/route.ts` 신설** — `exchangeCodeForSession(code)` 후 `/`로 리다이렉트 |
| 로그아웃 | `signOut()` → 다음 방문 시 새 게스트. "게스트 데이터는 로그아웃 시 접근 불가" 안내 문구 |
| 충돌 케이스 | 게스트 상태에서 `linkIdentity` 대상 계정이 **이미 존재**하면 에러 → "기존 계정으로 로그인하시겠어요?" 분기(게스트 데이터 승계 불가 고지) |

## 6. API 라우트 변경 목록

공통 원칙: **`user_id`를 요청 body/query로 받지 않는다** — `createServerClient(cookies).auth.getUser()`로 추출. 미인증(쿠키 없음/만료)은 401.

| 라우트 | 변경 |
|---|---|
| `app/api/auth/route.ts` | POST(닉네임 로그인) **삭제** — 클라 `signInAnonymously`/OAuth가 대체. PATCH(profile 수정)는 `app/api/profile/route.ts`로 개명 + user-scoped client(RLS가 본인 행만 허용 → IDOR-1 해소). 또는 클라에서 직접 `profiles` update로 대체하고 라우트 삭제 |
| `app/api/sessions/route.ts` | GET/POST/DELETE/PATCH 전부 user-scoped client 전환. `user_id` 파라미터 제거(쿠키 유저 기준). RLS가 타 유저 세션 차단 → IDOR-2 해소 |
| `app/api/chat/route.ts` | 진입 시 `getUser()` + `session_id` 소유권은 RLS insert policy가 강제(user-scoped client로 메시지 insert). LLM 호출 로직 무변경 |
| `app/api/upload/route.ts` | `getUser()` 후 `filePath = ${user.id}/${timestamp}_...` 서버 조립. admin 클라 유지 |
| `app/api/create-signed-url/route.ts` | 동일 — prefix 서버 조립 후 signed URL 발급 |
| `app/api/parse-document/route.ts` | `filePath`가 `${user.id}/`로 시작하는지 검증(기존 형식 검증에 추가) → IDOR-3 해소 |
| 변경 없음 | `summarize-title`(LLM만 호출, DB 미접근 — 제목 저장은 `/api/sessions` PATCH 경유로 위 항목에 포함) · `fetch-url`(url_cache=admin) · `pill-search` · `showtimes` · `speech` · `proxy-image` · `sync-drug-image` · `fetch-transcript` — 유저 데이터 무관. 단 어뷰징 방지용 `getUser()` 존재 확인(401 게이트)만 추가 검토 |

## 7. 프론트엔드 변경

- **`useAuthSession.ts` 재작성** — localStorage/`loginUser` 제거. `onAuthStateChange` 구독 + 세션 없으면 `signInAnonymously()`. 반환 형태(`currentUser`, `hydratedUserProfile`)는 유지하되 `SupabaseUser.id: number → string(uuid)`.
  - ⚠️ `id` 타입 변경 파급: `useChatSessions`(user_id 파라미터 제거로 흡수), `App.tsx`, `types.ts` — `user_id` 넘기던 fetch 전부 파라미터 삭제.
  - ⚠️ LCP: 기존 `isAuthLoading` 백그라운드 처리 패턴 유지(스켈레톤) — anonymous sign-in도 네트워크 1회라 블로킹 금지.
- **로그인 모달 신설** `components/AuthModal.tsx` — Google/Kakao 버튼 + 이메일 폼(로그인/가입 탭). 헤더 아바타 메뉴에 진입점: 게스트면 "로그인/계정 만들기"(+ "기록을 계정에 저장하세요" 배지), 정식이면 "로그아웃".
- **프로필 편집** — 기존 display_name/avatar 편집 UI를 profiles 테이블로 연결.
- `services/geminiService.ts` — `loginUser` 제거, fetch들의 `user_id` 파라미터 제거.

## 8. 외부 설정 (Phase 0 체크리스트)

- [ ] Supabase Dashboard: **Anonymous Sign-ins 활성화** + abuse 방지 **CAPTCHA(Turnstile) 검토**(anonymous는 봇 남용 벡터)
- [ ] Supabase Dashboard: **Manual Linking 활성화** (`linkIdentity` 전제)
- [ ] Google Cloud Console: OAuth Client(웹) 생성 → Supabase Google provider에 client id/secret + Redirect URI(`https://<ref>.supabase.co/auth/v1/callback`)
- [ ] Kakao Developers: 앱 등록 → Kakao 로그인 활성화 + Redirect URI → Supabase Kakao provider 설정 (동의항목: 닉네임·프로필 이미지)
- [ ] 이메일: 초기엔 Supabase 기본 SMTP(시간당 제한 有) → 실사용 늘면 커스텀 SMTP(Resend 등) 전환. 확인 메일 템플릿 한국어화
- [ ] Vercel env: `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` 추가, `.env.example` 갱신
- [ ] Auth 설정: Site URL = 프로덕션 도메인, Redirect URLs에 로컬(`http://localhost:3000/**`)·프리뷰 도메인 추가

## 9. 구현 순서 (Phase)

| Phase | 내용 | 완료 기준 |
|---|---|---|
| **0** 외부 설정 | §8 체크리스트 | 대시보드에서 anonymous+Google+Kakao 로그인 수동 확인 |
| **1** DB 마이그레이션 | 기존 3테이블 백업(`*_legacy` rename 또는 dump) → 신규 스키마+trigger+RLS+Storage policy 적용 (SQL 마이그레이션 파일로 관리) | anon key로 타 유저 행 접근 시 0건 확인 |
| **2** 클라 기반 | `@supabase/ssr` 설치, `lib/supabase/` 유틸, `middleware.ts`, `useAuthSession` 재작성(anonymous 자동), `auth/callback` 라우트 | 첫 방문 → 게스트 자동 생성 → 새로고침 세션 유지 |
| **3** API 전환 | §6 라우트 전부. user-scoped client + `user_id` 파라미터 제거 | 채팅 E2E(전송·저장·목록·삭제) + 401 케이스 |
| **4** 로그인 UI | AuthModal, 헤더 진입점, 게스트→전환 플로우, 프로필 편집 | 게스트 대화 → Google 연결 → 기록 승계 확인 / Kakao·이메일 동일 |
| **5** 정리 | 구 `users` 테이블·`loginUser`·`supabase`(범용 service_role export) 제거, TODO §보안 IDOR-1/2/3 완료 처리, REF_DB.md·README 갱신, legacy 백업 보존 기한 결정 | tsc 0 + 문서 정합 |

- Phase 2까지는 배포 없이 로컬(별도 Supabase 프로젝트 또는 로컬 스택)에서 진행 권장. **Phase 1~3은 배포 시점을 묶어야 함**(스키마와 코드가 상호 비호환 — 프리뷰 배포로 검증 후 프로덕션 1회 전환).

## 10. 리스크 · 주의

- **Anonymous 남용**: 방문마다 `auth.users` 행 생성 가능(쿠키 삭제 시 신규). 30일 이상 미전환 anonymous 유저 정리 잡(대시보드 SQL 스케줄) 검토. CAPTCHA는 UX 마찰과 트레이드오프 — 초기엔 미적용, 지표 보고 결정.
- **linkIdentity 이메일 충돌**(§5 마지막 행): UX 분기 반드시 구현 — 미구현 시 전환 실패가 무한 루프처럼 보임.
- **세션 쿠키 vs 기존 fetch**: 쿠키는 same-origin 자동 전송이라 기존 fetch 코드 변경 최소. 단 `credentials` 기본값 확인.
- **Vercel 60s 캡 무관**: auth 호출은 밀리초 단위, chat 파이프라인 예산 영향 없음.
- **Kakao 이메일 미제공 가능**: Kakao는 이메일 동의 항목이 선택(검수 전 제한) — 이메일 없이도 동작하도록 profiles가 auth 이메일에 의존하지 않는 현 설계 유지.
- **RLS 성능**: `chat_messages` policy가 서브쿼리(EXISTS) — `chat_sessions(id, user_id)` PK/인덱스로 충분하나, 메시지 목록 쿼리 플랜 1회 확인.

## 11. 후속 (이 플랜 범위 밖)

- Naver OAuth 커스텀 브릿지 (2차 플랜)
- Trial/Playground 메시지 횟수 제한 — anonymous 유저(`is_guest=true`) 대상 rate limit으로 자연 결합 (TODO §Trial/Playground)
- `lastActiveDoc` 등 localStorage 잔존 데이터의 DB 이전 (TODO §핵심 UX)
- 계정 삭제(회원 탈퇴) 플로우 — cascade로 데이터 일괄 삭제, UI만 추가
