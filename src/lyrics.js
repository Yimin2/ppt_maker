/** Section label patterns common in Korean worship lyrics */
const SECTION_RE =
  /^(?:제?\s*\d+\s*절|후렴(?:\s*\d+)?|코러스|chorus|브릿지|bridge|프렐류드|인트로|intro|outro|pre-?chorus|ending|끝|간주|prelude)$/i;

/**
 * @typedef {{ id: string, type: 'title' | 'lyrics', section: string, lines: string[] }} Slide
 */

let slideId = 0;

export function nextId() {
  slideId += 1;
  return `slide-${slideId}`;
}

export function isSectionLabel(line) {
  const t = line.trim();
  if (!t) return false;
  if (SECTION_RE.test(t)) return true;
  // short all-caps / bracket labels like [후렴], (1절)
  if (/^[\[\(【（].+[\]\)】）]$/.test(t) && t.length <= 20) return true;
  return false;
}

/**
 * Normalize section names so "1절" / "1 절" / "제1절" match.
 * @param {string} section
 */
export function normalizeSectionKey(section) {
  return String(section || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/^제(?=\d)/, "");
}

/**
 * Parse raw lyrics into slides + song arrangement.
 * - Blank lines separate blocks
 * - Section labels (1절, 후렴, ...) attach to following lines
 * - Lines within a block are chunked by `linesPerSlide` (default 2)
 * - Each section's lyrics are stored once (first full definition)
 * - Later bare labels (just `1절`) do NOT duplicate slides — they only extend
 *   the arrangement order for the operator (e.g. 1절→2절→후렴→1절→후렴)
 *
 * @param {string} raw
 * @param {{ linesPerSlide?: number, title?: string, includeTitleSlide?: boolean }} options
 * @returns {{ slides: Slide[], arrangement: string[] }}
 */
export function parseLyrics(raw, options = {}) {
  const linesPerSlide = options.linesPerSlide ?? 2;
  const title = (options.title || "").trim();
  const includeTitleSlide = options.includeTitleSlide !== false;

  /** @type {Slide[]} */
  const slides = [];
  /** @type {string[]} */
  const arrangement = [];

  if (includeTitleSlide && title) {
    slides.push({
      id: nextId(),
      type: "title",
      section: "",
      lines: [title],
    });
  }

  const lines = String(raw || "")
    .replace(/\r\n/g, "\n")
    .split("\n");

  let currentSection = "";
  /** @type {string[]} */
  let buffer = [];
  /** Full lyric lines for the current section occurrence (across blank-line blocks). */
  /** @type {string[]} */
  let sectionLines = [];
  let sectionHasContent = false;
  /** First full definition of each section. */
  /** @type {Map<string, string[]>} */
  const sectionLibrary = new Map();
  /** Sections already emitted as slides (first definition only). */
  /** @type {Set<string>} */
  const emittedSections = new Set();

  const pushContentSlides = (section, content) => {
    if (!content.length) return;
    for (let i = 0; i < content.length; i += linesPerSlide) {
      slides.push({
        id: nextId(),
        type: "lyrics",
        section,
        lines: content.slice(i, i + linesPerSlide),
      });
    }
  };

  const flushBuffer = () => {
    const content = buffer.map((l) => l.trim()).filter(Boolean);
    buffer = [];
    if (!content.length) return;

    sectionHasContent = true;
    sectionLines.push(...content);
  };

  /**
   * Finish the current section:
   * - with lyrics → create slides once, record arrangement step
   * - bare label after a known section → arrangement only (no extra slides)
   */
  const finishSection = () => {
    flushBuffer();

    const label = (currentSection || "").trim();
    const key = normalizeSectionKey(label);
    if (!key) {
      // no section label: still emit unlabeled lyrics as slides
      if (sectionHasContent && sectionLines.length) {
        pushContentSlides("", sectionLines);
      }
      sectionLines = [];
      sectionHasContent = false;
      return;
    }

    if (sectionHasContent && sectionLines.length) {
      if (!sectionLibrary.has(key)) {
        sectionLibrary.set(key, [...sectionLines]);
      }
      // 슬라이드는 구간당 첫 가사만 (장 수 최소화)
      if (!emittedSections.has(key)) {
        pushContentSlides(label, sectionLibrary.get(key));
        emittedSections.add(key);
      }
      arrangement.push(label);
    } else if (sectionLibrary.has(key) || emittedSections.has(key)) {
      // 가사 없이 라벨만 → 곡 진행 순서에만 추가 (슬라이드 복제 안 함)
      arrangement.push(label);
    }

    sectionLines = [];
    sectionHasContent = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushBuffer();
      continue;
    }

    if (isSectionLabel(trimmed)) {
      finishSection();
      currentSection = trimmed.replace(/^[\[\(【（]|[\]\)】）]$/g, "");
      continue;
    }

    buffer.push(trimmed);
  }

  finishSection();
  return { slides, arrangement };
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function linesFromText(text) {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd());
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines;
}

