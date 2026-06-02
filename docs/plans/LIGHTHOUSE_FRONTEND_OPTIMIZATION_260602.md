# Lighthouse 프론트엔드 최적화 계획 — 2026-06-02

> 원본 작성일: 2026-06-02  
> 이동 출처: `docs/logs/DEV_260602.md`

---

## 배경 / 목적

5/31에 구현 완료된 `needsSearch` 3-게이트 검색 라우팅 이후, **페이지 로드 레이턴시(Lighthouse)** 관점에서 추가 최적화 기회를 파악하기 위해 분석 세션 진행.

---

## Lighthouse 측정 결과 (chat-gem.vercel.app, 2026-06-02)

| 지표 | 값 | 등급 |
|---|---|---|
| FCP | 0.7s | Good |
| LCP | 1.2s | Good |
| TBT | **320ms** | Needs Improvement |
| CLS | 0 | Perfect |
| Speed Index | 0.7s | Good |
| **Performance** | **91** | - |
| **Accessibility** | **63** | 낮음 |

> 참고: 2026-04-04 측정 결과와 동일. 약 2개월간 점수 변동 없음.

### 주요 지적 사항

| 항목 | 상세 | 예상 절감 |
|---|---|---|
| Unused JS | `0n_oq2...js` 159KB + `0.vc...js` 82KB unused | **241 KiB** |
| Unused CSS | `fontawesome.min.css` 14.3KB 중 14.1KB 미사용 | 14 KiB |
| Legacy polyfill | `Array.at`, `Object.hasOwn` 등 6개 (ES2022 기본 지원 기능) | 14 KiB |
| Font display | FA woff2 2개 `font-display` 미지정 -> FOIT | 30~50ms |
| Buttons a11y | `<button>` 21개 중 다수 `aria-label` 미설정 | Accessibility 점수 |
| user-scalable | `viewport` `userScalable: false` -> 저시력 접근성 침해 | A11y 점수 |

---

## 채택한 최적화 방안 (ROI 기반 선별)

### Quick Wins — 코드 10줄 이하

#### QW1. FA `font-display: swap` 강제 주입 (FCP -30~50ms)

- **방법**: CDN CSS 교체 없이 `globals.css` 하단에 `@font-face` override 추가
- **파일**: `app/globals.css`
- **원리**: 동일 font-family+weight 조합의 마지막 `@font-face`가 우선 -> globals.css가 CDN보다 늦게 로드되므로 swap을 덮어씀

```css
@font-face {
  font-family: 'Font Awesome 6 Free';
  font-style: normal;
  font-weight: 900;
  font-display: swap;
  src: url('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2') format('woff2');
}
@font-face {
  font-family: 'Font Awesome 6 Free';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-regular-400.woff2') format('woff2');
}
```

#### QW2. Legacy Polyfill 제거 — browserslist 추가 (TBT -50ms, JS 14KB)

- **방법**: `package.json`에 `"browserslist"` 키 추가
- **원인**: `tsconfig` target=ESNext임에도 Next.js가 기본 browserslist로 ES2022 polyfill 주입

```json
"browserslist": [
  "chrome >= 109",
  "firefox >= 110",
  "safari >= 16",
  "edge >= 109"
]
```

#### QW3. Viewport `userScalable` 수정 (Accessibility +5~10점)

- **파일**: `app/layout.tsx`
- `maximumScale: 1` -> `maximumScale: 5`
- `userScalable: false` -> `userScalable: true`
- 모바일 입력창 자동 줌인 방지 위해 `<textarea>` font-size 16px 이상 보장 확인 필요

### 중기 (1~2일)

#### M1. framer-motion -> `next/dynamic` lazy load (TBT -100ms, ~50KB 절감)

- **현황**: `framer-motion ^12.29.2`, `DrugRenderer.tsx`·`BioRenderer.tsx` 2개 파일만 사용
- **방법**: 두 렌더러를 `ChatMessage.tsx`에서 dynamic import로 전환

```typescript
const DrugRenderer = dynamic(() => import('./DrugRenderer'), { ssr: false });
const BioRenderer  = dynamic(() => import('./BioRenderer'),  { ssr: false });
```

- 렌더러 내부 `motion.div`, `AnimatePresence` 코드는 변경 없음

### 제외 항목

| 항목 | 제외 이유 |
|---|---|
| 버튼 aria-label 21개 | 성능 수치 영향 없음. 별도 a11y 세션에서 처리 |
| FA SVG Core 전환 | 95개+ 아이콘 모두 React 컴포넌트 방식으로 전환해야 함. ROI 낮음. QW1으로 충분 |
| Google Fonts preconnect | `layout.tsx` L24에 이미 적용됨 |
| Render-blocking CSS | Next.js 자동 생성 청크, 직접 수정 불가 |
| non-composited animation | Lighthouse가 요소 특정 안 함. 프로파일링 필요 |

---

## 예상 결과

| 지표 | 현재 | QW1~3 후 | +M1 후 |
|---|---|---|---|
| Performance | 91 | 93~94 | **95+** |
| TBT | 320ms | ~270ms | **~170ms** |
| FCP | 0.7s | ~0.65s | 유지 |
| Accessibility | 63 | 70~73 | 유지 |
| JS 절감 | - | 14KB | **~64KB** |

---

## 병행 검토 사항 (서버 레이턴시)

이번 세션에서는 Lighthouse 기반 프론트엔드 최적화에 집중했으나, 서버 응답 latency 최적화도 구현 계획 문서에 포함:

| 항목 | 예상 효과 | 상태 |
|---|---|---|
| SDK 스트리밍 부활 (`generateContent` -> `generateContentStream`) | TTFB 5-15s -> 0.5-2s | 미착수 (과거 제거 이력 있음, 회귀 검증 필요) |
| ThinkingConfig 경로별 세밀화 | 0.5-1s 단축 | 미착수 |
| 히스토리 슬라이딩 윈도우 | 입력 토큰 ~40% 감소 | 미착수 |
| Two-track Stage2 스트리밍 | 1-2s 단축 | 미착수 |
| 계측 인프라 (`timing.ts`) | 측정 기반 마련 | 미착수 |

---

## 다음 세션 우선순위

1. QW1~QW3 즉시 적용 후 Lighthouse 재측정
2. M1 (framer-motion lazy) 적용 + Chrome Network 탭 확인
3. 서버 레이턴시 계측 인프라 구축 (`timing.ts`)
