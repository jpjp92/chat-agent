# OpenAI Image2 인포그래픽 테스트 계획 및 1차 결과 — 2026-06-02

> 대상 모델: `gpt-image-2-2026-04-21`  
> 라우팅/구조화 모델: `gemini-2.5-flash-lite`  
> 테스트 스크립트: `scripts/openai-image2-pipeline-test.mjs`  
> 출력 경로: `scripts/image-gen-output/openai-image2-pipeline/`

---

## 목적

서비스에 이미지 생성 기능을 넣기 전, 단순 작동 여부가 아니라 운영 관점의 품질/비용/속도 기준을 잡는다.

검증 목표:

1. `gpt-image-2-2026-04-21` 모델 접근 가능 여부
2. `low`/`medium` 품질 차이와 latency
3. 인포그래픽 텍스트 가독성, 특히 한국어 텍스트 안정성
4. `Gemini -> JSON -> prompt builder -> OpenAI image` 파이프라인 재사용성
5. 실제 과금 추정
6. 서비스 기본값과 premium 옵션 후보 결정

---

## 테스트 파이프라인

```txt
User input
  -> gemini-2.5-flash-lite
  -> infographic JSON
  -> prompt builder
  -> OpenAI Images API
  -> PNG + prompt + report JSON 저장
```

생성 스크립트:

```bash
node scripts/openai-image2-pipeline-test.mjs
```

주요 옵션:

```bash
--samples 1|2
--quality low|medium|high
--size 1536x1024
--text-lang en|ko
--density normal|dense
--model gpt-image-2-2026-04-21
```

모델 fallback 순서:

```txt
gpt-image-2-2026-04-21
-> gpt-image-2
-> gpt-image-1.5
-> gpt-image-1
```

참고: 첫 구현에서 `response_format` 파라미터를 보냈을 때 OpenAI Image API가 `Unknown parameter: 'response_format'`를 반환했다. 공식 가이드 흐름에 맞춰 해당 파라미터를 제거했고 이후 정상 생성됨.

---

## 1차 생성 결과

공통 조건:

```txt
size = 1536x1024
format = png
model = gpt-image-2-2026-04-21
```

| Case | Layout | Text | Density | Quality | Gemini structuring | Image latency | Output image tokens | Total tokens | Result |
|---|---|---|---|---|---:|---:|---:|---:|---|
| CPU vs GPU | cards | EN | normal | low | 2.03s | 25.90s | 158 | 442 | PASS |
| Redis vs Kafka vs RabbitMQ | cards | EN | normal | low | 2.06s | 27.83s | 158 | 422 | PASS |
| CPU vs GPU | cards | KO | normal | low | 2.36s | 29.85s | 158 | 438 | PASS |
| CPU vs GPU | cards | KO | dense | low | 3.04s | 45.04s | 158 | 541 | PASS |
| CPU vs GPU | cards | KO | dense | medium | 3.08s | 61.69s | 1372 | 1769 | PASS |
| Cell respiration | cards | KO | normal | low | 2.86s | 35.30s | 158 | 438 | PASS |
| Projectile motion | cards | KO | normal | low | 2.38s | 37.29s | 158 | 461 | PASS |
| Cell respiration | diagram | KO | normal | low | 3.06s | 31.76s | 158 | 481 | PASS |
| Myelin/action potential | diagram | EN | normal | low | 2.71s | 33.11s | 158 | 487 | PASS |

### Diagram subtype smoke test / English / low

조건:

```txt
case-set = subtypes
quality = low
size = 1536x1024
text-lang = en
density = normal
model = gpt-image-2-2026-04-21
```

스크립트 변경:

- `--case-set subtypes` 추가.
- `--case-ids` 필터 추가: 실패한 subtype만 재시도 가능.
- 각 subtype case가 자체 `layout`, `subtype`을 갖도록 변경.
- Gemini 구조화 단계에서 503/UNAVAILABLE/high demand도 transient로 보고 다음 key로 넘어가도록 보완.

결과:

| Subtype | Topic | Image latency | Output image tokens | Result |
|---|---|---:|---:|---|
| `flow` | Cellular respiration | 42.15s | 158 | PASS |
| `anatomy` | Myelinated axon | 36.15s | 158 | PASS |
| `architecture` | Transformer encoder block | 37.28s | 158 | PASS |
| `sequence` | TCP three-way handshake | 30.74s | 158 | PASS |
| `state_machine` | Online order lifecycle | 30.65s | 158 | PASS |
| `circuit` | RC low-pass filter | 24.90s | 158 | PASS |
| `signal_flow` | Audio DSP chain | 30.19s | 158 | PASS |
| `force` | Simply supported beam | 36.55s | 158 | PASS |
| `cycle` | Four-stroke engine | 29.84s | 158 | PASS |
| `map_cutaway` | Subduction zone | 34.81s | 158 | PASS |
| `graph` | Stress-strain curve | 35.04s | 158 | PASS after Gemini retry |
| `schematic` | Distillation column | 32.20s | 158 | PASS |
| `cutaway` | Gearbox | 27.63s | 158 | PASS after Gemini retry |
| `reaction_pathway` | SN1 reaction | 38.50s | 158 | PASS |
| `process_flow` | ETL pipeline | 29.13s | 158 | PASS |
| `decision_tree` | Web search routing | 32.75s | 158 | PASS |

Latency summary:

```txt
count = 16
average image latency = 33.03s
min = 24.90s
max = 42.15s
total image latency = 528.51s
```

대표 report:

