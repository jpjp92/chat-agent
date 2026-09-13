# 의존성 보안 업데이트 — Critical 2건 마감, 남은 High 는 전부 "안 쓰는 선택적 의존"

> 날짜: 2026-09-13 · 브랜치 `dev` · **미배포**
> 범위: `package.json`·`package-lock.json`. **앱 소스 코드 변경 0건**
> 검증: `npm run typecheck` 0 · `npm run build` 성공 · `npm test` **18종 통과** · kordoc 런타임 스모크

## 1. 결론

Dependabot 알림 **25건**을 의존성 트리와 실제 호출 지점에 대조하니 **원인은 5개**였다. 알림 수가 부풀어 보인 건 **같은 xmldom 취약점이 두 사본(0.8.x·0.9.x)에 각각 잡히기 때문**이다(#95/#79, #88/#81 처럼 쌍으로 뜨는 것).

| 결과 | 전 | 후 |
|---|---:|---:|
| Critical | 1 (알림 2건) | **0** |
| High | 15 | **12** |
| 합계 | 24 | 20 |

**High 12건은 숫자보다 성격이 중요하다 — 전부 `@huggingface/transformers` 하나에서 나온다**(§4).

## 2. 조치한 것

| 패키지 | 전 → 후 | 닫힌 알림 | 위험도 |
|---|---|---|---|
| `next` | 16.2.6 → **16.3.5** | **Critical 2** + High 4(SSRF 2·DoS·미들웨어 우회) + Moderate 5 | 마이너. 기존 `^16.2.6` 범위 안이었다 |
| `kordoc` | 3.1.1 → **4.13.1** | 서버 xmldom·sharp | **semver major** — §3 에서 계약 확인 |
| `@xmldom/xmldom` | 0.9.10 → **0.9.12** (kordoc) · 0.8.13 → **0.8.15** (mammoth) | xmldom High 전부 | 범위 내 |
| `onnxruntime-node` | 1.26.0 → **1.29.0** | adm-zip 0.5.17 → **0.6.1** | 범위 내 |

⚖️ **사전 분석에서 하나 틀렸다.** 검토 단계에서 *"mammoth 의 xmldom 0.8.13 은 업그레이드로 못 고친다 — 수정판이 0.9.12 뿐이고 mammoth 는 `^0.8.6` 을 못 박았다"* 고 적었는데, **0.8.x 라인에도 수정판 `0.8.15` 가 나와 있었다.** `npm update` 한 번에 풀렸고 `overrides` 도 breaking 위험도 필요 없었다. 📌 **권고안의 근거는 advisory 의 "fixed in" 한 줄이 아니라 해당 라인의 실제 릴리스 목록이어야 한다.**

### 2.1 Critical 2건의 실제 도달 가능성

고치긴 했지만 **둘 다 이 앱에서는 성립하지 않았다.** 기록해 둔다 — 다음에 같은 등급이 떴을 때 "Critical 이니 즉시 중단"으로 과반응하지 않기 위해서다.

- **#99 Windows RCE** — 배포는 Vercel(Linux), 개발은 WSL2(Linux). **해당 없음.**
- **#98 Image Optimization AVIF RCE** — `next/image` 사용처가 **코드 전체에 0건**이고 `next.config.ts` 에 `images` 설정이 없어 **외부 호스트가 기본 비허용**이다. `public/` 은 비어 있고 첨부는 전부 Supabase Storage(다른 오리진)라 `/_next/image?url=` 에 태울 AVIF 를 같은 오리진에 올릴 경로가 없다. 다만 **엔드포인트 자체는 살아 있다.**

🔴 **그래도 우선 올린 이유는 등급이 아니라 비용이다** — `^16.2.6` 이 이미 16.3.5 를 허용해 `package.json` 의미 변경 없이 끝나고, 같은 업그레이드가 **실제로 도달 가능한 High 4건**(Server Actions SSRF·rewrites SSRF·DoS)을 함께 닫는다. [PLAN_HARDENING §1](../../../plans/PLAN_HARDENING_260822.md) 표 #13 의 *"Next.js 16.2.11+ 로 올릴 것 — **미검증**"* 도 이걸로 해소된다.

## 3. kordoc major 업그레이드 — 계약을 먼저 고정하고 올렸다

`parse-document` 는 **공격자가 만든 파일이 우리 서버에서 파싱되는 이 앱의 유일한 경로**다(인증 라우트지만 익명 로그인이 열려 있어 사실상 도달 가능). 여기서 도는 xmldom 의 quadratic 파싱·메모리와 adm-zip 4GB 할당은 곧 함수 DoS라, **이번 업데이트에서 서버 위험이 실재하는 축은 이것 하나뿐이었다.**

major 라 [route.ts:38-60](../../../../app/api/parse-document/route.ts#L38) 이 의존하는 계약을 **올리기 전에 타입 정의로 박고** 확인했다:

| 확인 | 결과 |
|---|---|
| `parse(input, options?)` 시그니처 | 동일 |
| `ParseFailure`(`success:false`·`error`·`code`) | **완전 동일** |
| `ParseSuccess` | **가산 변경만** — `pages?: PageMarkdown[]` 추가, 나머지는 주석 |
| `FileType` 에 `hwp`·`hwpx`·`hwp3`·`hwpml` | 4종 모두 유지 |

타입만으로는 "빌드가 된다"까지만 말하므로 **런타임 스모크를 따로 돌렸다** — JSZip 으로 최소 HWPX(OCF zip + `section0.xml`)를 만들어 넣었다:

```
① 실패 경로  success = false | code = UNSUPPORTED_FORMAT   → 라우트 422 분기 성립
② HWPX 경로  success = true | fileType = hwpx | pageCount = 1
   markdown: "보안 업데이트 검증 문단"                      → 본문 추출 성립
```

### 3.1 ✅ 실제 `.hwp` 로 마저 검증했다 (같은 날 추가)

초판은 *"HWP 5.x 바이너리는 픽스처가 없어 미검증 — dev 배포 후 실제 첨부 1건이 남은 검증"* 으로 닫았는데, 실물(국토부 보도자료 `주간아파트가격동향`, **1.33MB**, HWP 5.x)을 받아 그 자리에서 끝냈다.

🔴 **"돌아간다"로는 부족하다 — 업그레이드의 질문은 "3.1.1 과 같은 결과를 내는가"다.** 그래서 **구버전을 격리 디렉터리에 따로 설치해 같은 파일을 양쪽으로 파싱하고 마크다운을 diff** 했다.

| | 3.1.1 | 4.13.1 |
|---|---|---|
| 결과 | success · `fileType=hwp` | 동일 |
| blocks / tables | 83 / 20 | **83 / 20 일치** |
| 마크다운 | 43,907자 · 521줄 | 43,919자 · **521줄 동일** |
| 파싱 | 171ms | 267ms |

**521줄 중 달라진 건 10줄이고 둘 다 개선이다.**

- ⓐ **원문자 번호가 복구됐다 — 3.1.1 이 내용을 흘리고 있었다.** `① 주간 아파트 매매가격 동향` 의 `①`·`②` 가 3.1.1 에서 **0개**, 4.13.1 에서 **2개**. 문서 목차 번호가 통째로 사라지고 있었다(모델이 "①번 항목" 질문을 받으면 근거가 없던 상태).
- ⓑ 줄머리 `*` → `\*` 이스케이프 8줄. 원문에선 각주 표시인데 마크다운이 불릿으로 해석하던 것이라 맞는 방향이다.

**손실 0건.** 표는 병합셀(`colspan`/`rowspan`) 14개가 HTML `<table>`, 단순표 12행이 파이프 — 두 버전 동일하다. 1.33MB 라 **직행 multipart 경로(≤4MB)** 까지 함께 확인됐다.

📌 **부수 확인** — 죽은 `<img src="image_001.bmp">` 가 이 문서 하나에 **14개**다([TODO §P1](../../../TODO.md) 의 "약 40개" 항목). **두 버전 모두 14개라 이번 업그레이드와 무관한 기존 문제**임이 확인됐다.

⚠️ 남은 것은 `.hwp3`·`.hwpml` 인데 둘 다 드문 형식이라 우선순위가 낮다.

점검은 [`tests/manual/check-kordoc-parse.mts`](../../../../tests/manual/check-kordoc-parse.mts) 로 남겼다 — **kordoc 을 직접 부르지 않고 라우트가 하는 순서**(확장자 게이트·4MB 라우팅 판정·`MARKDOWN_MAX` 트렁케이트·응답 필드 6종)를 재현한다. *라이브러리가 돌아가는 것과 우리 라우트가 답을 내는 것은 다른 주장이라서*다. 실제 문서는 `tests/manual/fixtures/`(gitignore)에 둔다.

## 4. 🔴 남은 High 12건 — 고칠 게 아니라 **지울 것**이다

전부 한 뿌리다.

```
kordoc 4.13.1
└─ @huggingface/transformers 4.2.0   ← optional. HIGH, range=*, 수정판 없음
   ├─ sharp 0.34.5                   ← 여기서만 구버전에 묶인다
   └─ onnxruntime-node 1.24.3
      └─ adm-zip 0.5.18
```

**kordoc 의 OCR 용 선택적 의존이고, 이 앱은 OCR 을 안 쓴다**(라우트가 받는 건 HWP 4종 텍스트뿐). kordoc 4 는 자기 직접 의존을 `sharp ^0.35.0`·`xmldom ^0.9.10` 으로 이미 올렸는데, **transformers 가 자기 하위에 옛 사본을 따로 들고 있어** 트리에 남았다.

⚖️ **`@huggingface/transformers` 는 `range=*`·`fixAvailable=false` 다 — 버전으로는 절대 안 닫힌다.** 닫는 방법은 **설치에서 빼는 것**(`omit=optional`)뿐인데, 그건 `next` 의 선택적 `sharp` 까지 함께 뺀다. `next/image` 사용처가 0건이라 무해해 **보일** 뿐 **Vercel 빌드 동작을 바꾸는 변경**이라 이번 범위에서 제외했다 → §6.

## 5. 고칠 수 없는 2건 — 둘 다 브라우저에서 돈다

| 알림 | 상태 | 왜 |
|---|---|---|
| `xlsx` #1·#2 (High, Direct) | ❌ **수정판이 존재하지 않는다** | SheetJS 가 npm 을 떠나 자체 CDN(0.20.x)으로 갔다. `npm audit` 도 `fixAvailable: false` |
| (해소됨) mammoth xmldom | ✅ 0.8.15 로 해결 | §2 의 ⚖️ 참조 |

🔴 **`xlsx` 는 등급이 시사하는 것보다 서비스 위험이 낮다** — [ChatInput.tsx:312](../../../../components/ChatInput.tsx#L312) 에서 **클라이언트 사이드**로 돈다. 사용자가 **자기 브라우저에서 자기가 고른 파일**을 파싱하는 것이라 prototype pollution·ReDoS 의 피해 범위가 자기 탭이다. 서버는 이 라이브러리를 안 쓴다. [TODO §P0](../../../TODO.md) 의 *"`xlsx` 대안 패키지 검토"* 가 맞는 판단이었고, **긴급도는 Direct·High 표시보다 낮다**는 근거를 여기 남긴다.

## 6. 부수 발견 — Next 16.3 이 `preferredRegion` 을 **deprecated** 로 경고하기 시작했다

빌드 로그:

```
⚠ The "preferredRegion" route segment config is deprecated.
```

⚖️ **[09-04 감사 §7-4](DEV_260904.md) 가 *"무효가 된 `preferredRegion` 5개를 지울지 결정"* 으로 열어둔 항목의 답이 프레임워크 쪽에서 왔다.** 그 export 는 무료(Hobby) 티어가 **이미 무시**하고 있어 실효가 없었는데([DEV_260609 정정](../06/DEV_260609.md)), 이제 **프레임워크도 폐기 예정이라고 말한다.** 제거 근거가 둘로 늘었다 — 다만 코드 변경이라 이번 의존성 작업에 섞지 않았다.

## 7. 남은 할 일

| # | 작업 | 우선순위 |
|---|---|---|
| ~~1~~ | ~~dev 배포 후 실제 `.hwp` 첨부 1건~~ — ✅ **같은 날 로컬에서 완료**(§3.1). 구버전 diff 로 회귀 0 확인. 남은 건 `.hwp3`·`.hwpml` 뿐이고 드문 형식이다 | 🟢 낮음 |
| 2 | `@huggingface/transformers` 계열 High 12건 — `omit=optional` 로 뺄지 결정. **Vercel 빌드 동작이 바뀌므로 별도 판단**(§4) | 🟡 중간 |
| 3 | `xlsx` 대안 — 서버 위험은 없으나 Direct 알림은 계속 뜬다(§5) | 🟡 중간 |
| 4 | `preferredRegion` 5개 제거 — 이제 근거가 둘(§6) | 🟢 낮음 |
| 5 | 나머지 Moderate·Low 8건(`hono`·`qs`·`postcss`·`brace-expansion` 등)은 빌드·개발 도구 체인 | 🟢 낮음 |

📌 **이번 작업은 코드 보안이 아니라 공급망 쪽이다. [PLAN_HARDENING §6](../../../plans/PLAN_HARDENING_260822.md#6-작업-순서) 의 1순위(`speech`·`summarize-title` 토큰 검증)는 그대로 남아 있고 이 업데이트가 그것을 대신하지 않는다.**
