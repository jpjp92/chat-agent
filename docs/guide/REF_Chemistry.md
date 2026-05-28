# Chemistry-Viz: Test Prompt Guide

Reference prompts for testing the `json:smiles` renderer (smiles-drawer).

---

## Renderer Schema

```json
{
  "smiles": "CCO",
  "text": "Ethanol"
}
```

- `smiles`: Valid SMILES string
- `text`: Display name shown below the structure

---

## 1. Simple Molecules

- "에탄올 구조식 보여줘"
- "물 분자 구조 그려줘"
- "아세트산(식초) 분자 구조 알려줘"
- "포도당(글루코스) 구조식 보여줘"
- "암모니아 분자 그려줘"

## 2. Drug / Pharmaceutical

- "아스피린 분자 구조 보여줘"
- "이부프로펜 화학구조식 알려줘"
- "카페인 분자 그려줘"
- "타이레놀(아세트아미노펜) SMILES 구조 보여줘"
- "페니실린 구조"

## 3. Complex / Aromatic

- "벤젠 구조 보여줘"
- "나프탈렌 구조식"
- "콜레스테롤 분자 구조 그려줘"
- "도파민 구조식 알려줘"
- "DNA 염기 아데닌 구조"

## 4. Reaction Context

- "에탄올이 산화되면 어떤 분자가 돼? 구조도 보여줘"
- "메탄올과 에탄올의 구조 차이 설명해줘"
- "에스터 반응에서 만들어지는 에틸아세테이트 구조"

---

## Tips

- SMILES 렌더링은 smiles-drawer 라이브러리 기반 (SVG 출력)
- **SVG Export**: 구조 이미지 오른쪽 상단 버튼으로 PNG/SVG 다운로드 가능
- **ViewBox 반응형**: 데스크톱 768px / 모바일 자동 스케일링
- 복잡한 분자(콜레스테롤 등)는 가로 스크롤로 확인
- SMILES 문법 오류 시 렌더링 실패 → Gemini가 검증된 IUPAC 기반 SMILES 사용