```txt
report-1780387527822.json
report-1780387662153.json
report-1780387801756.json
```

관찰:

- low 조건에서는 모든 subtype이 output image tokens 158로 고정됐다.
- subtype별 prompt 길이는 다르지만, low output token은 안정적으로 유지됐다.
- Gemini 503은 발생 가능하므로 이미지 생성 pipeline에서도 키 로테이션/재시도 정책이 필요하다.
- `graph`, `circuit`, `reaction_pathway`는 이미지가 생성되더라도 수식/회로/화학식 정확도 육안 검수가 필요하다.
- `pipeline`, `sequence`, `state_machine`, `decision_tree`, `process_flow`는 서비스형 설명 이미지로 우선순위가 높다.

### Non-figure style smoke test / low

도식/텍스트북 figure 외 이미지 스타일 재현력을 확인하기 위해 `--case-set styles`를 추가했다.

조건:

```txt
case-set = styles
quality = low
size = 1536x1024
density = normal
model = gpt-image-2-2026-04-21
```

스크립트 변경:

- `STYLE_CASES` 추가.
- 각 style case에 `visualStyle`을 지정하고 prompt builder에서 우선 적용.
- 스타일 테스트는 도식 정확도보다 스타일 재현력, 텍스트 가독성, 서비스 활용도를 본다.

English style baseline:

| Style | Topic | Image latency | Output image tokens | Result |
|---|---|---:|---:|---|
| editorial magazine poster | AI workflow overview | 39.31s | 158 | PASS |
| isometric 3D vector | Cloud data pipeline | 26.28s | 158 | PASS |
| whiteboard sketch | Product idea map | 26.27s | 158 | PASS |
| engineering blueprint | Robotic arm schematic | 39.77s | 158 | PASS |
| 3D clay render | App feature icons | 31.61s | 158 | PASS |
| flat vector illustration | Learning roadmap | 30.67s | 158 | PASS |
| comic explainer | UI cache bug | 26.81s | 158 | PASS |
| photoreal product scene | AI study assistant desk | 35.04s | 158 | PASS |

English latency summary:

```txt
count = 8
average image latency = 31.97s
min = 26.27s
max = 39.77s
all low outputs = 158 image tokens
```

Korean style text check:

| Style | Topic | Image latency | Output image tokens | Result |
|---|---|---:|---:|---|
| editorial magazine poster | AI workflow overview | 32.29s | 158 | PASS |
| whiteboard sketch | Product idea map | 26.32s | 158 | PASS |
| comic explainer | UI cache bug | 37.77s | 158 | PASS |

Korean latency summary:

```txt
count = 3
average image latency = 32.13s
min = 26.32s
max = 37.77s
all low outputs = 158 image tokens
```

한국어 육안 검토:

- `editorial magazine poster`: 한글 제목/섹션/본문은 전반적으로 읽힘. 다만 잡지형 포스터보다는 3카드 인포그래픽으로 수렴했다.
- `whiteboard sketch`: 한글 손글씨 스타일이 가장 자연스럽고 읽기 쉬움. 짧은 질문형 문장과 중심 키워드에 적합하다.
- `comic explainer`: 한글 단계 설명과 말풍선 텍스트가 대체로 안정적. UI 버그 설명 같은 절차형 콘텐츠에 적합하다.
- 스타일 테스트에서도 low output image tokens는 158로 유지됐다.
- 한국어 스타일 이미지는 가능하지만, 긴 문장보다 짧은 제목/라벨/말풍선 중심으로 제한하는 편이 안정적이다.

스타일 리스크:

- `comic explainer` 한국어 샘플(`style-comic-explainer-cache-bug...1780388490241.png`)에서 왼쪽 사람 캐릭터의 팔/손 형태가 부정확하게 생성됐다.
- 이는 `low` 품질의 세부 형태 보정 한계일 가능성이 크지만, 단순히 quality 문제만은 아니다. 사람, 손, 팔, 스마트폰을 잡는 포즈처럼 관절/신체 구조가 들어가면 `medium`에서도 실패 가능성이 남는다.
- UI 설명/버그 설명 목적이라면 사람 캐릭터를 기본 제외하고, `phone/browser mockup + arrows + labels` 중심의 패널형 comic으로 제한하는 편이 안정적이다.
- 캐릭터가 꼭 필요하면 full body나 손 동작 대신 bust/avatar/icon character 수준으로 제한하고, `no visible hands`, `no complex arm poses`, `no character holding a phone` 같은 제약을 prompt에 넣는다.
- 인체가 포함된 결과는 텍스트가 정상이어도 해부학적 오류 때문에 서비스 품질이 낮아 보일 수 있으므로 QA 기준에서 별도 체크해야 한다.

스타일별 1차 활용 판단:

```txt
high priority = whiteboard sketch, comic explainer, isometric, flat vector, 3D clay
medium priority = editorial poster, blueprint, photoreal product scene
needs careful QA = human characters/hands, blueprint/schematic, photoreal text surfaces, dense editorial layout
```

Comic explainer prompt 권장:

```txt
Use UI panels only.
Show browser or phone mockups, arrows, labels, and status icons.
Do not include human characters.
Do not draw hands, arms, or people holding devices.
Keep Korean text short and readable.
```

대표 report:

```txt
report-1780388335343.json
report-1780388490243.json
```

대표 출력:

```txt
scripts/image-gen-output/openai-image2-pipeline/
```

