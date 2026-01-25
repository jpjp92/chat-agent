# 📝 Project TODO List

## 🚀 Priority Tasks (Future Roadmap)

### 1. 세션 내 문서 컨텍스트 영구 저장 (Persistence)
- [ ] **목표**: 현재 브라우저 메모리(React State)에만 저장되는 `lastActiveDoc` 정보를 새로고침 후에도 유지.
- [ ] **방법**:
    - Supabase `sessions` 테이블에 `last_active_doc` (JSONB 타입) 컬럼 추가.
    - 문서 업로드 또는 세션 전환 시 해당 컬럼을 DB에 업데이트 및 동기화.
    - 세션 로드 시 DB에서 추출된 텍스트 컨텍스트를 불러와 AI에게 즉시 제공.

### 2. 한글 HWPX 문서 분석 지원
- [x] **목표**: 국내 공공기관 등에서 많이 쓰이는 `.hwpx` 파일 직접 분석 지원.
- [x] **방법**:
    - `JSZip` 라이브러리를 활용하여 `.hwpx` 파일(ZIP 패키지) 압축 해제.
    - `Contents/section0.xml` 등 문서 내용이 담긴 XML 파일 추출.
    - XML 태그를 정제하여 순수 텍스트를 뽑아낸 뒤 Gemini API 컨텍스트로 전달.
    - (참고): `reference/hwpx-back-main` 내의 파싱 로직 활용.

### 3. 파워포인트(PPTX) 문서 분석 지원
- [ ] **목표**: 텍스트 위주의 PPTX 슬라이드 내용 분석 지원.
- [ ] **방법**:
    - `JSZip`을 활용한 직접 XML 파싱 또는 전문 파싱 라이브러리 검토.
    - 각 슬라이드 단위로 텍스트를 구조화하여 AI 컨텍스트로 전달.

## 🛠️ Minor Improvements
- [ ] CSV/XLSX 파싱 시 대용량 데이터에 대한 토큰 제한 처리 (Chunking).
- [ ] 지원하지 않는 파일 형식 업로드 시 사용자 친화적인 안내 강화.
- [ ] 다중 문서 업로드 및 동기 분석 지원.

---
*Created on: 2026-01-21*
