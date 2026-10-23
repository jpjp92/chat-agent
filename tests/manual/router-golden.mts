/**
 * 라우터 골든셋 — 프롬프트를 고칠 때 **보지 않는** 동결 검증 세트. 기준: docs/guide/REF_ROUTER_LABELS.md
 *
 * 규율
 *   · 여기 문장을 근거로 프롬프트를 고치지 않는다. 고쳤다면 그 문장은 router-cases.mts(튜닝 세트)로 옮기고 새 문장을 채운다.
 *   · 기대값은 사람이 정한다. 세 분류기(Gemini·gpt-6-luna·Decisions)와 judge 가 갈린 문장만 다시 본다(probe-router-judge.mts).
 *   · 문장은 추가만 한다. 기대값을 바꾸면 `revised` 에 날짜와 이유를 남긴다.
 *
 * kind: positive(그 의도) · boundary(같은 분야 어휘, 다른 의도) · colloquial(구어체·축약·오타)
 */
import type { RouterCase } from './router-cases.mts';

export interface GoldenCase extends RouterCase {
    id: string;
    kind: 'positive' | 'boundary' | 'colloquial';
    added: string;
    revised?: string;
}

const g = (id: string, kind: GoldenCase['kind'], q: string, want: string, note = '', alt?: string[]): GoldenCase =>
    ({ id, kind, q, want, note, added: '2026-10-23', ...(alt ? { alt } : {}) });

