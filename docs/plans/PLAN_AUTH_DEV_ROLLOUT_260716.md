# PLAN — 인증 dev 이관 런북 (스테이징을 dev DB로 승격)

> 작성: 2026-07-16 · 상태: **실행 대기 (체크리스트)**
> 선행: [PLAN_AUTH_MVP_260709](PLAN_AUTH_MVP_260709.md) 스테이징 검증 완료 · [PLAN_AUTH_SIGNIN_PATHS_260715](PLAN_AUTH_SIGNIN_PATHS_260715.md)
> 목적: `feat/auth-mvp` 를 **dev 브랜치**에 안전하게 올린다.

---

## 0. 왜 이 문서가 필요한가 — dev 와 main 이 DB 를 공유한다

- **dev·main 둘 다** `gaomgqnpsjtabrvwnpad`(프로덕션) 를 쓴다.
- 스테이징 `ghdpnuwbvlrxmxcazzci` 는 이 브랜치 검증용으로 따로 판 것 — **이미 프로비저닝됨**(스키마·RLS·트리거·토글·Google).
- 🔴 **스키마 변경은 브랜치가 아니라 DB 단위다.** dev 를 위해 공유 DB 를 마이그레이션하면 그 순간 main 이 깨진다(스키마 §0 이 기존 테이블을 `_legacy` 로 rename → main 의 옛 코드가 없는 테이블을 조회).
- **결정(2026-07-16): 스테이징을 dev 상시 DB 로 승격.** dev 배포는 스테이징 하나로 전부, main 의 DB 는 손대지 않는다. 프로덕션 이관은 완전히 분리된 후속 단계.

### Vercel 구조 — GitHub 레포 1개, 프로젝트 2개

| Vercel 프로젝트 | Production 브랜치 | 도메인 | DB |
|---|---|---|---|
| **chat-agent** | main | chat-gem.vercel.app | 프로덕션 (미변경) |
| **chat-agent-dev** | dev | **chat-agent-dev.vercel.app** | 프로덕션 → **stg 로 전환** |

- 두 프로젝트는 **env 가 완전히 분리**돼 있다 → chat-agent-dev 만 stg 로 바꾸면 chat-agent(main)는 자동으로 안전.
- dev 가 chat-agent-dev 의 **Production 브랜치**이므로, 그 프로젝트의 **Production 스코프**에 env 를 넣는다(Preview 공유 문제 없음 — 별개 프로젝트라서).
- ⚠️ chat-agent(main) 프로젝트도 dev·feat 브랜치를 **Preview 로 빌드**한다. 인증 머지 후 그 프리뷰는 chat-agent 의 프로덕션 DB 로 돌아 **깨진다**(프로덕션 자체는 안전, 프리뷰만). 무시하거나 그 브랜치 프리뷰를 끈다.

---

## 1. 현재 env 바인딩 (split-brain 상태)

| 용도 | 변수 | 현재 | 목표(dev) |
|---|---|---|---|
| 인증/RLS (클라이언트·route) | `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 스테이징 ✅ | 스테이징 |
| 서버/스토리지 (service) | `SUPABASE_URL` / `SUPABASE_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | **프로덕션 🔴** | 스테이징 |

- 스테이징 자격증명은 이미 `STG_SUPABASE_URL` / `STG_SUPABASE_ANON_KEY` / `STG_SUPABASE_SERVICE_ROLE_KEY` 에 있다 → **새로 발급 없이 값 복사**.
- 코드는 손댈 것 없음 — 전부 env 구동. 앱 코드에 스테이징 ref 하드코딩 없음(docs·SQL 주석에만).

---

## 2. 실행 체크리스트

> 🔴 **순서 엄수: B·C(DB/대시보드) → A′(Vercel env) → D(머지).**
> 코드가 먼저 올라가면 버킷·OAuth 없는 상태로 dev 가 깨진다.

### A. 로컬 env 통일 — 서버 3개를 스테이징으로 — ✅ 완료 (2026-07-16)
- [x] `.env.local` 의 `SUPABASE_URL` ← `STG_SUPABASE_URL`
- [x] `.env.local` 의 `SUPABASE_KEY` ← `STG_SUPABASE_SERVICE_ROLE_KEY` (🔴 **service role** — `sync-drug-image` 가 이 클라이언트로 스토리지에 업로드하므로 anon 불가)
- [x] `.env.local` 에 `SUPABASE_SERVICE_ROLE_KEY` 신규 추가 ← `STG_SUPABASE_SERVICE_ROLE_KEY` (원래 없었음 — 이제 명시적)
- [x] 검증: URL 3개(`SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_URL`·`STG_SUPABASE_URL`) 전부 스테이징 일치, **프로덕션 ref 잔존 0** → split-brain 해소
- [x] 백업: 스크래치패드에 `.env.local.bak.*`
- (gitignore 된 파일 — 커밋 안 됨)

### B. 스테이징 스토리지 버킷 — ✅ 완료 (2026-07-16)
- [x] 확인: 스테이징에 버킷 없었음
- [x] `chat-imgs`·`chat-videos`·`chat-docs` 공개 버킷 3개 생성 (`scripts/sql/auth-mvp-storage-buckets.sql`)

### C. Google OAuth — dev 도메인 등록 — ✅ 완료 (2026-07-16)
- [x] **Google Cloud** → OAuth 클라이언트 `chat-agent-web` → **승인된 JavaScript 원본**에 `https://chat-agent-dev.vercel.app` 추가 (기존 `http://localhost:3000` 유지)
- [x] **스테이징 Supabase** → Authentication → URL Configuration → **Redirect URLs 에 `https://chat-agent-dev.vercel.app` 추가**
- [x] **승인된 리디렉션 URI 는 미변경** — `https://ghdpnuwbvlrxmxcazzci.supabase.co/auth/v1/callback` 유지.

