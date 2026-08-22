# PLAN — 인증 MVP 테스트 전략

> 작성: 2026-07-09 · 갱신: 2026-07-14 · 상태: **MVP 검증 완료 (스테이징)**
> 대상: [PLAN_AUTH_MVP_260709.md](PLAN_AUTH_MVP_260709.md) (익명로그인 + Google + RLS, Bearer 세션)

---

## 1. 테스트 환경

**전용 빈 Supabase 스테이징 프로젝트** — ref `ghdpnuwbvlrxmxcazzci`

파괴적 클린 스타트를 반복 실행해야 하므로 프로덕션(`gaomgqnpsjtabrvwnpad`)과 분리한다. 호스티드라서 Auth 서버·GRANT·익명로그인 동작이 프로덕션과 동일하다(로컬 Docker 스택 불필요).

**2026-07-09 실측 확인**: 테이블 0개 · `auth.users` 0명 · OAuth provider 없음(email만). 다른 앱과 공유하지 않는 **완전 빈 프로젝트**.

> 처음 지정했던 `iljfnveffqeshylumdcl`은 Notion 클론 앱이 실사용 중(pages 125행, 정식 유저 4명)이라 폐기했다. 공유 프로젝트였다면 ① 익명 로그인 활성화가 **프로젝트 전역**이라 저쪽 데이터가 노출될 수 있고 ② 표준 트리거명 `on_auth_user_created`가 충돌하며 ③ teardown의 `deleteUser`가 실계정을 cascade로 날릴 수 있었다. **인증 테스트는 반드시 전용 프로젝트에서.**

### 1-1. 환경 변수 (`.env.local`, gitignored)

```bash
STG_SUPABASE_URL=https://ghdpnuwbvlrxmxcazzci.supabase.co
STG_SUPABASE_ANON_KEY=<role=anon>              # §3 RLS 매트릭스 전용
STG_SUPABASE_SERVICE_ROLE_KEY=<role=service_role>  # §3-3 teardown 전용
```

> 🔴 **이름에 role을 박는다.** 프로덕션 `SUPABASE_KEY`는 **service_role**인데 스테이징에 같은 접미사(`STG_SUPABASE_KEY`)를 쓰면서 anon을 담으면, 프로덕션 관례로 유추한 코드가 정반대 권한을 집는다. 접미사를 `_ANON_KEY` / `_SERVICE_ROLE_KEY`로 분리한다.
>
> RLS 매트릭스(§3)가 service_role을 집으면 RLS를 통째로 우회해 **18개 케이스가 전부 거짓 통과**한다. §3는 anon만, teardown(§3-3)만 service_role을 쓴다. §2 가드가 이를 강제한다.
>
> 스테이징 변수에 **`NEXT_PUBLIC_` 접두사 금지** — Next.js가 `.env.local`을 자동 로드해 클라이언트 번들에 스테이징 설정이 박힌다.

**2026-07-09 실측 상태**

| 항목 | 상태 |
|---|---|
| `STG_SUPABASE_URL` → `ghdpnuwbvlrxmxcazzci` | ✅ 프로덕션과 분리 |
| `STG_SUPABASE_ANON_KEY` (`role=anon`, ref 일치) | ✅ |
| `STG_SUPABASE_SERVICE_ROLE_KEY` (`role=service_role`, ref 일치) | ✅ |
| 스키마 적용 ([`docs/guide/db/auth-mvp-schema.sql`](../../docs/guide/db/auth-mvp-schema.sql)) | ✅ 3테이블 노출 확인 |
| 승격 동기화 트리거 ([`auth-mvp-sync-trigger.sql`](../../docs/guide/db/auth-mvp-sync-trigger.sql)) | ✅ 적용 |
| Anonymous Sign-ins | ✅ 활성 (`role=authenticated`, `is_anonymous=true` 실측) |
| **RLS 매트릭스 18케이스** | ✅ **18/18** (`npx tsx scripts/test-auth-rls.ts`) |
| **신원/트리거 10케이스** | ✅ **10/10** (`npx tsx scripts/test-auth-identity.ts`) |
| Manual Linking | ✅ 활성 (2026-07-14) |
| Google provider | ✅ 등록 (2026-07-14, `google: true` 실측) |
| **라우트 계약 6케이스** | ✅ **6/6** |
| **게스트 한도 6케이스** | ✅ **6/6** |
| **수동 브라우저 E2E** | ✅ §5 전 항목 (버그 3건 발견·수정) |

### 1-2-a. Google 경로 — 무엇이 자동화되고 무엇이 수동인가

Google 로그인의 위험은 리다이렉트 핸드셰이크가 아니라 **그 결과로 트리거가 `profiles`를 어떻게 채우는가**에 있다. `admin.createUser({ user_metadata })`는 OAuth 유저와 동일한 `raw_user_meta_data` 형태를 만들고, `admin.updateUserById({ email_confirm })`는 익명→정식 승격의 서버측 효과를 재현한다. 따라서 그 부분은 브라우저 없이 결정론적으로 검증된다 (`test-auth-identity.ts`).

