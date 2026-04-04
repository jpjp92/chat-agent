# Chart-Viz: Test Prompt Guide

Reference prompts for testing the `json:chart` renderer (ApexCharts).

---

## Renderer Schema

```json
{
  "type": "bar" | "line" | "pie" | "donut" | "scatter" | "radar" | "treemap",
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

---

## Chart Type Selection Guide

| Use Case | Type |
|----------|------|
| Trend over time | `line` |
| Category comparison | `bar` |
| Part-of-whole | `pie` or `donut` |
| X vs Y correlation | `scatter` |
| Multi-variable / skills | `radar` |
| Hierarchical size | `treemap` |

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

## 7. Multi-series

- "한국/일본/중국 수출액 추이 비교 (최근 10년)"
- "나이키, 아디다스, 뉴발란스 연매출 비교 bar chart"

---

## Tips

- **데이터 없을 때**: Gemini가 학습 데이터 기반 추정값으로 생성 — 출처 확인 권장
- **단일 데이터 포인트**: 시각화 가치가 없으면 테이블로 대신 응답
- `categories`는 `bar`, `line`, `radar`에 필수. `pie`, `donut`은 series name이 레이블
- scatter는 `data: [{x, y}]` 형식 사용
