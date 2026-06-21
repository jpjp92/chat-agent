# Upload & Document Parsing Guide

업로드 가능한 모든 파일 타입과 각 처리 경로(멀티모달 네이티브 vs 텍스트 추출) 레퍼런스. 첨부 → 추출/전달 → 모델 입력까지의 흐름과 한도·동작을 한 곳에 정리한다.

> 관련: kordoc HWP 연동 [`../logs/DEV_260621.md`](../logs/DEV_260621.md) §6·§7, 검증·설계 [`../logs/DEV_260620.md`](../logs/DEV_260620.md) §2, [`../plans/PLAN_KORDOC_INTEGRATION_260620.md`](../plans/PLAN_KORDOC_INTEGRATION_260620.md)
> 코드: 첨부 처리 [`components/ChatInput.tsx`](../../components/ChatInput.tsx) `processFile`, 서버 파싱 [`app/api/parse-document/route.ts`](../../app/api/parse-document/route.ts), 컨텍스트 주입 [`src/hooks/useChatStream.ts`](../../src/hooks/useChatStream.ts)

---

## 공통 제약

| 항목 | 값 | 위치 |
|---|---|---|
| 최대 첨부 개수 | **3** | `MAX_ATTACHMENTS` |
| 최대 파일 크기 | **100MB** (이미지·문서·영상 공통) | `MAX_FILE_SIZE` / `MAX_VIDEO_SIZE` |
| HWP 직행/Storage 임계값 | **4MB** (`INLINE_MAX`) | ChatInput `parseViaKordoc` |
| `accept` 속성 | `image/*, video/*, application/pdf, .docx, .xlsx, .txt, .md, .csv, .hwp, .hwpx, .hwp3, .hwpml, .pptx` | ChatInput |

> ⚠️ Vercel 함수 본문 한도 4.5MB — 텍스트 추출형은 추출 결과(텍스트)만 `webContent`로 전송하므로 영향 적음. 멀티모달(이미지/PDF)은 공개 URL(`storageUrl`) 우선, 인라인 base64는 압축/크기로 관리. HWP만 4MB 임계값으로 직행/Storage 분기.

---

## 두 가지 처리 경로

### A. 멀티모달 네이티브 (Gemini가 직접 인식)

바이너리/`fileData`로 모델에 그대로 전달 — 레이아웃·이미지·표를 모델이 본다. 텍스트 추출 안 함.

| 타입 | 처리 | 비고 |
|---|---|---|
| **이미지** (`image/*`) | 클라에서 최대 1920px·JPEG 85% 압축 후 `image_url` | GIF는 애니메이션 보존 위해 원본 유지 |
| **영상** (`video/*`) | 네이티브 비디오 파트 | YouTube는 URL 분석 경로(별도) |
| **PDF** (`application/pdf`) | 네이티브 멀티모달(`fileData` fileUri/base64) | **kordoc 경유 안 함** — 레이아웃·이미지 인식 손실(회귀) 방지. 30MB+ 가능 |

> 서버 `supportedMimeTypes`는 `audio/`도 멀티모달로 수용하나 `accept`에 없어 파일 선택기로는 노출 안 됨(백엔드 capable, UI 미노출).

### B. 텍스트 추출 (extractedText → `[EXTRACTED_CONTENT:]`)

추출 텍스트를 `webContent`에 `[EXTRACTED_CONTENT: 파일명]` 마커로 주입. 모델은 텍스트만 본다.

| 타입 | 추출 방식 | 위치 | 표 보존 |
|---|---|---|---|
| **HWP 4종** `.hwp/.hwpx/.hwp3/.hwpml` | **kordoc** → 구조 보존 마크다운(진짜 `<table>`) via `/api/parse-document` | **서버** | ✅ `<table>` (colspan/rowspan) |
| **XLSX** `.xlsx` | SheetJS → 마크다운 표(첫 시트) | 클라 | ✅ 마크다운 표 |
| **CSV** `.csv` | 줄/콤마 파싱 → 마크다운 표 | 클라 | ✅ 마크다운 표 |
| **DOCX** `.docx` | mammoth **`convertToHtml`** → `<table>` 보존 | 클라 | ✅ `<table>` (th/td) |
| **PPTX** `.pptx` | JSZip — `<a:tbl>`→마크다운 표 + 비표 텍스트(슬라이드별) | 클라 | ✅ 마크다운 표(병합 셀은 근사), 이미지 위주 슬라이드는 안내 문구 |
| **TXT/MD** `.txt/.md` | UTF-8 디코드(실패 시 EUC-KR 폴백) | 클라 | — |

