# PLAN_SECURITY_REVIEW_261031 — 로컬 실행 검증(10-31)과 의존성 형상

> 상태: **검토 완료 · 수정 미착수**. 검토 2026-10-31, `dev` = `83e699d`(로컬 = `origin/dev`). 이전 회차: [PLAN_SECURITY_REVIEW_261023](PLAN_SECURITY_REVIEW_261023.md)(①~④ 10-24·10-25 완료) · [PLAN_HARDENING_260822](PLAN_HARDENING_260822.md).
> 원본: 외부 리뷰가 아니라 **로컬 레포에서 직접 수행**했다. 이전 회차는 클라우드 컨테이너라 코드 읽기만 가능했는데, 이번엔 `npm audit` · 인증 계약 하니스 · 락파일 대조를 **실제로 돌렸다.** 그래서 새 내용은 전부 애플리케이션 코드가 아니라 **의존성과 형상** 쪽이다.

## 0. 요약

- **애플리케이션 코드는 변동 없다.** 10-25 이후 두 커밋(`2a97162` 라우터·UI, `83e699d` 검색 OFF 규칙)은 보안 대상 파일을 건드리지 않았다. 10-23 회차의 ①~④ 수정이 현재 코드에 그대로 있다.
- **인증 계약 하니스를 실제로 돌려 16/16 통과**를 확인했다. 그동안은 코드만 읽고 추정했다.
- 신규 3건은 전부 의존성·형상이다 — ① `node_modules` 가 락파일보다 낡아 **로컬이 취약한 `xlsx` 0.18.5 로 돈다**(§2-1) ② 런타임 HIGH 4건 중 **실제 도달 가능한 것은 `zod` 하나**(§2-2) ③ `kordoc` 이 MCP SDK·Express 를 프로덕션 트리로 끌어온다(§2-3).
- **KaTeX 판정을 정정한다**(§3) — 현재는 "직접 벡터 없음 + 심층 방어 한 겹 얇음" 이다. 10-25 의 ~~"닫혀 있다"~~ 는 과했고, 권고가 그 근거였던 전제를 겨냥한다.

## 1. 실행 검증 (이번 회차에서 처음)

| 검증 | 명령 | 결과 |
|---|---|---|
| 인증 계약 | `npx tsx tests/test-route-auth.mts` | **16/16 통과** — 11개 라우트 중 9개 토큰 실검증, 2개(`client-log`·`proxy-image`)는 공개 허용목록 |
| 시크릿 유출 | `git ls-files` · `git log --diff-filter=A` | `.env`·`.env.local` **미추적**, git 이력에 들어간 적 **없음**(`.gitignore:17-21`) |
| 의존성 | `npm audit` | 전체 30건(high 4·moderate 22·low 4) · **런타임 13건**(high 4·moderate 5·low 4) |
| 형상 일치 | 락파일 ↔ `node_modules` 대조 | **불일치 4건** → §2-1 |

`middleware.ts` 가 없어 인증을 라우트마다 적는 구조인데, 그 누락을 하니스가 실제로 잡는다는 것을 확인했다. 10-17 `f7b1181` 의 계약 테스트가 의도대로 동작한다 → [DEV_261017](../logs/2026/10/DEV_261017.md).

## 2. 신규 발견

### 2-1. 🔴 `node_modules` 가 락파일보다 낡았다

```
패키지          락파일     설치본
xlsx           0.20.3  →  0.18.5   ← 취약 버전
next           16.4.2  →  16.3.5
katex          0.16.47 →  0.16.28
body-parser    2.3.0   →  2.2.2
```

의존성 보안 커밋 이후 `npm ci` 가 실행되지 않았다. **가장 문제는 `xlsx` 다** — `da6fe6d`(10-16)가 프로토타입 오염(CVE-2023-30533)·ReDoS(CVE-2024-22363)를 닫으려고 0.18.5 → 0.20.3 으로 올렸는데 로컬에는 여전히 취약한 0.18.5 가 깔려 있다.

