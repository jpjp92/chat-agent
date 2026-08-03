# PLAN — 인증 프로덕션(main) 이관 검토·런북

> 작성: 2026-07-19 · 상태: **검토·대기 (실행 전)**
> 선행: [PLAN_AUTH_DEV_ROLLOUT_260716](PLAN_AUTH_DEV_ROLLOUT_260716.md) dev 이관 완료 · [PLAN_AUTH_MVP_260709](PLAN_AUTH_MVP_260709.md)
> 목적: dev 에서 검증된 인증(익명+Google 승계+RLS)을 **main/프로덕션에 안전하게** 올리기 위한 검토사항 총정리.
> 🔴 **이 문서는 실행 지시가 아니라 이관 전 확인 목록.** 실제 실행은 별도 세션에서 신중히.

---

## 0. dev 와 무엇이 다른가 — 왜 더 위험한가

| 축 | dev 이관 (완료) | main 이관 (이 문서) |
|---|---|---|
| Vercel 프로젝트 | chat-agent-dev | **chat-agent** |
| DB | 스테이징 `ghdpnuwbvlrxmxcazzci` (빈 DB) | **프로덕션 `gaomgqnpsjtabrvwnpad` (라이브·실데이터)** |
| 사용자 | 없음 (클린 스타트) | **실사용자 존재 가능** |
| 컷오버 | 순차 가능 (아무도 안 씀) | **원자적 1회 전환 필수** |

- 🔴 **핵심 리스크**: 스키마 §0 이 기존 `users`/`chat_sessions`/`chat_messages` 를 `*_legacy` 로 rename 한다. **rename 되는 순간 main 의 (아직 옛) 코드는 없는 테이블을 조회 → 전면 장애.** 따라서 **SQL 적용과 main 코드 배포가 같은 창(window)에서** 일어나야 한다.
- dev 는 이 문제가 없었다(스테이징은 옛 코드가 안 붙어 있어서). main 은 다르다.

---

## 1. 실행 순서 (원자적 컷오버)

> 🔴 **순서 엄수. 유지보수 창(트래픽 적은 시간)에.**

1. **선행 외부 설정** (무중단, 코드와 무관 — 미리 다 해둘 것): §2 B·C·D·E·F·G
2. **백업**: 프로덕션 DB 스냅샷 + 기존 3테이블은 `_legacy` rename 이 곧 백업(삭제 아님 → 롤백 경로 확보)
3. **SQL 적용** (§2 A): `_legacy` rename + 신규 테이블·트리거·RLS·GRANT
4. **즉시 main 코드 배포**: `dev` → `main` 머지 → chat-agent 재빌드 (3과 4 사이 간격 최소화)
5. **스모크**: §3 검증 시나리오
6. **문제 시 롤백**: §4

---

## 2. 이관 전 검토·준비 체크리스트

### A. DB 스키마 (프로덕션 `gaomgqnpsjtabrvwnpad`)
- [x] 🆕 **사전 점검 실행 (2026-08-02 완료)** — [`scripts/sql/auth-mvp-preflight-prod.sql`](../../scripts/sql/auth-mvp-preflight-prod.sql). 결과: **🔴 두 항목 모두 clear** — B6 `_legacy` 이름 충돌 없음 · B3 의존 뷰 없음. B1(대상 3종 존재)은 A1 쿼리가 세 테이블을 조인해 성공한 것으로 묵시적 확인. B5(현행 RLS off)는 구 앱이 정상 동작 중인 것으로 확인(그게 IDOR-1/2). **남은 확인: B2(예상 밖 테이블/뷰) — 블로커 아님**
- [ ] SQL 3종 적용 (스키마·RLS·트리거·GRANT) — dev 에 쓴 것과 동일 스크립트
- [ ] 🔴 적용 **직전** 프로덕션 스냅샷 (Supabase 대시보드 백업 or `pg_dump`)
- [ ] `_legacy` rename 은 삭제가 아님 — 데이터 보존·롤백 경로. **`drop` 금지** (→ 실데이터 이관 결론은 §2-A-1)
- [ ] 적용 후 `supabase db advisors` 통과 확인

#### A-1. 기존 실데이터 이관 — **하지 않는다** (2026-08-02 확정)

