# PLAN_SECURITY_REVIEW_261023 — 보안 재검토(10-23) 검증과 처리 계획

> 상태: **①~③ 처리·chat-agent-dev 검증 완료(2026-10-24) · ④ 남음** → [DEV_261024](../logs/2026/10/DEV_261024.md). 검증 2026-10-23. 이전 정리: [PLAN_HARDENING_260822](PLAN_HARDENING_260822.md) · 10-17 인증 계약 `f7b1181`([DEV_261017](../logs/2026/10/DEV_261017.md)).
> 원본: 웹에서 받은 외부 리뷰 `reference/SECURITY_REVIEW.md`(로컬 전용, `origin/dev` = `28e14ce` 기준). 이 문서는 그 지적을 **dev HEAD(`b85cd6a`)의 코드로 다시 확인**한 결과다. 10-23 의 라우터 커밋은 지적 대상 파일을 건드리지 않았다.

## 0. 요약

- 원본 10개 항목 중 **9개는 코드로 확인됐다.** 1개(#4 안의 `url_cache` 포이즈닝)는 과장이다 — §2.
- 10-17 `f7b1181` 이 무인증 라우트를 막아 공격 비용이 "무인증" → "익명 세션 하나"가 됐다. 익명 세션은 무료·자동 발급이라 **인증만으로는 비용·변조·DoS 가 멈추지 않는다**는 원본의 전제(§1)는 맞다.
- 가장 급한 것은 **약품 이미지 덮어쓰기(#1)** 다. 의료 앱에서 알약 식별 화면에 다른 사진이 뜨면 복약 오류로 이어진다. 같은 파일의 SSRF(#2)와 함께 고친다.

## 1. 항목별 검증 (dev HEAD 기준)

| # | 심각도 | 원본 지적 | 판정 | 코드 근거 |
|---|---|---|---|---|
| 1 | MEDIUM | `sync-drug-image` 약품 이미지 덮어쓰기 | ✅ 맞음 | `app/api/sync-drug-image/route.ts:71` 캐시 키 = 요청자 입력 URL + `drug_name` · `:349` `upsert: true` · `:90`·`:212` `application/octet-stream` 을 이미지와 동급 허용. Storage 는 service_role(`:15-20`) |
| 2 | MEDIUM | 같은 라우트 리다이렉트 SSRF | ✅ 맞음 | 생 `fetch` 7곳(`:87 :128 :188 :282 :292 :305 :316`), `safeFetch` 0곳. `isDrugImageHost` 는 최초 URL 만 본다. `:163` `og:image` 폴백은 HTML 에서 뽑은 임의 URL |
| 3 | MEDIUM | PDF 파싱 타임아웃이 실효 없음 + 크기 상한 없음 | ✅ 맞음(일부 완화) | `server/pdf-text-node.ts:24` `Promise.race` 는 진 쪽을 취소하지 않고, `lib/pdf-text.ts:17-20` 은 메인 스레드(fake worker)에서 파싱한다. `app/api/fetch-url/route.ts:260` `arrayBuffer()` 바이트 상한 없음. 완화: 다운로드는 10초 abort 가 본문 읽기에도 걸린다 |
| 4 | MEDIUM | 보조 라우트 3개 게스트 쿼터 없음 | ✅ 맞음 · 포이즈닝은 과장 | `fetch-url:153` · `sync-drug-image:31` · `showtimes:157` 모두 `requireProfile` 만. 비용 소진(ScrapingBee·browserless·OpenAI)은 실제 위험 |
| 5 | LOW~MED | `/api/client-log` | ✅ 맞음 | 레이트리밋 없음 · `clean()` 이 `[\r\n\t]` 만 제거(`:8`) · `src/lib/client-error.ts:19` 가 auth 스코프에서 응답 본문 원문 500자 전송 |
| 6 | LOW | `supabase` 기본 export 가 RLS 우회 | ✅ 맞음 | `server/supabase.ts:17`. 로컬 `SUPABASE_KEY` 의 JWT role 클레임이 `service_role`(값은 보지 않고 role 만 확인), `.env.example:25` 도 service_role 을 넣으라고 안내. 사용처: `fetch-url`·`sync-drug-image` |
| 7 | LOW | API 키 끝 6자리 로그 | ✅ 맞음 | `server/config.ts:61 :70 :78` |
| 8 | LOW | CGV HMAC 시크릿 하드코딩 | ✅ 맞음 | `app/api/showtimes/route.ts:95` (제3자 역공학 키) |
| 9 | LOW | `touch_session_on_message()` 소유권 술어 없음 | ✅ 맞음 · 현재 악용 불가 | `docs/guide/db/session-activity.sql:16-18`. `chat_messages` RLS `WITH CHECK` 와 `revoke execute` 가 막고 있다 |
| 10 | LOW | `xlsx` 타르볼 URL → Dependabot 이탈 | ✅ 맞음 | `package.json:53`. 락파일 integrity 로 고정돼 공급망은 막혀 있다 |
| 권고 9 | — | `test-route-auth` 를 CI 에 | ✅ 맞음 | `.github/workflows/auto-pr.yml` 은 검증을 돌리지 않는다. `npm run verify` 는 로컬 전용 |

## 2. 원본과 다르게 본 것

### 2-A. `url_cache` 포이즈닝은 성립하지 않는다

원본은 "캐시 히트 시 조작 본문이 LLM 컨텍스트로 주입(TTL 14일)"이라 했다. 코드를 보면:
- 캐시 키는 URL 에서 `#` 만 뗀 값이다(`fetch-url/route.ts:69-71`).
- 저장되는 본문은 **그 URL 에서 실제로 가져온 내용**이다(`setCached` 호출 5곳 모두 같은 `cacheKey` 의 fetch 결과).

공격자가 남의 URL 키에 다른 본문을 넣을 경로가 없다. 자기가 통제하는 URL 의 본문이 캐시되는 것은 정상 동작이다. 남는 틈은 "사용자마다 다른 본문을 주는 서버"가 첫 요청자의 본문으로 14일 고정되는 정도이고, 이건 변조가 아니라 캐시 정책 문제다. **#4 의 실제 위험은 비용 소진이다.**

### 2-B. #3 다운로드는 무한정이 아니다

`fetch-url:245-260` 의 `AbortController` 10초가 `arrayBuffer()` 읽기에도 걸린다. 다만 Vercel 대역폭이면 10초에 수백 MB 를 받을 수 있어 **바이트 상한은 여전히 필요하다.** 진짜 문제는 파싱 쪽(취소 불가 · 메인 스레드)이다.

## 3. 처리 계획

원본 권고 순서에 동의하되 같은 파일끼리 묶는다.

| 순서 | 묶음 | 항목 | 범위 | 운영 작업 |
|---|---|---|---|---|
| 1 ✅ | `sync-drug-image` 정리 | #1 · #2 | `upsert` 차단(신규만 생성) · 캐시 키에서 자유 문자열 `drug_name` 제거 또는 정규화 · octet-stream 대신 매직바이트 검사 · 생 `fetch` 7곳 → `safeFetch`(`og:image` 폴백 포함) | 없음 |
| 2 ✅ | 보조 라우트 게스트 쿼터 | #4 | `consume_tts_quota` 패턴(공급자 호출 **전** 원자 소비, RPC 실패 시 fail-closed). `requireProfile` 이 `isGuest` 를 이미 준다 | **SQL 함수 추가 — 운영 DB 적용은 사용자** |
| 3 ✅ | PDF 입력 상한 | #3 | Content-Length 선검사 + 스트리밍 바이트 상한(30MB). **파싱 취소·워커 분리는 재검토 대상**(아래 3-2) | 없음 |
| 4 | 작은 정리 | #5 · #7 · #8 · #9 · 권고 9 | client-log 제어문자 `[\x00-\x1f]` 전체 제거 + auth 스코프는 `code`/`status` 만 · 키 로그는 인덱스로 · `CGV_HMAC_SECRET` env 이전 · 세션 트리거에 `and user_id = (select auth.uid())` · CI 에 `npm run verify` | **CGV env 추가 · SQL 재적용 — 사용자** |
| 보류 | 키 네이밍 | #6 | `SUPABASE_KEY` → `SUPABASE_SERVICE_ROLE_KEY` 통일, 폴백 제거, `supabaseAdmin` 만 노출. env 이름이 바뀌어 운영 설정도 바뀐다 | Storage 보안 AWS 이전 결정(10-10, TODO P0)과 함께 |
| 보류 | 수동 추적 | #10 | TODO 에 `xlsx` 수동 확인 항목. Dependabot 이 못 잡는다 | — |

### 3-1. 처리 결과 (10-24)

- **1** — 계획대로. 캐시 키의 `drug_name` 은 빼지 않고 정규화만 했다(같은 URL 이 약 이름에 따라 다른 사진을 주는 ConnectDI 검색 경로가 있다). 덮어쓰기는 `upsert: false` 가 막는다. 기존 `octet-stream` 캐시 파일은 유지.
- **2** — `consume_aux_quota(kind)` 하나로 세 라우트. 게스트만 세고 **캐시 미스 뒤에만** 소비. 한도 20·60·20. SQL `docs/guide/db/aux-quota.sql` 운영 적용 완료.
- **3** — 상한 30MB(20MB 에서 상향). 초과 PDF 는 텍스트층 없이 `isPdf`, 그 외 413.

### 3-2. PDF 파싱 취소·워커 분리 — 재검토 (10-24)

상한으로 입력 크기는 막혔지만 `extractPdfTextOnServer` 의 8초 `Promise.race` 는 여전히 파싱을 멈추지 않고 메인 스레드에서 돈다. 다만 텍스트 추출이 20만 자에서 멈추고(`lib/pdf-text.ts`) 함수 `maxDuration` 이 120초라 실제 피해는 "한 요청이 느려진다" 수준이다. 고칠지·어떻게(worker_threads 로 분리해 terminate, 쪽수 상한, 서버 추출 자체를 없애고 첫 턴처럼 모델이 URL 을 읽게 하기)는 다시 정한다.

client-log 레이트리밋(#5 의 첫 번째)은 공개 라우트라 사용자 단위로 걸 수 없다. IP 기준 또는 Vercel Firewall 규칙 중 고른다 — 묶음 4 착수 때 정한다.

## 4. 유지할 것 (원본 §2 동의)

`requireProfile` 의 실제 토큰 검증(anon 키 Bearer 0행 → 401 포함) · `tests/test-route-auth.mts` 계약 테스트 · `server/drug-image-hosts.ts` 공용 허용목록 · `proxy-image` 공개 + 허용 호스트 · RLS `USING`/`WITH CHECK` · `is_guest`·`message_count` 컬럼 GRANT · `server/ssrf.ts` hop 별 재검사 · dev 페이지 production `notFound()` · `isEvalSupported: false`.