- **프로덕션은 영향 없다** — Vercel·CI 모두 `npm ci` 로 락파일을 쓴다(`.github/workflows/verify.yml`).
- **로컬 개발이 다른 트리에서 돈다.** `xlsx` 는 `components/ChatInput.tsx` 의 클라이언트 사이드 전용이라(사용자가 자기 브라우저에서 자기 파일을 파싱) 실제 위험은 낮지만, `npm run dev` 로 하는 모든 확인이 프로덕션과 어긋난 버전에서 이뤄진다. 로컬 `npm audit` 결과도 마찬가지다.

**조치: `npm ci` 한 번.** 비용이 없고 형상을 맞춘다.

### 2-2. 🟡 런타임 HIGH 4건 중 도달 가능한 것은 1건

`npm audit` 숫자만 보면 급해 보이지만, 락파일에서 역의존을 추적하고 우리 호출 지점과 대조하면 대부분 도달 불가다.

| 패키지 | 등급 | 유입 경로 | 도달 가능? |
|---|---|---|---|
| **`zod` 4.3.6** | HIGH | ROOT(prod) · `@langchain/core` · `@langchain/langgraph` · MCP SDK · `kordoc` | ✅ **가능** |
| `kordoc` 4.13.1 | HIGH | 직접 의존 | `zod` **상속만** — 자체 권고 없음 |
| `markdown-it` 14.3.2 | HIGH | `kordoc` → `src/print/renderer.ts` 의 `renderHtml()` | ❌ 우리는 `parse()` 만 부른다 |
| `body-parser` 2.3.0 | HIGH | `kordoc` → `@modelcontextprotocol/sdk` → `express` | ❌ express 서버를 띄우지 않는다 |
| `fast-uri` 3.1.2 | moderate | `kordoc` → MCP SDK → `ajv` | ❌ 같은 이유 |
| `gaxios` 7.1.3 | moderate | `rimraf` **상속** | 자체 권고 아님 |
| `glob`·`minimatch`·`rimraf` | moderate | 빌드 툴체인 | ❌ 런타임 경로 아님 |
| `katex` 0.16.28 | low | ROOT(prod) → `rehype-katex` | ⚠️ 영향 범위 내 → §3 |

근거:

- **`markdown-it`** — `kordoc/dist/index.js:32703-32744` 에서 `src/print/renderer.ts` 가 `new MarkdownIt(...)` 후 `md.render(markdown)` 을 부른다. **markdown → HTML 방향**이고 `renderHtml`·`markdownToPdf`·`markdownToHwpx` export 로만 닿는다. 우리 코드는 `app/api/parse-document/route.ts:36` 의 `const { parse } = await import('kordoc')` 가 전부다 — **HWP → markdown 방향만 쓴다.** HIGH 권고(multi-line link reference definition 의 2차 시간 렌더링)는 markdown 을 **파싱**할 때의 문제라 이 경로에 없다.
- **`body-parser`·`fast-uri`** — `kordoc` 이 `@modelcontextprotocol/sdk` 를 의존하고 그게 `express` 와 `ajv` 를 끌어온다. 우리 코드에 `express`·`markdown-it` 직접 import 는 **0건**이다. Next.js 앱이라 express 서버가 뜨지 않으므로 HTTP 본문 파서 DoS 가 닿을 입구가 없다.

**`zod` 만 실제 조치가 필요하다.** LangChain 도구 스키마가 **LLM 이 생성한 도구 인자**를 검증하고(`zod-to-json-schema` 경유) `kordoc` 도 내부적으로 쓴다. 권고는 "oversized constrained collections 검증 중 메모리 고갈"이라 함수 메모리 DoS 로 이어진다. `>=4.6.6` 으로 올리면 `zod` 와 `kordoc`(상속) 두 건이 함께 해소된다. `fixAvailable: true`.

### 2-3. 🟡 `kordoc` 이 MCP SDK·Express 를 프로덕션 트리로 끌어온다

위 표의 구조적 원인이다. HWP 파싱 하나 때문에 `@modelcontextprotocol/sdk` → `express` → `body-parser`, `ajv` → `fast-uri` 가 프로덕션 의존성에 들어온다(`kordoc` 의 `dev: false`).

