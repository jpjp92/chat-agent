# 📝 Project TODO List

## ✅ Recently Completed (2026-01-31)

### API & UI Resilience Improvements (2026-01-31) ✓
- ✅ **API Fallback Strategy**: `gemini-2.5-flash` 모델 쿼터 초과 시 `gemini-2.5-flash-lite`로 자동 전환되는 다중 모델 폴백 로직 구현.
- ✅ **출력 위생 처리 (Sanitization)**: Google Search Grounding 오작동으로 인한 무한 공백 생성(Hallucination) 방지 필터 구현.
- ✅ **표(Table) UI 고도화**: 긴 표에 대한 세로 스크롤(`max-h-500px`) 및 `<br>` 태그 자동 줄바꿈 처리로 가독성 개선.
- ✅ **프롬프트 최적화**: 표 헤더 간소화 및 응답 완결성 지침 추가로 답변 품질 및 안정성 강화.

### BioRenderer 3D 구조 시각화 UI/UX 개선 (2026-02-01) ✓
- ✅ **수직 정렬 최적화**: CSS 패딩 기반 레이아웃(`pt-32 pb-24`)으로 단백질 구조가 상하 배지 사이의 시각적 중앙에 정확히 배치되도록 개선.
- ✅ **초기 로딩 정렬 안정화**: 지연 실행(600ms, 1200ms) 이중 `autoView` 호출로 레이아웃 확정 후 정렬하여 초기 점프 현상 제거.
- ✅ **모바일 툴팁 UX**: 모바일 환경에서 잔기 정보 툴팁을 하단 고정 패널로 전환하여 터치 인터랙션 시 가독성 대폭 향상.
- ✅ **반응형 레이아웃**: 모바일(`min-h-[300px]`)과 데스크탑(`min-h-[350px]`) 각각 최적화된 최소 높이 적용.
- ✅ **카메라 조작 제거**: 복잡한 수동 `translate`/`zoom` 로직 제거하고 NGL 기본 `autoView`와 CSS만으로 안정적 정렬 구현.


### 시각화 모듈 다국어화 (Deep Localization) ✓
- ✅ **전역 다국어 연동**: Bio, Chemical, Chart 렌더러가 전역 언어 설정(KO, EN, ES, FR)에 맞춰 내부 라벨('Chain', 'Atomic', 'Structure' 등)을 자동 전환.
- ✅ **AI 응답 강제 고정**: 사용자가 다른 언어로 질문하더라도 설정된 언어로만 답변하도록 시스템 지침(System Instruction) 최적화 및 Gemini API 호출 구조 고도화.
- ✅ **로딩 상태 로컬라이제이션**: '분석 중...' 등 시각화 장치 로딩 문구를 다국어 대응.

### API 보안 및 관리 효율화 (2026-01-31) ✓
- ✅ **동적 API Key 로드**: `API_KEY*` 패턴의 모든 환경 변수를 자동으로 감지하고 로테이션하는 중앙 설정(`api/lib/config.ts`) 구현.
- ✅ **프론트엔드 보안 강화**: `vite.config.ts`에서 클라이언트로의 API Key 주입 제거 및 백엔드 전용 관리 체계 확립.
- ✅ **중복 코드 제거**: 여러 API 엔드포인트(`chat`, `speech`, `title`)에서 개별적으로 관리하던 키 로직을 하나로 통합.

### Bio-Viz 및 시각화 로직 안정화 ✓
- ✅ **WebGL 자원 관리**: NGL Stage 소멸 시 `.dispose()` 명시적 호출로 메모리 누수 방지 및 WebGL 컨텍스트 최적화.
- ✅ **PDB 뷰어 UI 정제**: 헤더의 불필요한 중복 라벨을 제거하고 툴팁 좌표 계산 방식을 개선하여 클리핑 현상 해결.
- ✅ **스냅샷 기능 개선**: 투명 배경 대신 화이트 배경 처리를 보강하여 외부 리포트 호환성 증대.

## ✅ Recently Completed (2026-01-30)