| 자동화 (10케이스) | 수동 (브라우저 필요) |
|---|---|
| 익명 유저 → `사용자_XXXX` 폴백, `is_guest=true` | OAuth 리다이렉트 |
| OAuth형 유저 → Google `name`/`avatar_url` 반영, `is_guest=false` | `/auth/callback` 코드 교환 |
| 승격 → `is_guest` 동기화, 이름 갱신, **같은 uuid로 대화 승계** | `linkIdentity()` 실호출 |
| 사용자가 정한 이름은 승격이 덮지 않음 | 충돌 UX 분기 |

**이메일/비밀번호는 MVP 범위 밖**이지만 이유가 여기서 드러난다 — 익명→이메일 승격은 **비밀번호 설정 전 이메일 인증이 강제**(Supabase 공식)라 SMTP·확인메일·재설정이 통째로 딸려온다. Google 이메일은 이미 verified라 그 단계가 없다.

### 1-3. 스위트 자체 검증 (2026-07-09)

"18/18 통과"는 스위트가 거짓말하지 않을 때만 의미가 있다. 아래 대조 실험으로 확인했다.

| 실험 | 결과 |
|---|---|
| anon 슬롯에 service_role 주입 | ✅ 가드 1 발화 — `role이 'service_role'이다` |
| `STG_SUPABASE_URL`을 프로덕션으로 | ✅ 가드 2 발화 — `프로덕션과 같다. 중단` |
| `role=anon`이지만 ref가 다른 위조 JWT | ✅ 가드 3 발화 — `ref 불일치` |
| **뮤테이션** — A의 클라이언트를 service_role로 바꿔 RLS를 뚫은 척 | ✅ 케이스 2·10이 **실패** (0행 기대 → 1행) = 단언이 실제 구멍을 감지 |
| teardown 후 잔존 익명 유저 | ✅ 0명 |

> 뮤테이션 테스트가 핵심이다. 음성 단언만 있는 스위트는 테이블에 닿지 못해도 통과한다. 실제로 구멍을 뚫었을 때 빨간불이 켜지는지 봐야 그 단언에 이빨이 있음이 증명된다.

**신원 스위트도 같은 방식으로 검증됐다.** 동기화 트리거 적용 **전** 실행에서 케이스 7·8이 실패(8/10)했고, 적용 **후** 10/10이 됐다. 즉 그 두 단언은 실재하는 갭을 잡아낸 것이지 통과를 위해 쓰인 게 아니다.

케이스 10(커스텀 이름 보존)은 트리거 적용 전에는 **거짓 통과**였다 — 아무것도 덮어쓰지 않으니 당연히 통과. 지금은 케이스 8(폴백 이름은 **덮는다**)과 짝을 이뤄 `CASE` 분기가 실제로 판별함을 증명한다. 8이 통과하지 않는 한 10은 무의미하다.

### 1-2. 도구

기존 관행 유지 — 프레임워크 없이 `scripts/test-*.ts` + `npx tsx`. (weather·router·generator 동등성 스크립트와 동일 패턴, `N/N 통과` 카운터 출력.)

| 스크립트 | 역할 |
|---|---|
| `scripts/test-auth-rls.ts` | RLS 매트릭스 (§3) — DB 직접, dev 서버 불필요 |
| `scripts/test-auth-routes.ts` | 라우트 계약 (§4) — `npm run dev` 필요 |

마이그레이션 SQL은 **대시보드 SQL 편집기에서 수동 1회 적용**(CLI·pg 드라이버 도입 불필요). 스크립트는 *행동*만 검증한다.

---

## 2. 안전 가드 (스위트 진입점, 실패 시 즉시 abort)

이 두 가드가 없으면 스위트 전체가 거짓말을 할 수 있다.

1. **키가 정말 anon인가** — `STG_SUPABASE_ANON_KEY`가 JWT면 payload를 디코드해 `role === 'anon'` 단언. `sb_publishable_`로 시작하면 통과. `service_role`이면 **abort**.
   > 같은 `.env.local`에 service_role 키가 나란히 있고, 프로덕션은 접미사가 같은 `SUPABASE_KEY`에 service_role을 담고 있다. 변수 하나 잘못 집으면 전 케이스가 거짓 통과한다 — 이 가드가 그걸 막는다.
2. **프로덕션이 아닌가** — `STG_SUPABASE_URL !== SUPABASE_URL` 단언. 같으면 **abort**.
3. **JWT `ref` 클레임 일치** — anon 키의 `ref`가 `STG_SUPABASE_URL`의 프로젝트 ref와 같은지 단언. 프로덕션 키를 STG 슬롯에 잘못 넣는 사고 차단.

---

## 3. RLS 매트릭스 (`test-auth-rls.ts`) — 핵심

