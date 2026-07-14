# PLAN — 인증 MVP (익명로그인 + Google + RLS)

> 작성: 2026-07-09 · 상태: **✅ 구현·스테이징 검증 완료 (2026-07-14) — 프로덕션 이관 대기**
> 구현 로그: [DEV_260714](../logs/2026/07/DEV_260714.md) — 실제로 어떻게 배선됐는지, 그리고 **자동 40건이 못 잡은 버그 3개**
> 전체 설계: [PLAN_AUTH_SUPABASE_260708.md](PLAN_AUTH_SUPABASE_260708.md) — 이 문서는 그 중 **최소 실행 가능 조각**만 잘라낸 실행 플랜이다.
> 테스트 전략: [PLAN_AUTH_MVP_TEST_260709.md](PLAN_AUTH_MVP_TEST_260709.md) — 스테이징 프로젝트 + RLS 매트릭스(§6 검증 시나리오의 실행 설계)

---

## 1. 목표

**localStorage 닉네임 인증을 Supabase Auth로 교체하고, RLS로 IDOR-1/2를 구조적으로 봉합한다.** 로그인 provider는 Google 하나만 붙여 게스트→정식 승계 플로우를 검증한다.

MVP가 끝나면: 게스트가 대화 → Google 로그인 → **같은 uuid라 대화가 그대로 승계** → 다른 기기에서 로그인해도 기록 유지.

### 범위 (IN)

- Supabase **Anonymous Sign-in**으로 게스트 대체 (가입 없이 즉시 사용 UX 유지)
- **Google OAuth** 1종 + `linkIdentity` 게스트 승계
- `profiles` / `chat_sessions` / `chat_messages` 3테이블 **클린 스타트 + RLS 전면 활성화**
- **Bearer 토큰** 세션 전달 (§2)
- 라우트 전환: `/api/sessions`, `/api/chat`, 프로필 수정
- 로그인 UI: 헤더 진입점 + `AuthModal`(Google 버튼)

### 범위 밖 (OUT — 후속)

| 항목 | 이유 |
|---|---|
| Kakao / 이메일·비밀번호 / Naver | provider 1종으로 플로우 검증 후 추가. **익명→이메일 승격은 비밀번호 설정 전에 이메일 인증이 강제**(Supabase 공식)라 SMTP·확인메일·재설정 플로우가 통째로 딸려온다. Google은 이메일이 이미 verified라 인증 단계가 없다 — MVP를 Google로 시작하는 실질 근거 |
| **Storage 유저 prefix (IDOR-3)** | `upload`·`create-signed-url`·`parse-document`는 현행 admin 클라 유지. IDOR-3는 **미해소 상태로 남음**(의도적 이월) |
| `getClaims()` / asymmetric JWT 서명키 | Bearer+RLS에선 라우트가 유저 id를 몰라도 되어 왕복 자체가 없음(§2). 필요해지면 그때 |
| middleware.ts | Bearer 채택으로 불필요 |
| Trial 횟수 제한 | 인증 기반 확보 후 |

---

## 2. 세션 전달 = Bearer 토큰 (확정)

이 앱은 [app/page.tsx](../../app/page.tsx)가 `ssr: false`인 **완전 클라이언트 SPA**이고, [PLAN_NEXTJS_MIGRATION.md](PLAN_NEXTJS_MIGRATION.md) §2가 "RSC 최적화를 시도하지 않는다 / App 전체를 Client Component로 유지"를 명시한다. 쿠키 세션(`@supabase/ssr`)의 결정적 이점인 **서버 컴포넌트 세션 읽기**가 설계상 발생하지 않으므로, 비용만 남는다.

| | **Bearer (채택)** | 쿠키(@supabase/ssr) |
|---|---|---|
| 요청당 서버 홉 | 없음 | middleware가 매 요청 실행 |
| SSE 스트리밍(`/api/chat`) | 무관 | 헤더 flush 후 `Set-Cookie` 불가 → 갱신 금지 규율 필요 |
| CSRF | 구조적 면역 | 쿠키 자동 전송 → SameSite 의존 |
| XSS | 토큰 JS 메모리 | **동일** — ssr 브라우저 쿠키는 httpOnly 아님 |
| 토큰 부착 | `authedFetch` 1곳 | 자동 |

