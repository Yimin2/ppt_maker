import PptxGenJS from "pptxgenjs";

/**
 * @typedef {{ id: string, type: 'title' | 'lyrics', section: string, lines: string[] }} Slide
 */

const BG = "0A0A0A";
const FG = "FFFFFF";
/** 구간 라벨(1절·후렴) — 운영 확인용, 회중 시선에 안 걸리게 어둡게 */
const SECTION_FG = "3A3A3A";
// 교회 PC에서 흔히 있는 한글 폰트. 없으면 PowerPoint가 대체 폰트 사용
const FONT = "Malgun Gothic";

/** 찬양 가사 고정 크기 (긴 줄이어도 축소하지 않음) */
const LYRICS_FONT_SIZE = 36;
const TITLE_FONT_SIZE = 44;
const SECTION_FONT_SIZE = 12;
/** 가사 텍스트 박스 너비 (inch) */
const LYRICS_BOX_WIDTH = 9.0;

/**
 * 해당 pt에서 박스 안에 들어가는 대략 글자 수 (한글 bold 기준).
 * 폰트는 줄이지 않고, 이 길이를 넘으면 공백에서 줄을 나눔.
 * @param {number} fontSize
 * @param {number} [boxWidthIn]
 */
export function maxCharsForFont(fontSize, boxWidthIn = LYRICS_BOX_WIDTH) {
  // 한글 bold ≈ 글자 너비 0.95~1.0em
  const charWidthIn = (fontSize / 72) * 0.96;
  return Math.max(8, Math.floor(boxWidthIn / charWidthIn));
}

/**
 * 한 줄을 maxChars 이하로 공백 기준 분할.
 * 가운데 한 글자만 떨어지는 강제 줄바꿈을 막기 위함.
 * @param {string} line
 * @param {number} maxChars
 * @returns {string[]}
 */
export function wrapLineAtSpaces(line, maxChars) {
  const text = String(line || "").trim();
  if (!text) return [];
  if ([...text].length <= maxChars) return [text];

  /** @type {string[]} */
  const out = [];
  let rest = text;

  while ([...rest].length > maxChars) {
    const chars = [...rest];
    const window = chars.slice(0, maxChars).join("");

    // 허용 구간 안 마지막 공백 (앞 40% 이하는 너무 이른 끊김 → 피함)
    let breakAt = -1;
    const minBreak = Math.floor(maxChars * 0.35);
    for (let i = window.length - 1; i >= minBreak; i--) {
      if (window[i] === " " || window[i] === "\t") {
        breakAt = i;
        break;
      }
    }

    // 구간 안 공백이 없으면 조금 더 넓혀서 공백 탐색
    if (breakAt < 0) {
      const wider = chars.slice(0, Math.min(chars.length, Math.floor(maxChars * 1.2))).join("");
      const sp = wider.lastIndexOf(" ");
      if (sp >= minBreak) breakAt = sp;
    }

    // 그래도 없으면 공백 아무 데나 / 최후 수단 글자 단위
    if (breakAt < 0) {
      const anySp = window.lastIndexOf(" ");
      if (anySp > 0) breakAt = anySp;
      else breakAt = maxChars;
    }

    const head = chars.slice(0, breakAt).join("").trim();
    const tail = chars.slice(breakAt).join("").trim();
    if (head) out.push(head);
    rest = tail;
    if (!rest) break;
  }

  if (rest) out.push(rest);
  return out;
}

/**
 * 슬라이드 가사 줄들을 고정 폰트 기준으로 줄바꿈 처리.
 * @param {string[]} lines
 * @param {number} [fontSize]
 */
export function wrapLyricsLines(lines, fontSize = LYRICS_FONT_SIZE) {
  const maxChars = maxCharsForFont(fontSize);
  /** @type {string[]} */
  const wrapped = [];
  for (const line of lines) {
    wrapped.push(...wrapLineAtSpaces(line, maxChars));
  }
  return wrapped;
}

/**
 * 자막(가사) 위치 프리셋.
 * @typedef {'top-center' | 'middle-center' | 'bottom-center'} LyricsPosition
 */

/**
 * 구간 라벨은 가사와 분리 — 좌측 상단 구석(운영용), 가사는 위치 옵션만 따름.
 * @param {LyricsPosition | string} position
 */