### 3-1. 설계 원리

익명 유저도 Postgres `authenticated` 롤을 갖는다. 따라서 Node에서 `signInAnonymously()`를 **두 번**(독립 클라이언트 인스턴스, `persistSession: false`) 호출하면 유저 **A / B**가 생기고, OAuth 없이 RLS 전 표면을 결정론적으로 돌릴 수 있다.

**모든 음성 단언은 같은 테이블·같은 verb의 양성 단언과 짝을 짓는다.** 이 짝짓기가 세 가지 거짓 통과를 한 번에 잡는다:

| 결함 | 잡는 단언 |
|---|---|
| RLS를 안 켰다 | **음성** 실패 (B가 A의 행을 읽음) |
| 정책이 없다 (RLS on + policy 0 = 전면 거부) | **양성** 실패 (A가 자기 행도 못 읽음) |
| `authenticated` GRANT 누락 (Data API 미노출) | **양성** 실패 (동일) |

→ 별도 스키마 introspection 불필요. 행동이 스키마를 증명한다.

### 3-2. 케이스

**`profiles`**

| # | 주체 | 동작 | 기대 |
|---|---|---|---|
| 1 | A | 자기 프로필 select | 1행 (+ 트리거가 만든 `is_guest=true`, `사용자_XXXX` 확인) |
| 2 | A | B의 id로 select | 0행 |
| 3 | A | 자기 `display_name` update | 성공 + 값 반영 |
| 4 | A | B의 행 update | 0행 |
| 5 | A | 자기 행의 `id`를 B로 변경 | 거부 (`WITH CHECK`) |
| 6 | A | profiles insert | 거부 (insert 정책 없음) |

**`chat_sessions`**

| # | 주체 | 동작 | 기대 |
|---|---|---|---|
| 7 | A | `{ title }`만 insert (`user_id` 생략) | 성공 + `user_id === A.id` — **`default auth.uid()` 검증** |
| 8 | A | `{ title, user_id: B.id }` insert | 거부 (`WITH CHECK`) |
| 9 | A | select 전체 | 자기 세션만 |
| 10 | A | B의 session_id로 select | 0행 |
| 11 | A | B의 세션 title update | 0행 |
| 12 | A | B의 세션 delete | 0행 + **B 클라이언트로 존재 재확인** |

> 12번의 재확인이 중요하다. delete가 "0행 영향"을 반환해도 실제로 지워졌는지는 피해자 시점에서만 확정된다.

**`chat_messages`**

| # | 주체 | 동작 | 기대 |
|---|---|---|---|
| 13 | A | 자기 세션에 메시지 insert | 성공 |
| 14 | A | **B의 세션에** 메시지 insert | 거부 (`WITH CHECK` EXISTS 서브쿼리) |
| 15 | A | B 세션의 메시지 select | 0행 |
| 16 | A | B 세션의 메시지 delete | 0행 + B 시점 재확인 |

**미인증 (anon key, 세션 없음)**

| # | 동작 | 기대 |
|---|---|---|
| 17 | 3테이블 select | 0행 / 에러 |
| 18 | 3테이블 insert | 거부 |

### 3-3. Teardown

테스트가 익명 유저를 계속 만든다. `STG_SUPABASE_KEY`(service_role)로 `auth.admin.deleteUser(A.id)` / `(B.id)` → cascade로 세션·메시지·프로필 동반 삭제. **service_role의 유일한 정당 용도**이며 스테이징 한정.

> 삭제 전 **`is_anonymous === true` 및 이번 실행에서 생성한 id인지 단언**한다. 지금은 빈 프로젝트라 위험이 없지만, 가드가 없으면 훗날 실계정을 cascade로 날린다(폐기한 공유 프로젝트에서 실제로 문제가 됐을 시나리오).

> 익명 로그인은 IP당 rate limit이 있다. 반복 실행이 잦으면 429 — teardown을 꼭 돌리고, 실패 시 대시보드에서 수동 정리.

---

## 4. 라우트 계약 (`test-auth-routes.ts`) — dev 서버 필요 ✅ **6/6 통과 (2026-07-09)**

> 🔴 **dev 서버를 반드시 스테이징 env로 띄운다.** 구 라우트는 `supabase`(프로덕션 service_role)를 import하므로, 그냥 띄우면 **쓰기 테스트가 프로덕션 DB를 때린다.** `SUPABASE_URL`·`SUPABASE_KEY`·`NEXT_PUBLIC_*`을 전부 `STG_*`로 덮어 기동할 것(Next.js는 실제 env가 `.env` 파일보다 우선).
> 게다가 케이스 4는 API로 만든 세션을 **스테이징 DB에서 직접 재확인**한다 — 라우트가 프로덕션에 썼다면 여기서 실패한다.