> 되돌리기 비용은 인증 레이어에 국한 — 훗날 RSC 도입 시 쿠키로 교체 가능.

### 2-1. 핵심 이점 — 라우트가 유저 id를 알 필요가 없다

Bearer 토큰을 단 클라이언트로 쿼리하면 **Supabase가 JWT 서명을 검증**하고 **RLS `auth.uid()`가 행을 스코프**한다. 따라서:

- 라우트는 `getUser()`(auth 서버 왕복)를 **호출하지 않는다**.
- 세션 생성은 `user_id uuid not null default auth.uid()`로 **DB가 채운다** → 라우트는 `{ title }`만 insert.
- 위조 토큰 → Supabase가 거부. 타 유저 토큰 → 그 유저 자신의 데이터만 접근(정상).
- 라우트는 **토큰 헤더 부재 시에만 조기 401**을 던진다(명확한 에러용).

```ts
// lib/supabase/route.ts — 요청당 user-scoped 클라이언트
import { createClient } from '@supabase/supabase-js';

export function createRouteClient(req: Request) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;   // → 라우트에서 401
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } }
  );
}
```

---

## 3. DB 스키마 (클린 스타트)

> 기존 `users` / `chat_sessions` / `chat_messages`는 `*_legacy`로 rename 후 신규 생성. 기존 데이터는 대부분 자동생성 게스트라 이관하지 않는다.

### 3-1. 테이블

```sql
-- profiles: auth.users 1:1
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '사용자',
  avatar_url text,
  is_guest boolean not null default true,   -- 표시 전용, 인가 판단 금지
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default 'New Chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.chat_sessions (user_id, updated_at desc);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  attachment_url text,
  grounding_sources jsonb,
  created_at timestamptz not null default now()
);
create index on public.chat_messages (session_id, created_at);
```

> `user_id ... default auth.uid()` 가 §2-1의 "라우트가 id를 모른다"를 성립시킨다.

### 3-2. 신규 유저 → 프로필 자동 생성

```sql
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, avatar_url, is_guest)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name',
             '사용자_' || upper(substr(md5(random()::text), 1, 4))),
    new.raw_user_meta_data->>'avatar_url',
    new.is_anonymous
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

- 게스트: `raw_user_meta_data`가 비어 `사용자_XXXX` 폴백 (현행 UX 동일)
- Google: `name` / `avatar_url` 자동 채움
- `linkIdentity`는 **새 auth.users 행을 만들지 않으므로** INSERT 트리거 미발화 → 승계 유지.

**🔴 승격 동기화는 트리거가 한다 (클라이언트 아님)**

실측 확인(2026-07-09): 승격 시 `auth.users.is_anonymous`는 `false`로 바뀌고 데이터도 승계되지만, `handle_new_user`가 INSERT 트리거라 **`profiles.is_guest`는 `true`로, `display_name`은 `사용자_XXXX`로 남는다.**

이걸 클라이언트가 `profiles` update로 메우게 하면 실패 창이 생긴다 — 링크 직후 크래시·탭 종료 시 `is_guest`가 영구히 어긋난다. 그래서 `auth.users` **AFTER UPDATE 트리거**(`sync_profile_from_auth`)가 원천과 사본을 같은 트랜잭션에서 맞춘다. 사용자가 직접 정한 `display_name`·`avatar_url`은 덮지 않는다(폴백 상태일 때만 채움).

> `WHEN` 절로 `is_anonymous` / `raw_user_meta_data` 변경 시에만 발화 — 없으면 로그인마다(`last_sign_in_at` 갱신) 헛돈다.

### 3-2-a. 🔴 `linkIdentity` vs `signInWithOAuth` — 잘못 고르면 게스트 대화가 사라진다

둘 다 "Google로 로그인" 버튼 뒤에 있지만 결과가 다르다. **활성 세션(게스트 포함)이 있으면 `linkIdentity`**, 세션이 없으면 `signInWithOAuth`로 분기해야 한다.

게스트 세션이 살아있는데 `signInWithOAuth`를 부르면 **다른(또는 새) 유저로 로그인**되고, 익명 유저의 세션·메시지는 uuid가 갈라져 **주인 없이 남는다**. MVP의 핵심 가치가 바로 그 승계라, 이 분기가 틀리면 기능 자체가 무의미해진다.

> Supabase는 **verified 이메일**에 한해 같은 이메일의 OAuth 신원을 기존 유저에 자동 연결한다(unverified 자동 연결은 pre-account-takeover 공격 벡터라 금지). Google 이메일은 verified라 이 규칙에 걸린다 — 분기를 지키지 않으면 "기존 계정으로 조용히 흡수"가 일어난다.

### 3-3. RLS

> ⚠️ 익명 유저도 Postgres `authenticated` 롤을 갖는다 → `auth.role()='authenticated'` 검사는 무의미. 반드시 `TO authenticated` + 소유권 술어. UPDATE는 `WITH CHECK` 필수. `auth.uid()`는 `(select auth.uid())`로 감싸 플랜당 1회 평가.

```sql
alter table public.profiles enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;

