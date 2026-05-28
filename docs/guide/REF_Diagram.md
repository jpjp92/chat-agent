# Diagram-Viz: 경사면 힘 다이어그램 테스트 가이드

`json:diagram` + `type: "inclined_plane"` 렌더러 전용 테스트 프롬프트.  
그 외 물리 다이어그램 타입(free_body / projectile / collision)은 **REF_Physics.md** 참조.

---

## 스키마

```json
{
  "type": "inclined_plane",
  "angle": 30,
  "showBaseline": true,
  "showAngle": true,
  "forces": [
    { "label": "중력 (mg)",          "angle": 90,  "magnitude": 1.5,  "color": "#0066CC" },
    { "label": "수직항력 (N)",        "angle": -60, "magnitude": 1.3,  "color": "#FFA500" },
    { "label": "평행 분력 (mg sinθ)", "angle": 30,  "magnitude": 0.75, "color": "#00CC00" },
    { "label": "수직 분력 (mg cosθ)", "angle": -60, "magnitude": 1.3,  "color": "#87CEEB" },
    { "label": "마찰력 (f)",          "angle": 210, "magnitude": 0.5,  "color": "#FF0000" }
  ]
}
```

**Angle convention** (inclined_plane 전용): 0° = right, 90° = **down**, -90° = up, 180° = left  
※ free_body 타입은 90° = up (물리 표준) — 타입별로 다름

---

## 1. 기본 경사면

- "30도 경사면에서 물체에 작용하는 힘을 다이어그램으로 보여줘"
- "45도 경사면의 힘 분석 그려줘"
- "마찰이 없는 경사면에서 중력 분력 다이어그램"

## 2. 마찰 포함

- "경사각 30도, 마찰계수 0.3인 경사면 힘 다이어그램"
- "미끄러지지 않는 물체가 경사면에서 받는 모든 힘 표시해줘"
- "정지마찰력과 수직항력 비교 다이어그램"

## 3. 분력 분석

- "수직항력과 중력의 관계를 경사면에서 그려줘"
- "mg sinθ와 mg cosθ 분력 시각화 (θ=40도)"
- "경사면에서 알짜힘이 0인 평형 상태 다이어그램"

## 4. 교육 활용

- "물리 교과서에 나오는 경사면 힘 분석 도식"
- "수능 물리 경사면 문제풀이용 힘 다이어그램"
- "빗면 위 물체 등속도 운동 조건 다이어그램"

---

## Tips

- **magnitude**: 상대적 비율값 (1.0 = 중간 화살표)
- **color 권장**: 중력 `#0066CC`, 수직항력 `#FFA500`, 마찰력 `#FF0000`, 분력 `#00CC00`
- `showBaseline: true` — 수평 기준선 표시
- `showAngle: true` — 경사각 θ 표시