도달 불가라 당장 위험은 아니지만 **`npm audit` 노이즈의 근원**이다 — 런타임 HIGH 4건 중 3건이 여기서 나온다. 노이즈가 많으면 진짜 신호를 놓친다. `kordoc` 상위 버전이 MCP SDK 를 optional 로 돌렸는지 확인할 가치가 있다(현재 `^1.29.0` 을 `dependencies` 로 선언).

## 3. 10-25 회차 결론 정정 — KaTeX

10-25 에 ~~"KaTeX 경유 XSS 는 닫혀 있다"~~ 고 적었다(옛 결론). 근거는 `rehype-katex` 에 옵션을 주지 않아 KaTeX 기본값 `trust: false` 가 적용된다는 것이었다. `npm audit` 이 그 전제를 겨냥하는 권고를 가리킨다:

```
[low] katex  direct=true  installed=0.16.28 (lock 0.16.47)
  KaTeX: Existing prototype pollution can bypass trust restrictions
  GHSA-238p-pmpm-9mq7   영향 >=0.11.0 <0.18.2   fix katex 0.19.1 (semver major)
```

설치본과 락파일 **둘 다 영향 범위 안**이다. 정확한 현재 평가:

- **직접적인 XSS 벡터는 여전히 없다.** `dangerouslySetInnerHTML`·`.innerHTML`·`rehype-raw` 사용 0건이고(`components/ChatMessage.tsx:556` 의 "rehypeRaw 가 없어…" 주석이 부재를 확인한다), `react-markdown` 은 raw HTML 을 이스케이프한다.
- 다만 **심층 방어 한 겹이 약해졌다.** 이 렌더 경로에는 `fetch-url`·웹 검색을 거친 **공격자 영향권 텍스트가 LLM 출력으로 섞여 들어온다.** 프로토타입 오염 싱크가 생기면 `$$\href{javascript:…}{x}$$` 가 살아난다. 등급이 low 인 이유는 그 선행 조건 때문이고, 현재 싱크는 확인되지 않았다.

🔴 **수정이 까다롭다** — `npm audit` 이 제안하는 `rehype-katex 1.2.0` 은 현재 7.0.1 에서의 **다운그레이드라 잘못된 제안**이다. 올바른 경로는 `katex 0.19.x` + 그것을 peer 로 받는 `rehype-katex` 버전 확인이며 semver-major 라 수동 처리해야 한다.

## 4. 처리 계획

| 순서 | 항목 | 근거 | 내용 | 사용자 작업 |
|---|---|---|---|---|
| 1 | `npm ci` | §2-1 | 로컬이 취약한 `xlsx` 0.18.5·`next` 16.3.5 로 돈다. 형상을 맞추면 이후 `npm audit` 결과도 신뢰할 수 있다 | 없음 |
| 2 | `zod` → `>=4.6.6` | §2-2 | 실제 도달 가능한 유일한 런타임 HIGH. 한 번의 bump 으로 `zod`·`kordoc`(상속) 2건 해소 | 없음 |
| 3 | KaTeX trust 우회 | §3 | semver-major 라 수동. **`audit fix` 의 `rehype-katex 1.2.0` 제안은 다운그레이드라 따르면 안 된다** | 없음 |
| 4 | 상한·쿼터 발동 로그 | §5 | 통제는 있는데 발동이 프로덕션 로그에 안 남는다. `removeConsole` 의 `exclude: ['error','warn']` 한 줄로도 해결 | 없음 |
| 5 | `kordoc` 의존성 확인 | §2-3 | 상위 버전이 MCP SDK 를 optional 로 돌렸는지. audit 노이즈 3건의 근원 | 없음 |

보류 항목(client-log 레이트리밋 · PDF 파싱 취소 · `SUPABASE_KEY` 네이밍 · `xlsx` 수동 추적)은 [PLAN_SECURITY_REVIEW_261023 §3](PLAN_SECURITY_REVIEW_261023.md) 과 [TODO](../TODO.md) 의 순서를 그대로 따른다. 현재 코드에서 넷 다 그대로임을 확인했다.