create policy "own profile select" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "own profile update" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "own sessions" on public.chat_sessions
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "own messages" on public.chat_messages
  for all to authenticated
  using (exists (select 1 from public.chat_sessions s
                 where s.id = chat_messages.session_id and s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.chat_sessions s
                 where s.id = chat_messages.session_id and s.user_id = (select auth.uid())));
```

- 시스템 테이블(`url_cache`, `mfds_pills`)도 **RLS enable + policy 없음** → `supabaseAdmin`만 접근.
- 재생성 테이블은 `authenticated` 롤 **GRANT 확인** 필요(Data API 노출은 RLS와 별개). 적용 후 `supabase db advisors` 통과 확인.

---

## 4. 코드 변경

### 4-1. 신규

| 파일 | 내용 |
|---|---|
| `lib/supabase/client.ts` | `createClient`(브라우저 싱글톤, anon/publishable key). `auth.autoRefreshToken` 기본 on |
| `lib/supabase/route.ts` | §2-1 `createRouteClient(req)` — Bearer → user-scoped 클라 |
| `app/auth/callback/route.ts` | Google OAuth 콜백. `exchangeCodeForSession(code)` 후 `/`로 리다이렉트 |
| `components/AuthModal.tsx` | Google 버튼 + 게스트 안내 문구. (이메일 폼 자리만 비워둠) |

### 4-2. 수정

| 파일 | 변경 |
|---|---|
| `src/hooks/useAuthSession.ts` | **재작성**. localStorage/`loginUser` 제거 → `getSession()` 없으면 `signInAnonymously()`. `onAuthStateChange` 구독. `id: number → string(uuid)`. `isAuthLoading` 백그라운드 패턴 유지(LCP 회귀 방지) |
| `services/geminiService.ts` | `loginUser` 삭제. **`authedFetch` 헬퍼 신설**(세션 토큰 → `Authorization` 헤더) 후 sessions/chat 계열 fetch 전부 교체. `fetchSessions`의 `user_id` 쿼리 파라미터 **삭제** |
| `app/api/sessions/route.ts` | `createRouteClient(req)` 사용. GET: `user_id` 파라미터 제거(RLS가 스코프). POST: `{ title }`만 insert(`user_id`는 DB default). DELETE/PATCH: RLS가 소유권 강제 → **IDOR-2 해소** |
| `app/api/chat/route.ts` | 진입 시 Bearer 확인(없으면 401). 메시지 insert를 user-scoped 클라로 → RLS가 세션 소유권 검증. **LLM 파이프라인 로직 무변경** |
| `app/api/auth/route.ts` | POST(닉네임 로그인) **삭제**. PATCH → `profiles` update로 전환(RLS가 본인 행만 → **IDOR-1 해소**). 라우트째 삭제하고 클라에서 직접 `profiles` update도 가능 — 구현 시 택1 |
| `src/hooks/useChatSessions.ts` | `user_id` 인자 전달 제거 |
| `App.tsx` / `types.ts` | `SupabaseUser.id` 타입 `number → string` 파급 |
| `server/supabase.ts` | ⚠️ **`supabase` export는 실제로 service_role**(`SUPABASE_KEY`). MVP에선 **그대로 유지**(url_cache 등이 의존). 제거는 후속 |
| `.env.example` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` 추가 |

---

## 5. 구현 순서

