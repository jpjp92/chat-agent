import type { IntentType } from "./state.js";

const KOREAN_MEDICAL_KEYWORDS = [
    '알약', '약품', '캡슐', '명칭', '식별', '무슨 약',
    '용법', '용량', '성분', '부작용', '주의사항', '효능', '효과', '복용',
    '정제', '필름정', 'mg정', '산제', '시럽', '의약품', '약사', '처방'
];

const MEDICAL_WORD_PATTERN = /(?:^|\s)약(?:$|\s|이|을|은|에|과|도|은|는)/;
const MULTILINGUAL_MEDICAL_PATTERN = /(^|[^\p{L}\p{N}_])(pill|tablet|capsule|drug|medication|medicine|dosage|dose|side effects?|ingredients?|prescription|pharmacist|pastilla|tableta|c[aá]psula|medicamento|medicina|dosis|efectos secundarios|ingredientes?|receta|farmac[eé]utico|comprim[eé]|g[eé]lule|m[eé]dicament|posologie|effets secondaires|ingr[eé]dient|ordonnance|pharmacien)(?=$|[^\p{L}\p{N}_])/iu;
const AMBIGUOUS_IMAGE_IDENTIFICATION_PATTERN = /(이거|이것|사진|이미지|분석|확인|식별|뭔지|무엇|뭐야|알려|봐줘|판독|identify|analy[sz]e|what is this|check this|read this|image|photo|imagen|foto|identificar|analizar|qué es|que es|image|photo|identifier|analyser|qu'est-ce que|c'est quoi)/i;

const FALLBACK_RULES: Array<{ intent: Exclude<IntentType, "drug_id" | "drug_info" | "general">; pattern: RegExp }> = [
    {
        intent: "law_search",
        pattern: /(법령|법률|법안|조항|제\d+\s*조|몇\s*조|도로교통법|교통법|소방법|소방기본법|민법|형법|상법|근로기준법|근로법|개인정보\s*보호법|개인정보법|판례|헌재|행정규칙|고시|법령해석|korean law|statute|legal article|article\s+\d+|law provision|loi coréenne|article de loi|ley coreana|artículo legal)/i,
    },
    {
        intent: "pharmacy_search",
        pattern: /(약국|pharmacy|pharmacies|drugstore|farmacia|farmacias|pharmacie|pharmacies)/i,
    },
    {
        intent: "vet_search",
        pattern: /(동물병원|동물 병원|동물의원|동물 의료|동물의료|수의사|수의과|veterinary|veterinarian|animal hospital|pet hospital|vet clinic|vétérinaire|veterinaire|clinique vétérinaire|clinique veterinaire|hôpital pour animaux|hopital pour animaux|veterinario|clínica veterinaria|clinica veterinaria|hospital de animales)/i,
    },
    {
        intent: "hospital_search",
        pattern: /(병원|의원|응급실|hospital|clinic|emergency room|urgent care|doctor near|hôpital|hopital|clinique|urgences|médecin près|medecin pres|hospital|clínica|clinica|urgencias|médico cerca|medico cerca)/i,
    },
    {
        intent: "astronomy",
        pattern: /(별자리|성좌|천문|천체|밤하늘|은하|우주|행성|항성|별\s|별$|태양|달|월식|일식|유성|혜성|오리온|북두칠성|카시오페이아|안드로메다|양자리|황소자리|쌍둥이자리|게자리|사자자리|처녀자리|천칭자리|전갈자리|궁수자리|염소자리|물병자리|물고기자리|aries|taurus|gemini|cancer|leo|virgo|libra|scorpius|sagittarius|capricorn|aquarius|pisces|orion|ursa major|cassiopeia|andromeda|constellation|star map|night sky|astronomy|celestial|galaxy|planet|meteor|comet|constelación|constelacion|mapa estelar|cielo nocturno|astronomía|astronomia|celeste|galaxia|planeta|meteoro|cometa|constellation|carte du ciel|ciel nocturne|astronomie|céleste|celeste|galaxie|planète|planete|météore|meteore|comète|comete)/i,
    },
    {
        intent: "biology",
        pattern: /(단백질|유전자|DNA|RNA|세포|효소|아미노산|염기서열|protein|gene|genetics|enzyme|cell|pdb|amino acid|sequence|biology|ADN|ARN|proteína|proteina|genética|genetica|enzima|célula|celula|aminoácido|aminoacido|secuencia|biología|biologia|protéine|proteine|génétique|genetique|cellule|acide aminé|acide amine|séquence|sequence|biologie)/i,
    },
    {
        intent: "chemistry",
        pattern: /(분자|화합물|원소|화학|반응식|구조식|SMILES|molecule|compound|chemical|reaction|element|molecular structure|chemical structure|molécula|molecula|compuesto|química|quimica|reacción|reaccion|elemento|estructura molecular|molécule|molecule|composé|compose|chimie|réaction|reaction|élément|element|structure moléculaire|structure moleculaire)/i,
    },
    {
        intent: "physics",
        pattern: /(물리|역학|힘|중력|속도|가속도|운동량|충돌|마찰|경사면|포물선|전기장|자기장|physics|force|gravity|collision|projectile|free body|inclined plane|friction|momentum|electric field|magnetic field|física|fisica|fuerza|gravedad|colisión|colision|proyectil|fricción|friccion|momento|plano inclinado|campo eléctrico|campo electrico|campo magnético|campo magnetico|physique|gravité|gravite|collision|projectile|frottement|quantité de mouvement|quantite de mouvement|plan incliné|plan incline|champ électrique|champ electrique|champ magnétique|champ magnetique)/i,
    },
    {
        intent: "data_viz",
        pattern: /(차트|그래프|시각화|도표|통계|추이|분포|비교|chart|graph|plot|visuali[sz]e|statistics|trend|distribution|comparison|dashboard|gráfico|grafico|visualizar|visualización|visualizacion|estadística|estadistica|tendencia|distribución|distribucion|comparación|comparacion|graphique|visualiser|visualisation|statistique|tendance|distribution|comparaison)/i,
    },
];

export const hasMedicalIntentKeyword = (text: string): boolean => {
    return KOREAN_MEDICAL_KEYWORDS.some(keyword => text.includes(keyword)) ||
        MEDICAL_WORD_PATTERN.test(text) ||
        MULTILINGUAL_MEDICAL_PATTERN.test(text);
};

export const isAmbiguousImageIdentificationRequest = (text: string): boolean => {
    const normalized = text.trim();
    if (!normalized) return true;
    if (hasMedicalIntentKeyword(normalized)) return true;
    return normalized.length <= 40 && AMBIGUOUS_IMAGE_IDENTIFICATION_PATTERN.test(normalized);
};

/**
 * Deterministic fallback for product-critical intents.
 * This is used only when semantic routing is unavailable or inconclusive.
 */
export const classifyIntentByRules = (text: string, hasImage: boolean): IntentType => {
    for (const rule of FALLBACK_RULES) {
        if (rule.pattern.test(text)) return rule.intent;
    }

    if (hasMedicalIntentKeyword(text)) {
        return hasImage ? "drug_id" : "drug_info";
    }

    return "general";
};
