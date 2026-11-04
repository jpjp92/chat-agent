# PLAN — 물리 도해 SVG 운영 반영 (2026-11-03)

배경·시제품: [DEV_261103](../logs/2026/11/DEV_261103.md). 원칙: **LLM 은 물리량만 넘기고 방향·길이·라벨 자리는 코드가 계산한다**(시안 5개 중 4개가 경사면 방향을 틀렸다).

## 단계

| 단계 | 내용 | 사용자에게 보이는 변화 |
|---|---|---|
| 1 | 형식·렌더러 이식 — `parameters` 형식 추가, 기존 `forces` 계속 수용, 계산을 `lib/physics/` 로, SVG 렌더러 `components/PhysicsDiagram.tsx`, 검산·겹침 검사를 `npm test` 하니스로 | 없음(LLM 이 아직 `forces` 만 낸다) |
| 2 | 프롬프트 교체 — `server/agent/prompt.ts` 경사면·포물선 예시를 `parameters` 로. 실측(호출 수·비용 먼저 공지) | 새 도해 노출 시작 |
| 3 | 포물선 라벨 자동 배치(경사면 `incline-scene` 방식) | 모바일 포물선 라벨 |
| 4 | 자유물체도·충돌 이식, canvas 경로 제거 여부 결정 | — |

진행: 1~3단계 완료(11-03, 로컬 GPT·Gemini·모바일·라이트 확인). 4단계-A 충돌 완료(`{ m1, v1, m2, v2, kind, e? }`), 4단계-B 자유물체도 완료(`kind`·`angleDeg`·`magnitudeN?`) — 네 타입 모두 SVG. 4단계-C 완료(11-04) — 운영 옛 형식 11건, canvas 제거·안내 카드. 계획 종료. 범위 정정 — 질량·속력은 자르지 않는다(아래 "1단계 세부" 의 값 범위는 각도만 유효).

## 1단계 세부

- 분기: `ChatMessage` 가 `normalizePhysics` 로 판정 — `data.parameters` 가 있고 type 이 `inclined_plane`·`projectile` 이면 `PhysicsDiagram`, 아니면 기존 canvas. 저장된 옛 대화는 `forces` 형식이라 그대로 canvas 로 보인다.
- 값 검증: 범위 밖 값은 렌더러가 잘라 쓴다(경사각 5~60°, 질량 0.5~20kg, μ 0~1, 발사각 10~80°, 속력 5~40m/s) — 슬라이더 범위와 같다. 숫자가 아니면 canvas 로 떨어진다.
- 하니스: `tests/test-physics-diagram.mts` — 방향 내적·샘플 수치·포물선 + 672 장면 라벨 겹침 0.
- 시제품 미리보기(`tests/manual/prototypes/`)는 `lib/physics/` 를 import 하도록 바꿔 계산 코드를 하나로 둔다.

## 남는 판단

- `free_body` 는 힘 목록 자체가 문제마다 달라 `parameters` 로 줄이기 어렵다 — 4단계에서 "방향은 각도로 받되 라벨 자리만 코드가" 정도로 갈지 정한다.