- `cpu-vs-gpu-gpt-image-2-2026-04-21-low-1536x1024-1780378188477.png`
- `redis-kafka-rabbitmq-gpt-image-2-2026-04-21-low-1536x1024-1780378219572.png`
- `cpu-vs-gpu-gpt-image-2-2026-04-21-low-1536x1024-1780378410747.png`
- `cpu-vs-gpu-gpt-image-2-2026-04-21-low-1536x1024-1780378899523.png`
- `cpu-vs-gpu-gpt-image-2-2026-04-21-medium-1536x1024-1780379107330.png`
- `biology-cell-respiration-gpt-image-2-2026-04-21-low-1536x1024-1780384439433.png`
- `physics-projectile-motion-gpt-image-2-2026-04-21-low-1536x1024-1780384480316.png`
- `biology-cell-respiration-gpt-image-2-2026-04-21-low-1536x1024-1780384798277.png`
- `neuro-myelin-action-potential-gpt-image-2-2026-04-21-low-1536x1024-1780385535048.png`
- `subtype-flow-cell-respiration-gpt-image-2-2026-04-21-low-1536x1024-1780387052401.png`
- `subtype-anatomy-myelinated-axon-gpt-image-2-2026-04-21-low-1536x1024-1780387091919.png`
- `subtype-architecture-transformer-gpt-image-2-2026-04-21-low-1536x1024-1780387132823.png`
- `subtype-sequence-tcp-handshake-gpt-image-2-2026-04-21-low-1536x1024-1780387166873.png`
- `subtype-state-machine-order-gpt-image-2-2026-04-21-low-1536x1024-1780387201147.png`
- `subtype-circuit-rc-filter-gpt-image-2-2026-04-21-low-1536x1024-1780387229595.png`
- `subtype-signal-flow-audio-dsp-gpt-image-2-2026-04-21-low-1536x1024-1780387263618.png`
- `subtype-force-beam-load-gpt-image-2-2026-04-21-low-1536x1024-1780387304118.png`
- `subtype-cycle-four-stroke-engine-gpt-image-2-2026-04-21-low-1536x1024-1780387336870.png`
- `subtype-map-cutaway-plate-tectonics-gpt-image-2-2026-04-21-low-1536x1024-1780387375063.png`
- `subtype-schematic-distillation-gpt-image-2-2026-04-21-low-1536x1024-1780387413475.png`
- `subtype-reaction-pathway-sn1-gpt-image-2-2026-04-21-low-1536x1024-1780387457412.png`
- `subtype-process-flow-etl-gpt-image-2-2026-04-21-low-1536x1024-1780387490693.png`
- `subtype-decision-tree-search-routing-gpt-image-2-2026-04-21-low-1536x1024-1780387527788.png`
- `subtype-cutaway-gearbox-gpt-image-2-2026-04-21-low-1536x1024-1780387662140.png`
- `subtype-graph-stress-strain-gpt-image-2-2026-04-21-low-1536x1024-1780387801748.png`
- `style-editorial-poster-ai-workflow-gpt-image-2-2026-04-21-low-1536x1024-1780388093640.png`
- `style-isometric-cloud-pipeline-gpt-image-2-2026-04-21-low-1536x1024-1780388123771.png`
- `style-whiteboard-sketch-product-idea-gpt-image-2-2026-04-21-low-1536x1024-1780388153536.png`
- `style-blueprint-robot-arm-gpt-image-2-2026-04-21-low-1536x1024-1780388197406.png`
- `style-3d-clay-app-icons-gpt-image-2-2026-04-21-low-1536x1024-1780388232390.png`
- `style-flat-vector-learning-roadmap-gpt-image-2-2026-04-21-low-1536x1024-1780388267299.png`
- `style-comic-explainer-cache-bug-gpt-image-2-2026-04-21-low-1536x1024-1780388296840.png`
- `style-photoreal-product-desk-gpt-image-2-2026-04-21-low-1536x1024-1780388335335.png`
- `style-editorial-poster-ai-workflow-gpt-image-2-2026-04-21-low-1536x1024-1780388417726.png`
- `style-whiteboard-sketch-product-idea-gpt-image-2-2026-04-21-low-1536x1024-1780388448346.png`
- `style-comic-explainer-cache-bug-gpt-image-2-2026-04-21-low-1536x1024-1780388490241.png`

---

## 품질 관찰

### English normal / low

- 3카드 인포그래픽 구조가 안정적.
- 제목, 카드 heading, bullet 텍스트가 전반적으로 읽힘.
- 카드당 텍스트가 길어지면 줄바꿈이 촘촘해질 조짐이 있음.

### Korean normal / low

- 한글 제목과 카드 텍스트가 대부분 정상 렌더링됨.
- `역할`, `장점`, `주의할 점`, `사용 예시` 라벨이 안정적.
- 짧은 명사구 중심이면 서비스 사용 가능 수준.

### Korean dense / low

- dense 조건에서도 한글 깨짐은 거의 없음.
- 3카드까지는 읽을 수 있으나 카드 내부가 촘촘해짐.
- 발표용/공유용 기본값으로는 다소 답답하고, 정보 카드에 가까움.
- latency가 normal low 대비 증가함.

### Korean dense / medium

- 시각적 완성도, 여백, 카드 균형은 low보다 좋음.
- latency가 61.69s로 서비스 기본값으로는 부담.
- output image tokens가 low의 158에서 1372로 증가.
- 한국어 전용 지시에도 일부 라벨이 `Role`, `Pros`, `Watchout`, `Use case`처럼 영어로 나옴.

### Science cards / low