**결론: 자동 이관 경로가 원리적으로 없다.** 데이터 양이나 주인과 무관한 판단이다.

구 인증은 식별자가 **닉네임 문자열 하나뿐**이었다:

```ts
// origin/main:app/api/auth/route.ts (dev 에서 삭제됨)
.from('users').select(...).eq('nickname', nickname).maybeSingle();
if (existingUser) return { user: existingUser };   // 닉네임만 맞으면 그 계정
```

비밀번호도 토큰도 없다 — 이게 인증 MVP 가 없앤 **IDOR-1** 이다. 따라서:

- 어느 `auth.users.id`(익명 uuid / Google 연동)가 어느 닉네임의 주인인지 **알 방법이 없다**
- 사용자 신고("제가 `사용자_J8F5` 입니다")를 받아주는 매핑을 만들면 **방금 없앤 취약점을 되살리는 것**이다

**프로덕션 실사 (2026-08-02)**

| | 값 |
|---|---|
| users / sessions / messages | **845 / 1,821 / 5,838** (세션당 3.2개) |
| `auth.users` | **0** — 익명 로그인이 한 번도 쓰인 적 없음. 트리거 충돌·고아 `profiles` 없음 |
| 스토리지 | chat-docs 69개 234MB · chat-imgs 151개 86MB · chat-videos 4개 10MB (합 **330MB**) |

주간 추이 — 5월 271~455 → 6월 88~386 → 7월 8~185, **감소세**. 이번 주(7/27~) 32건.

**"users 845" 를 사람 수로 읽으면 안 된다.** 구 식별자 `사용자_XXXX` 는 localStorage 를 지울 때마다 새로 생긴다(`origin/main:src/hooks/useAuthSession.ts:29`). 한 사람이 캐시를 지운 횟수와 방문자 수가 구분되지 않는다.

**활동량이 개발 주기를 따라간다** (2026-08-02 대조):

| 그 주 DEV 로그 수 | 평균 메시지 |
|---|---|
| 6~7건 | **313** |
| 2~3건 | **89** |

특히 `2026-07-13` 주는 로그 3건인데 메시지가 **8건**뿐 — 그 주가 인증 작업(714·715·719)이라 **작업이 스테이징으로 옮겨간 주**다. 사용자도 최근 사용은 본인 테스트였다고 확인했다.

> **결론: 제3자 사용자에게 미칠 영향은 낮다. 다만 "전부 내 테스트"라고 단정할 근거도 없다.** 어느 쪽이든 되돌려줄 방법이 없으므로(위 IDOR 사유) 이관 결론은 바뀌지 않는다.

**사전 안내 — 하지 않는다**

사전 배너를 띄우려면 **main 에 배포를 두 번** 해야 한다(배너 → 컷오버). 그런데 ① 대상이 주당 3~4명(그마저 인원 확정 불가·대부분 본인 테스트) ② 안내를 봐도 **할 수 있는 게 없다**(이관 경로 없음, 수동 복사뿐) ③ 원자적 컷오버 원칙인데 배포를 하나 더 끼우면 창이 벌어진다.

**실패 모드가 온건하다는 점이 결정적이다** — 돌아온 사용자는 에러 화면이 아니라 **평범한 새 앱**을 본다(신규 사용자와 같은 빈 상태). 깨져 보이지 않는다.

- [ ] (선택) 컷오버와 **함께** 나가는 사후 안내 1회 — "로그인 방식이 변경되어 이전 대화는 표시되지 않습니다" + Google 로그인 유도. 추가 배포가 없고 사용자가 실제로 취할 행동으로 이어진다. **컷오버 blocker 아님**

**남기는 것**

- `users_legacy` · `chat_sessions_legacy` · `chat_messages_legacy` 보존. 나중에 본인 확인이 가능한 건이 생기면 **수동** 이관용.
- 적용 **직전** 스냅샷은 이와 별개로 필수(위 체크박스).

### B. Supabase 대시보드 토글 (프로덕션 프로젝트)
- [ ] **Anonymous Sign-ins 활성화**
- [ ] **Manual Linking 활성화** (`linkIdentity` 전제)
- [ ] **Google provider 등록** (Client ID/Secret)
- [ ] Auth → URL Configuration: Site URL + Redirect URLs 에 **`https://chat-gem.vercel.app`** 추가