| # | 요청 | 기대 |
|---|---|---|
| 1 | `Authorization` 없이 `/api/sessions` GET·POST·DELETE·PATCH | 401 **+ 표적 세션 미삭제**(피해자 시점 재확인) |
| 2 | `Authorization` 없이 `/api/chat` POST | 401 (스트림 열기 전) |
| 3 | 쓰레기 Bearer 토큰 | **401** (Supabase가 서명 거부) |
| 4 | A 토큰 + 세션 생성(`user_id` 미전달) | 정상 + 스테이징 DB에 `user_id=A` (양성 짝) |
| 5 | A 토큰 + **B의 session_id** DELETE | 미삭제 (B 시점 재확인) |
| 6 | A 토큰 + `?user_id=<B.id>` GET | **A의 세션만** — 파라미터 회귀 차단 (+ A의 세션이 실제로 보이는지 양성 짝) |

### 4-1. 빨간불 기준선이 실제 취약점을 드러냈다 (구현 전, 0/6)

| 케이스 | 전환 전 실제 동작 |
|---|---|
| 1 | 미인증 `DELETE`가 **200을 반환하며 B의 세션을 진짜로 삭제** (IDOR-2 쓰기) |
| 2 | `/api/chat`이 인증 없이 **200** — LLM까지 실행 |
| 6 | `?user_id=B`가 **B의 세션을 그대로 반환** (IDOR-2 읽기) |

구현 후 6/6. 즉 이 단언들은 통과를 위해 쓰인 게 아니라 실재하는 구멍을 잡았다.

### 4-2. 스위트 자체의 순서 의존 버그 (수정함)

초기 작성에서 케이스 1의 미인증 `DELETE`가 **픽스처를 실제로 삭제**해버려, 뒤의 케이스 6이 "B의 세션이 안 보인다"며 **거짓 통과**했다. 케이스 3도 `400`(user_id 누락)을 느슨한 `4xx`로 세어 엉뚱한 이유로 통과했다.

수정: 피해자 픽스처를 케이스마다 분리(`sB1`/`sB2`/`sB3`), 케이스 3은 `401`을 콕 집음, 케이스 6에 "A의 세션이 실제로 보인다"는 양성 짝 추가. **취약한 코드는 자기 테스트의 픽스처를 파괴해 뒤 케이스를 거짓 통과시킨다** — 파괴적 케이스는 픽스처를 공유하면 안 된다.

### 4-3. 스트리밍 + RLS insert E2E (수동 프로브, 통과)

케이스 4~6은 세션 CRUD만 본다. 이 전환의 최대 위험은 **SSE 스트림 안에서 user-scoped 클라이언트가 메시지를 insert하는 경로**다. 별도 프로브로 확인: 인증된 `/api/chat` → `200`, 스트림 정상 완료(28.5s), `user`·`assistant` 메시지 both 스테이징에 저장. 인증 게이트가 스트리밍을 깨지 않는다.

---

## 4-4. 🔴 브라우저에서만 드러난 버그 — StrictMode 익명 유저 중복 생성

스크립트 34케이스가 전부 통과한 뒤에도, 브라우저로 앱을 처음 열자 **익명 유저가 같은 초에 2명** 생성됐다(하나는 세션이 없는 고아).

원인: `reactStrictMode`가 기본 `true`라 dev 에서 effect 가 두 번 실행되고, 두 실행 모두 `getSession()`에서 `null`을 본 뒤 각자 `signInAnonymously()`를 호출한다.

프로덕션은 StrictMode 가 꺼져 한 번만 돌지만 덮어둘 문제가 아니다 — 익명 로그인은 **IP당 시간당 30회 제한 + 자동 정리 없음**이라, 중복 생성은 그대로 남고 남용 벡터를 직접 때린다.

수정: [`lib/supabase/client.ts`](../../lib/supabase/client.ts)의 `ensureSession()`이 **진행 중인 로그인 프로미스를 공유**한다. 검증은 실제 함수를 그대로 태워서 — 동시 2회 + 순차 1회 호출에 익명 유저 1명, 세 호출 모두 같은 uuid.

> **교훈**: 서버 계약 테스트는 클라이언트 생명주기를 보지 못한다. 34/34가 초록이어도 훅의 이중 실행·구독 누수·첫 로드 레이스는 브라우저를 열어야 보인다.

---

## 5. 수동 브라우저 E2E (OAuth 필요, 자동화 불가) ✅ **전 항목 통과 (2026-07-14)**

