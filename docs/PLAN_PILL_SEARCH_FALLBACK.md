# 약품검색 폴백 메커니즘 계획 (Google Search)

> **구현 완료: 2026-04-04** — 실제 구현은 초기 계획과 다른 방향으로 결정됨. 하단 참조.

## 현재 상황
- 약학정보원(pharm.or.kr)에서만 약품 데이터 검색
- 약학정보원에 해당 약품 정보 없으면 → **빈 결과 반환** (실패)

## 개선 목표
약학정보원 검색 실패 시 DDG(DuckDuckGo) Search로 폴백하여 **더 많은 약품 정보에 접근**

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

## 4️⃣ 실제 구현 방향 (계획 수정)

> **초기 계획 변경**: `pill-logic.ts`에 `searchGoogleFallback()` 추가 방식 대신,
> **MFDS Strategy 3 버그 수정 + LLM 레이어 폴백** 방식으로 구현.

### 변경 이유
로그 분석 결과, 문제는 약학정보원이 아니라 **MFDS Strategy 3**에 있었음:
- Strategy 3(base name 검색)이 전혀 다른 약품을 반환 → LLM이 오검색된 약을 그대로 처리
- 이 버그를 먼저 수정하지 않으면 폴백 자체가 의미 없음

### 실제 구현 내용 (2026-04-04)

```
Strategy 1: "제놀푸로탑" → MFDS 실패
Strategy 2: 단위 변환 → MFDS 실패
(Strategy 3 제거)
  ↓
반환: "식약처 DB 없음" + search_web 툴 유도 메시지
  ↓
LLM → searchWebTool("제놀 푸로탑 성분 용법 용량") 호출
  ↓
DDG 검색 결과 → 스니펫 + 소스 URL 반환
  ↓
소스 URL → chat.ts에서 파싱 → 하단 소스 칩 렌더링
```

### 수정된 파일
| 파일 | 변경 내용 |
|------|-----------|
| `api/_lib/agent/drug-info-tool.ts` | Strategy 3 블록 삭제, 실패 메시지에 `search_web` 유도 |
| `api/_lib/agent/tools.ts` | DDG URL 파싱 추가, `[WEB_SOURCE_URLS]` 블록 반환 |
| `api/chat.ts` | `on_tool_end` 이벤트에서 소스 URL 파싱 → 소스 칩 발송 |
| `components/ChatMessage.tsx` | ConnectDI URL 한글 단위 regex 수정 (`밀리그[램람]`) |

→ 상세 내용: [DEV_260404.md](DEV_260404.md)

---

## 5️⃣ 향후 고려사항

- `pill-logic.ts` 레이어(이미지 기반 알약 식별)의 폴백은 별도 작업으로 분리 검토
- DDG 검색 소스 칩 표시 테스트 후 품질 검증

---

## 성공 기준

- ✅ Strategy 3 오매칭 제거 → 완료
- ✅ MFDS 실패 시 원래 검색어로 DDG 검색 → 완료
- ✅ DDG 검색 결과 소스 칩 렌더링 → 완료
- ✅ ConnectDI URL 밀리그람 정규화 → 완료
- ⏳ 테스트: "제놀 푸로탑" 실제 검색 확인