/** v1 (10-23) — 텍스트 의도 17종 × 약 5문장. drug_id 는 이미지가 필요해 뺐다. */
export const GOLDEN_V1: GoldenCase[] = [
    // drug_info
    g('drug-1', 'positive', '판콜에이 먹으면 졸려?', 'drug_info'),
    g('drug-2', 'positive', '메트포르민 공복에 먹어도 돼?', 'drug_info', '복용 가능 여부(R4)'),
    g('drug-3', 'colloquial', '애기 부루펜 시럽 몇 미리 먹여', 'drug_info'),
    g('drug-4', 'boundary', '약 먹는 시간 알려주는 앱 추천', 'general', '약 어휘 · 앱'),
    g('drug-5', 'boundary', '약대 가려면 내신 몇 등급이야?', 'general', '진로'),
    // medical_qa
    g('med-1', 'positive', '손목터널증후군 증상이 뭐야', 'medical_qa'),
    g('med-2', 'positive', '대상포진 옆 사람한테 옮아?', 'medical_qa'),
    g('med-3', 'colloquial', '자고 일어나면 손가락이 뻣뻣함', 'medical_qa', '증상'),
    g('med-4', 'boundary', '의대 정원 늘린 이유가 뭐야', 'general', '의료 어휘 · 정책'),
    g('med-5', 'boundary', '병원비 카드 할부 되나요', 'general', '결제'),
    // pharmacy_search
    g('pha-1', 'positive', '해운대 지금 영업 중인 약국', 'pharmacy_search'),
    g('pha-2', 'positive', '대전 유성구 공휴일에 여는 약국', 'pharmacy_search'),
    g('pha-3', 'colloquial', '수원역 근처 약국 ㄱㄱ', 'pharmacy_search'),
    g('pha-4', 'boundary', '약국 아르바이트 시급 얼마야', 'general', '약국 어휘 · 일자리'),
    // hospital_search
    g('hos-1', 'positive', '부산 서면 이비인후과 알려줘', 'hospital_search'),
    g('hos-2', 'positive', '광주 주말에 진료하는 치과', 'hospital_search'),
    g('hos-3', 'colloquial', '이마 찢어졌는데 근처 응급실 어디', 'hospital_search'),
    g('hos-4', 'boundary', '치과의사 평균 연봉', 'general', '직업'),
    g('hos-5', 'boundary', '병원 개원 대출 받는 법', 'general', '창업·금융'),
    // vet_search
    g('vet-1', 'positive', '일산 강아지 슬개골 수술 잘하는 동물병원', 'vet_search'),
    g('vet-2', 'positive', '인천 고양이 중성화 동물병원', 'vet_search'),
    // vet-3 '강아지 예방접종 몇 개월에 맞아?' → 10-23 이 문장으로 프롬프트를 고쳐 router-cases.mts ROUTER_PET 으로 옮겼다
    g('vet-5', 'boundary', '고양이가 자꾸 토하는데 괜찮은 거야?', 'general', '동물 건강 — medical_qa 는 사람만'),
    g('vet-6', 'boundary', '토끼 이빨이 너무 길어졌는데 어떡해', 'general', '동물 건강'),
    g('vet-7', 'colloquial', '울집 강아지 귀에서 냄새남', 'general', '동물 건강 · 구어체'),
    g('vet-4', 'boundary', '동물병원 간호사 되려면 뭐 해야 돼', 'general', '진로'),
    // law_search
    g('lsr-1', 'positive', '개인정보 보호법 제17조 원문', 'law_search'),
    g('lsr-2', 'positive', '도로교통법 음주운전 조항 찾아줘', 'law_search'),
    g('lsr-3', 'positive', '근로기준법 조문 목록 보여줘', 'law_search'),
    g('lsr-4', 'boundary', '법조문 빨리 읽는 요령', 'general', '법 어휘 · 공부법'),
    // law_qa
    g('lqa-1', 'positive', '층간소음 신고하면 어떻게 돼?', 'law_qa'),
    g('lqa-2', 'positive', '미성년자 알바 밤 몇 시까지 할 수 있어?', 'law_qa', '허용 여부'),
    g('lqa-3', 'colloquial', '계약 3일 만에 해지하면 위약금 물어야 됨?', 'law_qa'),
    g('lqa-4', 'boundary', '변호사 수임료 평균 얼마야', 'general', '전문직 비용'),
    g('lqa-5', 'boundary', '부가세 신고 기간 언제야', 'general', '세금 절차(R5)'),
    // movie_search
    g('mov-1', 'positive', '왕십리 CGV 오늘 저녁 상영작', 'movie_search'),
    g('mov-2', 'positive', '롯데시네마 월드타워 내일 시간표', 'movie_search'),
    g('mov-3', 'colloquial', '강남 메박 지금 뭐함', 'movie_search'),
    g('mov-4', 'boundary', '넷플릭스 볼만한 영화 추천', 'general', 'OTT'),
    g('mov-5', 'boundary', '범죄도시 4 관객 수', 'general', '흥행 기록', ),
    // paper_search
    g('pap-1', 'positive', '비타민D랑 우울증 관련 연구 찾아줘', 'paper_search'),
    g('pap-2', 'positive', '수면 부족이 치매에 미치는 영향 논문', 'paper_search'),
    g('pap-3', 'colloquial', '장내 미생물이랑 비만 연구된 거 있어?', 'paper_search'),
    g('pap-4', 'boundary', '논문 APA 인용 형식 알려줘', 'general', '논문 어휘 · 형식'),
    g('pap-5', 'boundary', '조선시대 토지제도 논문 찾아줘', 'general', '인문·역사 — 두 DB 밖'),
    // arxiv_search
    g('arx-1', 'positive', 'LLM 환각 줄이는 방법 논문', 'arxiv_search'),
    g('arx-2', 'positive', '그래프 신경망 추천 시스템 arxiv 논문', 'arxiv_search'),
    g('arx-3', 'positive', '양자 오류 정정 최신 논문', 'arxiv_search'),
    g('arx-4', 'boundary', '머신러닝 공부 순서 알려줘', 'general', '학습'),
    // weather
    g('wea-1', 'positive', '광주 지금 기온 몇 도야', 'weather'),
    g('wea-2', 'positive', '이번 주말 강릉 비 와?', 'weather'),
    g('wea-3', 'colloquial', '낼 아침 서울 몇도', 'weather'),
    g('wea-4', 'boundary', '날씨 앱 뭐가 정확해?', 'general', '앱'),
    g('wea-5', 'boundary', '올해 장마 언제 끝나?', 'general', '계절 현상 — general+검색'),
    // biology
    g('bio-1', 'positive', '미토콘드리아 구조 3D로 보여줘', 'biology'),
    g('bio-2', 'positive', '항체 단백질 구조 시각화해줘', 'biology'),
    // bio-3 '세포 분열 과정 설명해줘' → 10-23 이 문장으로 medical_qa 범위를 고쳐 router-cases.mts ROUTER_BIO_EXPLAIN 으로 옮겼다
    { ...g('bio-4', 'boundary', '적혈구는 몸 어디서 만들어져?', 'general', '정상 생리 설명 — 건강 걱정 없음', ['biology', 'medical_qa']), revised: '2026-10-23 alt medical_qa — 사람 몸 원리는 Gemini 가 medical_qa 로 보내고, 답변 지침이 원리 설명으로 처리한다' },
    { ...g('bio-5', 'boundary', '사람 눈은 색을 어떻게 구분해?', 'general', '정상 생리 설명', ['biology', 'medical_qa']), revised: '2026-10-23 alt medical_qa — bio-4 와 같은 이유' },
    g('bio-6', 'boundary', '광합성이랑 세포호흡 차이', 'general', '생물 설명(사람 아님)', ['biology']),
    // 생물학 원리 13문장(10-23) — medical_qa 범위 수정 **뒤** 처음 잰 문장이다(수정 근거로 쓰지 않았다)
    g('bio-7', 'boundary', '뉴런은 어떻게 신호를 전달해?', 'general', '정상 생리', ['biology', 'medical_qa']),
    g('bio-8', 'boundary', '시냅스 가소성이 뭐야', 'general', '정상 생리', ['biology', 'medical_qa']),
    g('bio-9', 'boundary', 'iPSC 만드는 원리', 'general', '생명공학 원리', ['biology', 'medical_qa']),
    g('bio-10', 'boundary', '유도만능줄기세포랑 배아줄기세포 차이', 'general', '생명공학 비교', ['biology', 'medical_qa']),
    g('bio-11', 'boundary', 'CRISPR 유전자 가위 작동 원리', 'general', '생명공학 원리', ['biology']),
    g('bio-12', 'boundary', '미토콘드리아는 왜 에너지 공장이라고 해?', 'general', '세포 생물', ['biology', 'medical_qa']),
    g('bio-13', 'boundary', 'T세포랑 B세포 차이', 'general', '면역 원리', ['biology', 'medical_qa']),
    g('bio-14', 'boundary', '단백질 접힘이 뭐야', 'general', '분자 생물', ['biology']),
    g('bio-15', 'boundary', '장내 미생물은 무슨 역할 해?', 'general', '정상 생리', ['medical_qa']),
    g('bio-16', 'positive', '뉴런 구조 3D로 보여줘', 'biology'),
    g('med-8', 'positive', '알츠하이머에서 뉴런이 죽는 이유', 'medical_qa', '질병 기전'),
    g('med-9', 'positive', '항생제는 세균을 어떻게 죽여?', 'medical_qa', '치료 기전', ['general', 'drug_info']),
    g('pap-6', 'positive', 'iPSC로 파킨슨병 치료하는 연구 어디까지 왔어?', 'paper_search', '연구 현황', ['medical_qa']),
    g('med-6', 'positive', '인슐린 저항성이 생기는 이유', 'medical_qa', '질병 기전'),
    g('med-7', 'positive', '혈압이 갑자기 오르는 원인이 뭐야', 'medical_qa', '증상·질병 원인'),
    // chemistry
    g('chm-1', 'positive', '아스피린 분자 구조 보여줘', 'chemistry'),
    g('chm-2', 'positive', '메탄 연소 반응 구조식으로 그려줘', 'chemistry'),
    g('chm-3', 'boundary', '화학1 수능 공부법', 'general', '학습'),
    // physics
    g('phy-1', 'positive', '용수철 진동 시뮬레이션 보여줘', 'physics'),
    g('phy-2', 'positive', '경사면에서 공 굴러가는 시뮬레이션', 'physics'),
    g('phy-3', 'boundary', '물리학과 나오면 어디 취업해?', 'general', '진로'),
    // astronomy
    g('ast-1', 'positive', '오늘 밤 오리온자리 어디 떠?', 'astronomy'),
    g('ast-2', 'positive', '토성 고리 보여줘', 'astronomy'),
    g('ast-3', 'boundary', '별자리 궁합 봐줘', 'general', '운세'),
    // data_viz
    g('viz-1', 'positive', '최근 10년 서울 평균기온 그래프로', 'data_viz'),
    g('viz-2', 'positive', '코스피 1년 추이 차트로 보여줘', 'data_viz'),
    g('viz-3', 'boundary', '파워포인트 차트 예쁘게 꾸미는 법', 'general', '사용법'),
    // general
    g('gen-1', 'positive', '이메일로 정중하게 거절하는 문장 써줘', 'general'),
    g('gen-2', 'positive', '자바스크립트 async await 설명', 'general'),
    g('gen-3', 'positive', '제주도 흑돼지 맛집 추천', 'general'),
    g('gen-4', 'colloquial', 'ㅎㅇ 심심한데 퀴즈 내줘', 'general'),
];
