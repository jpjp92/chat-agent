# RETRO_AUTH_MVP — 인증 MVP 3부작 통합 회고

> 작성: 2026-07-23
> 대상 로그: [DEV_260714](DEV_260714.md)(구축) · [DEV_260715](DEV_260715.md)(로그인 경로) · [DEV_260719](DEV_260719.md)(dev 검증·마무리)
> 성격: 세 로그를 관통하는 아키텍처 결정·교훈을 한 곳에 모은 회고. 일별 상세는 원 로그 참조.

---

## 0. 한 줄 요약

localStorage 닉네임 + `service_role` 전권 구조를 걷어내고 **Supabase Auth 를 단일 신원 소스**로 세웠다. 게스트는 익명 계정(uuid), Google 로그인은 `linkIdentity` 로 **같은 uuid 에 신원을 덧붙여** 게스트 대화를 승계한다. 자동 40건 + 실 OAuth 검증을 통과했고, **버그 6개는 전부 자동 테스트가 아니라 실제 리다이렉트에서만 드러났다.**

---

## 1. 서사 — 3부작은 한 흐름이다

| 로그 | 단계 | 무엇을 |
|---|---|---|
| **DEV_260714** | 구축 | Auth 단일 신원 · RLS 전면 · 게스트 한도 서버 집계. 자동 40건 통과 후 **실 OAuth 버그 3개** |
| **DEV_260715** | 로그인 경로 정비 | 모달에 link 만 있고 sign-in 이 없던 게 뿌리. 계정선택 강제 · 빈 게스트 직행 · 계정 전환 |
| **DEV_260719** | dev 검증·마무리 | 실 OAuth 검증 중 **버그 3개 추가** · 함수 리전(iad1→icn1) · 라이브 검증 |

---

## 2. 핵심 아키텍처 결정 (되돌리지 말 것)

- **게스트도 진짜 계정.** Anonymous Sign-in 으로 uuid 발급 → 가입 없는 즉시 사용은 유지하되 데이터는 처음부터 RLS 로 DB 에 보호되어 들어간다.
- **승계는 `linkIdentity`, 로그인은 `signInWithOAuth` — 구분이 존재 이유.**
  이 프로젝트의 철칙은 세 번 정제됐다:
  > ~~"활성 세션 있으면 `signInWithOAuth` 금지"~~ (260714)
  > → **"승계할 게스트 *데이터*가 있을 때만 금지"** (260715 §3)
  > → **신호를 `sessions.length` → `guestHasData`(빈 기본 세션이 아닌 게 있나)로 교체** (260719 §3-2)
  - Supabase Automatic Linking 은 이메일 매칭이라 **익명 유저(이메일 없음)엔 원리적으로 불가** → 대시보드 **Manual Linking 활성화가 전제조건**.
- **세션 전달은 Bearer 토큰**(`@supabase/ssr` 쿠키 아님). 앱이 `ssr: false` 이고 RSC 최적화가 금지라 쿠키는 미들웨어·콜백만 늘린다.
- **RLS 가 스코프를 강제** → 라우트에서 `user_id` 파라미터·소유권 검사 폐기(IDOR-1·2 소멸).

---

## 3. 관통하는 교훈 — "실제 흐름을 태워야만 보이는 버그"

자동 40건이 초록불인 상태에서 실 OAuth 로 **버그 6개**가 나왔다. 이게 이 3부작의 진짜 값이다.

| # | 로그 | 버그 | 근본 |
|---|---|---|---|
| 1 | 260714 §4-a | 프로필 승격 절반만 됨 | `linkIdentity` 는 `raw_user_meta_data` 를 안 채움 → `identity_data` 에만 이름·아바타가 있다. 픽스처가 SIGNUP 경로를 흉내내 LINK 경로 버그를 못 봄 |
| 2 | 260714 §4-b | 충돌 모달 무반응 | 리다이렉트 **후** 에러는 예외가 아니라 `/?error=...` **URL 쿼리**로 온다 → `consumeOAuthError()` 로 회수 |
| 3 | 260714 §4-c 🔴 | 세션 캐시 유저 간 유출 | 캐시가 전역 키였고 `signOut` 이 안 지움. **RLS 는 DB 를 지키지만 localStorage 는 못 지킨다** → 캐시에 `ownerId` 각인 |
| 4 | 260719 §2 | 로그아웃 "연결 실패" 번쩍임 | 에러 화면이 "진짜 실패"와 "의도적 로그아웃(null)"을 구분 못 함 → `isSigningOut` 플래그 + `signOut` try/finally |
| 5 | 260719 §3 | 충돌 재시도 계정 두 번 고르기 | 2차 signIn 에도 `select_account` 가 걸림 → `oauthOptions(chooseAccount)` 파라미터화, 충돌 재시도에서만 제거 |
| 6 | 260719 §3-2 | 시나리오 2가 죽은 코드 | 새 게스트는 로드 시 빈 'New Chat' 세션 자동 생성 → `sessions.length` 항상 ≥1 → `=== 0` 분기가 영영 거짓 |