| Phase | 내용 | 완료 기준 |
|---|---|---|
| **0** 외부 설정 | Supabase 대시보드: **Anonymous Sign-ins 활성화**, **Manual Linking 활성화**(`linkIdentity` 전제). Google Cloud OAuth Client 생성 → Supabase Google provider 등록. Auth Site URL + Redirect URLs(`localhost:3000/**`, 프리뷰, 프로덕션). Vercel env 2종 추가 | 대시보드에서 익명·Google 로그인 수동 성공 |
| **1** DB 마이그레이션 | 기존 3테이블 `*_legacy` rename → §3 전체 적용(테이블·트리거·RLS·GRANT) | 타 유저 토큰으로 행 조회 0건. `supabase db advisors` 통과 |
| **2** 인증 기반 | `lib/supabase/*`, `useAuthSession` 재작성, `authedFetch` | 첫 방문 → 게스트 자동 생성 → 새로고침 세션 유지 |
| **3** 라우트 전환 | §4-2 sessions / chat / profile | 채팅 E2E(전송·저장·목록·삭제) + 토큰 없이 호출 시 401 |
| **4** 로그인 UI | AuthModal(Google), 헤더 진입점, **세션 유무로 `linkIdentity`/`signInWithOAuth` 분기**(§3-2-a), 충돌 에러 분기. `is_guest` 갱신은 트리거가 하므로 클라 코드 불필요 | §6 시나리오 전부 통과 |

> **Phase 1~3은 스키마와 코드가 상호 비호환** — 프리뷰 배포로 검증 후 프로덕션 1회 전환. Phase 2까지는 로컬/별도 프로젝트 권장.

---

## 6. 검증 시나리오 (Phase 4 완료 기준)

1. **게스트 생성** — 시크릿 창 첫 방문 → 대화 1건 → 새로고침 → 세션·메시지 유지
2. **승계** — 그 게스트가 Google 로그인 → **uuid 동일**, 기존 대화 그대로 보임, `profiles.is_guest=false`, display_name/avatar가 Google 값으로 갱신
3. **크로스 디바이스** — 다른 브라우저에서 같은 Google 계정 로그인 → 대화 보임 (기존 localStorage 구조에선 불가능했던 것)
4. **IDOR-2** — 유저 A 토큰으로 유저 B의 `session_id` GET/DELETE 시도 → 0건/실패
5. **IDOR-1** — 유저 A 토큰으로 B의 `profiles` update 시도 → 0행
6. **401** — `Authorization` 헤더 없이 `/api/sessions`, `/api/chat` 호출 → 401
7. **충돌** — 이미 그 Google 계정이 존재하는 상태에서 게스트가 `linkIdentity` → 에러 캐치 후 "기존 계정으로 로그인" 안내(게스트 데이터 승계 불가 고지)
8. **회귀** — tsc 0, 채팅 스트리밍·렌더러 카드·제목 자동생성 정상

---

## 7. 리스크

- **익명 유저 남용** — 쿠키 삭제마다 `auth.users` 행 생성. Supabase 기본 **rate limit은 IP당 시간당 30회**이고 **자동 정리는 없다**(공식 문서). MVP에선 방치, 지표 보고 CAPTCHA(Turnstile)·미전환 유저 정리 잡 검토. 테스트 스위트도 실행당 유저를 만드니 teardown 필수(§테스트 플랜).
- **linkIdentity 이메일 충돌**(시나리오 7) — 미구현 시 전환 실패가 무한 루프처럼 보임. **반드시 분기 구현**.
- **IDOR-3 미해소** — Storage 유저 prefix가 범위 밖. MVP 이후 즉시 착수 권장(현재 `filePath` 형식 검증으로 blast radius만 제한된 상태).
- **`id` 타입 전파**(`number → string`) — 컴파일 에러로 대부분 잡히나 문자열 비교/키 사용처 확인.
- **LCP 회귀** — 익명 로그인이 네트워크 1회. `isAuthLoading` 전면 블로킹 부활 금지(과거 개선 사항).

---

## 8. MVP 이후

1. **Storage 유저 prefix + IDOR-3** (가장 시급)
2. Kakao provider 추가 (Phase 0 절차만 반복)
3. 이메일/비밀번호 (SMTP·확인메일·재설정)
4. `server/supabase.ts`의 `supabase`(service_role) export 제거 → `supabaseAdmin`만
5. Naver 커스텀 브릿지 / Trial 횟수 제한 / 회원 탈퇴
