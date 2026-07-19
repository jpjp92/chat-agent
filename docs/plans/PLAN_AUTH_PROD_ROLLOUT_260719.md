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
- [ ] SQL 3종 적용 (스키마·RLS·트리거·GRANT) — dev 에 쓴 것과 동일 스크립트
- [ ] 🔴 적용 **직전** 프로덕션 스냅샷 (Supabase 대시보드 백업 or `pg_dump`)
- [ ] `_legacy` rename 은 삭제가 아님 — 데이터 보존·롤백 경로. **기존 실데이터 이관 여부 결정**(§0 MVP 노트: 대부분 자동생성 게스트라 미이관이 기본이나, **프로덕션에 실유저 대화가 있으면 재검토**)
- [ ] 적용 후 `supabase db advisors` 통과 확인

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
- [ ] `SUPABASE_URL`·`SUPABASE_KEY`(= **service role**) → 프로덕션 값 유지 확인
- [ ] `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY` **신규 추가** (프로덕션 값) — 인증 브랜치가 읽음, 빌드 타임에 구움
- [ ] 스코프 Production
- [ ] ⚠️ chat-agent-dev 는 손대지 않음 (이미 stg 로 완료)

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
- **OAuth 동의 화면 도메인** — `*.supabase.co` 노출은 Supabase **Custom Domain(유료)** 로만 앱 이름화 가능. AWS 마이그레이션·도메인 구매만으로는 불가(auth 서버 자체가 옮겨져야). post-MVP.
- **테스트 스크립트 가드** — `STG===PROD` 상대 비교 가드는 절대 ref(`gaomgqnpsjtabrvwnpad` 아님) 확인으로 교체 권장 ([DEV_260719 §4-1](../logs/2026/07/DEV_260719.md)).
- **익명 유저 남용** — 쿠키 삭제마다 `auth.users` 행 생성·자동정리 없음. 프로덕션에선 지표 보고 CAPTCHA(Turnstile)·미전환 정리 잡 검토.
- **`server/supabase.ts` service_role export 정리** — `supabase` → `supabaseAdmin` 일원화 (MVP 이후).

---

## 6. 요약 — 한 줄 판단

dev 는 "빈 DB·무사용자"라 순차로 편했지만, **main 은 라이브 프로덕션 DB 를 공유하므로 (1) 선행 외부설정을 미리 다 해두고 (2) SQL 적용 → main 배포를 최소 간격 원자 전환 (3) 리전 대시보드 설정을 잊지 말 것.** IDOR-3 는 이관을 막지 않되 직후 최우선으로 착수.