- 생물/물리 주제를 기존 카드형 prompt로 생성하면 내용은 읽히지만 도식이 아니라 카드형 요약으로 수렴한다.
- 세포호흡, 포물선 운동처럼 흐름/공간/방향이 중요한 주제는 카드형보다 `diagram`이 적합하다.
- science cards 2건 모두 output image tokens는 158로 low 비용 안정성은 유지.

### Cell respiration diagram / Korean / low

- `--layout diagram` 적용 후 카드형이 아닌 left-to-right flow 도식으로 생성됨.
- 한글 텍스트와 ATP/H2O/CO2 등 시각 요소는 대체로 안정적.
- 일부 단계명이 부정확하거나 반복됨: `해당 과정` 중복, 표준 단계명 미고정.
- 세포호흡 도식은 Gemini 구조화 단계에서 `Glycolysis`, `Pyruvate oxidation`, `Citric acid cycle`, `Electron transport chain`, `ATP synthesis` 같은 canonical term을 먼저 고정해야 함.

### Myelin/action potential diagram / English / low

- textbook-style diagram으로 가장 안정적인 결과를 보임.
- `Myelin Sheath`, `Nodes of Ranvier`, `Saltatory Conduction`, `Direction of Signal Propagation` 등 영어 canonical label이 잘 렌더링됨.
- 뉴런 구조, myelin segment, node gap, signal direction arrow가 표현됨.
- 단점: `Resting Potential -> Depolarization -> Repolarization` 전기생리 단계와 myelin anatomy 설명이 하나의 timeline처럼 섞임.
- 개선 방향: Panel A(anatomy)와 Panel B(membrane potential graph)를 분리하도록 prompt builder에서 강제.

---

## 비용 관찰

사용자가 OpenAI usage 화면에서 공유한 누적 비용:

```txt
gpt-image-2-2026-04-21 text input         $0.008
gpt-image-2-2026-04-21 image output       $0.060
gpt-image-2-2026-04-21 image input        $0
gpt-image-2-2026-04-21 cached image input $0
```

공유된 비용 시점 기준 성공 이미지 4장에 대한 단순 평균:

```txt
$0.068 / 4 images ~= $0.017 per image
```

이후 science/diagram low 테스트도 output image tokens가 158로 유지됐다. 단, `medium`은 output image token이 크게 증가했으므로 quality별 단가를 분리해 추적해야 한다.

추정:

```txt
low    ~= $0.01~$0.02 / image
medium ~= $0.06+ / image 가능성
```

사용량별 rough estimate:

| Usage | low 기준 | medium 기준 |
|---:|---:|---:|
| 100 images | ~$1.7 | ~$6+ |
| 1,000 images | ~$17 | ~$60+ |
| 10,000 images | ~$170 | ~$600+ |

---

## 운영 결론

현재 1차 결과 기준:

```txt
default quality = low
premium/regenerate quality = medium
high = 보류
```

권장 기본값:

```txt
size = 1536x1024
quality = low
textLanguage = routed by intent/domain, not always user language
density = normal
layout = Gemini-selected(cards | diagram | pipeline ...)
cards = 2~3, max 4 when layout=cards
```

한국어 텍스트 제한 권장:

```txt
제목: 12~18자 내외
카드 heading: 8~12자 내외
각 항목: 12~18자 내외
카드당 항목: 4개 이하
문장보다 명사구 우선
```

Dense 사용 기준:

```txt
3 cards dense = 가능하지만 기본값으로는 답답함
4 cards dense = 위험
6+ cards = 현재 크기에서는 비추천
```

---

## 이미지 텍스트 언어 라우팅 기준

이미지 안 텍스트 언어는 사용자 채팅 언어만으로 결정하지 않는다. 이미지 텍스트의 목적, 도메인 정확도, canonical term 필요성, 텍스트 밀도를 함께 본다.

기본 원칙:

```txt
default = user language
override to English = academic diagram, engineering schematic, CS architecture, graph/circuit/reaction
mixed = Korean explanation + English canonical labels
minimal = photoreal/product/illustrative styles
```

라우팅 표:

| 의도/도메인 | 권장 이미지 텍스트 언어 | 용어 정책 | 이유 |
|---|---|---|---|
| 일반 요약 카드 | 사용자 언어 | `translate` | 사용자가 바로 읽는 목적 |
| 서비스 사용법/UX 설명 | 사용자 언어, 한국 사용자면 `ko` | `translate` | 안내/가이드 성격 |
| Comic explainer | 사용자 언어 | `translate`, 짧은 말풍선 | 한국어 짧은 문장도 안정적 |
| Whiteboard sketch | 사용자 언어 | `translate`, 짧은 질문/키워드 | 한국어 손글씨 스타일 안정적 |
| 마케팅/소셜 포스터 | 타깃 사용자 언어 | `translate` | 메시지 전달 우선 |
| 학술/논문/textbook figure | `en` 우선 | `keep_english` | canonical label 정확도 |
| 생물/의학 diagram | `mixed` 또는 `en` | `bilingual_labels` 또는 `keep_english` | 용어 정확도 중요 |
| 물리/수학 graph | `en` 우선 | `keep_english`, 축/단위 고정 | 축/단위/기호 안정성 |
| 회로/화학 반응 | `en` 우선 | `keep_english`, 텍스트 최소화 | 심볼/전문 용어 안정성 |
| 컴퓨터공학 architecture/pipeline | `en` 우선 | `keep_english` | API, cache, queue, DB 등 영어가 자연스러움 |
| 국내 발표/교육자료 | `mixed` | `bilingual_labels` | 한국어 설명 + 핵심 영문 용어 |
| Photoreal/product scene | `minimal` | `minimal_text` | 표면 텍스트 왜곡 리스크 |
| Dense infographic | `en` 또는 `minimal` | `minimal_text` | 한글도 가능하지만 overflow 리스크 |

