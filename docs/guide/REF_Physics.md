# Physics: 물리 도해 (`json:diagram`)

인터랙티브 SVG 카드 4종 — 경사면·포물선·충돌·자유물체도. **LLM 은 물리량만 넘기고, 화살표 방향·길이·라벨 자리·결과값은 코드가 계산한다.**
AI 시안 5개 중 4개가 경사면 벡터 방향을 틀렸고(DEV_261103), canvas 시절에는 LLM 이 쓴 라벨 문자열을 키워드로 찾다가 "중력 (19.6 N)" 의 `N)` 을 수직항력으로 오인했다.

| 구성 | 위치 |
|------|------|
| 물리 계산 | `lib/physics/model.ts` — `incline` · `projectile` · `collision` · `freeBody` |
| 화면 배치(라벨 후보 탐색·viewBox) | `lib/physics/*-scene.ts`, 공용 `layout.ts` |
| 형식 판정·범위 | `lib/physics/params.ts` — `normalizePhysics` |
| 렌더러 | `components/PhysicsDiagram.tsx` (Tailwind, `dark:`, ko/en — es·fr 은 en) |
| 분기 | `components/ChatMessage.tsx` — 판정 통과는 SVG, 실패(옛 형식)는 `LegacyDiagramNotice` 안내 |
| 프롬프트 | `server/agent/prompt.ts` `diagram` 조각 — physics 의도일 때만 실린다 |
| 하니스 | `tests/test-physics-diagram.mts` — 방향 내적·수치 검산·라벨 겹침(경사면 672·포물선 600·충돌 324·자유물체도 288 장면) |
| 계획·경위 | [PLAN_PHYSICS_SVG_261103](../plans/PLAN_PHYSICS_SVG_261103.md) · [DEV_261103](../logs/2026/11/DEV_261103.md) |

canvas 렌더러(`DiagramRenderer.tsx`)는 11-04 제거. 옛 형식(`forces` 최상위 · `before/after` · `launchAngle`) 블록은 "같은 질문을 다시 하면 새 도해로" 안내 카드로 보인다(운영 잔량 11건).

---

## 의도 분류

`physics` 의도일 때만 도해 프롬프트가 실린다. 라우터 정의: "show a physics diagram or simulation — forces on an object (free-body, inclined plane), projectile, collision, …". 설명만 원하면 `general`, **설명을 그림과 함께** 원하면 `physics`([REF_ROUTER_LABELS](REF_ROUTER_LABELS.md) 규칙 3).

---

## 스키마

공통: `{ "type": …, "title": 15자 안팎, "parameters": { … } }`. 카드 부제에 조건(각도·질량 등)이 표시되므로 제목은 짧게.

### inclined_plane — 경사면

```json
{ "type": "inclined_plane", "title": "경사면 운동", "parameters": { "angleDeg": 30, "massKg": 2, "mu": 0.2 } }
```

- `angleDeg` 5~60 (밖은 잘린다 — 라벨 배치를 검증한 범위), `massKg` 문제 값 그대로(0.1~10000), `mu` 0~1. **마찰 없는 경사면은 `mu` 생략**(0 을 넣으면 마찰 슬라이더가 생긴다).
- 오른쪽이 높은 경사면. 탭 "작용하는 힘"(mg·N·f) / "중력 성분 분해"(mg sinθ·mg cosθ). 정지·미끄러짐 판정(μs=μk 단순화).

### projectile — 포물선

```json
{ "type": "projectile", "title": "포물선 운동", "parameters": { "launchDeg": 45, "speed": 20 } }
```

- `launchDeg` 10~80, `speed` 문제 값 그대로(1~200 m/s).
- 가로·세로 같은 축척, 시간 슬라이더, θ 호·v₀ 화살표, H 치수선(발사점 왼쪽), 비행 시간·최고 높이·사거리.

### collision — 1차원 충돌

```json
{ "type": "collision", "title": "완전비탄성 충돌", "parameters": { "m1": 2, "v1": 3, "m2": 1, "v2": 0, "kind": "perfectly_inelastic" } }
```