| # | 시나리오 | 확인 | 결과 |
|---|---|---|---|
| 1 | 시크릿 창 첫 방문 | 게스트 자동 생성 → 대화 → 새로고침 시 유지 | ✅ |
| 2 | **승계** — 게스트가 Google 로그인 | **uuid 동일**, 기존 대화 그대로, `is_guest=false`, display_name·avatar 갱신 | ✅ `9a01f609` 유지, 대화 13개 보존, `사용자_FF8F`→`Juan Park` |
| 3 | **크로스 디바이스** | 다른 브라우저에서 같은 Google 계정 → 대화 보임 | ⏸ 미검증 (구조상 2와 동일 경로) |
| 4 | **충돌** | 이미 존재하는 Google 계정으로 게스트가 `linkIdentity` → 에러 분기, 무한 루프 없음 | ✅ (§5-a 버그 수정 후) |
| 5 | 로그아웃 | 새 게스트 생성, **이전 대화 미노출** | ✅ (§5-c 버그 수정 후) |
| 6 | OAuth 콜백 | 리다이렉트 복귀 후 세션 확립 | ✅ `/auth/callback` 라우트 불필요 — supabase-js `detectSessionInUrl` 이 처리 |

### 🔴 수동 E2E 가 잡아낸 버그 3건 — **자동화 스위트 40건이 전부 놓쳤다**

세 건 모두 **실제 OAuth 리다이렉트를 태워야만** 드러난다. 이것이 §5 를 수동으로 남겨둔 값이다.

**(a) 리다이렉트 *후* 거절을 아무도 읽지 않았다**

`linkIdentity` 실패는 두 갈래로 온다. 우리는 한쪽만 처리하고 있었다.

| 시점 | 전달 방식 | 당시 상태 |
|---|---|---|
| 리다이렉트 **전** 거절 (`manual_linking_disabled` 등) | 예외 throw | ✅ 처리됨 |
| 리다이렉트 **후** 거절 (`identity_already_exists`) | **URL 쿼리 파라미터** | ❌ 무시됨 |

브라우저가 떠났다 돌아오므로 예외가 될 수 없다 — 스택이 이미 사라졌다.
사용자는 아무 설명 없이 돌아와 같은 버튼을 다시 눌렀다(로그에 동일 에러 2회 = 무한 재시도).
→ `consumeOAuthError()` 로 `?error_code=` 를 읽고 **주소창에서 지운 뒤** 충돌 분기를 연다.
   (지우지 않으면 새로고침 때 유령 에러가 되살아난다.)

**(b) 동기화 트리거가 잘못된 곳을 봤다** → [`auth-mvp-identity-sync.sql`](../../docs/guide/db/auth-mvp-identity-sync.sql)

`linkIdentity` 는 `raw_user_meta_data` 를 **채우지 않는다.** 실측:

```
identities   : [{ provider: "google", name: "Juan Park", ... }]
user_metadata: { "email_verified": true }        ← 이름도 아바타도 없다
```

`is_guest` 는 `is_anonymous` 변화로 뒤집혔지만 이름·아바타는 게스트 값 그대로였다.
provider 정보의 원천은 `auth.identities.identity_data` 다 → 거기를 보는 트리거로 교체.

> **신원 스위트(10/10)가 왜 놓쳤나**: `admin.createUser({ user_metadata })` 는 **신규 가입** 경로의
> 형태를 만든다. 기존 유저에 신원을 **덧붙이는** 링크 경로는 메타데이터가 다르게 채워진다.
> 픽스처가 실물과 달랐고, 그 차이가 정확히 버그가 사는 자리였다.

**(c) 🔴 대화 캐시가 유저를 구분하지 않았다 — 제목 유출**

로그아웃 후 **새 게스트의 사이드바에 이전 유저의 대화 제목이 그대로 떴다**(실측).
`chat_sessions_cache_v1` 이 전역 키 하나였고 `signOut()` 이 지우지 않았다.

**RLS 는 DB 를 지키지만 localStorage 는 못 지킨다.** 본문은 안 샜지만(클릭 시 API 가 RLS 로 차단)
**제목만으로도 유출이다** — 무슨 대화를 했는지 드러난다. 기기 공유 시 실제 프라이버시 사고.

→ 캐시에 `ownerId` 를 새기고, ① `signOut()` 이 즉시 비우고 ② 소유자 불일치면 가드가 폐기한다.
   `linkIdentity` 는 uuid 가 유지되므로 캐시가 유효하다(승계 경로 영향 없음).
   `signInWithGoogle`(충돌 후 "기존 계정으로 로그인")은 uuid 가 바뀌므로 가드가 잡는다.

### 5-b. 부수 정리 — '초기화' 버튼 제거

localStorage 시절 `handleReset` 은 `gemini_chat_user`(신원)+캐시를 지웠다. **DB 는 건드린 적이 없다** —
즉 초기화는 처음부터 **"신원 초기화" = 로그아웃**의 다른 이름이었다.
(옛 `/api/auth` 는 닉네임으로 유저를 조회해서, 같은 닉네임을 다시 넣으면 대화가 전부 돌아왔다.
 남의 닉네임만 알면 그 사람 대화를 볼 수 있었다는 뜻이기도 하다 — RLS 로 없앤 취약점.)