라우팅 의사결정:

```txt
if user explicitly requests Korean:
  use ko
  if academic/technical canonical terms exist:
    use mixed with English terms in parentheses

else if layout is diagram and domain is academic/science/engineering:
  use en

else if domain is computer_science/system_architecture/protocol:
  use en

else if output is user-facing guide/comic/whiteboard/marketing:
  use user language

else if text density is high or exact labels matter:
  use en or minimal

else:
  use user language
```

권장 JSON 필드:

```json
{
  "image_text_language": "ko | en | mixed | minimal",
  "language_reason": "user_facing | canonical_terms | technical_standard | text_accuracy_risk | explicit_user_request",
  "term_policy": "translate | keep_english | bilingual_labels | minimal_text",
  "canonical_terms": ["Node of Ranvier", "Action potential"],
  "translated_terms": [
    { "ko": "랑비에 결절", "en": "Node of Ranvier" }
  ]
}
```

Prompt builder 적용:

```txt
ko:
- Use crisp readable Korean text only.
- Keep labels short and avoid long sentences.

en:
- Use precise English labels only.
- Do not translate canonical scientific/technical terms.

mixed:
- Use Korean headings with English canonical terms in parentheses.
- Example: 랑비에 결절 (Node of Ranvier)

minimal:
- Avoid visible text except 1 short title or icon labels.
- Prefer visual symbols, arrows, and UI mockups.
```

주의:

- 사용자가 한국어로 질문해도 textbook figure, 회로도, 화학 반응 경로, CS architecture는 영어 라벨이 더 안정적일 수 있다.
- 사용자-facing 가이드, comic, whiteboard, 마케팅 이미지는 한국어가 자연스럽고 실제 테스트에서도 가독성이 좋았다.
- `mixed`는 너무 많은 병기를 넣으면 overflow가 생기므로 핵심 용어 3~6개까지만 병기한다.
- 언어 라우팅 결정은 Gemini 구조화 단계에서 먼저 고정하고, OpenAI image prompt에는 동일 정책을 명시한다.

---

## 사용자 의도 기반 생성 제어 체계

이미지 생성 품질은 OpenAI image 모델에 바로 긴 prompt를 던지는 방식보다, 서비스가 먼저 생성 가능 범위와 실패 위험을 좁힌 뒤 모델에 넘기는 방식이 안정적이다.

권장 구조:

```txt
User request
  -> intent/domain classifier
  -> layout router
  -> language/term router
  -> service guardrails
  -> Gemini structuring JSON
  -> deterministic prompt builder
  -> OpenAI image generation
  -> QA/check result
  -> optional regenerate with stricter constraints
```

역할 분리:

| 단계 | 담당 | 결정 내용 | 이유 |
|---|---|---|---|
| Intent/domain classifier | 서비스 + Gemini | 비교/요약/도식/스타일/학문 분야 | 사용자 표현은 자유롭지만 서비스 동작은 제한된 타입이어야 함 |
| Layout router | 서비스 rule 우선 | `cards`, `diagram`, `pipeline`, `decision_tree` 등 | layout 실패는 결과 전체를 망치므로 사전 제약 필요 |
| Language/term router | 서비스 rule + Gemini 보조 | `ko`, `en`, `mixed`, `minimal` | 사용자 언어와 이미지 텍스트 최적 언어가 다를 수 있음 |
| Service guardrails | 서비스 rule | max cards/nodes/visible words, 금지 요소 | 비용/가독성/정확도 리스크를 줄이는 고정 정책 |
| Structuring JSON | Gemini | title, labels, nodes, flow, constraints | 자유 텍스트를 이미지용 구조로 변환 |
| Prompt builder | deterministic code | 최종 prompt 문장화 | 같은 입력 정책이면 일관된 prompt가 나와야 함 |
| QA/check | 서비스 + 사용자/LLM 보조 | 텍스트 가독성, domain accuracy, anatomy risk | 생성 성공과 사용 가능 품질은 별개 |

Rule-based로 먼저 고정할 항목:

```txt
quality default = low
size default = 1536x1024
density default = normal
max cards = 3 default, 4 only for explicit comparison
max visible Korean text = short labels/phrases only
academic/science/engineering diagrams = en or mixed by default
human hands/arms/people holding devices = disabled by default
photoreal/product scene = minimal visible text
medium = explicit regenerate/premium only
high = disabled until cost baseline confirmed
```

Gemini에 맡길 항목:

```txt
topic normalization
domain detection
candidate layout reason
canonical term extraction
short Korean label drafting
flow/node/edge draft
must_show/avoid suggestions
```

서비스가 Gemini 결과를 검증해야 하는 항목:

```txt
layout_type is supported
text_language is allowed for the domain
card/node count is within limits
Korean labels are short enough
canonical_terms count is within limits
forbidden visual elements are not requested
technical diagrams include must_show/avoid
```

초기 구현 판단:

