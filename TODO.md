# 📝 Project TODO List

## ✅ Recently Completed (2026-01-25)

### 한글 HWPX 문서 분석 지원 ✓
- ✅ `JSZip` 라이브러리를 활용하여 `.hwpx` 파일(ZIP 패키지) 압축 해제
- ✅ `Contents/section*.xml` 파일에서 `<hp:t>` 태그 내 텍스트 추출
- ✅ HTML 엔티티 디코딩 및 Gemini API 컨텍스트 전달
- ✅ 드래그 앤 드롭 및 파일 선택 UI 지원

### Markdown 렌더링 개선 ✓
- ✅ 숫자 범위 표기(`1~10`) 시 취소선 오류 수정
- ✅ 정규식으로 `~` 기호를 HTML 엔티티(`&#126;`)로 치환하여 해결

### 문서화 개선 ✓
- ✅ README에 Mermaid 시스템 아키텍처 다이어그램 추가
- ✅ 프로젝트 구조 문서 업데이트 (JSZip 반영)
- ✅ 기능 설명에 HWPX 지원 명시

### 파워포인트(PPTX) 문서 분석 지원 ✓
- ✅ `JSZip`을 활용한 직접 XML 파싱 (`ppt/slides/slide*.xml`)
- ✅ `<a:t>` 태그에서 텍스트 추출 및 슬라이드별 구조화
- ✅ 텍스트 없는 PPTX 파일에 대한 예외 처리 (슬라이드 개수 + 안내 메시지)
- ✅ 드래그 앤 드롭 및 파일 선택 UI 지원 (주황색 PowerPoint 아이콘)

---

## 🚀 Priority Tasks (Future Roadmap)

### 1. 세션 내 문서 컨텍스트 영구 저장 (Persistence)
- [ ] **목표**: 현재 브라우저 메모리(React State)에만 저장되는 `lastActiveDoc` 정보를 새로고침 후에도 유지.
- [ ] **방법**:
    - Supabase `chat_sessions` 테이블에 `last_active_doc` (JSONB 타입) 컬럼 추가.
    - 문서 업로드 또는 세션 전환 시 해당 컬럼을 DB에 업데이트 및 동기화.
    - 세션 로드 시 DB에서 추출된 텍스트 컨텍스트를 불러와 AI에게 즉시 제공.

---

## 🛠️ Minor Improvements

- [ ] CSV/XLSX 파싱 시 대용량 데이터에 대한 토큰 제한 처리 (Chunking).
- [ ] 지원하지 않는 파일 형식 업로드 시 사용자 친화적인 안내 강화.
- [ ] 다중 문서 업로드 및 동기 분석 지원.
- [ ] 코드 블록 복사 버튼 추가 (ChatMessage 컴포넌트).
- [ ] 메시지 재생성 기능 추가.

---

## 🧹 Code Quality

- [ ] 불필요한 파일 정리 (`test-supabase.ts`, `metadata.json`).
- [ ] `reference/` 폴더 삭제 고려 (HWPX 구현 완료).
- [ ] ESLint/Prettier 설정 추가.
- [ ] 단위 테스트 작성 (Vitest).

---

*Last Updated: 2026-01-25*