/**
 * @param {string[]} lines
 */
export function textFromLines(lines) {
  return (lines || []).join("\n");
}

/**
 * @param {string} [section]
 * @param {string[]} [lines]
 * @returns {Slide}
 */
export function createLyricsSlide(section = "", lines = []) {
  return {
    id: nextId(),
    type: "lyrics",
    section,
    lines: [...lines],
  };
}

/**
 * Deep-ish clone with a new id (for paste / duplicate).
 * @param {Slide} slide
 * @returns {Slide}
 */
export function cloneSlide(slide) {
  return {
    id: nextId(),
    type: slide.type,
    section: slide.section || "",
    lines: [...(slide.lines || [])],
  };
}

const CLIPBOARD_PREFIX = "WORSHIP_PPT_SLIDE::";
const CLIPBOARD_MULTI_PREFIX = "WORSHIP_PPT_SLIDES::";

/**
 * @param {Partial<Slide>} data
 * @returns {Slide | null}
 */
function slideFromData(data) {
  if (!data || (data.type !== "title" && data.type !== "lyrics")) return null;
  return {
    id: nextId(),
    type: data.type,
    section: String(data.section || ""),
    lines: Array.isArray(data.lines) ? data.lines.map((l) => String(l)) : [],
  };
}

/**
 * @param {Slide} slide
 */
export function serializeSlide(slide) {
  return (
    CLIPBOARD_PREFIX +
    JSON.stringify({
      type: slide.type,
      section: slide.section || "",
      lines: slide.lines || [],
    })
  );
}

/**
 * @param {Slide[]} list
 */
export function serializeSlides(list) {
  if (!list.length) return "";
  if (list.length === 1) return serializeSlide(list[0]);
  return (
    CLIPBOARD_MULTI_PREFIX +
    JSON.stringify(
      list.map((slide) => ({
        type: slide.type,
        section: slide.section || "",
        lines: slide.lines || [],
      }))
    )
  );
}

/**
 * @param {string} text
 * @returns {Slide | null}
 */
export function deserializeSlide(text) {
  const many = deserializeSlides(text);
  return many.length ? many[0] : null;
}

/**
 * @param {string} text
 * @returns {Slide[]}
 */
export function deserializeSlides(text) {
  if (!text) return [];
  try {
    if (text.startsWith(CLIPBOARD_MULTI_PREFIX)) {
      const data = JSON.parse(text.slice(CLIPBOARD_MULTI_PREFIX.length));
      if (!Array.isArray(data)) return [];
      return data.map(slideFromData).filter(Boolean);
    }
    if (text.startsWith(CLIPBOARD_PREFIX)) {
      const data = JSON.parse(text.slice(CLIPBOARD_PREFIX.length));
      const one = slideFromData(data);
      return one ? [one] : [];
    }
  } catch {
    return [];
  }
  return [];
}

/**
 * Reorder slides: move item from `from` to `to` index.
 * @param {Slide[]} slides
 * @param {number} from
 * @param {number} to
 */
