# 📝 Project TODO List

## Priority Tasks (Future Roadmap)

### 🔥 High Priority (Core UX Improvements)

#### 0. 약품 이미지 정확도 개선 — 약학정보원 식별 검색 연동

> **배경**: 실제 약품 사진을 찍어 질문하면 엉뚱한 약품 정보를 반환하는 문제 발생.  
> Gemini Vision이 색상·모양·각인을 추출하더라도 Google Search 기반 추론은 오인식 위험이 높음.  
> **해결 방향**: 약학정보원(pharm.or.kr) 식별표시 DB를 직접 조회하여 정확도를 구조적으로 개선.

---

**[Phase 1] 약학정보원 검색 API 엔드포인트 구축** — `api/pill-search.ts`

- [x] **POST `/api/pill-search`** 신규 엔드포인트 작성
  - **입력**: `{ imprint_front, imprint_back?, color?, shape? }`
  - **핵심 로직**:
    1. 약학정보원 `list.asp` 에 POST 요청 (로그인 불필요 확인 완료 ✅)
    2. **5페이지 병렬 fetch** (`Promise.all`, 페이지당 ~1초 → 총 ~1.5~2초)
       - `_page=1` ~ `_page=5` 동시 요청 → 최대 50개 결과 수집
    3. **3단계 필터링 (우선순위 순)**:
       - **완전일치**: 앞면각인 + 색상 + 모양 전부 일치 → 확정 1개 반환
       - **각인일치**: 앞면각인만 일치 → 후보 목록 반환 (최대 5개)
       - **폴백**: 색상 + 모양만 일치하는 것 중 **가장 많이 나온 상위 3종** 반환
    4. 5페이지 안에 없으면 → `{ found: false, candidates: [...상위3종] }` 반환
  - **출력 스키마**:
    ```ts
    {
      found: boolean,
      match_type: 'exact' | 'imprint_only' | 'similar' | 'none',
      results: Array<{
        idx: string,
        product_name: string,
        front_imprint: string,
        back_imprint: string,
        shape: string,
        color: string,
        company: string,
        thumbnail: string,
        detail_url: string
      }>
    }
    ```
  - [x] HTML 파싱 로직: `scripts/test-pill-search.js` 의 검증된 파서 재사용
  - [x] 타임아웃 처리: 각 fetch에 `AbortController` 5초 제한 설정
  - [x] 에러 처리: 약학정보원 접속 실패 시 graceful fallback (Google Search로 폴백)

---

**[Phase 2] Vision 전처리 — 이미지에서 시각적 단서 추출** — `api/chat.ts` 수정

- [x] 이미지 첨부 + 약품 관련 쿼리 감지 조건 추가
  - 감지 조건: `attachments` 에 이미지 파일 존재 + 메시지에 약품 키워드 포함
    - 키워드 예시: `약`, `알약`, `약품`, `정`, `캡슐`, `이거 뭔 약`, `무슨 약`
- [x] **Vision 전처리 프롬프트** (Gemini 1차 호출, 저온도 0.1):
  ```
  이 이미지에서 알약의 시각적 정보를 JSON으로 추출하시오.
  반드시 아래 형식으로만 답하고 다른 텍스트는 출력하지 말 것:
  {
    "imprint_front": "앞면 각인 문자 (없으면 null)",
    "imprint_back":  "뒷면 각인 문자 (없으면 null)",
    "color":  "노랑|하양|분홍|주황|초록|파랑|빨강|갈색|기타",
    "shape":  "원형|타원형|장방형|삼각형|사각형|마름모|기타",
    "confidence": "high|medium|low"
  }
  ```
- [x] 추출 결과를 `/api/pill-search` 에 전달
- [x] `confidence: low` 인 경우 → 직접 검색 권고 메시지 추가

---

**[Phase 3] System Prompt 보강** — `api/chat.ts` systemInstruction 수정

- [x] `[DRUG VISUALIZATION]` 섹션에 이미지 기반 식별 프로토콜 추가:
  ```
  [PILL IMAGE IDENTIFICATION — MANDATORY PROTOCOL]
  약품 이미지가 첨부된 경우:
  1. PROVIDED_PILL_DATA 가 존재하면 이를 최우선으로 사용하여 json:drug 블록 생성
  2. match_type이 'exact'인 경우 → 확정 정보로 출력
  3. match_type이 'similar'인 경우 → ⚠️ 경고 배너 포함, 후보 목록 나열
  4. match_type이 'none'인 경우 → "식별 불가" 안내 + 약학정보원 링크 제공
  5. 절대로 DB 조회 결과와 다른 약품명을 출력하지 말 것
  ```
