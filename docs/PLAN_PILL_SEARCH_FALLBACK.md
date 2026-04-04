# 약품검색 폴백 메커니즘 계획 (Google Search)

## 현재 상황
- 약학정보원(pharm.or.kr)에서만 약품 데이터 검색
- 약학정보원에 해당 약품 정보 없으면 → **빈 결과 반환** (실패)

## 개선 목표
약학정보원 검색 실패 시 Google Search로 폴백하여 **더 많은 약품 정보에 접근**

---

## 1️⃣ 구현 범위

### 1-1. 폴백 트리거 조건
```
IF 약학정보원 검색 결과 = 0 건
  THEN Google Search 실행
  ELSE 약학정보원 결과 반환 (폴백 불필요)
```

**핵심**: 약학정보원 우선, 실패 시에만 Google Search

---

## 2️⃣ 아키텍처

### 현재 플로우
```
POST /api/pill-search
  ↓
searchPill() [pill-logic.ts]
  ├─ 약학정보원 검색 (5페이지)
  ├─ 결과 필터링 (각인, 색상, 모양)
  └─ 반환
```

### 개선된 플로우
```
POST /api/pill-search
  ↓
searchPill() [pill-logic.ts]
  ├─ 약학정보원 검색 (5페이지)
  ├─ 결과 필터링
  ├─ 결과 있음? → 반환 ✓
  └─ 결과 없음? → searchGoogleFallback() 호출
       ├─ Google Search 실행
       ├─ 각인/색상으로 매칭 검증
       └─ 반환
```

---

## 3️⃣ 세부 구현 전략

### 3-1. 검색 쿼리 구성
**각인 기반 (권장 - 정확도 높음)**
```
"[각인_앞] [각인_뒤] 약 정보 한국"
예: "TYLENOL 500 약 정보 한국"
```

**각인 없을 때 (형태/색상 기반)**
```
"[색상] [모양] 약 정보 한국"
예: "흰색 타원형 약 정보 한국"
```

### 3-2. Google Search API 선택
- **옵션 1**: `google-search-results` npm 패키지 (SerpAPI 기반)
- **옵션 2**: `ddg-lite` (DuckDuckGo - 더 가벼움)
- **옵션 3**: 기존 `fetch-url.ts` 활용 (웹 페이지 직접 크롤링)

**추천**: 옵션 3 (fetch-url + HTML 파싱) - 기존 코드와 일관성

### 3-3. 결과 데이터 구조

**Google Search 결과 포맷** (약학정보원과 호환)
```typescript
{
  idx: "google_[timestamp]_[hash]",  // 약학정보원과 구분
  front_imprint: "TYLENOL",
  back_imprint: "500",
  shape: "타원형",
  color: "흰색",
  drug_name: "타이레놀정500밀리그람(아세트아미노펜)",
  company: "한국얀센",
  source: "google_search",  // 출처 표시
}
```

### 3-4. 매칭 검증 로직
```
IF 각인 제공됨
  → 각인으로 1차 필터링 (완벽 매칭)
  → 색상 추가 검증 (있으면)
  → 모양 추가 검증 (있으면)
ELSE
  → 색상 + 모양으로의 매칭
```

---

## 4️⃣ 코드 구현 계획

### 수정 대상 파일

#### ① `api/_lib/pill-logic.ts`
**변경사항:**
- `searchPill()` 함수 로직 수정
  - L20-60: 약학정보원 검색 후 **결과 체크 추가**
  - 결과 없으면 → `searchGoogleFallback(criteria)` 호출
  
- 새 함수 추가
  - `searchGoogleFallback(criteria)`: Google Search 실행
  - `fetchGoogleSearchResults(query)`: 구글 검색
  - `parseGoogleSearchResults(html, criteria)`: 결과 파싱 & 매칭

#### ② `api/_lib/config.ts` (선택)
**변경사항:**
- Google Search 관련 환경변수 (필요 시)
- 타임아웃 설정 추가

#### ③ `api/pill-search.ts` (선택)
**변경사항:**
- 응답 포맷 확장 (source 필드 추가)
  ```json
  {
    found: boolean,
    match_type: "perfect_match|color_shape_match|google_search",
    source: "pharm_or_kr|google_search",
    results: [...]
  }
  ```

---

## 5️⃣ 타임라인 & 우선순위

| # | 작업 | 예상시간 | 우선순위 |
|---|------|---------|---------|
| 1 | `searchGoogleFallback()` 함수 구현 | 30min | 🔴 HIGH |
| 2 | Google 검색 쿼리 생성 로직 | 20min | 🔴 HIGH |
| 3 | 결과 파싱 & 매칭 검증 | 40min | 🔴 HIGH |
| 4 | 에러 처리 & 타임아웃 | 20min | 🟡 MEDIUM |
| 5 | 테스트 & 검증 | 30min | 🟡 MEDIUM |
| 6 | 응답 포맷 문서화 | 15min | 🟢 LOW |

**총 예상**: ~2.5시간

---

## 6️⃣ 예상 이슈 & 대응

| 이슈 | 원인 | 해결책 |
|------|------|--------|
| Google 검색 느림 | 네트워크 요청 | 타임아웃 설정 (5초) + 캐싱 |
| 오매칭 | 약명 유사 | 각인 검증 필수 구현 |
| 크롤링 차단 | User-Agent 감지 | Referer, User-Agent 헤더 추가 |
| 한글 인코딩 | URL 인코딩 누락 | `encodeURIComponent()` 사용 |

---

## 7️⃣ 성공 기준

- ✅ 약학정보원 검색 성공 → 이전대로 반환 (폴백 미실행)
- ✅ 약학정보원 실패 → Google Search 수행
- ✅ Google 검색 결과 → 각인/색상/모양으로 검증
- ✅ 응답 포맷 일관성 유지
- ✅ 에러 핸들링 개선

---

## 다음 단계

1. **계획 검토** - 위 계획 승인 여부
2. **구현 시작** - pill-logic.ts 수정
3. **테스트** - 다양한 약품으로 테스트
4. **배포** - Vercel 배포