- 생성 모델에 “알아서 예쁘게” 맡기는 방식은 카드형 요약에는 가능하지만, 학문/공학 도식과 한국어 텍스트에서는 실패 편차가 크다.
- 서비스는 먼저 좁은 schema와 guardrail을 적용하고, Gemini는 그 안에서 구조화만 담당하는 편이 맞다.
- 사용자가 “멋지게”, “자세히”, “한국어로 많이”처럼 위험한 요구를 해도 그대로 반영하지 말고, 이미지 안 텍스트는 짧게 제한한 뒤 나머지는 채팅 본문 설명으로 보완한다.

---

## Layout 유형 확장

이미지 생성은 단순 카드형 인포그래픽만으로 제한하지 않는다. Gemini 구조화 단계에서 `layout_type`을 먼저 결정하고, 해당 layout에 맞는 prompt builder를 사용한다.

권장 layout taxonomy:

| Layout | 용도 | 예시 | 주의점 |
|---|---|---|---|
| `cards` | 개념 비교, 요약 카드 | CPU vs GPU, Redis vs Kafka | 카드당 텍스트 제한 필수 |
| `diagram` | 과학/공학 구조 설명, 작동 원리 | 세포호흡, 뉴런 활동전위, 회로 흐름 | 라벨 정확도 강제 필요 |
| `pipeline` | 시스템/서비스/데이터 흐름 | chat-agent pipeline, upload flow | node/edge JSON 고정 필요 |
| `timeline` | 시간 순서, 발전 과정 | AI 모델 발전사, 프로젝트 로드맵 | 날짜/단계 수 제한 |
| `matrix` | 기준별 비교 | 도구 3개 x 기준 4개 | 3x4 이상은 텍스트 깨짐 위험 |
| `decision_tree` | 선택/진단/라우팅 기준 | 검색 필요 여부, 품질 선택 | yes/no 분기 짧게 유지 |
| `mindmap` | 개념 관계/분류 | 세포호흡 구성요소, agent 구성 | 중심 주제와 가지 수 제한 |
| `poster` | 1장 요약/발표용 | 논문 요약, 회의록 요약 | 본문을 이미지에 과도하게 넣지 않기 |

학문/공학 분야별 권장 layout:

| 분야 | 주로 적합한 layout | 예시 | 라벨/정확도 기준 |
|---|---|---|---|
| 생물학/의학 | `diagram`, `cycle`, `anatomy` | 세포호흡, 뉴런, 혈액순환, 단백질 구조 | 핵심 용어는 영어 canonical term 우선, 한국어는 보조 캡션 |
| 물리학 | `diagram`, `force`, `graph` | 포물선 운동, 전기장, 파동, 열역학 사이클 | 벡터 방향, 축 이름, 단위 고정 필요 |
| 컴퓨터공학 | `pipeline`, `architecture`, `state_machine`, `sequence` | TCP handshake, Transformer, DB transaction, LangGraph flow | 노드/엣지명은 JSON에서 고정, 임의 단계 추가 금지 |
| 지구과학 | `map_cutaway`, `cycle`, `timeline` | 판구조론, 암석 순환, 대기 순환, 지층 단면 | 공간 위치와 방향성이 중요, 지도/단면 혼합 주의 |
| 기계공학 | `schematic`, `cycle`, `force`, `cutaway` | 4행정 엔진, 터빈, 기어박스, 응력-변형률 | 부품명, 힘 방향, 입력/출력 흐름 고정 |
| 전기전자 | `circuit`, `signal_flow`, `graph` | RC 회로, op-amp, 필터 응답, 디지털 로직 | 회로 심볼 정확도가 중요, 복잡 회로는 텍스트 설명 병행 |
| 화학/화공 | `reaction_pathway`, `process_flow`, `schematic` | 반응 메커니즘, 증류탑, 촉매 사이클 | 화학식/화살표 정확도 한계가 있어 짧은 canonical label 권장 |
| 수학/통계 | `graph`, `matrix`, `concept_map` | 분포 비교, 최적화 landscape, 선형대수 변환 | 수식 렌더링은 위험하므로 축/라벨 중심 |
| 경제/사회과학 | `matrix`, `timeline`, `causal_loop` | 수요공급, 정책 효과 경로, 연구 설계 | 인과 방향과 변수명 짧게 유지 |

추가 diagram subtype 후보:

```txt
flow
anatomy
architecture
sequence
state_machine
circuit
signal_flow
force
cycle
map_cutaway
graph
schematic
cutaway
reaction_pathway
process_flow
decision_tree
```

서비스 우선순위:

```txt
1. cards
2. diagram
3. pipeline
4. timeline
5. decision_tree
6. matrix
7. mindmap
8. poster
```

서비스 관점에서는 `cards`를 기본 요약형으로 두고, 학문/공학 질문에서 구조/흐름/방향/축/부품/신호가 핵심이면 `diagram` 계열로 라우팅한다. 컴퓨터공학은 일반 `diagram`보다 `pipeline`, `architecture`, `sequence`, `state_machine` subtype을 구분하는 편이 prompt 재사용성이 높다.

권장 JSON schema 초안:

```json
{
  "layout_type": "cards | diagram | pipeline | timeline | matrix | decision_tree | mindmap | poster",
  "image_text_language": "ko | en | mixed | minimal",
  "language_reason": "user_facing | canonical_terms | technical_standard | text_accuracy_risk | explicit_user_request",
  "term_policy": "translate | keep_english | bilingual_labels | minimal_text",
  "title": "short title",
  "subtitle": "short subtitle",
  "language": "ko",
  "cards": [],
  "nodes": [],
  "edges": [],
  "flow": [],
  "canonical_terms": [],
  "translated_terms": [],
  "constraints": {
    "max_visible_words": 80,
    "max_cards": 4,
    "max_nodes": 8,
    "text_density": "normal"
  }
}
```