> 🔴 왜 콜백은 supabase.co 여야 하나: OAuth 흐름은 Google → **Supabase 콜백**(code→세션 교환) → 앱(redirectTo=dev 도메인) 순이다. code 를 교환하는 주체가 앱이 아니라 Supabase 라, 리디렉션 URI 에 앱 도메인을 넣으면 로그인이 깨진다. 앱 도메인이 들어갈 자리는 **Google 의 JavaScript 원본** + **Supabase 의 Redirect URLs** 두 곳뿐.
>
> 동의 화면에 뜨는 `*.supabase.co` 도 이 콜백 때문 — 앱 이름으로 바꾸려면 Supabase Custom Domain(유료), post-MVP.
>
> ⚠️ 테스트는 **고정 도메인 `chat-agent-dev.vercel.app`** 에서. 프리뷰 배포의 해시 URL(`chat-agent-dev-<hash>.vercel.app`)은 원본 미등록이라 거기선 Google 로그인 실패.

### A′. Vercel 환경변수 — **chat-agent-dev 프로젝트만** — ✅ 완료 (2026-07-16)
- [x] 기존 2개(옛 인증 전 코드용): `SUPABASE_URL`·`SUPABASE_KEY` → stg 로 교체. `SUPABASE_KEY` = stg **service role**.
- [x] 인증 브랜치용 2개 신규 추가: `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY` = stg (`.env.local` 값과 일치 확인).
- [x] 스코프 `Production and Preview`. `SUPABASE_SERVICE_ROLE_KEY` 는 생략(코드가 `SUPABASE_KEY` 로 폴백).
- [x] **chat-agent(main) 프로젝트는 미변경** — 프로덕션 DB 유지.
- 반영은 **머지(D) 시점의 dev 재빌드에서** — `NEXT_PUBLIC_*` 는 빌드 타임에 굽는다. 지금 dev 는 아직 옛 코드라 이 변수들을 안 읽는다.

### C′. 로컬 선검증 (머지 전, 스테이징 DB 바인딩) — ✅ 완료 (2026-07-19)
- [x] **시나리오 1 — 게스트→Google 승계** (같은 uuid·대화 보존·이름/아바타 동기화)
- [x] **시나리오 2 — 빈 게스트 → 바로 로그인** (§3-2 죽은 코드 수정 후 충돌 소멸)
- [x] **시나리오 3 — 업로드** (이미지→chat-imgs, 대용량 HWP→chat-docs+parse-document 200, docx→클라이언트 인라인) 전 경로 실안착
- [x] 검증 중 버그 3개 발견·수정([DEV_260719](../logs/2026/07/DEV_260719.md)): 로그아웃 번쩍임 · 충돌 재시도 계정 재선택 · 시나리오 2 죽은 코드 — 3파일(useAuthSession·App), tsc 0
- 준비 메모: 스테이징 잔여 정식 유저가 Google 계정 소진 → `johnnyworld9278`(메시지 0) 1명 정리 후 승계 확인.

### D. 브랜치 머지·배포 — ✅ 완료 (2026-07-19)
- [x] `feat/auth-mvp` → dev 머지·푸시 (인증 4개 커밋)
- [x] chat-agent-dev 배포 → **스테이징(서울) 정상 바인딩** 확인 (외부 API 호출이 `ghdpnuwbvlrxmxcazzci.supabase.co`), 로그인·대화·업로드 실동작
- [x] **함수 리전 최적화** — dev 로그에서 `/api/sessions` 가 iad1(~900ms). Supabase 는 서울이라 5개 라우트에 `preferredRegion='icn1'` 추가(커밋 `a7a8636`). **하지만 무료(Hobby) 티어는 코드 export 를 무시** → 실제 해결은 **Vercel Settings → Functions → Function Region = Seoul(icn1) 단일 선택**(사용자 적용 완료). 상세·교훈은 [DEV_260719 §4](../logs/2026/07/DEV_260719.md).

---

## 3. 부작용 · 주의

- **테스트 스크립트 프로덕션 가드**: 스테이징이 dev 실DB가 되면 `STG_SUPABASE_URL === SUPABASE_URL` 이 되어, 스크립트의 `abort if STG===PROD` 가드가 발동해 중단된다. 프로덕션 보호는 유지되니 안전 방향이지만, **dev DB 대상 테스트를 돌리려면 그 가드를 손봐야** 한다. (지금은 인지만; 별도 처리)
- **스토리지 IDOR-3 미해결**: 이관과 무관하게 스토리지 라우트는 여전히 무인증 + service-role + 공개 버킷이다([보안 검토 2026-07-16] 참조, TODO §보안 IDOR-3). dev 에서도 그대로 노출된다 — 이관의 blocker 는 아니지만 다음 우선순위.
- **클린 스타트**: 스테이징은 빈 DB라 dev 유저는 새로 시작한다 — 원래 설계 의도와 일치.

---

## 4. 이관 후 남는 것 (프로덕션 이관 — 별도 단계)

dev 가 스테이징에서 안정화되면, 그때 프로덕션(`gaomgqnpsjtabrvwnpad`) 이관:
- SQL 3종 적용(§0 의 `_legacy` rename 백업 먼저) · 대시보드 3종 토글 · Google 운영 콜백 + JS 원본 · main 코드와 **동시** 컷오버(같은 DB 공유라 코드-스키마 원자적 전환 필요).
- 상세는 [PLAN_AUTH_MVP_260709](PLAN_AUTH_MVP_260709.md) 이관 섹션.
