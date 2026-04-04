# TODO

> 완료된 항목은 [DEV_HISTORY.md](DEV_HISTORY.md)에 기록됩니다.

---

## 백로그

### 핵심 UX

- [ ] **메시지 재생성** — 응답이 마음에 들지 않을 때 같은 프롬프트로 재실행 (구현 일정 미정)
- [ ] **메시지 편집** — 보낸 메시지 수정 후 해당 시점부터 재실행
- [ ] **세션 문서 컨텍스트 영구 저장** — `lastActiveDoc`을 Supabase(`chat_sessions.last_active_doc` JSONB)에 저장하여 새로고침 후에도 컨텍스트 유지

### 성능 — Lighthouse 90+
현재 점수: 83/100

- [ ] `fonts.gstatic.com` preconnect에 `crossorigin="anonymous"` 추가 (혼합 힌트 경고 해소)
- [ ] FontAwesome CDN → `@fortawesome/fontawesome-svg-core` 전환 (미사용 CSS 18KB + font-display 지연 100ms 제거)
- [ ] `react-markdown` lazy loading — 메인 번들에서 분리하여 미사용 JS ~247KB 절감
- [ ] KaTeX / Google Fonts 자체 호스팅 — `jsdelivr` / `googleapis` 런타임 의존성 제거
- [ ] `framer-motion` 실사용 여부 확인 — 미사용 시 제거로 ~50KB gzip 절감

### 데이터 & 시각화

- [ ] **CSV/XLSX 파싱 고도화** — 대용량 파일 행 제한 + 샘플링(1000행 이상), 컬럼 타입 자동 감지, 다중 시트 지원
- [ ] **Chem-Viz** — 대형 분자 동적 결합 길이 스케일링, 모바일 가로 스크롤 강화

### 코드 품질

- [ ] ESLint / Prettier 설정 추가
- [ ] 단위 테스트 작성 (Vitest)
- [ ] `test-supabase.ts` 정리

### 낮은 우선순위 / 보류

- [ ] **ARC (Agent RAG Cache)** — Supabase pgvector 캐시 + LangGraph 캐시 노드. 트래픽 증가 시 재검토.
- [ ] **3D Astro-Viz** — Three.js 3D 천구, 행성 위치 계산(케플러), ISS 오버레이
- [ ] **3D Physics-Viz** — React Three Fiber + Rapier 강체/유체 시뮬레이션
- [ ] **Plotly/D3 벡터장** — LaTeX 수식 입력 → 수치 해석 → 전자기장/파동함수 시각화
- [ ] **Service Worker (PWA)** — 정적 자산 캐싱. Vercel Edge로 커버되어 우선순위 낮음.

---

_최종 수정: 2026-04-04 (v4.14 9-intent 구현 완료)_