---

## Diagram 분류 기준

`diagram`은 단순 설명 카드가 아니라, 구조/흐름/위치/방향/상호작용이 중요한 경우에 사용한다.

대표 트리거:

```txt
process, flow, pathway, mechanism, cycle, structure, anatomy,
signal, potential, force, vector, circuit, reaction pathway,
도식, 흐름, 과정, 구조, 원리, 회로, 벡터, 경로, 전달
```

예시:

| Query | Recommended layout | 이유 |
|---|---|---|
| `myelin sheath action potential` | `diagram` | 뉴런 구조, 수초, 랑비에 결절, 전기 신호 이동 방향이 핵심 |
| `세포호흡 플로우` | `diagram` | 해당과정 -> TCA -> 전자전달계 -> ATP 생성 흐름 |
| `포물선 운동 속도 벡터` | `diagram` | 궤적, 속도 벡터, 중력 가속도 방향 표시 필요 |
| `CPU vs GPU` | `cards` 또는 `matrix` | 비교 요약이 핵심 |
| `LangGraph agent pipeline` | `pipeline` | 단계별 시스템 흐름이 핵심 |

`myelin sheath action potential` 도식 prompt builder 권장 구조:

```json
{
  "layout_type": "diagram",
  "title": "Myelin Sheath and Action Potential",
  "flow": [
    { "label": "Axon", "description": "nerve signal path", "visualCue": "long neuron fiber" },
    { "label": "Myelin sheath", "description": "insulates the axon", "visualCue": "segmented wrapping" },
    { "label": "Node of Ranvier", "description": "signal jumps between nodes", "visualCue": "small gaps" },
    { "label": "Action potential", "description": "electrical impulse moves forward", "visualCue": "arrows along axon" },
    { "label": "Saltatory conduction", "description": "faster signal transmission", "visualCue": "jumping arrow path" }
  ],
  "constraints": {
    "must_show": ["axon", "myelin sheath", "node of Ranvier", "direction arrows"],
    "avoid": ["comparison cards", "dense paragraphs", "unlabeled anatomy"]
  }
}
```

품질상 주의:

- 과학 도식은 보기 좋게 나와도 라벨/위치가 틀릴 수 있으므로 Gemini 구조화에서 `must_show`, `avoid`, `flow`를 강하게 고정한다.
- 한국어 도식은 가능하지만, 고유명사는 영어 병기 권장: `랑비에 결절(Node of Ranvier)`.
- 복잡한 생물 구조는 `low`로 먼저 생성 후 필요 시 `medium` regenerate가 적합하다.
- 논문/텍스트북 figure 스타일은 영어 canonical term을 기본으로 사용한다. 한국어 설명은 채팅 본문이나 보조 캡션에 두는 편이 더 정확하다.

Textbook figure prompt 개선안:

```txt
Create two clearly separated panels:
Panel A: myelinated axon anatomy
- Axon
- Myelin sheath
- Node of Ranvier
- Direction of action potential

Panel B: membrane potential graph
- Resting potential
- Depolarization
- Repolarization
- Time
- Membrane potential (mV)

Do not merge anatomy labels with the graph timeline.
Use precise English scientific labels only.
Do not add extra labels.
```

---

## 남은 테스트 매트릭스

1. `medium normal` 1장 생성: medium이 dense가 아닌 경우에도 비용/latency가 크게 증가하는지 확인
2. `high` 1장 생성: premium 품질 후보인지, 비용이 과도한지 확인
3. `4 cards normal` 테스트: 서비스 최대 카드 수 확정
4. `6 cards sparse` 테스트: 카드 수 한계 확인
5. 한국어 긴 문장 2개 이상 포함 테스트: overflow/오탈자 한계 확인
6. `diagram` 추가 테스트: `myelin sheath action potential`, 회로도, 화학 반응 경로
7. `pipeline`, `timeline`, `decision_tree` layout별 1장씩 smoke test
8. Rate limit 테스트: 5 images/min 제한에서 queue 필요성 확인

### 한국어 추가 테스트 매트릭스

한국어는 “생성 가능 여부”보다 텍스트 길이, 문장성, layout 밀도, domain term 처리에 따른 실패 경계를 확인해야 한다.

우선순위 높은 테스트:

| Test | Layout | Text policy | 목적 | 성공 기준 |
|---|---|---|---|---|
| 짧은 비교 카드 | `cards` | `ko` | 기본 한국어 카드 품질 재확인 | 제목/라벨/항목이 모두 읽힘 |
| 4카드 비교 | `cards` | `ko` | 카드 수 한계 확인 | overflow 없이 핵심 라벨 판독 가능 |
| 긴 문장 스트레스 | `cards` | `ko` | 문장형 텍스트 실패 경계 확인 | 긴 문장 왜곡 여부 기록, 기본값 제외 판단 |
| 한국어 comic UI 설명 | `comic/panel` | `ko` | 사용자-facing 절차 설명 가능성 확인 | 사람/손 없이 UI panel 중심으로 생성 |
| 한국어 whiteboard | `whiteboard` | `ko` | 짧은 키워드/질문형 설명 확인 | 손글씨 스타일 가독성 유지 |
| 생물 도식 mixed | `diagram` | `mixed` | 한국어 설명 + 영문 canonical label 확인 | 핵심 용어 3~6개 병기, overflow 없음 |
| CS architecture Korean request | `architecture` | `en` 또는 `mixed` | 사용자가 한국어로 물어도 영어 라벨 라우팅이 나은지 확인 | API/cache/queue/DB 라벨 안정성 |
| photoreal Korean text | `photoreal` | `minimal` | 표면 텍스트 왜곡 리스크 확인 | 텍스트 최소화가 더 안정적인지 비교 |

