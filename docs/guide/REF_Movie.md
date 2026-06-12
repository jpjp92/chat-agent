# Movie-Viz: Test Prompt Guide

Reference prompts for testing the `json:movie` renderer and the multiplex showtimes pipeline (CGV · 롯데시네마 · 메가박스).

> 기술 상세(스파이크·엔드포인트 발견·캐시·CGV 콜드 최적화): [`../logs/DEV_260610.md`](../logs/DEV_260610.md), [`../logs/DEV_260611.md`](../logs/DEV_260611.md) §6
> ⚠️ CGV 조회는 `BROWSERLESS_KEY` 필요 (Cloudflare Bot Management 우회 — 실 헤드리스 Chrome). 롯데·메가박스는 direct JSON.

---

## 2단 데이터 구조 (클라이언트 페치)

다른 렌더러와 달리 영화 카드는 **상영시간표를 도구가 직접 가져오지 않는다.** `movieTool`은 지역에 맞는 3사 기본 지점만 담은 가벼운 `json:movie`를 반환하고(즉시 챗 응답 종료), 실제 상영표는 `MovieRenderer`가 마운트·지점변경 시 `/api/showtimes`를 호출해 채운다(스켈레톤 → 카드). CGV browserless ~2.5s 지연이 챗 함수 밖에 머물러 응답이 빠르고, 지점 드롭다운 재조회와 동일 엔드포인트를 재사용한다.

```
영화 질의 → router(movie_search) → generator(movieTool) → json:movie{region,defaults}
   → fast-pass(LLM 우회) → ChatMessage 파싱 → MovieRenderer
   → 체인별 GET /api/showtimes (마운트·드롭다운 변경 시) → 스켈레톤 → 카드
```

---

## Renderer Schema

### 1) `json:movie` — movieTool 반환 (가벼움)

```json
{
  "region": "강남",
  "defaults": {
    "cgv":   { "code": "0056", "nm": "강남" },
    "lotte": { "code": "1|1|1013", "nm": "가산디지털" },
    "mega":  { "code": "1372", "nm": "강남" }
  }
}
```

> `region`은 사용자가 말한 지역(미지정 시 `"강남"`). `defaults`는 `lib/theaters.findDefaultBranch()`가 지역 키워드로 고른 3사 지점. CGV `code`=siteNo, 롯데 `code`=cinemaID(`Division|int(Detail)|CinemaID`), 메가박스 `code`=brchNo.

### 2) `GET /api/showtimes?chain=&code=&nm=` 응답 (실 상영표)

```json
{
  "chain": "cgv",
  "code": "0056",
  "cinema": "CGV 강남",
  "movies": 6,
  "total": 22,
  "ms": 2480,
  "date": "20260612",
  "cached": false,
  "age": 0,
  "list": [
    {
      "chain": "CGV",
      "cinema": "CGV 강남",
      "movie": "군체",
      "date": "20260612",
      "poster": "https://cdn.cgv.co.kr/...",
      "rating": "15세",
      "format": "2D",
      "showtimes": [
        { "start": "11:45", "end": "13:50", "screen": "1관", "screenFull": "1관 (Laser)", "left": 131, "total": 144 }
      ]
    }
  ]
}
```

> `screen`은 정제된 상영관명(CGV `cleanCgvScreen`: `4관[SCREENX] (리클라이너,Laser)` → `4관 SCREENX`), `screenFull`은 원본(데스크톱 호버 `title`). `left/total`=잔여/총석. `date`가 오늘과 다르면 카드에 `내일` 배지. `cached`=`fresh`(120s 내)/`stale`(30분 내, 백그라운드 갱신)/`false`. `nocache=1`로 강제 신선.

---

## 1. 지역 기반 상영표 조회

- "강남 영화 상영시간표 알려줘"
- "홍대 오늘 무슨 영화 해?"
- "노원 영화관 상영시간"
- "부산 서면 영화 정보 알려줘"
- "영화 상영표 보여줘" — 지역 미지정 → 강남 기본

## 2. 영화 정보 / 일정형 질의

- "오늘 영화 정보 알려줘"
- "지금 상영 중인 영화 뭐 있어?"
- "볼만한 영화 있어?"
- "개봉 영화 알려줘"
- "상영작 보여줘"

> ⚠️ 이 부류가 프로덕션에서 일반 검색으로 새던 케이스(DEV_260612). 라우터 LLM 실패 시 정규식 폴백이 받도록 `intentRules.ts` 패턴을 보강함.

## 3. 체인 직접 지정

- "CGV 강남 상영시간표"
- "메가박스 코엑스 일정"
- "롯데시네마 건대입구 영화 뭐 해?"