대화가 DB 로 옮겨간 뒤엔 로컬을 지워도 새로고침 즉시 복원돼 **아무 일도 하지 않는 껍데기**가 됐다.
같은 의도는 `signOut` 이 정확히, 이름 그대로 수행한다 → 버튼 제거.

### 5-c. 로그인 진입점 복원 (설정 모달)

한도 모달이 **유일한** 로그인 진입점이었다. 그래서 로그아웃한 사용자가 자기 계정으로 돌아가려면
**메시지 5개를 태워 한도에 걸리는 수밖에** 없었다. 실사용에서 가장 먼저 터졌을 결함.

→ 설정 모달(우측 아바타)에 상태별 계정 영역:
  - 게스트 → `Google로 계속하기` (한도 모달과 **같은 AuthModal**, `reason='save'`)
  - 로그인 → 계정 이메일 + `로그아웃`

---

## 6. 회귀 (전환 전후 동일해야 함)

- `npx tsc --noEmit` → 0
- 채팅 스트리밍(SSE) 정상 — Bearer 도입이 스트림을 깨지 않음
- 렌더러 카드(weather·movie) + 제목 자동생성 정상
- **LCP** — 익명 로그인 네트워크 1회가 첫 페인트를 블로킹하지 않음(`isAuthLoading` 전면 차단 부활 금지)
- 세션 목록 페이지네이션(offset/limit) 정상 — `user_id` 파라미터 제거 후에도

---

## 7. 실행 순서

| 단계 | 내용 | 게이트 |
|---|---|---|
| 0 | **선행 준비** — `.env.local`에 `STG_SUPABASE_ANON_KEY` 추가. 대시보드에서 **Anonymous Sign-ins** + **Manual Linking** 활성화, Google provider 등록 | `signInAnonymously()` Node에서 성공 |
| 1 | 스테이징에 [MVP 플랜 §3](PLAN_AUTH_MVP_260709.md) 스키마 SQL 수동 적용 (대시보드 SQL 편집기) | 테이블·트리거 생성 확인 |
| 2 | `test-auth-rls.ts` 작성·실행 | **18/18 통과** (안전 가드 2개 선통과) |
| 3 | 라우트 전환 구현 | — |
| 4 | `test-auth-routes.ts` 실행 | **6/6 통과** |
| 5 | 로그인 UI 구현 | — |
| 6 | §5 수동 E2E + §6 회귀 | 전 항목 통과 |
| 7 | 프로덕션 프로젝트에 동일 SQL 적용 → 배포 | Phase 1~3 배포 묶음 |

> §3(RLS)이 **구현보다 먼저** 통과해야 한다. 스키마가 틀린 채로 라우트를 짜면 디버깅 표면이 두 배가 된다.

---

## 8. 알려진 한계

- **IDOR-3 미검증** — Storage 유저 prefix가 MVP 범위 밖이라 테스트도 없다. `upload`·`create-signed-url`·`parse-document`는 여전히 admin 클라 + 형식 검증뿐.
- **linkIdentity 자동화 불가** — OAuth 리다이렉트가 브라우저를 요구. §5-2·5-4가 수동으로 남는다.
- **익명 rate limit** — 반복 실행 시 429. teardown 필수.
- **스테이징 ≠ 프로덕션 데이터** — 클린 스타트라 이관 검증 대상 자체가 없다(의도).

---

## 9. 부록 — Google OAuth 대시보드 선행 설정 (§7-0 상세)

> 코드는 이미 준비돼 있다. **막히는 건 전부 대시보드 설정**이고, 세 곳이 각각 독립적으로
> 실패하면서 화면엔 똑같이 "연결하지 못했습니다"로 보인다. 그래서 순서와 실패 증상을 못 박아 둔다.

### 9-1. 어느 프로젝트인가 — 가장 먼저 확인

`.env.local`에 **스테이징과 프로덕션이 함께** 들어 있다. 대시보드에서 프로젝트를 잘못 고르면
설정은 저장되는데 앱은 여전히 실패한다(실제로 한 번 겪음).

| 용도 | ref |
|---|---|
| **앱이 붙는 곳** (`NEXT_PUBLIC_SUPABASE_URL`) | `ghdpnuwbvlrxmxcazzci` — 스테이징 |
| 레거시 라우트(`url_cache`·Storage)가 쓰는 곳 (`SUPABASE_URL`) | `gaomgqnpsjtabrvwnpad` — **프로덕션. 건드리지 말 것** |

바로 들어가는 링크: `https://supabase.com/dashboard/project/ghdpnuwbvlrxmxcazzci/auth/providers`

### 9-2. 순서 — 동의 화면 → 클라이언트 → Supabase → Manual Linking

네 곳이 **각각 독립적으로** 실패한다. 하나만 하면 다음 관문에서 다시 막힌다.
Google Cloud 는 **자격증명 발급자**, Supabase 는 **소비자**다. 서로를 가리켜야 한다.