export function layoutForPosition(position) {
  const pos = position || "middle-center";

  // 좌측 상단 구석 — 찬양 중 시선(가운데 가사)과 겹치지 않음
  const section = { x: 0.2, y: 0.12, w: 1.6, h: 0.32 };

  if (pos === "top-center") {
    return {
      align: "center",
      section,
      lyrics: {
        y: 0.45,
        h: 4.7,
        valign: "top",
      },
    };
  }

  if (pos === "bottom-center") {
    return {
      align: "center",
      section,
      lyrics: {
        y: 3.2,
        h: 2.1,
        valign: "top",
      },
    };
  }

  // middle-center (기본): 정중앙
  return {
    align: "center",
    section,
    lyrics: {
      y: 1.55,
      h: 2.8,
      valign: "middle",
    },
  };
}

/**
 * 곡 제목을 섹션 이름에 쓸 수 있게 정리.
 * @param {string} songTitle
 */
export function sanitizePptSectionBase(songTitle) {
  return (
    String(songTitle || "찬양")
      .trim()
      .replace(/[\\/:*?"<>|]/g, "")
      .slice(0, 40) || "찬양"
  );
}

/**
 * @param {{
 *   title: string,
 *   slides: Slide[],
 *   position?: LyricsPosition | string,
 * }} options
 */
export async function downloadWorshipPpt({
  title,
  slides,
  position = "middle-center",
}) {
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_16x9";
  pres.author = "찬양 PPT 메이커";
  pres.title = title || "찬양";
  pres.subject = "Worship lyrics presentation";

  const fontSize = LYRICS_FONT_SIZE;
  const songTitle = (title || "찬양").trim() || "찬양";
  // 섹션은 절 단위가 아니라 곡 단위 — 곡 제목 하나
  const songSection = sanitizePptSectionBase(songTitle);

  const exportSlides = (slides || []).filter((s) => {
    if (s.type === "title") return true;
    return (s.lines || []).some((l) => String(l).trim());
  });

  const hasTitleSlide = exportSlides.some((s) => s.type === "title");
  const lyricsSlides = exportSlides.filter((s) => s.type === "lyrics");

  if (exportSlides.length) {
    pres.addSection({ title: songSection });
  }

  // 제목 슬라이드 (있을 때만)
  if (hasTitleSlide) {
    const titleSlideData = exportSlides.find((s) => s.type === "title");
    const slide = pres.addSlide({ sectionTitle: songSection });
    slide.background = { color: BG };
    const text = (
      titleSlideData?.lines?.[0] ||
      songTitle ||
      "찬양"
    ).trim();
    slide.addText(text, {
      x: 0.6,
      y: 1.8,
      w: 8.8,
      h: 1.8,
      fontSize: TITLE_FONT_SIZE,
      fontFace: FONT,
      color: FG,
      bold: true,
      align: "center",
      valign: "middle",
      margin: 0,
    });
  }

  // 가사 슬라이드 (순서 미리보기 장 없음)
  for (const slideData of lyricsSlides) {
    const slide = pres.addSlide({ sectionTitle: songSection });
    slide.background = { color: BG };

    const section = (slideData.section || "").trim();
    const rawLines = (slideData.lines || []).map((l) => l.trim()).filter(Boolean);
    if (!rawLines.length) continue;

    const lines = wrapLyricsLines(rawLines, fontSize);
    const layout = layoutForPosition(position);

    if (section) {
      slide.addText(section, {
        x: layout.section.x,
        y: layout.section.y,
        w: layout.section.w,
        h: layout.section.h,
        fontSize: SECTION_FONT_SIZE,
        fontFace: FONT,
        color: SECTION_FG,
        align: "left",
        valign: "middle",
        margin: 0,
      });
    }

    const textItems = lines.map((line, i) => ({
      text: line,
      options: {
        breakLine: i < lines.length - 1,
        fontSize,
        fontFace: FONT,
        color: FG,
        bold: true,
        align: layout.align,
      },
    }));

    slide.addText(textItems, {
      x: 0.5,
      y: layout.lyrics.y,
      w: LYRICS_BOX_WIDTH,
      h: layout.lyrics.h,
      align: layout.align,
      valign: layout.lyrics.valign,
      margin: 0,
      wrap: false,
    });
  }

  const safeName = songTitle
    .replace(/[\\/:*?"<>|]/g, "")
    .trim()
    .slice(0, 80);
  const fileName = `${safeName || "찬양"}.pptx`;
  await pres.writeFile({ fileName });
}