### C. Google Cloud OAuth (`chat-agent-web` 클라이언트)
- [ ] **승인된 JavaScript 원본**에 `https://chat-gem.vercel.app` 추가
- [ ] **승인된 리디렉션 URI** = `https://gaomgqnpsjtabrvwnpad.supabase.co/auth/v1/callback` (프로덕션 ref — dev 의 stg ref 와 다름!)
- [ ] ⚠️ 동의 화면에 `*.supabase.co` 노출은 그대로 (Custom Domain 유료, post-MVP → §5)

### D. Storage 버킷 (프로덕션)
- [ ] 프로덕션에 `chat-imgs`·`chat-videos`·`chat-docs` **존재·규격 확인** (기존 앱이 이미 쓰므로 있을 가능성 높음 — dev 처럼 새로 만들 필요 없을 수 있음. **먼저 확인**)
- [ ] 없으면 `scripts/sql/auth-mvp-storage-buckets.sql` 로 생성

### E. Vercel env — **chat-agent(main) 프로젝트만**

`origin/main` 과 `dev` 의 `process.env.*` 참조를 전수 비교한 결과(2026-08-02):

| 구분 | 변수 | 비고 |
|---|---|---|
| 🆕 신규 필수 | `NEXT_PUBLIC_SUPABASE_URL` | `https://gaomgqnpsjtabrvwnpad.supabase.co` |
| 🆕 신규 필수 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **anon** 키 (service_role 아님) |
| 🆕 신규 선택 | `DISABLE_LLM_FOLLOWUP` | 개발용 A/B 스위치 — **프로덕션엔 넣지 않는다** |
| 삭제 | (없음) | |
| 개명 | (없음) | |