```
Google Cloud Console                Supabase                     앱
────────────────────                ────────────────────         ──────────
OAuth 클라이언트 생성   ──────►     Client ID / Secret 입력  ──►  linkIdentity()
  ▲                                   │
  └── redirect URI 등록  ◄────────  Callback URL 복사
```

**① Google Cloud — OAuth 동의 화면 (먼저 해야 클라이언트 생성이 열린다)**

`API 및 서비스 → 사용자 인증 정보` 에 노란 배너로 강제된다. 4단계 마법사:

1. **앱 정보** — 앱 이름은 사용자가 Google 로그인 화면에서 보게 될 이름. 지원 이메일 선택
2. **대상(Audience)** — **External** (개인 Gmail 이면 Internal 은 선택지에 없다)
3. **연락처 정보** — 본인 Gmail
4. **완료 → 만들기**

🔴 만든 직후 **대상 → 테스트 사용자에 본인 Gmail 추가**. 앱이 "테스트 중" 상태라
등록 안 된 계정은 동의 화면까지 가놓고 **`access_blocked`** 로 막힌다. MVP 에선
게시(Publish)는 불필요 — 테스트 사용자 등록만으로 충분하다.

**② Google Cloud — OAuth 클라이언트 생성**

- 애플리케이션 유형: **웹 애플리케이션**
- **승인된 JavaScript 원본** (origins) — 앱이 뜨는 주소:
  ```
  http://localhost:3000
  https://<프로덕션 도메인>
  ```
- **승인된 리디렉션 URI** — Supabase Google 패널 하단의 Callback URL 을 **Copy 버튼으로**:
  ```
  https://ghdpnuwbvlrxmxcazzci.supabase.co/auth/v1/callback
  ```
  🔴 손으로 타이핑하면 `redirect_uri_mismatch`. 한 글자도 틀리면 안 된다.
- 생성되면 팝업으로 두 값이 나온다:
  ```
  클라이언트 ID       ...-....apps.googleusercontent.com
  클라이언트 보안 비밀 GOCSPX-...
  ```

> **origins 와 redirect URI 는 서로 다른 것이다.** origins 는 "어느 웹페이지가 요청할 수 있나",
> redirect URI 는 "결과를 어디로 보낼 수 있나". 우리 경우 origins 는 앱(localhost:3000),
> redirect 는 Supabase 다. 헷갈려서 둘을 같은 값으로 넣으면 안 된다.

**③ Supabase → Authentication → Providers → Google**

- Enable Sign in with Google: **ON**
- **Client IDs**: 반드시 `…apps.googleusercontent.com` 형태.
  🔴 `poc-test` 같은 임의 문자열을 넣으면 Supabase 설정은 통과(`google: true`)하지만
  실제 클릭 시 Google 이 **`invalid_client`** 로 거절한다. 한 단계 뒤에서 다시 막히는 함정.
- Client Secret 입력 → **Save**
- 🔴 Client Secret 은 **서버 전용**. `NEXT_PUBLIC_*` 에 넣거나 클라이언트 코드로 내려보내면 안 된다.
  (Supabase 대시보드에만 저장한다 — 우리 코드는 이 값을 아예 모른다.)

**④ Supabase → Authentication → Sign In / Providers → Manual Linking: ON**

- Anonymous Sign-ins 를 켰던 그 화면에 같이 있다.
- 🔴 이게 꺼져 있으면 `linkIdentity()` 는 **서버에서 즉시 거절**된다 (`manual_linking_disabled`).
  Google 을 아무리 잘 등록해도 여기서 먼저 막혀 Google 설정 상태는 확인조차 못 한다.
- **①~③ 없이 이것만 켜도 진전이 확인된다** — 에러가 `manual_linking_disabled` →
  `Unsupported provider` 로 바뀌면 관문 하나를 통과한 것이다.

**⑤ Supabase → Authentication → URL Configuration**

- **Site URL**: 배포 도메인 (로컬만 테스트 중이면 `http://localhost:3000`)
- **Redirect URLs**: OAuth 완료 후 되돌아올 수 있는 주소의 허용 목록.
  여기 없는 주소로는 Supabase 가 리다이렉트를 거부한다.
  ```
  http://localhost:3000
  https://<프로덕션 도메인>
  ```
  Vercel 프리뷰까지 열려면 `https://*.vercel.app` — 다만 운영에선 정확한 URL 만 두는 게 안전하다.

> 우리 앱은 `redirectTo: window.location.origin` 이라 **경로 없이 origin 만** 등록하면 된다.
> `/auth/callback` 같은 서버 콜백 라우트를 두는 설계가 아니다 → 9-6.

### 9-3. 브라우저 없이 검증하기

매번 게스트 메시지 5개를 태워 모달을 띄우는 건 낭비다. 설정 반영 여부는 한 방에 확인된다.

```bash
curl -s "https://ghdpnuwbvlrxmxcazzci.supabase.co/auth/v1/settings" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" | python3 -m json.tool
```