- [x] 약학정보원 검색 결과를 `webContext` 에 `[PROVIDED_PILL_DATA]` 태그로 주입
  ```
  [PROVIDED_PILL_DATA]
  match_type: exact
  product_name: 슈다페드정
  front_imprint: SVI
  back_imprint: -
  shape: 타원형
  color: 노랑
  company: 대화제약
  detail_url: https://...
  ```

---

**[Phase 4] 프론트엔드 UX** — `App.tsx` / `components/` 수정

- [x] 이미지 첨부 + 약품 키워드 감지 시 로딩 메시지 변경:
  - 기존: `"이미지를 분석 중입니다..."`
  - 변경: `"약품 식별 중... (약학정보원 DB 조회)"`
- [x] `match_type: 'similar' | 'none'` 반환 시 경고 UI 표시 (ChatMessage 내)
  - 예: 노란색 배너 `"⚠️ 이미지에서 정확한 약품을 찾지 못했습니다. 아래는 유사 약품 후보입니다."`

---

**[검증 완료 사항]** ✅

- 약학정보원 POST 검색 방식 (로그인 불필요) 확인
- HTML 파싱 로직 (`scripts/test-pill-search.js`) 정상 동작 확인
- 페이지당 응답속도 ~1초, 5페이지 병렬 시 ~1.5~2초 예상
- UTF-8 인코딩 (meta + 실제 파일 모두 UTF-8) 확인

---

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

#### 🤖 LangGraph.js 기반 Agentic 아키텍처 리팩토링 ✅

- [x] **목표**: `api/chat.ts`의 단일 모놀리식 파이프라인을 `@langchain/langgraph`를 활용한 Multi-Actor (Node/State/Edge) 기반 구조로 전환.
- [x] **State Management (`AgentState`)**: 대화 기록(`messages`), Tool 실행 결과, 추출된 시각 컨텍스트, 라우팅 정보(`next_node`)를 담는 완벽히 타이핑된(TypeScript) 상태 객체 설계.
- [x] **Node 분할 및 Graph 컴파일**:
  - **Router Node**: 사용자 의도 분석 및 분기 결정 (일반 대화 vs 이미지 처리 vs 툴 사용).
  - **Vision Preprocessing Node**: 첨부된 이미지에 특화된 시각 정보 추출.
  - **Tool Executor Node**: 조건부 엣지(Conditional Edge)를 통해 약품 DB 검색, 유튜브 파싱 등을 수행.
  - **Generator Node**: 최종 컨텍스트를 융합하여 정답안 스트리밍.
- [x] **Function Calling 표준화**: 하드코딩된 예외 조건(`if/else`)을 제거하고, `identifyPillTool`, `extractYoutubeTitleTool` 등의 규격화된 도구를 LLM에 주입하여 자율 판단 유도.
- [x] **Dynamic Prompting**: 유저 의도에 맞춰 필요한 모듈화된 시각화 지침(Chem-Viz, Astro-Viz 등)만 노드 체인 도중 동적으로 주입하여 전체 프롬프트 사이즈(토큰) 최적화 및 속도 향상.
- [x] **Streaming 호환성 보장**: LangGraph의 `streamEvents`를 활용하여 프론트엔드와 기존 SSE 방식 통신 완벽 지원.

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

- [x] **esm.sh CDN → npm 로컬 임포트 전환** ✅
  - `react-markdown`, `remark-gfm`, `remark-math`, `rehype-katex`, `react-syntax-highlighter` 모두 npm 설치 후 Vite 번들에 포함.
  - 메인 번들에서 분리(`markdown-vendor` chunk)하여 초기 번들 gzip **679 KB → 325 KB (약 52% 감소)**.
  - CDN 장애 시 전체 채팅창 렌더링 불가 이슈 해소.