기존 19개는 그대로다. 특히 `SUPABASE_URL`·`SUPABASE_KEY` 는 [server/supabase.ts:7-10](../../server/supabase.ts#L7-L10) 이 여전히 읽으므로 **지우면 안 된다.**

#### E-0. 어느 DB 를 쓸 것인가 — **A안 확정** (2026-08-02)

| 안 | 내용 | 판단 |
|---|---|---|
| **A (채택)** | main 은 **프로덕션 `gaomgqnpsjtabrvwnpad`** 를 계속 쓴다. 거기에 `auth-mvp-*.sql` 적용 | dev(stg) 가 **스테이징으로 남는다** |
| B (기각) | main 을 **stg `ghdpnuwbvlrxmxcazzci`** 로 승격. SQL 적용·`_legacy` rename·롤백 전부 불필요 | **dev 와 main 이 같은 DB 를 공유** → 스테이징이 사라진다 |

B 는 "SQL 을 한 번도 안 돌려도 된다"는 점이 솔깃하다(stg 는 이미 15일째 검증됨). 그런데 대가가 **격리의 소멸**이다. 이번 인증 작업만 해도 stg 에서 스키마를 여러 번 갈아엎으며 잡았다 — 그 여유를 없애는 값으로는 비싸다. 부수적으로 프로덕션 스토리지 330MB 도 접근 불가가 되는데, 이건 §A-1 에서 결정한 "데이터 이관 안 함"과 **별개의 손실**이다(결정한 적 없다).

B 를 정말 하려면 dev 용 Supabase 를 새로 만들어야 하고, 그러면 "프로젝트 3개 + SQL 1회"라 A 보다 일이 는다.

> **A안의 귀결: main 의 Supabase 관련 변수 4개는 전부 `gaomgqnpsjtabrvwnpad` 를 가리켜야 한다.** 하나라도 stg 를 가리키면 아래 §E-1 사고가 된다.

#### E-1. 🔴 실제로 발생한 사고 — stg 값이 main 에 들어갔다 (2026-08-02)

`.env.local`(= **stg** `ghdpnuwbvlrxmxcazzci`)의 값을 main Vercel 에 그대로 등록했다. 실측:

```
main Vercel:
  SUPABASE_URL                   gaomgqnpsjtabrvwnpad   ← 프로덕션 (예전부터 있던 값)
  NEXT_PUBLIC_SUPABASE_URL       ghdpnuwbvlrxmxcazzci   ← 🔴 stg
  NEXT_PUBLIC_SUPABASE_ANON_KEY  role=anon      ref=ghdpnuwbvlrxmxcazzci   ← 🔴 stg
  SUPABASE_SERVICE_ROLE_KEY      role=service_role ref=ghdpnuwbvlrxmxcazzci ← 🔴 stg
```

**터지기 전에 잡혔다** — 마지막 프로덕션 배포(1h 전)가 env 등록(36m 전)보다 앞선다. Vercel 은 env 를 **배포 시점에 함수에 굽는다.** 고치기 전까지 **재배포 금지**(머지가 아니라 단순 redeploy 도 반영된다).

배포됐다면:
- `SUPABASE_SERVICE_ROLE_KEY` 는 **머지 전 현재 main 코드도 이미 읽는다**([server/supabase.ts](../../server/supabase.ts) · create-signed-url · parse-document). 프로덕션 URL + stg 서명 키 → 서명 불일치 → **파일 업로드·문서 파싱만 실패.** 채팅은 멀쩡해서 원인이 env 라는 걸 알아채기 어렵다.
- 머지 후엔 클라이언트와 `createRouteClient` 가 통째로 stg 를 본다 → 대화는 stg 에, 서버 일부는 프로덕션에.

**원인은 부주의가 아니라 구조다.** 프로젝트가 셋(로컬·dev·main)인데 **변수 이름이 전부 같아서**, 복사해 넣는 순간 출처 정보가 사라진다. 그래서 아래 대조 절차를 체크리스트에 넣는다.

#### E-2. 조치·검증 체크리스트

- [x] `NEXT_PUBLIC_*` 2개 등록 (2026-08-02) — 단, **stg 값이라 교체 필요**(§E-1)
- [ ] 🔴 `NEXT_PUBLIC_SUPABASE_URL` → `https://gaomgqnpsjtabrvwnpad.supabase.co` 로 **교체**
- [ ] 🔴 `NEXT_PUBLIC_SUPABASE_ANON_KEY` → 프로덕션 프로젝트의 **anon public** 키로 **교체**
- [ ] 🔴 `SUPABASE_SERVICE_ROLE_KEY` → **삭제**. 지우면 [server/supabase.ts:10](../../server/supabase.ts#L10) 폴백으로 `SUPABASE_KEY`(80일째 프로덕션에서 쓰던 값)를 쓴다 — dev 와 동일한, 검증된 경로다. 값 교체보다 삭제가 낫다.
- [ ] 스코프가 **Production** 인지 확인
- [ ] ⚠️ chat-agent-dev 와 로컬 `.env.local` 은 **손대지 않는다** — 거기선 stg 가 맞다

**대조 절차** — 값을 넣은 뒤 반드시 두 가지를 본다. Sensitive 로 등록하면 CLI 로 못 읽으므로 대시보드에서 확인한다.

```bash
# 1) URL 두 개의 ref 가 같은가
#    SUPABASE_URL 과 NEXT_PUBLIC_SUPABASE_URL → 둘 다 gaomgqnpsjtabrvwnpad

# 2) 키의 role·ref 디코드 (네트워크 안 탐)
echo '<붙여넣은_키>' | cut -d. -f2 | base64 -d 2>/dev/null | grep -oE '"(role|ref)":"[^"]*"'
#    NEXT_PUBLIC_SUPABASE_ANON_KEY → "role":"anon"  "ref":"gaomgqnpsjtabrvwnpad"
#    service_role 이 나오면 RLS 를 전부 우회하는 키를 브라우저 번들에 굽는 것이다
```

#### E-3. dev ↔ main env 전수 비교 (2026-08-02, `vercel env ls`)

차이는 **3개뿐이고 전부 main 에만 있다.** dev 에만 있는 변수는 0개 — 즉 이름 기준으로는 머지 준비가 끝나 있다.

| 변수 | main | dev | 조치 |
|---|:---:|:---:|---|
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | ❌ | **삭제**(§E-2). dev 는 없이도 폴백으로 15일 돌았다 |
| `VITE_SUPABASE_URL` | ✅ | ❌ | 삭제 → §5-2 |
| `VITE_SUPABASE_ANON_KEY` | ✅ | ❌ | 삭제 + rotate → §5-2 |

나머지 29개는 이름·스코프 동일. 사소한 차이: `LAW_OC` 가 main 은 Production 만, dev 는 Production+Preview. main 프리뷰에서 법령 조회가 안 되지만 §G 대로 머지 후 프리뷰는 어차피 깨지므로 방치한다.

#### E-4. 순서와 함정

**🔴 순서: env 교체 → 그다음 머지.** 값이 없거나 틀려도 **빌드는 통과한다.** [lib/supabase/client.ts:17](../../lib/supabase/client.ts#L17) 의 throw 는 `useAuthSession` 마운트 시점, 즉 런타임이다. 배포는 초록불인데 앱은 흰 화면이 된다.

**`NEXT_PUBLIC_` 은 빌드 타임에 번들로 구워진다.** 값을 고치면 저장만으로 반영되지 않고 **재배포**해야 한다.

### F. Vercel 함수 리전 — **chat-agent(main) 프로젝트** 🆕 dev 에서 얻은 교훈
- [ ] **Settings → Functions → Function Region = Seoul(icn1)** 단일 선택 + 재배포
- 🔴 **코드의 `preferredRegion='icn1'` 만으로는 무료(Hobby) 티어에서 안 먹힌다** (per-function 멀티리전은 Pro+ 전용, 조용히 무시). dev 에서 실증([DEV_260719 §4](../logs/2026/07/DEV_260719.md)·메모리 `vercel-free-tier-region`). **대시보드 단일 리전 설정이 유일한 수단.** 프로덕션 Supabase 도 서울이므로 동일 적용.
- [ ] 현재 main 프로젝트가 iad1 이면 900ms 왕복 그대로 — 이관 시 반드시 함께 처리

### G. Vercel 프리뷰 부작용
- [ ] chat-agent(main) 프로젝트가 dev·feat 브랜치를 **Preview 로 빌드**한다. 인증 머지 후 그 프리뷰들은 프로덕션 DB 로 돌아 스키마 불일치로 **깨진다**(프로덕션 자체는 안전, 프리뷰만). 무시하거나 해당 프리뷰 끄기.

---

## 3. 이관 후 검증 시나리오 (프로덕션)

[PLAN_AUTH_MVP_260709 §6](PLAN_AUTH_MVP_260709.md) 8종 + dev 에서 추가로 확인된 것:
- [ ] 1 게스트 생성·새로고침 유지
- [ ] 2 승계 (같은 uuid·대화 보존·이름/아바타 동기화)
- [ ] 3 크로스 디바이스
- [ ] 4·5 IDOR-2/1 (타 유저 행 0건)
- [ ] 6 401 (토큰 없이 호출)
- [ ] 7 충돌 (`identity_already_exists` → 기존 계정 로그인 안내)
- [ ] 8 회귀 (스트리밍·렌더러·제목생성)
- [ ] 🆕 **리전**: 프로덕션 로그에서 `Routed to Seoul (icn1)` 확인 (F 적용 확인)
- [ ] 🆕 **게스트 한도**: 6번째 메시지 403 `guest_limit_reached`(한도 5) → 로그인 후 해제

---

## 4. 롤백 계획

- SQL 은 `_legacy` **rename**(삭제 아님)이라 되돌리기 가능: 신규 테이블 drop → `*_legacy` 를 원래 이름으로 rename → main 을 인증 이전 커밋으로 재배포.
- 프로덕션 스냅샷(§2 A)이 최후 방어선.
- Vercel env·리전·대시보드 토글은 비파괴적 — 코드 롤백만으로 대부분 원복.

---

## 5. 이관과 **무관하게 남는** 미결 항목 (이관 blocker 아님)

- **🔴 Storage IDOR-3** — `upload`·`create-signed-url`·`parse-document` 가 무인증 + service-role + 공개 버킷. dev 에도 그대로 노출 중. **이관의 blocker 는 아니지만 프로덕션에선 노출면이 실사용자로 확대** → 이관 후 **최우선 보안 과제**. (근본해결: Bearer+RLS·유저별 prefix·private 버킷. [PLAN_AUTH_MVP §8](PLAN_AUTH_MVP_260709.md))
- **OAuth 동의 화면 도메인** — `*.supabase.co` 노출. **2026-08-01 정정: "Custom Domain(유료)만 가능"은 틀렸다.** → §5-1 참조.
- **테스트 스크립트 가드** — `STG===PROD` 상대 비교 가드는 절대 ref(`gaomgqnpsjtabrvwnpad` 아님) 확인으로 교체 권장 ([DEV_260719 §4-1](../logs/2026/07/DEV_260719.md)).
- **익명 유저 남용** — 쿠키 삭제마다 `auth.users` 행 생성·자동정리 없음. 프로덕션에선 지표 보고 CAPTCHA(Turnstile)·미전환 정리 잡 검토.
- **`server/supabase.ts` service_role export 정리** — `supabase` → `supabaseAdmin` 일원화 (MVP 이후).

### 5-1. OAuth 동의 화면에 `*.supabase.co` 대신 앱 이름 띄우기 (2026-08-01 추가)

**증상**: 로그인 시 `ghdpnuwbvlrxmxcazzci.supabase.co(으)로 이동` 이 표시된다.

**원인**: Google 은 기본적으로 **콜백 URL 의 루트 도메인**을 보여준다. Supabase 호스팅 인증에서 그 주소는 `https://<ref>.supabase.co/auth/v1/callback` 이고, 이 URI 가 승인된 리디렉션 URI 로 등록돼 있어야 로그인이 성립한다 — **지울 수 없다.** 앱이 보내는 `redirectTo`(localhost / vercel.app)는 Supabase 콜백 **이후** 단계라 Google 은 보지 못한다. 그래서 로컬·dev 어디서 눌러도 표시가 같다(2026-08-01 Edge/Chrome 교차 확인).

**선택지**

| | 방법 | 비용 | 코드 변경 |
|---|---|---|---|
| A | Supabase **Custom Domain** → 콜백이 `auth.<우리도메인>` 으로 바뀜 | 유료 부가기능 | 없음 |
| **B** | **Google Cloud 동의 화면 브랜딩 + 도메인 소유 확인** | 무료 | 없음 |
| C | GIS + `signInWithIdToken` (Google 이 우리 도메인만 봄) | 무료 | ❌ **채택 불가** |

> **C 를 배제한 이유**: `linkIdentity` 는 리디렉션 흐름 전용이다. 익명 게스트 → 정식 계정 승계(같은 uuid·대화 보존)가 이 API 위에 서 있어서, C 로 가면 인증 MVP 설계의 중심을 다시 짜야 한다.

**B 절차**

- [ ] ① Google **Search Console** 에서 도메인 소유 확인 (HTML 파일 업로드)
- [ ] ② 동의 화면 → **승인된 도메인**에 ①의 도메인 추가 ← **여기서 막히는지가 B 의 성패**
- [ ] ③ 브랜딩: 앱 이름 · 로고(120×120 이상) · **개인정보처리방침 URL** · **약관 URL**
- [ ] ④ 게시 상태 **테스트 → 프로덕션**
- [ ] ⑤ 반영 확인 (로고는 최대 24시간)

**착수 순서**: **②를 먼저 시도한다.** 자체 도메인이 없고 `chat-gem.vercel.app` 을 쓰는데, `vercel.app` 은 공개 접미사 목록에 있어 `chat-gem.vercel.app` 이 등록 가능 도메인으로 취급된다. 다만 Google 의 승인된 도메인 필드가 이를 받아주는지는 **넣어봐야 안다.** 거부되면 자체 도메인이 필요하고, 그러면 A 와 비용 구조가 비슷해진다. 5분이면 갈리므로 다른 준비보다 먼저 한다.

**③ 선결 조건은 해소됨(2026-08-01)** — `/privacy`·`/terms` 페이지를 만들었다(`app/privacy`·`app/terms`, 공용 골격 `app/legal/LegalPage.tsx`). 정적 프리렌더라 로그인 없이 열리고 심사 봇이 접근할 수 있다.
- [ ] 🔴 `app/legal/LegalPage.tsx` 의 `CONTACT_EMAIL` 을 **실제 주소로 교체** (현재 `CHANGE_ME@example.com`). Google 은 연락 가능한 곳을 요구한다.

**정황**: 같은 client_id 로 한때 `chat agent` 가 표시된 적이 있다(2026-08-01). 앱 이름은 이미 설정돼 있고 빠진 건 ②·④ 쪽일 가능성이 크다.

**판단**: 기능 문제가 아니라 **브랜딩 문제**다. 컷오버 blocker 가 아니며, 무료인 B 를 먼저 시도하고 안 되면 A 를 비용 판단으로 넘긴다.

근거: [Supabase — Login with Google](https://supabase.com/docs/guides/auth/social-login/auth-google) (커스텀 도메인 + 브랜드 검증 병행 권고, "브랜드 검증은 자동이 아니며 며칠 소요") · [supabase#33387](https://github.com/supabase/supabase/issues/33387)

### 5-2. Vercel env 청소 — 레거시·미사용 변수 (2026-08-02 추가)

§E-3 비교 중 발견. **컷오버 blocker 아님.**

| 변수 | 위치 | 근거 |
|---|---|---|
| 🔴 `VITE_SUPABASE_ANON_KEY` | main | 이름은 anon 인데 **실제 payload 는 `role=service_role`**, ref 는 프로덕션도 stg 도 아닌 **제3의 옛 프로젝트 `axpvmgndefueicehdetu`** |
| `VITE_SUPABASE_URL` | main | 위와 같은 옛 프로젝트 |
| `JINA_API_KEY` | main·dev | 두 브랜치 코드·문서 통틀어 참조 **0건** |
| `HOSPITAL_KEY` | main·dev | 코드는 `PHARM_KEY` 를 쓴다([hospital-tool.ts:7](../../server/agent/hospital-tool.ts#L7)). dev 브랜치 `.env.example` 에서는 이미 제거됨 |

`VITE_` 접두사는 **Vite 전용 규약**이라 Next.js 빌드는 읽지도 않는다. 전수 확인: `origin/main`·`dev` 모두 `VITE_` 참조 0건, `import.meta.env` 는 [PLAN_NEXTJS_MIGRATION](PLAN_NEXTJS_MIGRATION.md) 문서에만, `vite.config`·`index.html` 은 트래킹된 파일에 없음.

**🔴 순서: Supabase 에서 rotate 먼저, Vercel 에서 삭제 나중.** Vercel 에서 지워도 그 키가 무효화되지는 않는다 — Vite 시절 번들에 실려 나갔다면 이미 밖에 있고, 삭제는 그걸 되돌리지 못한다. 반대로 하면 "그 키가 뭐였는지" 추적할 단서가 사라진다.

- [ ] `axpvmgndefueicehdetu` 프로젝트가 아직 살아 있는지 확인 (빈 껍데기면 rotate 무의미)
- [ ] 살아 있으면 service_role 키 **rotate**
- [ ] main 에서 `VITE_SUPABASE_URL`·`VITE_SUPABASE_ANON_KEY` 삭제
- [ ] main·dev 에서 `JINA_API_KEY`·`HOSPITAL_KEY` 삭제

`MFDS_API_ENDPOINT` 는 같은 목록에 보이지만 **실제로 쓴다 — 남긴다.**

---

## 6. 요약 — 한 줄 판단

dev 는 "빈 DB·무사용자"라 순차로 편했지만, **main 은 라이브 프로덕션 DB 를 공유하므로 (1) 선행 외부설정을 미리 다 해두고 (2) SQL 적용 → main 배포를 최소 간격 원자 전환 (3) 리전 대시보드 설정을 잊지 말 것.** IDOR-3 는 이관을 막지 않되 직후 최우선으로 착수.

**2026-08-02 추가**: DB 선택은 **A안**(main = 프로덕션 `gaomgqnpsjtabrvwnpad`, stg 는 스테이징으로 존치) 확정 — §E-0. 현재 최우선 blocker 는 **§E-2 env 3개 교정**이며, 그 전까지 **main 재배포 금지**(§E-1).