테스트 문장 후보:

```txt
CPU와 GPU 차이를 한국어 카드 3장으로 짧게 설명해줘
Redis, Kafka, RabbitMQ를 한국어 4카드로 비교해줘
초보자가 이해할 수 있게 각 카드에 긴 한국어 설명문을 넣어줘
캐시 버그가 생기는 과정을 사람 없이 브라우저 화면과 화살표로 설명해줘
제품 아이디어를 한국어 화이트보드 스케치로 정리해줘
세포호흡 과정을 한국어 설명과 영어 핵심 용어를 함께 넣어 도식화해줘
LangGraph agent pipeline을 한국어 사용자를 위한 구조도로 만들어줘
AI 공부 도우미 책상 장면을 만들어줘. 이미지 안 텍스트는 최소화해줘
```

한국어 QA 항목:

```txt
title_readable
section_labels_readable
body_text_readable
hangul_misspelling_or_garbling
line_break_overflow
mixed_term_accuracy
english_label_intrusion_when_ko_required
layout_followed
visual_artifact_risk
```

---

## 사용량 제한 초안

이미지 생성은 latency와 비용이 모두 크므로 채팅 응답 생성보다 강한 제한이 필요하다. 1차 테스트 기준 `low`도 25~45초, `medium`은 60초대까지 걸렸고, 현재 tier 기준 분당 이미지 제한도 작다.

권장 기본 정책 초안:

| 사용자/상황 | 권장 제한 | 품질 기본값 | 비고 |
|---|---:|---|---|
| 비로그인/게스트 | 0~1 images/day | low | 비용 보호 우선. 초기에는 비활성화도 가능 |
| 무료 로그인 사용자 | 3 images/day, 1 image/min | low | 재시도 포함 일일 한도 차감 |
| 일반 유료/프리미엄 | 30 images/day, 3 images/min | low 기본, medium 선택 | medium은 별도 크레딧 차감 권장 |
| 관리자/테스트 계정 | 100 images/day, 5 images/min | low/medium | 운영 검증용, 별도 allowlist |
| 전체 서비스 글로벌 | 5 images/min 이하에서 시작 | low | tier1 rate limit 보호, queue 필수 |

초기 구현 권장:

```txt
per-user daily limit = 3 images/day for free users
per-user burst limit = 1 active image job
global concurrency = 2
global rate = 4 images/min
default quality = low
medium = premium/regenerate only
high = disabled until cost baseline confirmed
```

큐 정책:

```txt
Queue: BullMQ 또는 Supabase-backed job table
Concurrency: 2
Retry: max 1 automatic retry for transient 429/5xx
Retry delay: use Retry-After when present, otherwise exponential backoff 30s -> 60s
Timeout: 90s per image job
Cancellation: user can cancel queued/running UI state, server cancel is best-effort
```

차감 기준:

- 요청 접수 시 `reserved` 상태로 1회 차감하고, API 호출 전 취소되면 환불한다.
- OpenAI API 호출이 시작된 뒤 실패하면 실패 원인별로 처리한다.
- 429/5xx 같은 provider 오류는 자동 재시도 1회까지 무료 처리한다.
- prompt 정책 위반, 사용자 취소, 과도한 텍스트로 인한 품질 실패는 자동 환불하지 않는다.
- `medium`은 `low` 대비 output image token이 크게 증가하므로 3~4 크레딧 차감 후보로 둔다.

운영 계측 필수 필드:

```txt
user_id
session_id
job_id
model
quality
size
layout_type
text_language
image_text_language
language_reason
term_policy
canonical_terms
prompt_hash
input_prompt_tokens
output_image_tokens
total_tokens
latency_ms
estimated_cost_usd
status
error_code
created_at
```

초기 정책 결론:

```txt
무료 기본값은 low + 1536x1024 + normal density.
동시 생성은 사용자당 1개로 제한.
전역 동시성은 2부터 시작.
medium/high는 비용 baseline이 더 쌓일 때까지 명시적 옵션으로만 제공.
```

---

## 구현 시 고려사항

- 이미지 생성은 25~60초 latency가 발생할 수 있으므로 UI에서는 job 상태/진행 상태 표시가 필요하다.
- 동시 생성은 rate limit과 비용 폭주를 막기 위해 queue 기반으로 제한해야 한다.
- 기본 생성은 `low`, 재생성/고품질 옵션은 `medium`으로 분리한다.
- 생성 결과는 prompt, model, quality, size, usage, latency를 함께 저장해 사후 비용 분석이 가능해야 한다.
- 한국어 텍스트는 가능하지만 prompt builder에서 텍스트 길이 제한을 강하게 걸어야 한다.
- 이미지 텍스트 언어는 사용자 언어가 아니라 도메인/의도/정확도 기준으로 라우팅해야 한다.
- 학문/공학 도식은 보기 좋은 결과보다 라벨 정확도가 우선이므로, Gemini JSON 단계에서 `must_show`, `avoid`, `labels`, `edges`, `panels`를 먼저 고정한다.
- 사람/손/팔이 포함된 스타일 이미지는 anatomy 오류 리스크가 있으므로 기본 prompt에서는 제외하고, 필요 시 `medium` regenerate 및 별도 QA 대상으로 둔다.
