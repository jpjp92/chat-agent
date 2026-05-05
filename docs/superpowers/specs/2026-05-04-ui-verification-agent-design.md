# UI 검증 에이전트(UI Verification Agent) 설계서

## 1. 개요
본 에이전트는 신규 개발된 UI 컴포넌트 및 페이지가 기존 디자인 시스템과 일관성을 유지하는지(Consistency), 정의된 대로 동작하는지(Interaction), 그리고 다양한 환경에서 올바르게 렌더링되는지(Responsiveness)를 검증하는 전문 서브에이전트입니다.

## 2. 우선순위 (Success Criteria)
1. **디자인 시스템 일관성 (4)**: 기존 Tailwind 클래스 패턴, 여백(Spacing), 색상(Palette) 사용법 준수 여부
2. **인터랙티브 기능 검증 (2)**: 클릭, 호버, 로딩 상태, 피드백(Toast) 등 동작 확인
3. **반응형 및 접근성 (3)**: 모바일 레이아웃 및 다크 모드 지원 여부
4. **시각적 회귀 테스트 (1)**: 의도치 않은 레이아웃 변화 감지

## 3. 검증 방식: 하이브리드(Hybrid) 접근
*   **1단계: 정적 분석 (Static Analysis)**
    *   `components/` 내 유사 컴포넌트 코드 분석
    *   Tailwind 클래스 조합 및 Framer Motion 사용 패턴 비교
*   **2단계: 동적 검증 (Dynamic Verification)**
    *   Playwright를 사용하여 Headless 브라우저 실행
    *   실제 컴포넌트 렌더링 및 인터랙션 시뮬레이션
    *   성능(로딩 속도) 및 반응형 레이아웃 확인

## 4. 보고 형식 (Reporting Format)
1. **체크리스트 (Checklist)**: 항목별 Pass/Fail 상태 요약
2. **텍스트 리포트 (Text Report)**: 불일치 사항이나 개선점에 대한 상세 설명
3. **스크린샷 (Screenshots)**: 문제 지점 또는 주요 상태에 대한 시각적 증거

## 5. 기술 스택 및 도구
*   **Test Runner**: Playwright (스크린샷 및 인터랙션 테스트)
*   **Analysis**: 정규표현식 및 LLM 기반 코드 패턴 매칭
*   **Environment**: Vite 개발 서버 기반 런타임 검증

---
*최종 수정: 2026-05-04*