export function moveSlide(slides, from, to) {
  if (
    from < 0 ||
    to < 0 ||
    from >= slides.length ||
    to >= slides.length ||
    from === to
  ) {
    return slides;
  }
  const next = [...slides];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Move multiple slides (keeping relative order) so the block starts at `to`.
 * `to` is an index in the *current* list (drop position before adjustment).
 * @param {Slide[]} slides
 * @param {number[]} fromIndices
 * @param {number} to
 */
export function moveSlides(slides, fromIndices, to) {
  const sorted = [...new Set(fromIndices)]
    .filter((i) => i >= 0 && i < slides.length)
    .sort((a, b) => a - b);
  if (!sorted.length) return slides;

  const items = sorted.map((i) => slides[i]);
  const remaining = slides.filter((_, i) => !sorted.includes(i));

  let insertAt = to;
  for (const i of sorted) {
    if (i < to) insertAt -= 1;
  }
  insertAt = Math.max(0, Math.min(insertAt, remaining.length));

  return [
    ...remaining.slice(0, insertAt),
    ...items,
    ...remaining.slice(insertAt),
  ];
}

/**
 * Remove multiple slides by index.
 * @param {Slide[]} slides
 * @param {number[]} indices
 */
export function removeSlides(slides, indices) {
  const drop = new Set(indices);
  return slides.filter((_, i) => !drop.has(i));
}

/**
 * Split lyrics slide at caret in raw textarea text.
 * Content before caret stays; content after becomes a new slide.
 *
 * @param {Slide[]} slides
 * @param {number} index
 * @param {string} value
 * @param {number} caret
 * @returns {{ slides: Slide[], focusIndex: number, caret: number } | null}
 */
export function splitAtCaret(slides, index, value, caret) {
  const slide = slides[index];
  if (!slide || slide.type !== "lyrics") return null;

  const safeCaret = Math.max(0, Math.min(caret, value.length));
  const beforeLines = linesFromText(value.slice(0, safeCaret));
  const afterLines = linesFromText(value.slice(safeCaret));

  const first = { ...slide, lines: beforeLines };
  const second = createLyricsSlide(slide.section, afterLines);

  return {
    slides: [
      ...slides.slice(0, index),
      first,
      second,
      ...slides.slice(index + 1),
    ],
    focusIndex: index + 1,
    caret: 0,
  };
}

/**
 * Merge current lyrics slide into the previous adjacent lyrics slide.
 * @returns {{ slides: Slide[], focusIndex: number, caret: number } | null}
 */
export function mergeWithPrevious(slides, index) {
  if (index <= 0) return null;
  const curr = slides[index];
  const prev = slides[index - 1];
  if (!curr || curr.type !== "lyrics" || !prev || prev.type !== "lyrics") {
    return null;
  }

  const prevText = textFromLines(prev.lines);
  const currText = textFromLines(curr.lines);
  const caret =
    prevText.length + (prevText.length && currText.length ? 1 : 0);

  const merged = {
    ...prev,
    lines: linesFromText(
      prevText + (prevText.length && currText.length ? "\n" : "") + currText
    ),
    section: prev.section || curr.section,
  };

  return {
    slides: [
      ...slides.slice(0, index - 1),
      merged,
      ...slides.slice(index + 1),
    ],
    focusIndex: index - 1,
    caret,
  };
}

/**
 * Merge next adjacent lyrics slide into the current one.
 * @returns {{ slides: Slide[], focusIndex: number, caret: number } | null}
 */
export function mergeWithNext(slides, index) {
  if (index < 0 || index >= slides.length - 1) return null;
  const curr = slides[index];
  const next = slides[index + 1];
  if (!curr || curr.type !== "lyrics" || !next || next.type !== "lyrics") {
    return null;
  }

  const currText = textFromLines(curr.lines);
  const nextText = textFromLines(next.lines);
  const caret = currText.length;

  const merged = {
    ...curr,
    lines: linesFromText(
      currText + (currText.length && nextText.length ? "\n" : "") + nextText
    ),
    section: curr.section || next.section,
  };

  return {
    slides: [
      ...slides.slice(0, index),
      merged,
      ...slides.slice(index + 2),
    ],
    focusIndex: index,
    caret,
  };
}

/**
 * Remove empty lyrics slides; title slides kept if they have text.
 * @param {Slide[]} slides
 */
export function removeEmptyLyricsSlides(slides) {
  return slides.filter((s) => {
    if (s.type === "title") return true;
    return (s.lines || []).some((l) => String(l).trim());
  });
}

/**
 * @param {Slide[]} slides
 * @param {number} index
 */
export function removeSlide(slides, index) {
  if (index < 0 || index >= slides.length) return slides;
  return slides.filter((_, i) => i !== index);
}

export const SAMPLE_TITLE = "주 예수 이름 높여";

export const SAMPLE_LYRICS = `1절
주 예수 이름 높여
우리 모두 찬양해
그 사랑 영원히
우리 안에 흐르네

2절
십자가 그 은혜로
나를 자유케 하시네
새 생명 주셨으니
주만 따라 살리라

후렴
할렐루야 할렐루야
주께 영광 돌리세
할렐루야 할렐루야
영원히 찬양하리

1절
후렴
`;
