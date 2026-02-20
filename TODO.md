# 📝 Project TODO List

##  Priority Tasks (Future Roadmap)

### 🔥 High Priority (Core UX Improvements)

#### 1. 세션 내 문서 컨텍스트 영구 저장 (Persistence) 
- [ ] **목표**: 현재 브라우저 메모리(React State)에만 저장되는 `lastActiveDoc` 정보를 새로고침 후에도 유지.
- [ ] **방법**:
    - Supabase `chat_sessions` 테이블에 `last_active_doc` (JSONB 타입) 컬럼 추가.
    - 문서 업로드 또는 세션 전환 시 해당 컬럼을 DB에 업데이트 및 동기화.
    - 세션 로드 시 DB에서 추출된 텍스트 컨텍스트를 불러와 AI에게 즉시 제공.
- [ ] **예상 효과**: 사용자가 새로고침 후에도 문서 컨텍스트를 유지하여 대화 연속성 향상.

#### 2. 메시지 재생성 기능 (Regenerate Message)
- [ ] **목표**: 사용자가 AI 응답이 마음에 들지 않을 때 같은 프롬프트로 다시 생성 요청.
- [ ] **구현**:
    - 각 AI 메시지에 "재생성" 버튼 추가 (ChatGPT 스타일).
    - 이전 메시지 삭제 후 동일한 사용자 메시지로 재요청.
    - 로딩 상태 및 스트리밍 처리.
- [ ] **예상 효과**: 사용자 만족도 향상, 재질문 횟수 감소.

#### 3. 다중 이미지 및 문서 분석 (Multi-modal Collection Analysis) ✅
- [x] **Phase 1: Frontend (UI/UX)**: `ChatInput` 갤러리 구현 및 최대 3개 파일 Append 로직 적용.
- [x] **Phase 2: Backend & AI Logic**: `api/chat.ts` 다중 파트(inlineData/fileData) 처리 및 외부 URL Base64 프록싱 구현.
- [x] **Phase 3: Persistence (UI Layer)**: `ChatMessage.tsx` 다중 이미지 그리드 렌더링 및 가로/세로 동적 배열 최적화.

### ⚙️ Medium Priority (Data & Intelligence)

#### 4. CSV/XLSX 파싱 고도화
- [ ] **대용량 데이터 처리**: 상위 N행 제한 및 요약 안내 (예: 1000행 이상 시 샘플링).
- [ ] **컬럼 타입 자동 감지**: 숫자, 날짜, 텍스트 등 자동 인식 및 최적화된 시각화 제안.
- [ ] **다중 시트 지원**: Excel 파일의 여러 시트를 선택하여 분석.

#### 5. 다중 문서 업로드 및 교차 분석 ✅
- [x] **목표**: 여러 개의 문서 파일(PDF, DOCX 등)을 동시에 업로드하고 교차 분석 지원.
- [x] **구현**: 모든 업로드된 문서의 텍스트를 `webContext`에 결합하여 AI에게 제공.

### 🎨 Low Priority (Advanced Visualizations)

#### 6. 화학 구조 시각화 반응형 고도화 (Chemical-Viz)
- [ ] **동적 본드 길이(Bond Length) 조절**: SMILES 문자열 길이에 따라 결합선 길이를 반비례 조절하여 긴 분자의 디테일 보존.
- [ ] **가로 스크롤 레이아웃 보강**: 초거대 분자 대응을 위한 터치 기반 가로 탐색 UI 강화.

#### 7. 수식 기반 그래프 및 벡터장 (Plotly/D3)
- [ ] **LaTeX 수식 입력 → JS 수치 해석 → 동적 그래프 시각화**.
- [ ] **전자기장 벡터 필드, 파동 함수, 3D 표면 차트(Surface Plot) 구현**.
- [ ] **예상 효과**: 물리학, 수학 교육용 시각화 강화.

#### 8. 별자리 시각화 엔진 고도화 (Astro-Viz Advanced)
- [ ] **Phase 4: 3D 천구 및 고급 기능 (Expert)**
    - [ ] Three.js 기반 3D 천구 전환 (회전/확대 가능).
    - [ ] 행성 위치 계산 (케플러 궤도 방정식).
    - [ ] 실시간 ISS 위치 오버레이.
    - [ ] 별 클릭 시 위키/상세 정보 툴팁 표시.

#### 9. 3D 물리 시뮬레이션 (Phy-Viz Advanced)
- [ ] **Phase 3: 3D 강체/유체 시뮬레이션 (Three.js + Rapier)**
    - React Three Fiber(R3F) 기반의 고성능 3D 물리 엔진 탑재.
    - **유체 역학(Fluid Dynamics)**: 입자 시스템(SPH)을 활용한 물/액체 시뮬레이션.
    - 복잡한 3D 구조물 및 강체 상호작용 실험.

### ⚡ 성능 안정화 및 기능 추가
- [ ] **Self-host Font Awesome**: 
    - CDN 대신 `@fortawesome/react-fontawesome` 적용 또는 CSS/webfonts 자체 호스팅.
    - **목표**: 외부 CDN 의존도 제거 및 렌더링 차단 해소.
- [ ] **Self-host KaTeX/Fonts**: `jsdelivr` 및 `googleapis` 의존성 제거.
- [ ] **Service Worker (PWA)**: 정적 자산 캐싱을 통한 일관된 성능 보장.
- [ ] **Image Proxy Next-gen**: `.webp` 자동 변환 및 최적화.

---

## 🛠️ Minor Improvements

- [x] 다크모드/라이트모드 UI 일관성 폴리싱 (Borderless 전략 상시 적용) ✅
- [x] 사이드바 UI 전면 개편 (GPT/Gemini 스타일 반영) ✅
- [x] **v3.5 모바일 컴팩트 UI 최적화** ✅
    - 헤더 및 입력창 수직 패딩 최소화로 채팅 공간 극대화.
    - 사용자 메시지 말풍선 너비 최적화 (`w-fit`) - 긴 이미지가 있어도 텍스트가 늘어지지 않음.
- [ ] 메시지 편집 기능 추가 (Edit message).
- [ ] 음성 인터랙션 고도화 (Voice Mode Strategy).

---

## 🧹 Code Quality & Refactoring

- [ ] 불필요한 파일 정리 (`test-supabase.ts`, `metadata.json`).
- [ ] `reference/` 폴더 삭제 고려 (HWPX 구현 완료).
- [ ] ESLint/Prettier 설정 추가.
- [ ] 단위 테스트 작성 (Vitest).

---

*Last Updated: 2026-02-21 (Multi-Modal Analysis and Mobile UI Polish)*