```jsonc
{
  "external": {
    "anonymous_users": true,   // ← 게스트 로그인
    "google": true             // ← 이게 false 면 provider 미등록
  }
}
```

> Manual Linking 은 이 응답에 **나오지 않는다**. 그건 브라우저에서 링크를 눌러
> `manual_linking_disabled` 가 사라졌는지로만 확인된다.

### 9-4. 증상 → 원인 대응표

실패는 전부 모달의 같은 문구로 보인다. 원인은 **콘솔의 `[AuthModal] linkIdentity failed:`** 줄로만 갈린다.

| 콘솔 / 화면 | 원인 | 조치 |
|---|---|---|
| `manual_linking_disabled` | Manual Linking OFF | 9-2 ③ |
| `Unsupported provider` / `provider is not enabled` | Google provider 미등록 | 9-2 ② |
| Google 화면에서 `invalid_client` | Client ID가 가짜/오타 | 9-2 ② — `…apps.googleusercontent.com` 확인 |
| `redirect_uri_mismatch` | Google Cloud의 redirect URI 불일치 | 9-2 ①-3 |
| `identity_already_exists` | **정상** — 그 Google 계정이 이미 다른 유저 소유 | 버그 아님. §5-4 충돌 시나리오 통과 |

### 9-5. 현재 상태 (2026-07-14) — **서버 설정 완료**

| | 항목 | 상태 |
|---|---|---|
| ✅ | Anonymous Sign-ins | 활성 |
| ✅ | **Allow manual linking** | 활성 |
| ✅ | **Google provider** | 등록 (`google: true`) |
| ✅ | Google Cloud OAuth 클라이언트 | 생성 (동의 화면 Testing + 테스트 사용자 등록) |
| ✅ | §5 수동 E2E | 전 항목 통과 |

**브라우저 없이 확인**: `npx tsx scripts/test-auth-link-preflight.ts`
`skipBrowserRedirect` 로 URL 만 받아오면 서버 판정이 그대로 드러난다 →
게스트 메시지 5개를 태워 모달을 띄울 필요가 없다.

```
✅ manual linking 통과
✅ Google provider 등록됨 — Google 동의 화면 URL 발급 확인
```

> 🔴 **동의 화면에 `ghdpnuwbvlrxmxcazzci.supabase.co` 가 노출된다.** Google 은 리디렉션 URI 의
> 도메인을 보여주므로 Supabase 를 쓰는 한 피할 수 없다. 앱 이름을 넣어도 이 줄은 남는다.
> 없애려면 **Supabase Custom Domain**(유료)으로 콜백을 `auth.<내도메인>` 으로 바꿔야 한다.
> → post-MVP.

### 9-6. 기각한 대안 — "일반 Next.js + Supabase Google 로그인" 레시피

외부 조언·블로그·LLM 답변은 대부분 **로그인 페이지 → 대시보드** 형태의 SSR 앱을 전제한다.
그 레시피를 그대로 가져오면 우리 설계를 되돌린다. 세 가지가 정면충돌한다.

| 일반 레시피 | 우리 | 왜 |
|---|---|---|
| `signInWithOAuth()` | **`linkIdentity()`** | 🔴 우리 사용자는 **이미 익명 계정**을 갖고 있다. 활성 세션에서 `signInWithOAuth` 를 부르면 **다른 uuid 로 새 계정**이 생기고 게스트의 대화가 **주인 없이 남는다.** 승계가 이 프로젝트의 존재 이유다. |
| `/auth/callback` 라우트 + `exchangeCodeForSession()` | **불필요** | 브라우저 supabase-js 가 `detectSessionInUrl` 로 PKCE 코드를 알아서 교환한다. PKCE 는 이미 쓰고 있다 — 서버 라우트로 옮기는 것과 PKCE 사용 여부는 별개 문제다. |
| `@supabase/ssr` 쿠키 세션 | **Bearer** | 앱이 `ssr: false` 순수 SPA 이고 `PLAN_NEXTJS_MIGRATION.md` §2 가 RSC 최적화를 금지한다 → 쿠키의 유일한 실익(서버 컴포넌트 세션 읽기)이 발생하지 않는다. [MVP 플랜 §2](PLAN_AUTH_MVP_260709.md) 참조. |

역설적이지만 그런 레시피도 "**로그인 상태에서 추가 provider 연결 → 명시적 Account Linking**"
이라고 스스로 말한다. **우리가 바로 그 케이스다.** 일반 로그인 경로 코드를 복사해 오면 안 된다.

부수적으로:
- 트리거 이름은 `on_auth_user_created` 가 아니라 **`on_auth_user_created_chatagent`** — `auth.users` 를
  공유하는 다른 앱과 충돌하지 않기 위해 일부러 다르게 지었다.
- 온보딩 분기 · `user_roles` · 로그인 감사 로그는 타당하지만 **MVP 범위 밖**이다.