## 4. 지점 변경 (카드 내 인터랙션)

- 카드의 체인별 드롭다운에서 지점 검색·선택 → 해당 지점 `/api/showtimes` 재조회
- ↗ 아이콘 → 지점 공식 페이지(롯데·메가박스는 지점 딥링크, CGV는 극장별 예매 공통 페이지)

## 5. 멀티턴 후속 질문 (카드 데이터 요약)

카드가 화면에 떠 있을 때, 표시된 상영표에 대한 후속 질문은 **카드를 다시 그리지 않고 텍스트로 요약 답변**한다. (DEV_260612 §5)

- "메가박스에만 상영하는 영화 있어?" — 체인 간 영화 비교
- "제일 빠른 시간대는?" / "가장 늦은 회차는?"
- "좌석 많이 남은 영화 추천해줘"
- "CGV랑 롯데 비교해줘"

> **동작 원리**: `MovieRenderer`가 가져온 상영표를 클라 스토어(`lib/movieContext.ts`)에 적재 → 다음 메시지에 `movieContext`로 동봉 → 라우터가 "카드 존재 + 질문형"이면 `movie_search`가 아니라 `general`로 보내 화면 데이터로 답하게 함(검색 off로 일반 표 폴백 차단). 데이터에 없는 정보(줄거리·평점·예매율·다른 지역)는 지어내지 않고 검색/재조회로 안내.
> **새 카드 vs 후속**: "홍대 영화 상영시간표"처럼 새 지역·표시 요청은 질문형이 아니라 그대로 새 카드를 그린다.

### 5-1. 상영표에 없는 정보 → 웹 검색 전환

상영표에 없는 정보(줄거리·평점·예매율·관객수·장르)를 물으면 모델이 **"상영표엔 없어요" + "웹에서 검색해 드릴까요?"** 로 물어보고, 동의하면 그 턴에 Google 검색으로 답한다.

- "군체 평점 어때?" → "상영표엔 평점이 없어요. 웹에서 검색해 드릴까요?"
- "응" / "ㅇㅇ" / "네 부탁해요" / "그래 찾아줘" → **웹 검색으로 답변** (그 턴만 검색 ON)
- "군체 평점 검색해줘" (직접 검색 요청) → 곧바로 웹 검색

> 라우터가 ① 명시적 검색요청(검색·찾아봐·구글…) ② 직전 봇이 검색 제안 + 사용자 동의(`AFFIRM`) 를 감지해 `forceSearch`로 전환. 그 외 후속 질문은 검색 off(화면 데이터로 답).

---

## Tips

- **3사 색상**: CGV 빨강(`#e6002d`) · 롯데시네마 블루(`#2563eb`) · 메가박스 보라(`#6b3fa0`). 롯데는 흰 배지 아웃라인(적색 중복 회피).
- **fetch 방식**: 롯데(`GetPlaySequence`)·메가박스(`schedulePage.do`)는 direct JSON(~0.1~0.3s, 좌석수 포함). **CGV만 browserless**(Cloudflare가 Node TLS 지문 차단 — direct HMAC 서명도 403).
- **SWR 캐시 + 스켈레톤**: fresh 120s / stale 30분(즉시 반환 + 백그라운드 갱신). CGV 콜드 7.3s → 웜 0.003s. 빠른 2사도 최소 320ms 스켈레톤 표시로 "번쩍" 방지, 3사 로딩 상태 일관.
- **CGV 콜드 ~2.5s**: `domcontentloaded` + 이미지/폰트/CSS 리소스 차단 + `api.cgv.co.kr/robots.txt` 직접 goto. 남은 floor=browserless 기동(실 Chrome spin-up).
- **채팅 변형 카드**: 칩 모바일 1열 / 데스크톱 2열, 패널 경량화(체인색 상단 액센트), 영화 `MOVIE_CAP=3` + 더보기, 회차 `CHIP_CAP=8` + 더보기.
- **좌석 부족 강조**: 잔여/총석 15% 미만이면 칩 테두리·좌석수 적색.
- **오늘 0건 시 내일 폴백**: 오늘 상영 회차 없으면 자동으로 내일 조회 후 `내일` 배지 표시.
- **지점 데이터**: `data/theater-branches.json`(3사 532지점) 빌드 타임 번들 → 드롭다운 즉시 표시(추가 요청 없음). 갱신은 `scripts/test-branch-list.mjs` 재스크랩 후 복사.
- **서울 리전**: `/api/showtimes`는 `preferredRegion='icn1'` — 한국 극장 API 접근(law-tool과 동일 이유).
