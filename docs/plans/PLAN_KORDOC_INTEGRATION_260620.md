# kordoc 한글문서 파싱 연동 계획 — 2026-06-20

> 작성일: 2026-06-20
> 상태: **P1~P3 구현·E2E 검증 완료 (2026-06-21)**. 직행/Storage/트렁케이트/415/정리 전 경로 통과. 구현 기록: `docs/logs/DEV_260621.md` §6.
> 레퍼런스: `reference/kordoc/통합가이드.md`, `reference/kordoc/route.ts`, `reference/kordoc/kordoc-tester.html`
> 패키지: [`kordoc`](https://www.npmjs.com/package/kordoc) v3.1.1 — HWP3/HWP/HWPX/HWPML/PDF/XLS/XLSX/DOCX → Markdown

---

## 1. 목표 & 범위

한글(HWP) 계열 문서를 **구조 보존 마크다운**(진짜 표 포함)으로 추출해 모델 요약 정확도를 높인다.

| 포맷 | 현재 | 변경 후 | 결정 |
|---|---|---|---|
| `.hwpx` | `<hp:t>` 텍스트만 공백 join, 표·구조 소실 ([ChatInput.tsx:290](../../components/ChatInput.tsx#L290)) | kordoc 구조 보존(제목·문단·표·리스트) | **kordoc 경유** |
| `.hwp` (5.x 바이너리) | ❌ 미지원 | kordoc OLE2 파싱 | **kordoc 경유 (신규)** |
| `.hwp3` (1996~2002) | ❌ 미지원 | kordoc 지원 | **kordoc 경유 (신규)** |
| `.hwpml` | ❌ 미지원 | kordoc 지원 | **kordoc 경유 (신규)** |
| `.pdf` | Gemini 네이티브 멀티모달 직접 전달 ([ChatInput.tsx:408](../../components/ChatInput.tsx#L408)) | **변경 없음** | **현행 유지** (kordoc 경유 시 레이아웃·이미지 인식 손실 = 회귀) |
| `.docx` | mammoth `extractRawText` | **변경 없음** | 현행 유지 (충분) |
| `.xlsx` | XLSX → 마크다운 표 | **변경 없음** | 현행 유지 (충분) |

**스코프 확정:** HWP 계열 4종(`.hwpx`/`.hwp`/`.hwp3`/`.hwpml`)만 kordoc 경유. PDF·docx·xlsx는 현행 로직 유지.

---

## 1.5 검증 결과 (2026-06-20) — `scripts/test-kordoc.mjs`

실제 정부 사업계획서 4종(사용자 제공)으로 서버 파싱 검증 완료. **전부 파싱 성공, 표 구조 완벽 보존**(`<table>` + colspan/rowspan).

| 파일 | 포맷 | 원본 | base64 | 블록 | 표 | 마크다운 | 시간 |
|---|---|---|---|---|---|---|---|
| 문체부 연구개발계획서 | hwpx | 3.64MB | **4.98MB ⚠️** | 248 | 30 | 31,173자 | 784ms |
| 중기부 지원사업계획서 | hwp | 3.91MB | **5.35MB ⚠️** | 272 | 29 | 35,309자 | 162ms |
| 데이터바우처 계획서 | hwp | 1.71MB | 2.34MB ✅ | 151 | 22 | 11,626자 | 43ms |
| NIA 사업수행계획서 | hwp | 32.24MB | **44.17MB ⚠️** | 876 | 141 | 159,244자 | 581ms |

**핵심 발견:**
1. **파싱 품질·속도 우수** — `.hwp` 바이너리·`.hwpx` 모두 표/제목/리스트 보존, 32MB도 600ms 이내.
2. **🔴 전송 방식 재설계 필수** — 4개 중 **3개가 base64 변환 시 Vercel 4.5MB 본문 한도 초과**. 레퍼런스 가이드의 인라인 base64 POST(`{fileData}`)는 실제 정부 문서 대다수에서 413 실패. → **§3 전송 방식을 4MB 임계값 라우팅(직행 multipart + 대용량 Storage)으로 변경**.
3. **마크다운 토큰 예산 주의** — NIA 159K자 ≈ 5만 토큰+. 모델 컨텍스트 한도/비용 고려해 길이 상한·요약 전 트렁케이트 정책 필요(다운스트림).

### Storage 왕복 파이프라인 검증 — `scripts/test-kordoc-pipeline.mjs`

§3 전송 경로(signed URL 업로드 → 서버 download → kordoc → 정리)를 실제 Supabase(`chat-docs`)로 end-to-end 검증. **4종 전부 성공**, Vercel 4.5MB 한도 우회 확인.

| 파일 | 업로드 | 다운로드 | 파싱 | 왕복 합계 | 정리 |
|---|---|---|---|---|---|
| 문체부 (3.64MB) | 1099ms | 663ms | 359ms | 2210ms | ✅ |
| 중기부 (3.91MB) | 676ms | 803ms | 82ms | 1562ms | ✅ |
| 데이터바우처 (1.71MB) | 473ms | 761ms | 19ms | 1255ms | ✅ |
| NIA (32.24MB) | 1944ms | 1692ms | 371ms | **4008ms** | ✅ |

→ 최대 32MB도 왕복 4초로 `maxDuration=60` 충분. `createSignedUploadUrl`+`uploadToSignedUrl`+`download`+`remove` 전부 동작 확인. (이후 레이턴시 벤치로 일반 문서는 직행 multipart가 더 빠름이 드러나, 최종 설계는 §3 임계값 라우팅.)

### 기존 방식 vs kordoc 비교 — `scripts/test-kordoc-compare.mjs` (문체부 hwpx)

| 항목 | 기존(JSZip `<hp:t>`) | kordoc |
|---|---|---|
| 추출 글자수 | 25,007자 | 31,173자 (**+25%**) |
| 표 보존 | **없음(평문)** | 있음(30개, `<table>`) |
| 처리 시간 | 46ms | 351ms |

핵심은 글자수 +25%가 아니라 **셀 경계 소실**이다. 기존 방식은 `용어 및 약어 정의 에듀테크 교육... 데이터 레이블 ...`처럼 셀이 공백으로 뭉개져 모델이 "용어=정의" 쌍을 구분 못 함. kordoc은 `<th>`/`<td>`로 키-값이 명확 → 요약·표 질의 정확도 직결. 처리 시간 차(46→351ms)는 무시 가능.

### 전송 아키텍처 레이턴시 벤치 — `scripts/test-kordoc-latency.mjs` (runs=3 평균, 실측)

| 파일 | raw | A) Storage 경유 | B) 직행 multipart | 단축 |
|---|---|---|---|---|
| 데이터바우처 | 1.71MB | 1141ms | 442ms | 699ms (61%↓) |
| 문체부 | 3.64MB | 1623ms | 725ms | 898ms (55%↓) |
| 중기부 | 3.91MB | 1241ms | 472ms | 769ms (62%↓) |
| NIA | 32MB | 4084ms | N/A (raw>4.5MB) | — |

- 레이턴시 80~90%는 **네트워크(Storage 왕복)**, 파싱은 <10%. 줄일 대상은 전송 경로.
- **직행 multipart → download hop 제거로 55~62% 단축**. (벤치는 Vercel 한도 4.5MB로 가용성 표기; 실제 설계 임계값은 마진 둔 **4MB** — §3.)
- raw > 4MB(NIA 등)는 Storage 필수.
- 직행은 **multipart(raw) 채택** — base64는 raw ~3.3MB부터 한도 초과(가용범위 좁음)+인코딩 CPU.

---

## 2. 왜 서버 사이드인가

- chat-agent의 모든 API 라우트가 이미 `runtime = 'nodejs'` → kordoc 의존 `zlib`/`cfb`가 폴리필 없이 네이티브 동작.
- 클라 번들 미증가(브라우저용 kordoc은 ~480KB + pako/buffer 폴리필 필요).
- 기존 `/api/upload`가 `{ fileName, fileData(base64) }`를 받는 패턴과 동일 → 재사용.

---

## 3. 아키텍처 (검증 후 갱신 — 크기 임계값 라우팅)

> §1.5 레이턴시 벤치 근거. 레퍼런스 가이드의 인라인 base64 POST는 폐기(raw ~3.3MB부터 4.5MB 초과). **raw 크기로 분기**: 일반 문서는 직행 multipart(빠름), 대용량만 Storage 경유.

```
파일 첨부(.hwpx/.hwp/.hwp3/.hwpml)  ← processFile에서 "첨부 시점" 백그라운드 처리(응답 critical path 밖)
  │
  ├─ raw ≤ 4MB → [직행] POST /api/parse-document  (multipart/form-data, raw 바이너리)
  │                  → kordoc.parse  (55~62% 빠름, download hop 없음)
  │
  └─ raw > 4MB → [Storage 경유] POST /api/create-signed-url (chat-docs, 기존 라우트)
                    → 클라가 signedUrl로 Storage 직접 PUT  (Vercel 4.5MB 우회)
                    → POST /api/parse-document { filePath }
                    → 서버가 storage.download(filePath) → kordoc.parse → remove(정리)
  │
  → { markdown, fileType, blockCount, tableCount, metadata }
  → message.extractedText            [다운스트림 변경 없음]
  → /api/chat → 모델이 표·제목 인식하여 요약

  실패 시(.hwpx 한정) → 기존 JSZip <hp:t> 폴백
```

**임계값:** `INLINE_MAX = 4MB`. Vercel 함수 바디 한도는 4.5MB지만 multipart 오버헤드(폼 경계/헤더)+안전 마진 0.5MB 확보. 테스트 4종 중 NIA(32MB)만 Storage 경유, 나머지 직행.
**라우트는 두 입력을 모두 수용:** multipart 바디(직행) 또는 `{ filePath }`(Storage).

kordoc API 표면(테스터 실측 기준):
- `kordoc.detectFormat(arrayBuffer)` → 포맷 문자열
- `kordoc.parse(arrayBuffer)` → `{ success, error?, code?, markdown, fileType, blocks:[{type,...}], metadata:{title,...} }`
- `tableCount = blocks.filter(b => b.type === 'table').length`

---

## 3.5 레이턴시 최적화 레버 (종합)

전체 지연 = 전송(client↔server, ±Storage) + 파싱(<10%) + LLM 생성. 적용 순서대로:

| # | 레버 | 효과 | 위치 |
|---|---|---|---|
| L1 | **첨부 시점 백그라운드 파싱** | 2~4초를 응답 critical path 밖으로 → **체감 최대 절감** | P2 `processFile` |
| L2 | **4MB 직행 multipart** (download hop 제거) | 일반 문서 55~62%↓ | §3 / P1·P2 |
| L3 | **`preferredRegion = 'icn1'` 라우트 고정** | iad1 기본 시 태평양 횡단 + Storage leg 악화 방지. chat/showtimes와 동일 | **P1 (필수)** |
| L4 | **마크다운 길이 상한** | 大문서(NIA 159K자≈5만 토큰)의 `/api/chat` TTFT·생성 지연 절감 — 전송 최적화보다 큰 레버 | P3 |
| L5 | 응답 페이로드 최소화 (`markdown`+meta만, `blocks[]` 미반환) | 라우트→클라 전송량 | P1 |

> ⚠️ **벤치 지역성 주의:** §1.5 레이턴시 수치는 **로컬 WSL→Supabase** 측정. 프로덕션은 **Vercel(icn1)→Supabase**라 절대값 상이. Storage download leg는 icn1↔Supabase 거리에 좌우 → **Supabase 프로젝트 리전이 ap-northeast인지 검증 필요**(아니면 대용량 경로 지연 고착, L3 효과도 제한).

---

## 4. 구현 단계

### P0 — 서버 검증 ✅ 완료 (2026-06-20)
- [x] `npm i kordoc` (v3.1.1, package.json 등록)
- [x] `scripts/test-kordoc.mjs` — 라우트와 동일 경로(`parse`)로 파싱, 포맷/블록/표/길이/제목/마크다운 미리보기 출력
- [x] fixtures — `reference/kordoc/` 정부 문서 4종 (사용자 제공)
- [x] 4종 전부 `success=true` + 표 보존 확인 → §1.5 결과표. **전송 방식 재설계 필요 발견**.

### P1 — 서버 라우트 ✅ 완료 (2026-06-21)
- [x] `app/api/parse-document/route.ts` 추가
  - **수정점 ①: `SUPPORTED = ['.hwp', '.hwpx', '.hwp3', '.hwpml']`** (`.pdf`/docx/xlsx 제외 — native/현행 유지)
  - **수정점 ②: 입력 2종 수용** — ⓐ multipart/form-data raw 바이너리(직행, raw≤4MB) ⓑ `{ filePath }`(Storage download, 대용량). base64 인라인 미채택.
  - `runtime='nodejs'`, `maxDuration=60`, 동적 `import('kordoc')`. (Storage 경유 정리 `remove()`는 보안 리뷰로 제거 → P3 참고)
  - **`preferredRegion = 'icn1'` (L3)** 적용
  - 응답 `{ markdown, truncated, fileType, blockCount, tableCount, metadata }` — `blocks[]` 미반환(L5)
  - 🔴 **빌드 갭 발견·수정**: kordoc 번들링 시 webpack이 내부 `pdfjs-dist/legacy/build/pdf.worker.mjs`(PDF 경로용·미설치) 정적 import를 해석하려다 빌드 실패. `next.config.ts`에 `serverExternalPackages: ['kordoc']` 추가로 번들 제외(런타임 require는 정상).

### P2 — 클라이언트 연동 ✅ 완료 ([components/ChatInput.tsx](../../components/ChatInput.tsx))
- [x] `parseViaKordoc(file)` 헬퍼 — raw≤4MB(`INLINE_MAX`) multipart 직행, 초과는 `create-signed-url`→Storage PUT→`{filePath}` 분기
- [x] **첨부 시점 처리** — 기존 `processFile`가 이미 첨부 시점 추출(전송 critical path 밖). HWP 분기를 그 안에 통합.
- [x] `.hwpx` 분기를 HWP 4종 분기(`isHwpFile`)로 교체, kordoc 우선 + `.hwpx` 실패 시 JSZip 폴백(`.hwp`/`.hwp3`/`.hwpml`은 폴백 없음=원래 미지원, 회귀 아님)
- [x] `accept` 속성에 `.hwp,.hwp3,.hwpml` 추가
- [x] 드롭 허용목록 `isHwpFile`로 교체(4종 허용)
- [x] 첨부 아이콘 매핑 `isHwpFile`로 교체

### P3 — 가드 & 안정화 ✅ 완료
- [x] **마크다운 길이 상한 (L4)** — `MARKDOWN_MAX = 100_000`자. 초과 시 트렁케이트 + 안내 문구, `truncated:true`. NIA 159K→100K 검증.
- [x] **Supabase 리전 점검** — `cf-ray ...-ICN`(서울 엣지) 신호, gateway direct. origin 리전 확정은 대시보드 권장이나 ≤4MB 직행이라 영향 미미(블로커 아님).
- [x] `chat-docs` 고아 파일 방지 — **보안 리뷰 반영해 라우트 `remove()` 제거**(아래). 정리는 버킷 TTL/스케줄로 위임(잔여 백로그).
- [x] **🔴 보안 리뷰 대응 (IDOR)** — `{filePath}` Storage 경로가 service-role로 임의 HWP 파일 다운로드/삭제를 허용하던 문제. 무인증 앱이라 소유권 검증 불가 → ① `filePath`를 create-signed-url 산출 형식 `^\d+_[a-z0-9._-]+\.(hwp|hwpx|hwp3|hwpml)$`로 엄격 검증(traversal·타 객체 차단), ② **파괴 벡터인 route-side `remove()` 제거**. 근본 해결(앱 전역 인증 + 유저별 storage prefix)은 백로그.
- [x] `maxDuration=60` 유지 — 32MB도 왕복 4초로 여유.

---

## 5. 리스크 & 대응

| 리스크 | 영향 | 대응 |
|---|---|---|
| PDF를 kordoc 경유 시 멀티모달 인식 손실 | 회귀 | 라우트 `SUPPORTED`에서 `.pdf` 제거, 클라는 hwp 계열만 전송 |
| Vercel 4.5MB 본문 한도 (실측 3/4 초과) | base64 POST 413 | **§3 4MB 임계값 라우팅으로 해소** (직행 multipart + 대용량 create-signed-url 재사용) |
| 대형 마크다운(NIA 159K자) | 토큰 비용·컨텍스트 초과 | P3 길이 상한/트렁케이트 |
| 폴백은 `.hwpx`만 커버 | `.hwp`/`.hwp3` 실패 시 대안 없음 | 원래 미지원이라 회귀 아님 / 명확한 에러 메시지 |
| kordoc 신규 의존성 취약점 12건(7 mod·4 high) | 보안 | 점검 결과 12건은 전부 기존 의존성(ws/xlsx/uuid 등), **kordoc 의존성은 취약점 0건** |
| PDF 파싱(pdfjs-dist 37MB) | 번들/설치 부담 | 스코프 외 (PDF native) → 미설치. webpack 번들 시 kordoc 내부 pdfjs import 충돌 → `serverExternalPackages:['kordoc']`로 해결 |
| **🔴 IDOR — `{filePath}` 임의 파일 다운로드/삭제** (보안 리뷰) | service-role로 chat-docs 임의 HWP 유출·파괴 | ① filePath 형식 엄격 검증(traversal 차단) ② route-side `remove()` 제거. 근본 해결=앱 전역 인증+유저별 prefix(백로그) |

---

## 6. 검증 기준 (Success Criteria)

- `scripts/test-kordoc.mjs`: 4종 fixtures 전부 `success=true`, 표 포함 문서는 `tableCount ≥ 1`.
- `npm run build` ✓ (route 추가 후 라우트 수 13→14, 타입 오류 0).
- 실대화 플로우: `.hwp`/`.hwpx` 업로드 → 표가 마크다운으로 보존된 요약 응답.
- `.hwpx` kordoc 실패 강제 시 JSZip 폴백 동작.

---

## 7. 완료 후 정리

- 구현 기록은 `docs/logs/DEV_YYMMDD.md`에 기록.
- `docs/TODO.md` 백로그/데이터 섹션에 잔여 항목(크기 가드 고도화 등) 이관.
- 본 계획은 `docs/plans/PLAN_INDEX.md` Active Priorities에 등재.
