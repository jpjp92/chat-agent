# Chart-Viz: Test Prompt Guide

Reference prompts for testing the `json:chart` renderer (ApexCharts).

---

## Renderer Schema

```json
{
  "type": "bar" | "line" | "area" | "pie" | "donut" | "scatter" | "radar" | "treemap" | "heatmap",
  "title": "Chart Title",
  "data": {
    "categories": ["Jan", "Feb", "Mar"],
    "series": [
      { "name": "Series Name", "data": [10, 20, 30] }
    ]
  }
}
```

For `scatter`: `"data": [{ "x": 1.5, "y": 3.2 }, ...]`

For `treemap`: 단일 series, `"data": [{ "x": "라벨", "y": 값 }, ...]`

For `heatmap`: **행 하나당 series 하나**. `name` 이 행 라벨, 각 점이 `{ "x": "열 라벨", "y": 값 }` 이다. `categories` 는 필요 없다.

```json
{
  "type": "heatmap",
  "title": "요금제별 부가서비스 지원",
  "data": {
    "series": [
      { "name": "결제 관리", "data": [{ "x": "유심보호", "y": 0 }, { "x": "스팸차단", "y": 1 }] },
      { "name": "기기 보호", "data": [{ "x": "유심보호", "y": 1 }, { "x": "스팸차단", "y": 1 }] }
    ]
  }
}
```

---

## Chart Type Selection Guide

| Use Case | Type |
|----------|------|
| Trend over time | `line` (`area` for filled) |
| Category comparison | `bar` |
| Part-of-whole | `pie` or `donut` |
| X vs Y correlation | `scatter` |
| Multi-variable / skills | `radar` |
| Hierarchical size | `treemap` |
| 누적량 / 시간에 따른 구성비 | `area` (채운 면적이 의미를 가질 때만. 단순 추세는 `line`) |
| 두 범주 축이 교차하는 행렬 | `heatmap` (기능 지원표, 상관행렬, 요일×시간 활동량) |

---

## 1. Bar Chart

- "2023년 국가별 GDP 상위 10개국 막대 차트로 보여줘"
- "월별 평균 기온 비교 차트"
- "한국 연도별 인구 변화 bar chart"
- "BTS 앨범별 판매량 비교"

## 2. Line Chart

- "최근 5년간 비트코인 가격 추이 그래프"
- "코로나19 국내 확진자 추이 선 그래프"
- "삼성전자 주가 최근 1년 차트"
- "지구 평균 기온 상승 추이"

## 3. Pie / Donut

- "2024 파리 올림픽 메달 순위 상위 5개국 파이 차트"
- "한국 에너지원별 발전 비중 도넛 차트"
- "MZ세대 SNS 사용률 pie chart"

## 4. Scatter

- "키와 몸무게의 상관관계 산점도"
- "나라별 GDP vs 기대수명 scatter plot"
- "광고비 지출과 매출의 상관 분석"

## 5. Radar

- "손흥민과 메시의 능력치 레이더 차트로 비교해줘 (속도, 드리블, 슈팅, 패스, 체력, 수비)"
- "iPhone vs Galaxy 성능 비교 radar chart"
- "국가별 삶의 질 지표 비교 (교육, 의료, 안전, 경제, 환경)"

## 6. Treemap

- "S&P 500 섹터별 시가총액 비중 treemap"
- "코딩 언어별 깃허브 사용 비중"
- "국가별 탄소 배출량 비교 treemap"

## 7. Heatmap

- "통신사 요금제별 부가서비스 지원 여부를 표로 비교해줘"
- "요일 × 시간대별 웹사이트 방문량 히트맵"
- "주요 자산군 간 상관계수 행렬 히트맵 (주식, 채권, 금, 원유, 비트코인)"
- "국가별 연도별 이산화탄소 배출량 히트맵"

## 8. Multi-series

- "한국/일본/중국 수출액 추이 비교 (최근 10년)"
- "나이키, 아디다스, 뉴발란스 연매출 비교 bar chart"

---

## Tips

- **실제 통계는 검색으로**: `data_viz` 도 라우터 `needs_search` 를 따른다(11-05) — 인구·가격·연도별 지수는 검색 on, `y = x²` 같은 함수 그래프는 off. 예전엔 렌더러 의도라 검색을 강제로 꺼 학습 지식으로 그렸다(출생아 2024년 "21만 예측", 실제 238,317명)
- **흩어진 수치로 차트 금지**: 기사마다 다른 시점·기준의 숫자를 모아 한 차트에 넣지 않는다 — 같은 출처·기준의 연속 값이 없으면 본문·표로
- **x축**(11-05, [PLAN_CHART_AXIS_261105](../plans/PLAN_CHART_AXIS_261105.md)): 선·영역·산점도의 숫자 `{x,y}` 와 **간격이 불균등한** 숫자 범주(1970·1980·2000·2020)는 numeric 축 — 실제 간격 보존, 깔끔한 눈금, `straight` 선, 가로 스크롤 없음. 등간격 숫자 범주 10개 이하(2020~2025, −0.4…0.4)·문자열 범주·막대는 category(등간격이어도 10개 초과면 numeric — 함수 샘플이 스크롤되지 않게)(범주 축은 `monotoneCubic`, 10개 넘으면 가로 스크롤). 판정은 `components/chart-axis.ts`
- **숫자 표시**(11-05, [PLAN_CHART_P1_261105](../plans/PLAN_CHART_P1_261105.md)): y축은 한국어 만·억(그 밖 k·M·B), 툴팁은 원본 수치 + 단위(`1,006,645명`). 선택 필드 `yAxis.unit` 은 **원자료 단위**(명·원·%) — 헤더에 `· 단위: 명`. 단위가 이미 `만 명`·`억 원` 이면 재축약 안 함. 마커: 산점도 6 · 결측 선 4 · 점 ≤ 10 인 numeric 선 4(관측점). 규칙은 `components/chart-format.ts`
- **렌더러 보정**(`ChartRenderer.tsx`, 11-05): 값 2개 미만 시리즈는 빼고 값 3개 이상 시리즈가 없으면 차트를 안 그림 · 결측이 있을 때만 점 표시 · 등장 애니메이션은 처음 한 번
- **단일 데이터 포인트**: 시각화 가치가 없으면 테이블로 대신 응답
- `categories`는 `bar`, `line`, `radar`에 필수. `pie`, `donut`은 series name이 레이블(단일 시리즈 `[{x,y}]` 도 받는다 — x 가 레이블)
- scatter는 `data: [{x, y}]` 형식 사용
- **heatmap 색은 값의 크기 하나로만 칠해진다.** 한 히트맵 안에 단위·스케일이 다른 값을 섞으면 색이 의미를 잃는다
- **heatmap 의 빈 칸은 "아니오"가 아니라 "모름"으로 읽힌다.** 예/아니오 행렬은 `1`/`0` 으로 채우고 본문에서 그 의미를 밝힌다
- **heatmap 행 순서**: ApexCharts 는 첫 series 를 맨 아래에 쌓으므로 렌더러가 행을 뒤집어 준다 — 모델이 쓴 순서 그대로 위에서 아래로 읽힌다 ([ChartRenderer.tsx](../../components/ChartRenderer.tsx))
- **area 는 `line` 과 데이터 형식이 같다.** 채운 면적이 누적·구성비를 뜻할 때만 고른다