- 1 이 왼쪽, + 가 오른쪽(왼쪽으로 가면 음수). `kind`: `elastic` | `inelastic` | `perfectly_inelastic`. `e`(반발계수 0~1)는 `inelastic` 이고 문제에 있을 때만.
- 충돌 후 속도는 운동량 보존 + 반발계수로 렌더러가 계산. 서로 다가가지 않으면 "충돌하지 않음".

### free_body — 자유물체도

```json
{
  "type": "free_body", "title": "물에 뜬 공",
  "parameters": {
    "object": { "shape": "circle", "label": "공" },
    "forces": [
      { "kind": "gravity", "angleDeg": 270, "magnitudeN": 4.91 },
      { "kind": "buoyancy", "angleDeg": 90, "magnitudeN": 4.91 }
    ]
  }
}
```

- `kind`: `gravity`·`normal`·`friction`·`tension`·`buoyancy`·`drag`·`applied`·`spring`·`other` → 기호 mg·N·f·T·F_b·D·F·F_s. `label` 은 `other` 만(6자).
- `angleDeg`: 0 = 오른쪽, 90 = 위(물리 표준). `magnitudeN` 은 **전부 주거나 전부 생략** — 전부 있을 때만 알짜힘 계산(합의 0.5% 미만은 평형). 없으면 같은 길이 + 각주.
- 힘 1~8개. 같은 방향(±8°) 화살표는 옆으로 비켜 그린다.

---

## 테스트 프롬프트

| 질문 | 기대 |
|------|------|
| 경사각 30도 빗면에서 마찰계수 0.2인 2kg 물체에 작용하는 힘 그려줘 | a 3.21 m/s², f 는 빗면 위쪽 |
| 경사각 10도, 마찰계수 0.5, 5kg 물체는 미끄러질까? | 도해 포함, 정지(a 0) |
| 마찰 없는 37도 경사면 위 물체의 힘 분석해줘 | a 5.90, μ 슬라이더·f 없음 |
| 100kg 물체가 30도 경사면에 있을 때 힘 그려줘 | mg 981.00 N(잘리지 않음) |
| 초속 20m/s, 발사각 60도 포물선 운동 그려줘 | T 3.53 · H 15.29 · R 35.31 |
| 10도로 낮게 던진 공의 궤적 보여줘 | 속력 기본 20, v₀ 라벨이 화살표 끝 |
| 2kg 공이 3m/s로 정지한 1kg 공과 완전비탄성 충돌하는 상황 그려줘 | 함께 +2.00 m/s, 손실 3.00 J |
| 5kg 물체가 2m/s, 1kg 물체가 반대 방향 6m/s, 반발계수 0.5로 충돌 | 0 · +4.00 m/s, 손실 20.00 J |
| 물에 뜬 공에 작용하는 힘 그려줘 | 평형(알짜힘 0) |
| 10kg 상자를 40N으로 수평으로 밀고 마찰계수 0.3일 때 자유물체도 | ΣF 10.57 N 오른쪽 |
| 경사면에서 물체가 미끄러지는 원리를 그림과 수식으로 쉽게 설명해줘 | physics 의도 → 경사면 카드 |
| 경사면에서 물체가 왜 미끄러져? | general — 텍스트 답 |
| 경사면 위 물체 힘 그려줘 / 포물선 운동 보여줘 / 충돌 시각화해줘 / 자유물체도 보여줘 | 값 없음 → LLM 이 교과서 값 선택 + 가정 한 문장 |

화면 확인: 모바일 폭(축약 라벨 `mg∥`·`H`·`R`, 슬라이더 한 줄씩, 지표 2×2) · 라이트/다크 · 영어 질문은 영어 카드.

---

## 답변 본문 규칙 (프롬프트)

값이 빠진 요청("경사면 그려줘")은 LLM 이 교과서 첫 예제 수준의 값을 직접 골라 구성하고, 가정한 값을 본문 한 문장으로 밝힌다(코드에 기본값을 고정하지 않는다). 카드가 값·계산을 보여 주므로 본문은 결론과 핵심 식 하나만. 숫자를 쓰면 g = 9.81(카드와 일치). 수치 조건이 있는 예/아니오 질문에도 도해를 붙인다.