**메타 교훈**: *자동 픽스처가 현실과 다른 지점이 정확히 버그가 사는 지점이었다*(§4-a). 그리고 버그 6개 중 5개는 상태·리다이렉트·캐시의 **상호작용**에서 왔지 단일 함수 결함이 아니다.

**피한 함정**(260719 §3-2): 판정을 `profiles.message_count` 로 하려다 그만뒀다 — 프로필 로드 시점 값이라 대화 직후 **stale(0)** → 대화한 게스트가 `signInWithOAuth` 로 빠져 고아되는 원래 버그를 되살릴 뻔. **게스트 데이터는 전부 브라우저 안 → 클라이언트 `sessions` 가 실시간 진실.**

---

## 4. 인프라 교훈 — 무료 티어 함수 리전

260719 §4: dev 로그에서 `/api/sessions` 가 **iad1(워싱턴)** 실행 ~900ms. **Supabase 는 서울(ap-northeast-2)** → 서울유저→US함수→서울DB 태평양 이중 왕복.

- 🔴 코드 `preferredRegion='icn1'` 을 인증·업로드 3개 라우트(sessions·upload·create-signed-url, 커밋 `a7a8636`)에 넣고도 여전히 iad1 — **Hobby 티어는 per-function `preferredRegion` export 를 무시**(Pro+ 전용). (sync-drug-image·fetch-url 은 후속으로 보류 → 코드 미추가.)
- **유일한 해결**: Vercel 프로젝트 → Settings → Functions → **Function Region = Seoul(icn1) 단일 선택**. 재배포부터 적용.
- 라이브 검증: **GET /api/sessions 900ms → 135ms**. 게스트 한도(403 `guest_limit_reached`)→로그인→chat 200 end-to-end 통과.

> 교훈: "코드에 `preferredRegion` 넣으면 리전이 바뀐다"는 무료 티어에서 **거짓**. 리전 스위치는 대시보드 단일 리전 설정 하나뿐.

---

## 5. 미결 항목 (백로그)

- **프로덕션 이관** — SQL 3종 적용 · 대시보드 3종 토글(Anonymous / Manual Linking / Google) · Google Cloud 운영 콜백 URI + JS 원본 · Supabase Redirect URLs. → [PLAN_AUTH_PROD_ROLLOUT_260719](../../plans/PLAN_AUTH_PROD_ROLLOUT_260719.md) 로 이어짐.
- **IDOR-3 (Storage)** — `upload`/`create-signed-url`/`parse-document` 는 아직 admin 클라이언트 + 형식 검증뿐. 근본해결 = 유저별 prefix `${user.id}/...` + RLS. **미해결.**
- **테스트 스크립트 가드** — `STG_SUPABASE_URL === SUPABASE_URL` 상대 비교 가드가 스테이징=dev DB 승격 시 오탐. 더 나은 가드 = 대상이 프로덕션 ref(`gaomgqnpsjtabrvwnpad`) 아님을 절대 확인. (PLAN_AUTH_DEV_ROLLOUT §3)
- **동의 화면** — 앱 이름 대신 `*.supabase.co` 표시. Custom Domain(유료) 외 방법 없음. 보류.
- **Kakao · 이메일+비밀번호** — Google 연결 후엔 이메일이 이미 검증 상태라 `updateUser({ password })` 가 깔끔. 후속.

---

## 6. 검증 상태

- 자동 40건: RLS 18 · identity 10 · limit 6 · routes 6 — 전부 통과, tsc 0.
- 실 OAuth: 시나리오 1(승계)·2(빈 게스트 직행)·3(업로드 3경로) dev 검증 통과.
- 라이브(재배포 후): 서울 리전 실행 확인 · 성능 개선 · 게스트 한도→로그인 흐름 통과.

> 원 로그 3편의 상호참조가 촘촘하므로, 세부는 각 로그로. 이 문서는 "왜 이렇게 됐나"의 단일 진입점.
