# Drug-Viz: Test Prompt Guide

Reference prompts for testing the `json:drug` renderer and the drug identification pipeline (MFDS + pharm.or.kr + DDG fallback).

---

## Renderer Schema

```json
{
  "name": "슈다페드정",
  "engName": "Sudafed Tab.",
  "ingredient": "슈도에페드린염산염 60mg",
  "category": "비충혈제거제 (코막힘 완화)",
  "dosage": "1회 1정, 1일 3~4회 식후 복용",
  "image_url": "https://nedrug.mfds.go.kr/...",
  "pharm_url": "https://www.pharm.or.kr/search/drugidfy/show.asp?idx=...",
  "pill_visual": {
    "shape": "round | oval | capsule | other",
    "color": "white | yellow | pink | blue | green | other",
    "imprint_front": "앞면 각인",
    "imprint_back": "뒷면 각인"
  },
  "efficacy": [
    { "label": "코막힘 완화", "icon": "fa-wind" }
  ]
}
```

---

## 1. Basic Drug Lookup (MFDS hit)

- "타이레놀 500 성분이랑 복용법 알려줘"
- "판콜에이 어떤 약이야?"
- "아목시실린 250mg 용법은?"
- "이부프로펜 400mg 효능 알려줘"

## 2. Pill Identification by Imprint (pharm.or.kr)

- "각인 ER 512 흰색 타원형 알약이 뭐야?"
- "앞면에 DL 뒷면에 50 찍힌 노란 원형 약 이름 알려줘"
- "하얀색 원형 알약인데 한쪽에 TYLENOL 500 써있어"

## 3. MFDS Fallback → DDG Search

Drugs not in MFDS DB — should trigger `search_web` tool call:

- "제놀 푸로탑 성분 알려줘"
- "게로비탈 효능이 뭐야?"
- "오쏘몰 이뮨 성분표 알려줘"

## 4. Image-based Identification (Vision Node)

Attach a pill photo and ask:

- "이 알약이 뭔지 알려줘"
- "사진 속 약 이름이랑 용법 알려줘"
- "이 캡슐이 무슨 약이야?"

### MFDS Local Pill DB (`mfds_pills`)

`mfds_pills` is the local Supabase copy of MFDS pill identification data. The current production flow uses it primarily for image-based pill identification:

1. Router detects image + medical/pill keyword.
2. Vision node extracts `imprint_front`, `imprint_back`, `color`, `shape`.
3. `identify_pill` calls `searchMfdsPills()` first.
4. If local MFDS lookup fails, it falls back to `pharm.or.kr` scraping.

Current runtime usage:

- Strongly used: image-based visual identification.
- Underused: text-based drug info lookup (`search_drug_info`) still calls the MFDS Open API directly.
- Underused: `/api/pill-search` still uses the legacy `searchPill()` path only.

DB audit snapshot (2026-06-04):

- Total rows: `22,555`
- `item_name`, `entp_name`, `chart`, `drug_shape`, `color_class1`, `item_image`, `etc_otc_name`: 100% populated
- `class_name`: 22,553 rows
- size fields (`leng_long`, `leng_short`, `thick`): about 99.8% populated
- rows with actual `mark_codes`: 2,117 rows (9.4%)
- rows without mark codes but with color/shape/image: 20,438 rows (90.6%)

Implications:

- The table is valuable beyond imprint search because name, class, OTC/Rx type, form, image, shape, color, and size are highly complete.
- Imprint-based identification is strong when `mark_codes` exist, but most pills require candidate ranking based on visual metadata rather than imprint alone.
- For text drug cards, `mfds_pills` can serve as a fast local source for visual/classification fields before or instead of a live MFDS API call.

## 5. Multi-Drug Comparison

- "타이레놀이랑 애드빌 차이 알려줘" — should return two `json:drug` blocks or a comparison
- "이부프로펜 vs 나프록센 어떤 게 더 강해?"

---

## Tips

- **pharm.or.kr 딥링크**: `pharm_url` 필드가 있으면 약품 카드 하단에 "약학정보원" 버튼 표시
- **ConnectDI 이미지**: `image_url`은 MFDS nedrug 이미지 URL 또는 ConnectDI에서 파싱한 URL
- **소스 칩**: DDG fallback 시 하단 소스 칩으로 출처 URL 표시됨
- **각인 검색 팁**: 각인은 대소문자 구분 없이 입력, 뒷면 생략 가능