- [ ] **Lighthouse 90+ 달성을 위한 심화 최적화 (진행 예정)**
  - [x] **Forced Reflow 제거** (`ChatInput.tsx`): `style.height = 'auto'` 직후 `scrollHeight` 읽기로 발생하던 레이아웃 스래싱 해소. `requestAnimationFrame` + `cancelAnimationFrame` 데바운싱 적용, `window.innerWidth` 중복 쿼리 2→1회 최적화. **TBT -75ms 예상** ✅
  - [ ] **Preconnect 속성 조정**: `fonts.gstatic.com`에 `crossorigin="anonymous"` 추가하여 사전 연결/미사용 혼선 경고 해소.
  - [ ] **아바타 이미지 초경량화**: WebP 화질(`q=80` → `q=50`) 추가 하향 혹은 로컬 2KB 미만 SVG 아이콘 파일로 대체하여 Image Delivery 최적화 달성.
  - [ ] **SVG 아이콘 마이그레이션**: FontAwesome CDN CSS를 걷어내고 `@fortawesome/fontawesome-svg-core` 형태로 대체하여 Font-display 지연(100ms) 및 Unused CSS(18KB) 동시 해결.
  - [ ] **마크다운 & 서드파티 모듈 Code-Splitting**: 초기 메인 화면 로드에 불필요한 `react-markdown` 컴포넌트를 `React.lazy()`와 `Suspense`를 활용해 분할 로드하여 Unused JavaScript(247KB) 낭비 방지.
- [ ] **Self-host Font Awesome**:
  - CDN 대신 `@fortawesome/react-fontawesome` 적용 또는 CSS/webfonts 자체 호스팅.
  - **목표**: 외부 CDN 의존도 제거 및 렌더링 차단 해소.
- [ ] **Self-host KaTeX/Fonts**: `jsdelivr` 및 `googleapis` 의존성 제거.
- [ ] **`framer-motion` 번들 제거 검토**: 실제 사용 여부 확인 후 제거 시 ~50KB(gzip) 절감 가능.
- [ ] **Service Worker (PWA)**: 정적 자산 캐싱을 통한 일관된 성능 보장.
- [ ] **Image Proxy Next-gen**: `.webp` 자동 변환 및 최적화.

---

## 🛠️ Minor Improvements

- [x] 다크모드/라이트모드 UI 일관성 폴리싱 (Borderless 전략 상시 적용) ✅
- [x] 다크/라이트 모드 사용자 설정 유지 (localStorage 연동 및 HTML Head 스크립트로 FOUC 방지) ✅
- [x] 마크다운 코드 블록 렌더링 오류 수정 (스트리밍 중이거나 특정 모델 응답에서 코드 블록 포맷이 깨져 일반 텍스트로 렌더링되는 UI 버그 해결 및 프롬프트 개선) ✅
- [x] 클립보드 복사 기능 비보안/모바일 환경 호환성 개선 (Fallback textarea 로직 추가) ✅
- [x] 사이드바 UI 전면 개편 (GPT/Gemini 스타일 반영) ✅
- [x] **v3.5 모바일 컴팩트 UI 최적화** ✅
  - 헤더 및 입력창 수직 패딩 최소화로 채팅 공간 극대화.
  - 사용자 메시지 말풍선 너비 최적화 (`w-fit`) - 긴 이미지가 있어도 텍스트가 늘어지지 않음.
- [ ] 메시지 편집 기능 추가 (Edit message).
- [ ] **음성 인터랙션 고도화 (Voice Mode Strategy)**
  - [x] **STT UX 및 안정성 개선**: 언어 변경/언마운트 시 메모리 해제(Cleanup), 예외 처리(`onerror`), 수동 타이핑 시 덮어쓰기 방지, 인식 시작 시 띄어쓰기 방어 및 **5초 무응답 시 자동 전송(Auto-Submit)** 기능 추가.
  - [x] **TTS 모바일 볼륨 최적화**: Web Audio API의 `GainNode`를 활용하여 모바일 환경에서 재생되는 음성 소리 증폭(Gain 1.5x~2.0x).

---

## 🧹 Code Quality & Refactoring

- [x] ~~불필요한 파일 정리 (`metadata.json`)~~ → `metadata.json` 삭제 완료 ✅
- [ ] `test-supabase.ts` 파일 정리.
- [ ] `reference/` 폴더 삭제 고려 (HWPX 구현 완료).
- [ ] ESLint/Prettier 설정 추가.
- [ ] 단위 테스트 작성 (Vitest).

---

_Last Updated: 2026-03-08 (Lighthouse TBT 최적화 — ChatInput Forced Reflow 제거, requestAnimationFrame + cancelAnimationFrame 적용)_
