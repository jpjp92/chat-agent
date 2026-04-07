# Constellation-Viz: Test Prompt Guide

Reference prompts for testing the `json:constellation` renderer (HTML5 Canvas star map).

---

## Renderer Schema

```json
{
  "stars": [
    {
      "id": 0,
      "ra": 5.919,
      "dec": 7.407,
      "mag": 0.42,
      "name": "Betelgeuse",
      "constellation": "ori"
    }
  ],
  "constellations": [
    {
      "id": "ori",
      "name": { "ko": "오리온자리", "en": "Orion", "es": "Orión", "fr": "Orion" },
      "lines": [[0, 1], [1, 2]]
    }
  ],
  "center": { "ra": 5.5, "dec": 0.0 },
  "zoom": 1.5
}
```

- `ra`: Right Ascension in hours (0–24)
- `dec`: Declination in degrees (-90 to 90)
- `mag`: Apparent magnitude (lower = brighter; 0.0 is very bright, 6.0 is faint)
- `lines`: Star connection lines using `id` pairs to form constellation patterns
- `center` + `zoom`: Optional viewport control

---

## 1. Zodiac Constellations

- "오리온자리 별자리 보여줘"
- "전갈자리 보여줘"
- "사자자리 시각화해줘"
- "처녀자리 별지도 그려줘"
- "쌍둥이자리 보여줘"

## 2. Northern Sky Highlights

- "북두칠성 보여줘"
- "카시오페이아자리 그려줘"
- "큰곰자리와 작은곰자리 함께 보여줘"
- "페르세우스자리"

## 3. Southern / Summer / Winter Sky

- "여름철 대삼각형 보여줘 (독수리자리, 백조자리, 거문고자리)"
- "겨울철 육각형 별자리 시각화"
- "남십자자리 보여줘"

## 4. Notable Stars

- "시리우스가 포함된 별자리 보여줘"
- "북극성과 주변 별자리 그려줘"
- "베텔게우스와 리겔이 있는 별자리"
- "알데바란 별 포함 황소자리"

## 5. Multi-Constellation View

- "황도 12궁 모두 보여줘"
- "봄철 별자리 3개 함께 그려줘"
- "오리온자리 주변 별자리 전부 보여줘"

---

## Tips

- **실시간 하늘**: 렌더러는 현재 날짜/시간 기준 별 위치 자동 계산 (일주운동 포함)
- **zoom**: 1.0 기본, 2.0 이상은 특정 별자리 확대 뷰
- **mag 기준**: 2.0 이하 = 밝은 별, 4.0 이상 = 희미한 별
- **Milky Way**: 은하수 파티클 클라우드 자동 렌더링
- **Time Travel**: "2000년 1월 1일 자정 오리온자리 보여줘" 처럼 과거/미래 요청 가능
- **줌 레벨**: 줌이 높을수록 별 이름 레이블 자세히 표시됨