---

## HWP 파싱 상세 (kordoc)

기존 `.hwpx`는 JSZip `<hp:t>` 텍스트만 추출해 셀 경계가 공백으로 뭉개졌고(표→평문), 구형 `.hwp`/`.hwp3`/`.hwpml`은 미지원이었다. kordoc은 `<th>/<td>`로 키-값을 보존 → 요약·표 질의 정확도 직결.

```
HWP 첨부 → ChatInput.parseViaKordoc(file)
  ├─ raw ≤ 4MB → [직행] POST /api/parse-document  (multipart raw, download hop 없음·55~62% 빠름)
  └─ raw > 4MB → POST /api/create-signed-url → Storage PUT → POST {filePath}
                    → 서버가 storage.download → kordoc.parse  (Vercel 4.5MB 우회)
  → { markdown, truncated, fileType, blockCount, tableCount, metadata }
  → extractedText → webContent [EXTRACTED_CONTENT:] → /api/chat
  실패 시(.hwpx 한정) → 기존 JSZip <hp:t> 폴백 (.hwp/.hwp3/.hwpml은 폴백 없음=원래 미지원)
```

- 라우트: `runtime=nodejs`, `preferredRegion=icn1`, `maxDuration=60`. `next.config.ts`에 `serverExternalPackages:['kordoc']`(webpack이 kordoc 내부 pdfjs worker 정적 import 번들하려다 빌드 실패 → 외부화).
- **길이 상한(L4)**: 마크다운 100,000자 초과 시 트렁케이트 + 안내(`truncated:true`). NIA 159K자 사례 대응.
- **보안**: `{filePath}`는 `^\d+_[a-z0-9._-]+\.(hwp|hwpx|hwp3|hwpml)$` 형식 검증(traversal 차단), 정리용 `remove()`는 IDOR(임의 삭제) 우려로 제거 → 고아 파일은 버킷 TTL 위임(백로그).

---

## PDF 처리 상세 (네이티브 멀티모달)

PDF는 **텍스트 추출(kordoc/mammoth) 경유 금지** — Gemini가 PDF를 직접 읽어 레이아웃·표·이미지·스캔본까지 인식한다(추출하면 회귀). `[EXTRACTED_CONTENT:]` 마커를 만들지 않으며, 멀티모달 경로로만 흐른다.

```
PDF 첨부 → ChatInput: base64 data URL로 읽기(압축·추출 없음)
  attachment = { data: base64, mimeType: 'application/pdf', extractedText: undefined }
  │
  └─ useChatStream 업로드 판정 (raw = base64 × 0.75)
       ├─ raw < 1MB  → 인라인 base64 유지 (Vercel 4.5MB 본문 우회 가능)
       └─ raw ≥ 1MB  → chat-docs 버킷 업로드 → data를 공개 URL로 교체
  │
  └─ /api/chat 전달:
       ├─ data=http(업로드됨) → fileData { fileUri, mimeType:'application/pdf' }  ← Gemini가 URL에서 직접 읽음
       └─ data=base64(인라인) → image_url { url:'data:application/pdf;base64,…' }
```

**핵심 동작**
- **크기**: 네이티브라 30MB+ 가능. **1MB 임계값**으로 인라인(base64)/Storage(공개 URL) 분기 — HWP의 4MB 임계값과는 별개(PDF는 base64라 임계값이 더 보수적).
- **검색 게이트**: PDF는 멀티모달이므로 `hasMultimodalContent=true` → Gemini API 제약상 Search 동시 사용 불가 → grounding 자동 off. (HWP/문서의 `[EXTRACTED_CONTENT:]` 게이트가 아니라 멀티모달 경로로 off — 결과는 동일)
- **멀티턴**: PDF는 `extractedText`가 없어 `[PREVIOUSLY_UPLOADED_DOCUMENT_CONTENT:]` 복원 대상이 아님. 대신 chat 라우트가 **최근 3턴**의 첨부를 history에 재전송(`fileData`/`image_url`)해 컨텍스트 유지, 그 이전 턴은 `[Attached File: 파일명]` 텍스트 마커로만 남음. → 긴 대화에서 PDF를 다시 참조하려면 재첨부 권장.
- **저장/표시**: 업로드된 PDF는 `chat-docs` 버킷 공개 URL(`getPublicUrl`)로 히스토리 미리보기 복원. (버킷 공개 특성은 보안 백로그의 인증/유저별 prefix 항목과 연계 — DEV_260621 §6)

