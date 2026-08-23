import React, { useState, useRef, useEffect, useCallback } from 'react';
import mammoth from "mammoth";
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { MessageAttachment, Language } from '../types';
import { CHAT_MODEL_OPTIONS, CHAT_MODEL_SECTIONS, type ChatModelId } from '../src/lib/models';
import { authedFetch } from '../services/geminiService';

interface ChatInputProps {
  onSend: (message: string, attachment?: MessageAttachment, attachments?: MessageAttachment[]) => void;
  disabled?: boolean;
  language?: Language;
  showToast: (message: string, type?: 'error' | 'success' | 'info') => void;
  editValue?: string;
  selectedModel: ChatModelId;
  onModelChange: (model: ChatModelId) => void;
  welcome?: boolean;                               // 웰컴(입력창 중앙)=드롭다운 아래로 / 그 외=위로
  prefill?: { text: string; ts: number } | null;   // 추천 칩 클릭 시 입력창 채움 (ts로 재클릭 재발화)
}

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const MAX_VIDEO_SIZE = 100 * 1024 * 1024;
const MAX_ATTACHMENTS = 3;

// HWP 계열 4종 — kordoc 경유로 구조 보존 마크다운(표 포함) 추출
const HWP_EXTS = ['.hwp', '.hwpx', '.hwp3', '.hwpml'];
const isHwpFile = (name: string) => HWP_EXTS.some((ext) => name.toLowerCase().endsWith(ext));
// raw ≤ 4MB는 직행 multipart(55~62% 빠름), 초과는 Storage 경유(Vercel 4.5MB 본문 한도 우회)
const INLINE_MAX = 4 * 1024 * 1024;

// HWP 계열 → /api/parse-document. 4MB 임계값 라우팅(직행 multipart / 대용량 Storage).
// 설계: docs/plans/PLAN_KORDOC_INTEGRATION_260620.md §3
async function parseViaKordoc(file: File): Promise<string> {
  if (file.size <= INLINE_MAX) {
    // 직행 — multipart raw 바이너리
    const form = new FormData();
    form.append('file', file, file.name);
    const res = await authedFetch('/api/parse-document', { method: 'POST', body: form });
    if (!res.ok) throw new Error(`parse-document ${res.status}: ${(await res.json().catch(() => ({}))).error || res.statusText}`);
    return (await res.json()).markdown ?? '';
  }
  // 대용량 — create-signed-url → Storage PUT → { filePath }
  const signRes = await authedFetch('/api/create-signed-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: file.name, bucket: 'chat-docs', mimeType: file.type || 'application/octet-stream' }),
  });
  if (!signRes.ok) throw new Error(`create-signed-url ${signRes.status}`);
  const { signedUrl, filePath } = await signRes.json();
  const putRes = await fetch(signedUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
  if (!putRes.ok) throw new Error(`Storage PUT ${putRes.status}`);
  // 서명 URL PUT(위)만 평범한 fetch 다 — 서명 자체가 인증이라 Bearer 를 붙이면 충돌한다.
  const res = await authedFetch('/api/parse-document', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath }),
  });
  if (!res.ok) throw new Error(`parse-document ${res.status}: ${(await res.json().catch(() => ({}))).error || res.statusText}`);
  return (await res.json()).markdown ?? '';
}

