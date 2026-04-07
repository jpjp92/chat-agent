# Biology-Viz: Test Prompt Guide

Reference prompts for testing the `json:bio` renderer (NGL Viewer for 3D PDB, sequence viewer for 1D).

---

## Renderer Schema

### 3D Protein Structure (PDB) — preferred

```json
{
  "type": "pdb",
  "title": "Crambin",
  "data": {
    "pdbId": "1CRN",
    "name": "Crambin"
  }
}
```

### 1D Sequence Viewer

```json
{
  "type": "sequence",
  "title": "Insulin A",
  "data": {
    "sequence": "GIVEQCCTSICSLYQLENYCN",
    "name": "Human Insulin A Chain",
    "highlights": [
      { "start": 1, "end": 5, "label": "Active Site", "color": "#f87171" }
    ]
  }
}
```

> Rule: Always prefer `pdb` over `sequence` unless user explicitly asks for sequence view.

---

## 1. Protein 3D Structure

- "헤모글로빈 3D 구조 보여줘"
- "인슐린 단백질 구조 시각화해줘"
- "DNA 폴리머라아제 구조 보여줘"
- "리소자임 3D 구조"
- "콜라겐 단백질 구조 알려줘"

## 2. Enzyme

- "트립신 효소 구조"
- "아밀라아제 3D 구조 보여줘"
- "ATP 합성효소 시각화"
- "카탈라아제 구조"

## 3. DNA / RNA

- "DNA 이중나선 구조 보여줘" — PDB ID: 1BNA (B-form DNA)
- "tRNA 구조 시각화"
- "리보솜 구조" — PDB ID: 4V9D

## 4. Sequence Viewer

- "인슐린 A 체인의 아미노산 서열 보여줘"
- "헤모글로빈 알파 체인 서열에서 활성 부위 표시해줘"

## 5. Disease-related

- "알츠하이머와 관련된 아밀로이드 베타 구조 보여줘" — PDB: 5OQV
- "코로나바이러스 스파이크 단백질 구조" — PDB: 6VXX
- "낫 모양 적혈구 관련 헤모글로빈 S 구조"

---

## Tips

- **NGL Viewer**: Cartoon 표현, 체인별 색상 자동
- **모바일 툴팁**: 잔류기 정보는 탭 시 하단 패널로 표시
- **PDB ID 조회**: RCSB PDB (https://www.rcsb.org) 에서 확인 가능
- **autoView**: 렌더링 후 600ms 딜레이로 카메라 자동 조정
- **WebGL**: 탭 전환 시 context 자동 해제/재생성