> 비교: **표/키-값 추출이 목적**이면 HWP/XLSX/CSV(구조 보존)가 유리하고, **레이아웃·이미지·스캔 인식**이 목적이면 PDF 네이티브가 최선. 같은 한글 문서라도 .hwp는 kordoc(표 마크다운), .pdf는 멀티모달로 서로 다른 강점.

---

## 멀티턴 문서 컨텍스트

- 첫 턴 첨부: `[EXTRACTED_CONTENT: 파일명]`
- 후속 턴(첨부 없이 이전 문서 참조): 세션 `lastActiveDoc`에서 `[PREVIOUSLY_UPLOADED_DOCUMENT_CONTENT: 파일명]`로 복원, **30,000자 상한**(`MAX_DOC_CHARS`, 초과 시 `[CONTENT_TRUNCATED]`).
- 영상 후속 턴은 `[VIDEO_ANALYSIS_SUMMARY]`(1차 분석 결과 재사용).

---

## 첨부 문서 search-gate (grounding 기본 off)

첨부 문서가 답변 근거이므로, 문서가 있으면 **Google Search grounding 기본 비활성** → 문서 요약/검토에 불필요한 two-track 검색이 붙어 레이턴시·환각이 늘던 문제 해소.

- 트리거 마커: `[EXTRACTED_CONTENT:]`(현재 턴) / `[PREVIOUSLY_UPLOADED_DOCUMENT_CONTENT:]`(후속 턴)
- **예외(grounding on)**: 사용자가 **문서 외 추가 검증**을 명시 요청할 때 — `검색|찾아|조사|출처|근거|최신|최근|실시간|뉴스|latest|recent|search|source|cite`. `검토`/`정리`/`요약`은 매치 안 됨.
- 동작: 게이트 열림 → general 게이트(`needsSearch`)가 최종 판정. URL 게이트와 동일 철학. PDF는 멀티모달이라 `[EXTRACTED_CONTENT:]` 미생성 + 이미 grounding off → 충돌 없음.
- 구현: [`server/agent/nodes/generator.ts`](../../server/agent/nodes/generator.ts) renderer 게이트 직후. (DEV_260621 §7)

---

## 테스트 프롬프트

```
# HWP — 표 보존 요약
(정부 사업계획서.hwp 첨부) 문서 검토해줘
→ intent=general, "Doc content present ... suppressed", useGoogleSearch=false,
   단일 패스로 표·수치 보존 요약

# 문서 + 외부 검증 (grounding on)
(문서 첨부) 이 내용 최신 통계랑 비교해서 검색해줘
→ 게이트 열림 → needsSearch 판정 → grounding on

# XLSX/CSV — 표 인식
(데이터.xlsx 첨부) 이 표에서 매출 1위 항목 알려줘

# DOCX — 표 보존 (convertToHtml → <table>)
(버전 히스토리 표가 있는 보고서.docx 첨부) 표 내용 정리해줘

# PPTX — 표 보존 (<a:tbl> → 마크다운 표)
(표가 든 발표.pptx 첨부) 마지막 슬라이드 표 정리해줘
```

---

## Tips

- **표는 모든 텍스트 추출 포맷이 보존** — HWP(kordoc `<table>`)·DOCX(mammoth `convertToHtml` `<table>`)·XLSX/CSV(마크다운 표)·PPTX(`<a:tbl>`→마크다운 표). 단 **PPTX 병합 셀(gridSpan/rowSpan)은 마크다운 한계로 근사**(빈 셀 패딩)되므로, 병합이 많은 복잡한 표가 핵심이면 PDF(멀티모달)로 첨부하는 편이 정확.
- **PDF는 그대로** — 레이아웃·이미지·스캔 인식이 필요하면 PDF 네이티브가 최선(kordoc 경유 금지).
- **대용량 HWP(>4MB)** — 자동으로 Storage 경유. 최대 32MB도 왕복 ~4초로 `maxDuration=60` 여유.
- **search-gate** — 문서 요약 중 웹 결과가 섞이길 원하면 "검색/최신/출처" 같은 단어를 명시.