// 이미지를 최대 1920px / JPEG 85%로 압축 — Vercel 4.5MB 페이로드 제한 대응
// GIF는 Canvas 변환 시 애니메이션 프레임 소실로 원본 유지
const compressImage = (dataUrl: string, mimeType: string): Promise<string> => {
  if (mimeType === 'image/gif') return Promise.resolve(dataUrl);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const MAX_DIM = 1920;
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > MAX_DIM || h > MAX_DIM) {
        if (w > h) { h = Math.round(h * MAX_DIM / w); w = MAX_DIM; }
        else { w = Math.round(w * MAX_DIM / h); h = MAX_DIM; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#FFFFFF'; // PNG 투명도 → 흰 배경 처리
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
};

const ChatInput: React.FC<ChatInputProps> = ({ onSend, disabled, language = 'ko', showToast, editValue, selectedModel, onModelChange, welcome = false, prefill }) => {
  const [input, setInput] = useState('');
  const [selectedAttachments, setSelectedAttachments] = useState<MessageAttachment[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [isSTTSupported, setIsSTTSupported] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const finalTranscriptRef = useRef('');
  const submitTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const rafRef = useRef<number | null>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);

  const i18n = {
    fr: { placeholder: "Posez une question", sizeError: "Trop lourd (Max 100Mo)", typeError: "Fichier non supporté", dropTitle: "Déposer le fichier ici", dropSubtitle: "Ajouter au chat", limitError: "Max 3 fichiers" },
    ko: { placeholder: "무엇이든 물어보세요", sizeError: "용량 초과 (최대 100MB)", typeError: "지원하지 않는 파일", dropTitle: "파일을 여기에 놓으세요", dropSubtitle: "채팅에 추가하기", limitError: "최대 3개 파일만 첨부 가능" },
    en: { placeholder: "Ask anything", sizeError: "Too large (Max 100MB)", typeError: "Unsupported file", dropTitle: "Drop file here", dropSubtitle: "Add to chat", limitError: "Max 3 files" },
    es: { placeholder: "Haz una pregunta", sizeError: "Muy grande (Máx 100MB)", typeError: "Archivo no soportado", dropTitle: "Suelta el archivo aquí", dropSubtitle: "Añadir al chat", limitError: "Máx 3 archivos" }
  };

  const t = i18n[language] || i18n.ko;

  // 모델 i18n — Header에서 이동(라벨은 4개 언어 공통, 설명만 번역). 드롭다운은 입력창 우측에 통합.
  const modelI18n: Record<string, Record<string, string>> = {
    ko: { modelSectionGemini: "Google Gemini", modelSectionOpenAI: "OpenAI", modelSectionLegacy: "이전 모델", model37Flash: "Gemini 3.7 Flash", model37FlashDesc: "최신 Gemini Flash", model36Flash: "Gemini 3.6 Flash", model36FlashDesc: "빠르고 안정적인 기본 모델", model35Flash: "Gemini 3.5 Flash", model35FlashDesc: "균형 잡힌 이전 세대 모델", model25Flash: "Gemini 2.5 Flash", model25FlashDesc: "빠르고 균형 잡힌 응답", modelGpt54Mini: "GPT-5.4 mini", modelGpt54MiniDesc: "빠르고 효율적인 OpenAI 모델", modelGpt56Luna: "GPT-5.6 luna", modelGpt56LunaDesc: "균형 잡힌 OpenAI 모델" },
    en: { modelSectionGemini: "Google Gemini", modelSectionOpenAI: "OpenAI", modelSectionLegacy: "Previous models", model37Flash: "Gemini 3.7 Flash", model37FlashDesc: "Latest Gemini Flash", model36Flash: "Gemini 3.6 Flash", model36FlashDesc: "Fast, stable default", model35Flash: "Gemini 3.5 Flash", model35FlashDesc: "Balanced previous-generation model", model25Flash: "Gemini 2.5 Flash", model25FlashDesc: "Fast & balanced", modelGpt54Mini: "GPT-5.4 mini", modelGpt54MiniDesc: "Fast, efficient OpenAI model", modelGpt56Luna: "GPT-5.6 luna", modelGpt56LunaDesc: "Balanced OpenAI model" },
    es: { modelSectionGemini: "Google Gemini", modelSectionOpenAI: "OpenAI", modelSectionLegacy: "Modelos anteriores", model37Flash: "Gemini 3.7 Flash", model37FlashDesc: "El Gemini Flash más reciente", model36Flash: "Gemini 3.6 Flash", model36FlashDesc: "Modelo predeterminado rápido y estable", model35Flash: "Gemini 3.5 Flash", model35FlashDesc: "Modelo equilibrado de generación anterior", model25Flash: "Gemini 2.5 Flash", model25FlashDesc: "Rápido y equilibrado", modelGpt54Mini: "GPT-5.4 mini", modelGpt54MiniDesc: "Modelo OpenAI rápido y eficiente", modelGpt56Luna: "GPT-5.6 luna", modelGpt56LunaDesc: "Modelo OpenAI equilibrado" },
    fr: { modelSectionGemini: "Google Gemini", modelSectionOpenAI: "OpenAI", modelSectionLegacy: "Modèles précédents", model37Flash: "Gemini 3.7 Flash", model37FlashDesc: "Le dernier Gemini Flash", model36Flash: "Gemini 3.6 Flash", model36FlashDesc: "Modèle rapide et stable par défaut", model35Flash: "Gemini 3.5 Flash", model35FlashDesc: "Modèle équilibré de génération précédente", model25Flash: "Gemini 2.5 Flash", model25FlashDesc: "Rapide et équilibré", modelGpt54Mini: "GPT-5.4 mini", modelGpt54MiniDesc: "Modèle OpenAI rapide et efficace", modelGpt56Luna: "GPT-5.6 luna", modelGpt56LunaDesc: "Modèle OpenAI équilibré" },
  };
  const mt = modelI18n[language] || modelI18n.ko;
  const selectedModelOption = CHAT_MODEL_OPTIONS.find(o => o.id === selectedModel) ?? CHAT_MODEL_OPTIONS[0];

  const adjustHeight = () => {
    // 이전에 예약된 rAF가 있으면 취소 (빠른 연속 타이핑 시 누적 방지)
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }
    // rAF로 지연: style 변경 후 즉시 scrollHeight를 읽는 Forced Reflow 패턴 해소
    rafRef.current = requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return; // 언마운트 후 실행 방지
      const isMobile = window.innerWidth < 640; // 한 번만 쿼리
      const minHeight = isMobile ? 36 : 40;
      const maxHeight = isMobile ? 140 : 180;
      textarea.style.height = 'auto';
      const scrollHeight = textarea.scrollHeight;
      textarea.style.height = `${Math.min(Math.max(scrollHeight, minHeight), maxHeight)}px`;
      rafRef.current = null;
    });
  };

  // 컴포넌트 언마운트 시 미처리 rAF 정리
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [input]);

  useEffect(() => {
    if (editValue) {
      setInput(editValue);
      finalTranscriptRef.current = editValue;
      textareaRef.current?.focus();
      // 높이 조절 트리거를 위해 약간의 지연 후 실행
      setTimeout(adjustHeight, 10);
    }
  }, [editValue]);

  // 추천 칩 클릭 → 입력창 채움 (editValue와 동일 패턴, ts로 같은 칩 재클릭도 재발화)
  useEffect(() => {
    if (prefill && prefill.text) {
      setInput(prefill.text);
      finalTranscriptRef.current = prefill.text;
      textareaRef.current?.focus();
      setTimeout(adjustHeight, 10);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.ts]);

  // 모델 드롭다운 바깥 클릭 시 닫기
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) setIsModelMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      setIsSTTSupported(true);
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      const langMap: Record<Language, string> = { ko: 'ko-KR', en: 'en-US', es: 'es-ES', fr: 'fr-FR' };
      recognition.lang = langMap[language] || 'ko-KR';

      recognition.onstart = () => setIsListening(true);
      recognition.onerror = (event: any) => {
        console.error("Speech recognition error", event.error);
        if (event.error === 'not-allowed') {
          showToast(language === 'ko' ? '마이크 접근 권한이 없거나 거부되었습니다.' : 'Microphone access denied.', "error");
        } else if (event.error === 'network') {
          showToast(language === 'ko' ? '네트워크 연결 상태가 불안정합니다.' : 'Network connection error.', "error");
        } else if (event.error === 'no-speech') {
          // just ignore no-speech as it's fairly common when pausing
          console.warn("Speech recognition paused (no-speech)");
        } else {
          showToast(language === 'ko' ? '음성 인식 도중 오류가 발생했습니다.' : 'Speech recognition error occurred.', "error");
        }

        // abort if UI is stuck
        if (event.error !== 'no-speech') {
          setIsListening(false);
          recognition.abort();
        }
      };
      recognition.onresult = (event: any) => {
        let interimTranscript = '';
        let currentFinalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) currentFinalTranscript += transcript;
          else interimTranscript += transcript;
        }
        if (currentFinalTranscript) finalTranscriptRef.current += currentFinalTranscript;
        setInput(finalTranscriptRef.current + interimTranscript);
      };
      recognition.onend = () => setIsListening(false);
      recognitionRef.current = recognition;

      return () => {
        recognition.abort(); // stop()대신 abort()로 변경하여 컴포넌트 언마운트 시 메모리 즉시 해제 방지
      };
    }
  }, [language, showToast]);

  const toggleListening = () => {
    if (!recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current.stop();
    } else {
      let currentVal = input;
      if (currentVal && !currentVal.endsWith(' ') && !currentVal.endsWith('\n')) {
        currentVal += ' ';
      }
      finalTranscriptRef.current = currentVal;
      setInput(currentVal);
      recognitionRef.current.start();
    }
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if ((input.trim() || selectedAttachments.length > 0) && !disabled) {
      if (isListening) recognitionRef.current.stop();
      // onSend handles multiple attachments: passing first for compat, but we'll change App.tsx later
      // Actually, let's update ChatInputProps first or handle it here
      (onSend as any)(input, selectedAttachments.length > 0 ? selectedAttachments[0] : undefined, selectedAttachments);
      setInput('');
      setSelectedAttachments([]);
      finalTranscriptRef.current = '';
      if (textareaRef.current) textareaRef.current.style.height = window.innerWidth < 640 ? '36px' : '40px';
    }
  };

  const handleSubmitRef = useRef(handleSubmit);
  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  });

  useEffect(() => {
    if (submitTimeoutRef.current) {
      clearTimeout(submitTimeoutRef.current);
      submitTimeoutRef.current = null;
    }

    if (isListening && input.trim()) {
      submitTimeoutRef.current = setTimeout(() => {
        handleSubmitRef.current();
      }, 5000);
    }

    return () => {
      if (submitTimeoutRef.current) {
        clearTimeout(submitTimeoutRef.current);
        submitTimeoutRef.current = null;
      }
    };
  }, [input, isListening]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const processFile = useCallback(async (file: File) => {
    if (selectedAttachments.length >= MAX_ATTACHMENTS) {
      showToast(t.limitError, "error");
      return;
    }

    const isVideo = file.type.startsWith('video/');
    const limit = isVideo ? MAX_VIDEO_SIZE : MAX_FILE_SIZE;

    if (file.size > limit) {
      showToast(t.sizeError, "error");
      return;
    }

    let extractedText = "";

    try {
      if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || file.name.endsWith(".docx")) {
        const arrayBuffer = await file.arrayBuffer();
        // convertToHtml로 표를 <table>(th/td)로 보존 — extractRawText는 셀을 평문으로 뭉갬.
        // kordoc HWP·XLSX와 동일하게 모델이 키-값/행열을 정확히 인식. 추출 시점 +~10ms(첨부 시점, 응답 critical path 밖).
        const result = await mammoth.convertToHtml({ arrayBuffer });
        extractedText = result.value;
      } else if (file.name.endsWith(".xlsx") || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer);
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

        const markdownTable = jsonData.map((row, i) => {
          const line = `| ${row.map(cell => String(cell || "").replace(/\|/g, "\\|")).join(' | ')} |`;
          if (i === 0) {
            const separator = `| ${row.map(() => '---').join(' | ')} |`;
            return `${line}\n${separator}`;
          }
          return line;
        }).join('\n');

        extractedText = `[XLSX DATA CONVERTED TO MARKDOWN TABLE (Sheet: ${firstSheetName})]\n${markdownTable}`;
      } else if (file.type === "text/plain" || file.type === "text/markdown" || file.type === "text/csv" ||
        file.name.endsWith(".txt") || file.name.endsWith(".md") || file.name.endsWith(".csv")) {

        const arrayBuffer = await file.arrayBuffer();

        try {
          const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
          extractedText = utf8Decoder.decode(arrayBuffer);
        } catch (e) {
          const eucKrDecoder = new TextDecoder('euc-kr');
          extractedText = eucKrDecoder.decode(arrayBuffer);
        }

        if (file.name.endsWith(".csv")) {
          const lines = extractedText.split(/\r?\n/).filter(line => line.trim() !== "");
          if (lines.length > 0) {
            const tableData = lines.map(line => {
              return line.split(',').map(cell => cell.trim().replace(/^["']|["']$/g, ''));
            });

            const markdownTable = tableData.map((row, i) => {
              const line = `| ${row.join(' | ')} |`;
              if (i === 0) {
                const separator = `| ${row.map(() => '---').join(' | ')} |`;
                return `${line}\n${separator}`;
              }
              return line;
            }).join('\n');

            extractedText = `[CSV DATA CONVERTED TO MARKDOWN TABLE]\n${markdownTable}`;
          }
        }
      } else if (isHwpFile(file.name)) {
        // HWP 계열 4종 — kordoc 경유(구조 보존 마크다운, 표 포함). 실패 시 .hwpx만 JSZip 폴백.
        try {
          extractedText = await parseViaKordoc(file);
        } catch (err) {
          console.error("kordoc parse failed:", err);
          if (file.name.toLowerCase().endsWith(".hwpx")) {
            const arrayBuffer = await file.arrayBuffer();
            const zip = await JSZip.loadAsync(arrayBuffer);
            const sectionFiles = Object.keys(zip.files)
              .filter(name => name.match(/Contents\/section\d+\.xml/i))
              .sort();

            let fullText = "";
            for (const sectionPath of sectionFiles) {
              const xmlContent = await zip.file(sectionPath)!.async("string");
              const textMatches = xmlContent.match(/<hp:t[^>]*>(.*?)<\/hp:t>/g);
              if (textMatches) {
                const sectionText = textMatches
                  .map(m => m.replace(/<[^>]+>/g, ''))
                  .map(t => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'"))
                  .join(' ');
                fullText += sectionText + "\n";
              }
            }
            extractedText = fullText.trim();
          } else {
            throw err; // .hwp/.hwp3/.hwpml은 폴백 없음 — 상위 catch가 에러 로그
          }
        }
      } else if (file.name.endsWith(".pptx") || file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
        const arrayBuffer = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);
        const slideFiles = Object.keys(zip.files)
          .filter(name => name.match(/ppt\/slides\/slide\d+\.xml$/i))
          .sort((a, b) => {
            const numA = parseInt(a.match(/slide(\d+)\.xml$/i)?.[1] || '0');
            const numB = parseInt(b.match(/slide(\d+)\.xml$/i)?.[1] || '0');
            return numA - numB;
          });

        // [\s\S]로 개행 포함 텍스트 런까지 추출('.'은 개행 포함 <a:t>를 통째로 누락)
        const decodeEnt = (s: string) => (s || '')
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
        const runs = (xml: string) => decodeEnt((xml.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g) || [])
          .map(m => m.replace(/<[^>]+>/g, '')).join(' ')).replace(/\s+/g, ' ').trim();
        // <a:tc> 셀 — 문단(<a:p>)별 런을 합쳐 셀 1칸으로
        const cellText = (tc: string) => {
          const ps = tc.match(/<a:p>[\s\S]*?<\/a:p>/g) || [tc];
          return ps.map(p => decodeEnt((p.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g) || [])
            .map(m => m.replace(/<[^>]+>/g, '')).join(''))).join(' ').replace(/\s+/g, ' ').trim();
        };
        // <a:tbl> → 마크다운 표. 병합 셀(gridSpan/rowSpan)은 마크다운 한계로 근사(빈 셀 패딩)
        const tableToMd = (tbl: string) => {
          const rows = (tbl.match(/<a:tr[\s\S]*?<\/a:tr>/g) || [])
            .map(tr => (tr.match(/<a:tc[\s\S]*?<\/a:tc>/g) || []).map(cellText));
          if (!rows.length) return '';
          const cols = Math.max(...rows.map(r => r.length));
          const pad = (r: string[]) => r.concat(Array(Math.max(0, cols - r.length)).fill(''));
          let md = `| ${pad(rows[0]).join(' | ')} |\n| ${Array(cols).fill('---').join(' | ')} |\n`;
          rows.slice(1).forEach(r => md += `| ${pad(r).join(' | ')} |\n`);
          return md.trim();
        };

        let fullText = "";
        for (let i = 0; i < slideFiles.length; i++) {
          const xmlContent = await zip.file(slideFiles[i])!.async("string");
          // <a:tbl> 블록은 마크다운 표로, 그 외 영역은 텍스트로 읽기순서 유지하며 추출
          let slideOut = "";
          for (const part of xmlContent.split(/(<a:tbl[\s\S]*?<\/a:tbl>)/g)) {
            if (part.startsWith('<a:tbl')) { const t = tableToMd(part); if (t) slideOut += '\n' + t + '\n'; }
            else { const t = runs(part); if (t) slideOut += t + '\n'; }
          }
          slideOut = slideOut.trim();
          if (slideOut) fullText += `[Slide ${i + 1}]\n${slideOut}\n\n`;
        }

        if (fullText.trim().length < 10) {
          extractedText = `[PPTX 파일: 총 ${slideFiles.length}개 슬라이드]\n⚠️ 텍스트를 찾을 수 없습니다. 이미지 위주의 슬라이드인 경우 개별 이미지를 캡처하여 업로드해주세요.`;
        } else {
          extractedText = fullText.trim();
        }
      }
    } catch (err) {
      console.error("Text extraction failed:", err);
    }

    const isImage = file.type.startsWith('image/');
    const reader = new FileReader();
    reader.onloadend = async () => {
      const rawDataUrl = reader.result as string;
      const data = isImage ? await compressImage(rawDataUrl, file.type) : rawDataUrl;
      const mimeType = isImage && file.type !== 'image/gif'
        ? 'image/jpeg'
        : (file.type || (file.name.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream'));
      const newAttachment: MessageAttachment = {
        data,
        mimeType,
        fileName: file.name,
        fileSize: file.size,
        extractedText: extractedText || undefined
      };
      setSelectedAttachments(prev => [...prev, newAttachment]);
    };
    reader.readAsDataURL(file);
  }, [selectedAttachments, t.limitError, t.sizeError, showToast]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      Array.from(files).forEach(file => processFile(file));
    }
    e.target.value = '';
  };

  const removeAttachment = (index: number) => {
    setSelectedAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1 || items[i].type.indexOf('pdf') !== -1 ||
        items[i].type.indexOf('video') !== -1 ||
        items[i].type.indexOf('word') !== -1 || items[i].type.indexOf('text') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          processFile(file);
        }
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const allowedMimeTypes = [
        'application/pdf',
        'text/plain',
        'text/markdown',
        'text/csv',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      ];

      Array.from(e.dataTransfer.files).forEach(file => {
        if (file.type.startsWith('image/') || file.type.startsWith('video/') || allowedMimeTypes.includes(file.type) ||
          file.name.endsWith('.docx') || file.name.endsWith('.xlsx') || file.name.endsWith('.md') || file.name.endsWith('.txt') || file.name.endsWith('.csv') || isHwpFile(file.name) || file.name.endsWith('.pptx') || file.name.endsWith('.mp4') || file.name.endsWith('.mov')) {
          processFile(file);
        } else {
          showToast(t.typeError, "error");
        }
      });
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 relative">
      {selectedAttachments.length > 0 && (
        <div className="absolute bottom-full left-4 sm:left-6 mb-3 flex flex-wrap gap-2 animate-in slide-in-from-bottom-2 duration-300">
          {selectedAttachments.map((attachment, index) => (
            <div key={index} className="relative group">
              <div className="relative overflow-hidden rounded-xl border border-slate-200 dark:border-white/10 shadow-md bg-white dark:bg-slate-800/60" style={{ height: '72px' }}>
                {attachment.mimeType.startsWith('image/') ? (
                  /* 이미지: 직사각형 가로형 */
                  <div className="flex h-full" style={{ width: '128px' }}>
                    <img src={attachment.data} alt="Upload" className="w-full h-full object-cover" />
                    <div className="absolute bottom-1 right-1 bg-black/60 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase">
                      {attachment.fileName?.split('.').pop() || 'img'}
                    </div>
                  </div>
                ) : attachment.mimeType.startsWith('video/') ? (
                  /* 비디오: 직사각형 가로형 */
                  <div className="relative flex items-center justify-center bg-slate-900" style={{ width: '128px', height: '72px' }}>
                    <video src={attachment.data} className="absolute inset-0 w-full h-full object-cover opacity-40" />
                    <i className="fa-solid fa-circle-play text-white text-2xl z-10 drop-shadow-md"></i>
                    <div className="absolute bottom-1 right-1 bg-black/60 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-md z-10 uppercase">
                      {(attachment.fileName || 'video').split('.').pop()}
                    </div>
                  </div>
                ) : (
                  /* 문서: 직사각형, 아이콘 + 이름 */
                  <div className="flex items-center gap-2.5 px-3 bg-slate-50 dark:bg-slate-500/5" style={{ width: '160px', height: '72px' }}>
                    <i className={`fa-solid ${attachment.mimeType === 'application/pdf' ? 'fa-file-pdf text-red-500' :
                      attachment.mimeType.includes('word') || attachment.fileName?.endsWith('.docx') ? 'fa-file-word text-blue-500' :
                        attachment.mimeType.includes('sheet') || attachment.fileName?.endsWith('.xlsx') ? 'fa-file-excel text-green-700' :
                          attachment.mimeType.includes('presentationml') || attachment.fileName?.endsWith('.pptx') ? 'fa-file-powerpoint text-orange-600' :
                            attachment.mimeType.includes('csv') || attachment.fileName?.endsWith('.csv') ? 'fa-file-csv text-green-600' :
                              (attachment.fileName ? isHwpFile(attachment.fileName) : false) ? 'fa-file-lines text-blue-400' :
                                'fa-file-lines text-slate-500'
                      } text-2xl flex-shrink-0`}></i>
                    <div className="flex flex-col min-w-0">
                      <span className="text-[11px] text-slate-700 dark:text-slate-200 font-semibold truncate leading-tight" style={{ maxWidth: '100px' }}>
                        {attachment.fileName}
                      </span>
                      <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">
                        {attachment.fileName?.split('.').pop() || 'file'}
                      </span>
                    </div>
                  </div>
                )}

                {/* Hover overlay 삭제 버튼 */}
                <button
                  onClick={() => removeAttachment(index)}
                  className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-all duration-200 rounded-xl"
                >
                  <i className="fa-solid fa-xmark text-white text-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 drop-shadow-lg"></i>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        onDragOver={disabled ? undefined : handleDragOver}
        onDragLeave={disabled ? undefined : handleDragLeave}
        onDrop={disabled ? undefined : handleDrop}
        className={`relative flex flex-wrap items-center justify-between gap-y-1 bg-white/80 dark:bg-white/[0.07] backdrop-blur-sm px-1.5 py-1 sm:px-2 sm:py-1.5 rounded-[24px] sm:rounded-[28px] transition-all focus-within:ring-2 focus-within:ring-indigo-400/30 dark:focus-within:ring-indigo-500/30 border border-slate-200/80 dark:border-white/[0.13] shadow-sm min-h-[40px] sm:min-h-[48px] ${isDragging ? 'ring-2 ring-primary-500 bg-primary-50 dark:bg-primary-900/20' : ''}`}
      >
        {isDragging && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm rounded-[24px] sm:rounded-[28px] animate-in fade-in duration-200 pointer-events-none">
            <p className="text-sm font-bold text-primary-600 dark:text-primary-400">{t.dropTitle}</p>
          </div>
        )}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="image/*,video/*,application/pdf,.docx,.xlsx,.txt,.md,.csv,.hwp,.hwpx,.hwp3,.hwpml,.pptx"
          multiple
          className="hidden"
        />

        {/* 첨부(+) — 모바일: textarea 왼쪽 인라인(1행) / 데스크톱: flex-wrap으로 둘째 줄 왼쪽 */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex-shrink-0 flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 text-slate-500 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-white/5 rounded-full transition-colors"
        >
          <i className="fa-solid fa-plus text-lg"></i>
        </button>

        {/* textarea — 모바일: flex-1 인라인(1행) / 데스크톱: basis-full+order-first로 첫 줄 전체 폭(2단) */}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            // 수동 타이핑 시 텍스트 중복 및 덮어쓰기 방어를 위해 STT 즉시 중단
            if (isListening && recognitionRef.current) {
              recognitionRef.current.stop();
              setIsListening(false);
            }
            setInput(e.target.value);
            finalTranscriptRef.current = e.target.value;
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={t.placeholder}
          rows={1}
          disabled={disabled}
          style={{
            // 일반 텍스트는 공백/단어 단위로, 끊을 곳 없는 초장문 토큰만 강제 줄바꿈
            overflowWrap: 'anywhere',
            wordBreak: 'normal'
          }}
          className="flex-1 min-w-0 sm:basis-full sm:order-first bg-transparent px-2 sm:px-3 py-1 outline-none resize-none text-sm sm:text-base text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 min-h-[32px] max-h-[140px] sm:max-h-[180px] leading-relaxed block overflow-y-auto scrollbar-hide font-medium whitespace-pre-wrap"
        />

        {/* 컨트롤 — 모바일: textarea 오른쪽 인라인(1행) / 데스크톱: flex-wrap으로 둘째 줄 오른쪽 */}
        <div className="flex-shrink-0 flex items-center gap-0.5 sm:gap-1">
            {/* 모델 선택기 — 데스크톱 전용(입력창 통합). 모바일은 헤더에 표시(md:hidden ↔ hidden md:block) */}
            <div ref={modelMenuRef} className="hidden md:block relative">
              <button
                type="button"
                onClick={() => setIsModelMenuOpen(prev => !prev)}
                className="flex items-center gap-1 pl-2.5 pr-2 py-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-white/10 transition"
              >
                <span className="text-[13px] font-semibold bg-gradient-to-r from-indigo-500 to-purple-500 dark:from-indigo-400 dark:to-purple-400 bg-clip-text text-transparent">{mt[selectedModelOption.labelKey]}</span>
                <i className={`fa-solid fa-chevron-down text-[10px] text-indigo-400/70 dark:text-indigo-400/60 transition-transform ${isModelMenuOpen ? 'rotate-180' : ''}`}></i>
              </button>
              {isModelMenuOpen && (
                <div className={`model-menu-scrollbar absolute right-0 w-60 sm:w-64 max-h-[min(19rem,60vh)] overflow-y-auto overscroll-contain bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-white/10 py-1 z-50 ${welcome ? 'top-full mt-2' : 'bottom-full mb-2'}`}>
                  {CHAT_MODEL_SECTIONS.map((section, sectionIndex) => (
                    <div key={section.id} className={sectionIndex > 0 ? 'border-t border-slate-100 dark:border-white/10' : ''}>
                      <div className={`px-4 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] flex items-center gap-1.5 ${section.id === 'gemini' ? 'text-indigo-500/75 dark:text-indigo-300/65' : section.id === 'openai' ? 'text-emerald-600/75 dark:text-emerald-300/65' : 'text-slate-400 dark:text-white/35'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${section.id === 'gemini' ? 'bg-indigo-400/80' : section.id === 'openai' ? 'bg-emerald-400/80' : 'bg-slate-300/80 dark:bg-slate-500/70'}`} />
                        {mt[section.labelKey]}
                      </div>
                      {CHAT_MODEL_OPTIONS.filter(option => option.section === section.id).map(option => (
                        <button type="button" key={option.id} onClick={() => { onModelChange(option.id); setIsModelMenuOpen(false); }} className={`w-full px-4 py-2.5 flex justify-between items-center gap-3 text-left transition-colors ${section.id === 'gemini' ? 'hover:bg-indigo-50/60 dark:hover:bg-indigo-400/5' : section.id === 'openai' ? 'hover:bg-emerald-50/60 dark:hover:bg-emerald-400/5' : 'hover:bg-slate-50 dark:hover:bg-white/5'}`}>
                          <span className="min-w-0">
                            <span className="block font-semibold text-sm text-slate-800 dark:text-white/90">{mt[option.labelKey]}</span>
                            <span className="block text-[10px] sm:text-xs font-medium text-slate-500 dark:text-white/40 mt-0.5 tracking-wide">{mt[option.descriptionKey]}</span>
                          </span>
                          {selectedModel === option.id && <i className={`fa-solid fa-check shrink-0 ${section.id === 'gemini' ? 'text-indigo-500 dark:text-indigo-300' : section.id === 'openai' ? 'text-emerald-600 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-300'}`}></i>}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {isSTTSupported && (
              <button
                type="button"
                onClick={toggleListening}
                className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-all ${isListening ? 'bg-red-500 text-white shadow-lg animate-pulse' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-white/5'
                  }`}
              >
                <i className={`fa-solid ${isListening ? 'fa-microphone' : 'fa-microphone-lines'} text-sm`}></i>
              </button>
            )}

            <button
              type="submit"
              disabled={(!input.trim() && selectedAttachments.length === 0) || disabled}
              className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-all ${(!input.trim() && selectedAttachments.length === 0) || disabled ? 'text-slate-300 dark:text-white/20' : 'text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-500/10'
                }`}
            >
              <i className="fa-solid fa-arrow-up text-base sm:text-sm"></i>
            </button>
        </div>
      </form>
    </div>
  );
};

export default ChatInput;