### 화학 및 생물 구조 시각화 고도화 ✓
- ✅ **화학 구조 모바일 뷰 최적화**: 긴 선형 분자가 모바일에서 너무 작게 보이는 문제를 해결하기 위해 최소 너비(`min-w`) 설정 및 가로 스크롤 지원.
- ✅ **버튼 레이블 단순화**: 모바일 가독성을 위해 'SMILES NOTATION' -> 'SMILES', 'COPY SMILES' -> 'COPY'로 텍스트 간소화.
- ✅ **몰입형 3D 레이아웃 (Bio-Viz)**: 테두리를 제거하고 플로팅 배지와 투명 헤더를 적용하여 현대적인 3D 뷰어 경험 제공.
- ✅ **프리미엄 커스텀 툴팁 (Bio-Viz)**: NGL 기본 툴팁 대신 글래스모피즘 디자인의 상호작용형 툴팁 구현.
- ✅ **데스크탑 렌더링 안정화**: `ResizeObserver`를 통한 화면 미출력 버그 해결.
- ✅ **호버 감지 및 잔기 정보 노출 정밀화**: `PickingProxy`와 `fixed` 포지셔닝 툴팁을 결합하여 가닥 위의 잔기 번호(#)를 실시간으로 정확히 추적.
- ✅ **거대 구조물 시각화 검증**: 코넥신(Connexin, 2ZW3) 등 12개 이상의 체인을 가진 거대 채널 단백질에 대한 안정적인 렌더링 및 분석 확인.

### 데이터 시각화 및 문서 렌더링 ✓
- ✅ **README 최신화**: Mermaid 아키텍처 다이어그램 및 신규 컴포넌트 구조 반영.
- ✅ **LaTeX 렌더링 최적화**: KaTeX CSS 연동, 모바일 가로 스크롤 지원, 인라인/블록 수식 스타일링 차별화.

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

### 2. 물리학 시뮬레이션 엔진 도입 (Phy-Viz) [NEW]
- [ ] **Phase 1: 2D 고전역학 (Matter.js)**
    - 충돌, 중력, 마찰, 탄성을 실시간 웹 캔버스에서 시뮬레이션.
    - 예: "공이 경사면에서 굴러가는 시뮬레이션 보여줘", "진자 운동 보여줘".
- [ ] **Phase 2: 수식 기반 그래프 및 벡터장 (Plotly/D3)**
    - LaTeX 수식 입력 -> JS 수치 해석 -> 동적 그래프 시각화.
    - 전자기장 벡터 필드, 파동 함수, 3D 표면 차트(Surface Plot) 구현.
- [ ] **Phase 3: 3D 강체/유체 시뮬레이션 (Three.js + Rapier)**
    - React Three Fiber(R3F) 기반의 고성능 3D 물리 엔진 탑재.
    - 입자 시스템(Particle System)을 활용한 유체/기체 시뮬레이션 실험.

### 2. Bio-Viz 상호작용 심화 (Advanced Interaction)
- [ ] **선택 부위 강조**: AI 응답 내용에 따라 특정 잔기(Residue)나 도메인을 3D 상에서 즉시 하이라이트/줌인 하는 링크 기능.
- [ ] **구조 비교 모드**: 두 개의 PDB 구조를 나란히 배치하거나 중첩(Superposition)하여 보여주는 기능.
- [ ] **애니메이션 제어**: 단백질의 유연성을 보여주는 궤적(Trajectory) 애니메이션 재생 컨트롤 추가.


---

## 🛠️ Minor Improvements

- [ ] CSV/XLSX 파싱 시 대용량 데이터 처리 (상위 N행 제한 및 요약 안내).
- [x] 지원하지 않는 파일 형식 업로드 시 사용자 친화적인 안내 강화 (Toast 메시지).
- [ ] 다중 문서 업로드 및 동기 분석 지원.
- [x] 코드 블록 및 시각화 결과물 내보내기 버튼 추가.
- [ ] 메시지 재생성 기능 추가.

---

## 🧹 Code Quality & Refactoring

- [ ] **App.tsx 컴포넌트 분리 (Refactoring)**
    - [ ] **LoadingScreen**: `isAuthLoading` 상태일 때 보여주는 로딩 UI (`LoadingScreen.tsx`) 컴포넌트화.
    - [ ] **WelcomeMessage**: 채팅 시작 전 웰컴 메시지 UI (`WelcomeMessage.tsx`) 컴포넌트화.
    - [ ] **ChatArea**: 실제 메시지가 렌더링되는 메인 영역 (`ChatArea.tsx`) 컴포넌트화하여 `App.tsx`의 복잡도 감소.
- [ ] **API Key 관리 및 보안 강화**
    - [x] `vite.config.ts`에서 하드코딩된 `API_KEY` 주입 제거 (프론트엔드 노출 방지).
  - [x] 백엔드(`api/*.ts`)에서 `process.env`를 이용한 동적 API Key 로드 및 로테이션 구현.
  - [x] Vercel 환경 변수 추가 시 코드 수정 없이 자동 반영되도록 개선.
- [ ] 불필요한 파일 정리 (`test-supabase.ts`, `metadata.json`).
- [ ] `reference/` 폴더 삭제 고려 (HWPX 구현 완료).
- [ ] ESLint/Prettier 설정 추가.
- [ ] 단위 테스트 작성 (Vitest).

---

*Last Updated: 2026-01-31 (v2.4)*