## 5. 관찰 — 통제는 있는데 발동이 조용하다

취약점은 아니지만 탐지 공백이다. 10-25 에 제기했고 현재도 그대로다.

`next.config.ts` 의 `removeConsole: { exclude: ['error'] }` 가 프로덕션에서 `log/info/debug/warn` 을 제거한다. **서버 코드에도 적용된다**(주석이 명시). 그런데 10-24 에 들어온 통제의 발동 신호가 `console.warn` 이다:

```
app/api/fetch-url/route.ts:295   console.warn('[fetch-url] PDF over byte cap — skipping text layer', …)
app/api/fetch-url/route.ts:298   console.warn('[fetch-url] body over byte cap', …)
server/config.ts:64              console.warn('[Config] API key … rate-limited (RPM)')
```

30MB 상한에 걸린 요청은 **비정상 입력 신호**인데 프로덕션 로그에도 DB 에도 기록이 없다. 쿼터 초과도 `server/aux-quota.ts` 의 `reason === 'quota'` 경로가 429 를 반환하면서 `console.*` 을 전혀 부르지 않는다 — 다만 이쪽은 `aux_usage` 행이 남아 쿼리로 확인되고 TODO 4순위가 이미 집계다.

**완전 실명은 아니다** — 비용 공격의 핵심 신호인 공급자 401/402/429(`app/api/fetch-url/route.ts:53` `logProviderAuthFailure`)는 `console.error` 라 남는다. 문제는 **새로 추가한 통제가 걸려도 언제 걸렸는지 알 수 없다**는 점이다. 원래 의도가 "브라우저 콘솔 노출 최소화"이고 주석도 "대부분 서버 진단 로그"라 적었으니 `warn` 보존은 의도와 충돌하지 않는다.

### CSP — 사실상 부재 (LOW, 심층 방어)

`next.config.ts` 의 CSP 는 `frame-src`·`object-src`·`base-uri` 뿐이고 `default-src`·`script-src`·`style-src`·`img-src`·`connect-src` 가 없다. 활성 XSS 경로는 없으니 즉각적 구멍은 아니지만 **생기면 담아낼 것이 없다.** §3 의 KaTeX trust 우회와 `xlsx` CDN 타르볼 의존성을 감안하면 2차 방어로서 가치가 있다. [TODO](../TODO.md) 에 "번들 최적화(자체 호스팅) 완료 후 연계"로 추적 중 — 엄격한 `script-src` 가 CDN 스크립트를 깨뜨리므로 순서 의존은 타당하다.

그 외 헤더는 견고하다 — `nosniff` · `X-Frame-Options: SAMEORIGIN` · `strict-origin-when-cross-origin` · HSTS 2년+`includeSubDomains` · `Permissions-Policy` 로 카메라·마이크·위치 차단.

## 6. 유지할 것

10-23 회차 §4 에 더해, 이번에 실행으로 확인한 것:

- **`tests/test-route-auth.mts` + `tests/run-all.mts` 자동 수집 + CI** — 인증 계약이 테스트로 강제된다. 이번에 **실제로 돌려 16/16 통과**. `middleware.ts` 부재에 대한 유효한 대안이다.
- **`.gitignore` env 규칙** — `.env`·`.env.local` 이 한 번도 커밋되지 않았음을 git 이력으로 확인.
- **`npm ci` 기반 CI** — 프로덕션이 로컬 형상 드리프트의 영향을 받지 않는 이유다(§2-1).
- 그리고 10-23 §4 그대로: `requireProfile` 의 실제 토큰 검증 · `server/drug-image-hosts.ts` 공용 허용목록 · `aux-quota.sql` 의 원자 판정과 fail-closed · `sniffImageType` + `upsert: false` · `readCapped` 의 선언값·스트림 이중 검사 · `server/ssrf.ts` hop 별 재검사 · RLS `USING`/`WITH CHECK` · `is_guest`·`message_count` 컬럼 GRANT · dev 페이지 production `notFound()` · `isEvalSupported: false`.
