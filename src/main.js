import {
  parseLyrics,
  normalizeSectionKey,
  splitAtCaret,
  removeSlide,
  removeSlides,
  removeEmptyLyricsSlides,
  linesFromText,
  cloneSlide,
  serializeSlides,
  deserializeSlides,
  moveSlides,
  SAMPLE_TITLE,
  SAMPLE_LYRICS,
} from "./lyrics.js";
import { downloadWorshipPpt } from "./ppt.js";

/** @type {import('./lyrics.js').Slide[]} */
let slides = [];

/**
 * 곡 진행 순서 (예: 1절 → 2절 → 후렴 → 1절 → 후렴).
 * 슬라이드는 구간당 한 번만, 반복은 여기서만 표시.
 * @type {string[]}
 */
let arrangement = [];

/** 운영자가 곡 진행에서 현재 밟고 있는 단계 인덱스 */
let arrangementStep = 0;

/** @type {import('./lyrics.js').Slide[][]} */
const past = [];
/** @type {import('./lyrics.js').Slide[][]} */
const future = [];
const MAX_HISTORY = 50;

/** @type {{ index: number, caret: number } | null} */
let pendingFocus = null;

/** @type {Set<number>} */
let selected = new Set();
/** Shift 범위 선택의 기준점 */
let anchorIndex = -1;

/** 순서 변경 드래그 중인 인덱스들 */
/** @type {number[]} */
let dragFromIndices = [];

/** @type {import('./lyrics.js').Slide[] | null} */
let memoryClipboard = null;

const els = {
  title: document.getElementById("title-input"),
  lyrics: document.getElementById("lyrics-input"),
  linesPerSlide: document.getElementById("lines-per-slide"),
  includeTitle: document.getElementById("include-title-slide"),
  lyricsPosition: document.getElementById("lyrics-position"),
  parseBtn: document.getElementById("parse-btn"),
  sampleBtn: document.getElementById("sample-btn"),
  downloadBtn: document.getElementById("download-btn"),
  undoBtn: document.getElementById("undo-btn"),
  redoBtn: document.getElementById("redo-btn"),
  slideCount: document.getElementById("slide-count"),
  emptyState: document.getElementById("empty-state"),
  slidesList: document.getElementById("slides-list"),
  arrangementBar: document.getElementById("arrangement-bar"),
  arrangementSteps: document.getElementById("arrangement-steps"),
  arrangementHint: document.getElementById("arrangement-hint"),
};

/** @param {import('./lyrics.js').Slide[]} list */
function cloneSlides(list) {
  return list.map((s) => ({
    ...s,
    lines: [...(s.lines || [])],
  }));
}

function updateHistoryButtons() {
  els.undoBtn.disabled = past.length === 0;
  els.redoBtn.disabled = future.length === 0;
}

function pushHistory() {
  past.push(cloneSlides(slides));
  if (past.length > MAX_HISTORY) past.shift();
  future.length = 0;
  updateHistoryButtons();
}

function getSelectedSorted() {
  return [...selected]
    .filter((i) => i >= 0 && i < slides.length)
    .sort((a, b) => a - b);
}

function primarySelected() {
  const sorted = getSelectedSorted();
  if (!sorted.length) return -1;
  if (sorted.includes(anchorIndex)) return anchorIndex;
  return sorted[sorted.length - 1];
}

/**
 * @param {number[]} indices
 * @param {number} [anchor]
 */
function setSelection(indices, anchor) {
  selected = new Set(
    indices.filter((i) => i >= 0 && i < slides.length)
  );
  if (typeof anchor === "number") {
    anchorIndex = anchor;
  } else if (selected.size) {
    anchorIndex = Math.max(...selected);
  } else {
    anchorIndex = -1;
  }
  highlightSelection();
  updateSlideCountLabel();
}

function selectOnly(index) {
  if (index < 0 || index >= slides.length) {
    setSelection([]);
    return;
  }
  setSelection([index], index);
}

function selectRange(from, to) {
  if (from < 0) {
    selectOnly(to);
    return;
  }
  const a = Math.min(from, to);
  const b = Math.max(from, to);
  const indices = [];
  for (let i = a; i <= b; i++) indices.push(i);
  // shift 범위: anchor 유지
  setSelection(indices, from);
}

function toggleSelect(index) {
  const next = new Set(selected);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  setSelection([...next], index);
}

function clampSelection() {
  selected = new Set(
    [...selected].filter((i) => i >= 0 && i < slides.length)
  );
  if (anchorIndex >= slides.length) {
    anchorIndex = slides.length ? slides.length - 1 : -1;
  }
  if (!selected.size && slides.length) {
    // 선택 없으면 첫 장 유지하지 않음 — 명시적 선택만
  }
}

/**
 * @param {import('./lyrics.js').Slide[]} next
 * @param {{ record?: boolean, focus?: { index: number, caret: number } | null, select?: number | number[] }} [options]
 */
function setSlides(next, options = {}) {
  const record = options.record !== false;
  if (record) {
    pushHistory();
  }
  if (options.focus) {
    pendingFocus = options.focus;
  }
  slides = next;

  if (Array.isArray(options.select)) {
    setSelection(options.select, options.select[options.select.length - 1]);
  } else if (typeof options.select === "number") {
    setSelection([options.select], options.select);
  } else {
    clampSelection();
  }

  render();
}

function undo() {
  if (!past.length) return;
  future.push(cloneSlides(slides));
  slides = past.pop() || [];
  pendingFocus = null;
  clampSelection();
  render();
  updateHistoryButtons();
}

function redo() {
  if (!future.length) return;
  past.push(cloneSlides(slides));
  slides = future.pop() || [];
  pendingFocus = null;
  clampSelection();
  render();
  updateHistoryButtons();
}

function buildFromInput() {
  const title = els.title.value.trim();
  const raw = els.lyrics.value;
  const linesPerSlide = Number(els.linesPerSlide.value) || 2;
  const includeTitleSlide = els.includeTitle.checked;

  if (!raw.trim() && !title) {
    alert("제목이나 가사를 입력해 주세요.");
    return;
  }

  const { slides: next, arrangement: arr } = parseLyrics(raw, {
    title,
    linesPerSlide,
    includeTitleSlide,
  });
  arrangement = arr || [];
  arrangementStep = 0;
  setSlides(next, { select: next.length ? [0] : [] });
}

/**
 * 구간 라벨에 해당하는 첫 가사 슬라이드 인덱스.
 * @param {string} sectionLabel
 */
function findSectionSlideIndex(sectionLabel) {
  const key = normalizeSectionKey(sectionLabel);
  if (!key) return -1;
  return slides.findIndex(
    (s) =>
      s.type === "lyrics" && normalizeSectionKey(s.section || "") === key
  );
}

/**
 * 곡 진행 단계로 이동: 해당 구간 슬라이드 선택 + 단계 하이라이트.
 * @param {number} stepIndex
 */
function goToArrangementStep(stepIndex) {
  if (stepIndex < 0 || stepIndex >= arrangement.length) return;
  arrangementStep = stepIndex;
  const label = arrangement[stepIndex];
  const slideIndex = findSectionSlideIndex(label);
  if (slideIndex >= 0) {
    selectOnly(slideIndex);
    const card = els.slidesList.querySelector(`[data-index="${slideIndex}"]`);
    card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  renderArrangement();
}

function renderArrangement() {
  if (!els.arrangementBar || !els.arrangementSteps) return;

  if (!arrangement.length) {
    els.arrangementBar.hidden = true;
    els.arrangementSteps.innerHTML = "";
    return;
  }

  els.arrangementBar.hidden = false;
  els.arrangementSteps.innerHTML = "";

  arrangement.forEach((label, i) => {
    if (i > 0) {
      const arrow = document.createElement("span");
      arrow.className = "arrangement-arrow";
      arrow.textContent = "→";
      arrow.setAttribute("aria-hidden", "true");
      els.arrangementSteps.appendChild(arrow);
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "arrangement-chip" + (i === arrangementStep ? " is-current" : "");
    btn.textContent = label;
    btn.title = `${i + 1}번째: ${label} (클릭하면 해당 구간 슬라이드로)`;
    btn.addEventListener("click", () => goToArrangementStep(i));
    els.arrangementSteps.appendChild(btn);
  });

  if (els.arrangementHint) {
    const cur = arrangement[arrangementStep] || "";
    const next =
      arrangementStep + 1 < arrangement.length
        ? arrangement[arrangementStep + 1]
        : "끝";
    els.arrangementHint.textContent = `지금: ${cur} · 다음 구간: ${next} · 단계 ${arrangementStep + 1}/${arrangement.length} (클릭으로 이동 · → 키로 다음 구간)`;
  }
}

/**
 * @param {number} index
 * @param {string} value
 */
function draftLines(index, value) {
  const lines = value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd());
  slides[index] = { ...slides[index], lines };
}

function applyFocus() {
  if (!pendingFocus) return;
  const { index, caret } = pendingFocus;
  pendingFocus = null;
  selectOnly(index);

  requestAnimationFrame(() => {
    const card = els.slidesList.querySelector(`[data-index="${index}"]`);
    const ta = card?.querySelector("textarea.slide-text");
    if (!(ta instanceof HTMLTextAreaElement)) return;
    ta.focus();
    const pos = Math.max(0, Math.min(caret, ta.value.length));
    ta.setSelectionRange(pos, pos);
  });
}

function highlightSelection() {
  els.slidesList.querySelectorAll(".slide-card").forEach((el) => {
    const i = Number(el.getAttribute("data-index"));
    el.classList.toggle("selected", selected.has(i));
  });
}

function updateSlideCountLabel() {
  const n = slides.length;
  const s = getSelectedSorted().length;
  els.slideCount.textContent =
    s > 1 ? `${n}장 · ${s}개 선택` : `${n}장`;
}

/** 입력 칸에서 텍스트가 선택돼 있으면 네이티브 복사/붙여넣기 사용 */
function hasTextSelectionInField() {
  const el = document.activeElement;
  if (
    !(el instanceof HTMLInputElement) &&
    !(el instanceof HTMLTextAreaElement)
  ) {
    return false;
  }
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  return start !== end;
}

function isTextFieldFocused() {
  const el = document.activeElement;
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
}

/**
 * @param {import('./lyrics.js').Slide[]} list
 * @param {number} afterIndex
 */
function insertSlidesAfter(list, afterIndex) {
  if (!list.length) return;
  const insertAt =
    afterIndex >= 0 && afterIndex < slides.length
      ? afterIndex + 1
      : slides.length;
  const next = [
    ...slides.slice(0, insertAt),
    ...list,
    ...slides.slice(insertAt),
  ];
  const newIndices = list.map((_, i) => insertAt + i);
  setSlides(next, {
    select: newIndices,
    focus:
      list.length === 1 && list[0].type === "lyrics"
        ? { index: insertAt, caret: 0 }
        : null,
  });
}

/**
 * @param {number[]} fromIndices
 * @param {number} to  drop 위치 (해당 인덱스 앞)
 */
function reorderSelected(fromIndices, to) {
  const sorted = [...fromIndices].sort((a, b) => a - b);
  if (!sorted.length) return;
  const next = moveSlides(slides, sorted, to);
  // 이동 후 새 인덱스 계산
  let insertAt = to;
  for (const i of sorted) {
    if (i < to) insertAt -= 1;
  }
  insertAt = Math.max(0, Math.min(insertAt, next.length - sorted.length));
  const newIndices = sorted.map((_, i) => insertAt + i);
  setSlides(next, { select: newIndices });
}

function clearDropIndicators() {
  els.slidesList
    .querySelectorAll(".drop-before, .drop-after, .dragging")
    .forEach((el) => {
      el.classList.remove("drop-before", "drop-after", "dragging");
    });
}

function deleteSelectedSlides() {
  const indices = getSelectedSorted();
  if (!indices.length) return;
  setSlides(removeSlides(slides, indices), { select: [] });
}

// ── 마퀴(드래그) 다중 선택 ──
let marquee = null;

function endMarquee() {
  if (!marquee) return;
  marquee.box.remove();
  document.removeEventListener("mousemove", marquee.onMove);
  document.removeEventListener("mouseup", marquee.onUp);
  marquee = null;
}

/**
 * @param {MouseEvent} e
 */
function startMarqueePossible(e) {
  if (e.button !== 0) return;
  if (!(e.target instanceof HTMLElement)) return;
  if (e.target.closest("textarea, input, button.btn, .drag-handle")) return;
  // 슬라이드 리스트 영역에서만
  if (!e.target.closest(".slides-list, .slide-card")) return;

  const startX = e.clientX;
  const startY = e.clientY;
  const cardEl = e.target.closest(".slide-card");
  const startIndex = cardEl
    ? Number(cardEl.getAttribute("data-index"))
    : -1;
  const additive = e.shiftKey || e.metaKey || e.ctrlKey;
  const rangeMode = e.shiftKey && !e.metaKey && !e.ctrlKey;
  const toggleMode = e.metaKey || e.ctrlKey;

  /** 마퀴 시작 전 기존 선택 (additive용) */
  const baseSelected = additive ? new Set(selected) : new Set();

  let moved = false;
  const box = document.createElement("div");
  box.className = "selection-marquee";

  const onMove = (ev) => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (!moved && Math.hypot(dx, dy) < 6) return;

    if (!moved) {
      moved = true;
      // 텍스트 선택 방지
      ev.preventDefault();
      document.body.appendChild(box);
    }

    const x1 = Math.min(startX, ev.clientX);
    const y1 = Math.min(startY, ev.clientY);
    const x2 = Math.max(startX, ev.clientX);
    const y2 = Math.max(startY, ev.clientY);

    box.style.left = `${x1}px`;
    box.style.top = `${y1}px`;
    box.style.width = `${x2 - x1}px`;
    box.style.height = `${y2 - y1}px`;

    const hit = [];
    els.slidesList.querySelectorAll(".slide-card").forEach((el) => {
      const r = el.getBoundingClientRect();
      const intersects = !(
        r.right < x1 ||
        r.left > x2 ||
        r.bottom < y1 ||
        r.top > y2
      );
      if (intersects) {
        hit.push(Number(el.getAttribute("data-index")));
      }
    });

    if (toggleMode) {
      // 기존 ∪ 박스 안
      const next = new Set(baseSelected);
      for (const i of hit) next.add(i);
      setSelection([...next], hit[hit.length - 1] ?? anchorIndex);
    } else if (rangeMode && anchorIndex >= 0 && hit.length) {
      // shift 드래그: anchor ~ 현재 박스의 끝
      const edge = hit.includes(startIndex)
        ? hit[hit.length - 1] === startIndex
          ? hit[0]
          : hit[hit.length - 1]
        : hit[hit.length - 1];
      selectRange(anchorIndex, edge);
    } else {
      setSelection(hit, hit[hit.length - 1] ?? -1);
    }
  };

  const onUp = (ev) => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    box.remove();
    marquee = null;

    if (moved) return;

    // 클릭 (드래그 아님)
    if (startIndex < 0) {
      if (!additive) setSelection([]);
      return;
    }

    if (rangeMode && anchorIndex >= 0) {
      selectRange(anchorIndex, startIndex);
    } else if (toggleMode) {
      toggleSelect(startIndex);
    } else {
      selectOnly(startIndex);
    }
  };

  marquee = { box, onMove, onUp };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

function render() {
  const count = slides.length;
  els.downloadBtn.disabled = count === 0;
  updateHistoryButtons();
  updateSlideCountLabel();
  renderArrangement();

  if (count === 0) {
    els.emptyState.hidden = false;
    els.slidesList.hidden = true;
    els.slidesList.innerHTML = "";
    selected = new Set();
    anchorIndex = -1;
    return;
  }

  els.emptyState.hidden = true;
  els.slidesList.hidden = false;
  els.slidesList.innerHTML = "";
  clampSelection();

  slides.forEach((slide, index) => {
    const card = document.createElement("article");
    card.className =
      "slide-card" + (selected.has(index) ? " selected" : "");
    card.dataset.index = String(index);
    card.tabIndex = 0;

    // ── 드래그 핸들 (순서 변경) ──
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "drag-handle";
    handle.title = "드래그해서 순서 변경 (여러 개 선택 시 함께 이동)";
    handle.setAttribute("aria-label", "드래그해서 순서 변경");
    handle.innerHTML = "⋮⋮";
    handle.draggable = true;

    handle.addEventListener("dragstart", (e) => {
      // 선택 안 된 핸들이면 그 장만 선택
      if (!selected.has(index)) {
        selectOnly(index);
      }
      dragFromIndices = getSelectedSorted();
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", dragFromIndices.join(","));

      dragFromIndices.forEach((i) => {
        els.slidesList
          .querySelector(`[data-index="${i}"]`)
          ?.classList.add("dragging");
      });

      try {
        e.dataTransfer.setDragImage(card, 24, 24);
      } catch {
        // ignore
      }
    });

    handle.addEventListener("dragend", () => {
      dragFromIndices = [];
      clearDropIndicators();
    });

    card.addEventListener("dragover", (e) => {
      if (!dragFromIndices.length) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";

      const rect = card.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      card.classList.toggle("drop-before", before);
      card.classList.toggle("drop-after", !before);
      els.slidesList.querySelectorAll(".slide-card").forEach((other) => {
        if (other !== card) {
          other.classList.remove("drop-before", "drop-after");
        }
      });
    });

    card.addEventListener("dragleave", (e) => {
      if (!card.contains(/** @type {Node} */ (e.relatedTarget))) {
        card.classList.remove("drop-before", "drop-after");
      }
    });

    card.addEventListener("drop", (e) => {
      if (!dragFromIndices.length) return;
      e.preventDefault();
      const rect = card.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      let to = before ? index : index + 1;
      const from = [...dragFromIndices];
      clearDropIndicators();
      reorderSelected(from, to);
      dragFromIndices = [];
    });

    // 포커스만 — 선택은 mousedown/마퀴에서
    card.addEventListener("focus", () => {
      if (!selected.has(index) && !marquee) {
        // 탭 포커스 시 단일 선택
        selectOnly(index);
      }
    });

    const main = document.createElement("div");
    main.className = "slide-main";

    const top = document.createElement("div");
    top.className = "slide-top";

    const badge = document.createElement("div");
    badge.className = "slide-badge";
    badge.innerHTML = `<strong>${index + 1}</strong> · ${
      slide.type === "title" ? "제목" : "가사"
    } · ${slide.lines.filter((l) => String(l).trim()).length}줄`;
    top.appendChild(badge);

    if (slide.type === "lyrics") {
      const sectionInput = document.createElement("input");
      sectionInput.className = "section-input";
      sectionInput.type = "text";
      sectionInput.placeholder = "구간 (예: 1절, 후렴)";
      sectionInput.value = slide.section || "";

      let sectionSnapshot = slide.section || "";
      sectionInput.addEventListener("focus", () => {
        if (!selected.has(index)) selectOnly(index);
        sectionSnapshot = slides[index]?.section || "";
      });
      sectionInput.addEventListener("change", () => {
        const value = sectionInput.value;
        if (value === sectionSnapshot) {
          render();
          return;
        }
        setSlides(
          slides.map((s, i) => (i === index ? { ...s, section: value } : s)),
          { select: [index] }
        );
      });
      top.appendChild(sectionInput);
    }

    main.appendChild(top);

    const preview = document.createElement("div");
    const posClass = positionPreviewClass();
    preview.className =
      "slide-preview" +
      (slide.type === "title" ? " is-title" : "") +
      (slide.type === "lyrics" ? ` pos-${posClass}` : "");

    if (slide.type === "lyrics" && slide.section) {
      const label = document.createElement("div");
      label.className = "slide-section-label";
      label.textContent = slide.section;
      preview.appendChild(label);
    }

    if (slide.type === "title") {
      const input = document.createElement("input");
      input.className = "slide-title-text";
      input.type = "text";
      input.value = slide.lines[0] || "";
      input.placeholder = "곡 제목";

      let titleSnapshot = slide.lines[0] || "";
      input.addEventListener("focus", () => {
        if (!selected.has(index)) selectOnly(index);
        titleSnapshot = slides[index]?.lines[0] || "";
      });
      input.addEventListener("change", () => {
        const value = input.value;
        if (value === titleSnapshot) return;
        setSlides(
          slides.map((s, i) => (i === index ? { ...s, lines: [value] } : s)),
          { select: [index] }
        );
      });
      preview.appendChild(input);
    } else {
      const textarea = document.createElement("textarea");
      textarea.className = "slide-text";
      textarea.value = (slide.lines || []).join("\n");
      textarea.placeholder =
        "가사 입력 · Ctrl/⌘+Enter 새 슬라이드 · 맨 앞에서 ⌫ 합침";
      textarea.rows = Math.max(2, slide.lines.length || 2);

      let textSnapshot = (slide.lines || []).join("\n");

      textarea.addEventListener("focus", () => {
        if (!selected.has(index)) selectOnly(index);
        textSnapshot = (slides[index]?.lines || []).join("\n");
      });

      textarea.addEventListener("input", () => {
        draftLines(index, textarea.value);
        const n = textarea.value.split("\n").filter((l) => l.trim()).length;
        badge.innerHTML = `<strong>${index + 1}</strong> · 가사 · ${n}줄`;
      });

      textarea.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          const caret = textarea.selectionStart ?? textarea.value.length;
          const result = splitAtCaret(slides, index, textarea.value, caret);
          if (!result) return;
          setSlides(result.slides, {
            focus: { index: result.focusIndex, caret: result.caret },
            select: [result.focusIndex],
          });
          return;
        }

        if (
          e.key === "Backspace" &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey &&
          textarea.selectionStart === 0 &&
          textarea.selectionEnd === 0
        ) {
          const prev = slides[index - 1];
          if (!prev || prev.type !== "lyrics") return;
          e.preventDefault();

          const prevText = (prev.lines || []).join("\n");
          const currText = textarea.value.replace(/\r\n/g, "\n");
          const caret =
            prevText.length + (prevText.length && currText.length ? 1 : 0);
          const mergedLines = linesFromText(
            prevText +
              (prevText.length && currText.length ? "\n" : "") +
              currText
          );
          const nextSlides = [
            ...slides.slice(0, index - 1),
            {
              ...prev,
              lines: mergedLines,
              section: prev.section || slides[index].section,
            },
            ...slides.slice(index + 1),
          ];
          setSlides(nextSlides, {
            focus: { index: index - 1, caret },
            select: [index - 1],
          });
          return;
        }

        if (
          e.key === "Delete" &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey &&
          textarea.selectionStart === textarea.value.length &&
          textarea.selectionEnd === textarea.value.length
        ) {
          const nextSlide = slides[index + 1];
          if (!nextSlide || nextSlide.type !== "lyrics") return;
          e.preventDefault();

          const currText = textarea.value.replace(/\r\n/g, "\n");
          const nextText = (nextSlide.lines || []).join("\n");
          const caret = currText.length;
          const mergedLines = linesFromText(
            currText +
              (currText.length && nextText.length ? "\n" : "") +
              nextText
          );
          const nextSlides = [
            ...slides.slice(0, index),
            {
              ...slides[index],
              lines: mergedLines,
              section: slides[index].section || nextSlide.section,
            },
            ...slides.slice(index + 2),
          ];
          setSlides(nextSlides, {
            focus: { index, caret },
            select: [index],
          });
        }
      });

      textarea.addEventListener("blur", () => {
        if (pendingFocus) return;

        const lines = linesFromText(textarea.value);
        const nextText = lines.join("\n");
        const prevText = textSnapshot
          .replace(/\r\n/g, "\n")
          .replace(/\n+$/, "");

        if (!lines.some((l) => l.trim())) {
          if (slides[index]?.type === "lyrics") {
            setSlides(removeSlide(slides, index));
          }
          return;
        }

        if (nextText === prevText) {
          slides[index] = { ...slides[index], lines };
          return;
        }

        setSlides(
          slides.map((s, i) => (i === index ? { ...s, lines } : s)),
          { select: getSelectedSorted().length ? getSelectedSorted() : [index] }
        );
      });

      preview.appendChild(textarea);
    }

    main.appendChild(preview);

    const controls = document.createElement("div");
    controls.className = "slide-controls";

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn small danger";
    delBtn.textContent = "삭제";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      // 선택된 여러 장에 포함되면 일괄 삭제
      if (selected.has(index) && selected.size > 1) {
        deleteSelectedSlides();
      } else {
        setSlides(removeSlide(slides, index));
      }
    });
    controls.appendChild(delBtn);

    card.appendChild(handle);
    card.appendChild(main);
    card.appendChild(controls);
    els.slidesList.appendChild(card);
  });

  applyFocus();
  highlightSelection();
}

async function handleDownload() {
  if (!slides.length) return;

  const cleaned = removeEmptyLyricsSlides(slides);
  const normalized = cleaned
    .map((s) => ({
      ...s,
      lines: (s.lines || [])
        .map((l) => String(l).trim())
        .filter((l) => l.length > 0),
      section: (s.section || "").trim(),
    }))
    .filter((s) => s.type === "title" || s.lines.length > 0);

  if (!normalized.length) {
    alert("내보낼 슬라이드가 없습니다.");
    return;
  }

  const title =
    els.title.value.trim() ||
    normalized.find((s) => s.type === "title")?.lines[0] ||
    "찬양";

  els.downloadBtn.disabled = true;
  els.downloadBtn.textContent = "만드는 중…";
  try {
    const position = els.lyricsPosition?.value || "middle-center";
    await downloadWorshipPpt({
      title,
      slides: normalized,
      position,
    });
  } catch (err) {
    console.error(err);
    alert("PPT 생성 중 오류가 났습니다. 콘솔을 확인해 주세요.");
  } finally {
    els.downloadBtn.disabled = slides.length === 0;
    els.downloadBtn.textContent = "PPT 다운로드";
  }
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

function getClipboardSlides() {
  const indices = getSelectedSorted();
  if (!indices.length) return [];
  return indices.map((i) => slides[i]);
}

/** 미리보기용 위치 클래스 */
function positionPreviewClass() {
  const v = els.lyricsPosition?.value || "middle-center";
  if (v === "middle-center") return "middle";
  if (v === "bottom-center") return "bottom";
  return "top";
}

function refreshPreviewPositions() {
  const pos = positionPreviewClass();
  els.slidesList.querySelectorAll(".slide-preview:not(.is-title)").forEach((el) => {
    el.classList.remove("pos-top", "pos-middle", "pos-bottom");
    el.classList.add(`pos-${pos}`);
  });
}

els.lyricsPosition?.addEventListener("change", () => {
  refreshPreviewPositions();
});

els.parseBtn.addEventListener("click", buildFromInput);
els.sampleBtn.addEventListener("click", () => {
  els.title.value = SAMPLE_TITLE;
  els.lyrics.value = SAMPLE_LYRICS;
  buildFromInput();
});
els.downloadBtn.addEventListener("click", handleDownload);
els.undoBtn.addEventListener("click", undo);
els.redoBtn.addEventListener("click", redo);

els.lyrics.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    buildFromInput();
  }
});

// 마퀴 / 클릭 다중 선택
els.slidesList.addEventListener("mousedown", startMarqueePossible);

document.addEventListener("copy", (e) => {
  if (hasTextSelectionInField()) return;
  if (
    isTextFieldFocused() &&
    document.activeElement &&
    !document.activeElement.closest(".slide-card")
  ) {
    return;
  }

  const list = getClipboardSlides();
  if (!list.length) return;

  const payload = serializeSlides(list);
  memoryClipboard = list.map((s) => ({
    ...s,
    lines: [...(s.lines || [])],
  }));
  e.clipboardData?.setData("text/plain", payload);
  e.preventDefault();
});

document.addEventListener("cut", (e) => {
  if (hasTextSelectionInField()) return;
  if (
    isTextFieldFocused() &&
    document.activeElement &&
    !document.activeElement.closest(".slide-card")
  ) {
    return;
  }

  const indices = getSelectedSorted();
  const list = getClipboardSlides();
  if (!list.length) return;

  const payload = serializeSlides(list);
  memoryClipboard = list.map((s) => ({
    ...s,
    lines: [...(s.lines || [])],
  }));
  e.clipboardData?.setData("text/plain", payload);
  e.preventDefault();
  setSlides(removeSlides(slides, indices), { select: [] });
});

document.addEventListener("paste", (e) => {
  const text = e.clipboardData?.getData("text/plain") || "";
  let list = deserializeSlides(text);

  if (!list.length && memoryClipboard?.length) {
    // 시스템 클립보드가 비었을 때 메모리 백업
    if (
      !isTextFieldFocused() ||
      document.activeElement?.closest(".slide-card")
    ) {
      list = memoryClipboard.map((s) => cloneSlide(s));
    }
  }

  if (!list.length) return;

  if (
    isTextFieldFocused() &&
    document.activeElement &&
    !document.activeElement.closest(".slide-card")
  ) {
    return;
  }

  if (hasTextSelectionInField()) return;

  e.preventDefault();
  memoryClipboard = list.map((s) => ({
    ...s,
    lines: [...(s.lines || [])],
  }));
  const after = primarySelected();
  insertSlidesAfter(
    list.map((s) => cloneSlide(s)),
    after
  );
});

document.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;

  // Delete / Backspace 로 선택 슬라이드 삭제 (입력 중 아닐 때)
  if (
    (e.key === "Delete" || e.key === "Backspace") &&
    !mod &&
    getSelectedSorted().length > 0 &&
    !isTextFieldFocused()
  ) {
    e.preventDefault();
    deleteSelectedSlides();
    return;
  }

  // Ctrl/Cmd+A 전체 선택 (슬라이드 영역)
  if (
    mod &&
    e.key.toLowerCase() === "a" &&
    slides.length &&
    (!isTextFieldFocused() ||
      document.activeElement?.closest(".slide-card"))
  ) {
    // 가사 textarea 안에서는 텍스트 전체 선택 유지
    if (
      document.activeElement instanceof HTMLTextAreaElement &&
      document.activeElement.classList.contains("slide-text")
    ) {
      return;
    }
    if (
      document.activeElement instanceof HTMLInputElement &&
      document.activeElement.closest(".slide-card")
    ) {
      return;
    }
    e.preventDefault();
    setSelection(
      slides.map((_, i) => i),
      0
    );
    return;
  }

  // 곡 진행: 입력 중이 아니면 ] / → 다음 구간, [ / ← 이전 구간
  if (
    !mod &&
    arrangement.length > 0 &&
    !isTextFieldFocused() &&
    (e.key === "ArrowRight" ||
      e.key === "ArrowLeft" ||
      e.key === "]" ||
      e.key === "[")
  ) {
    e.preventDefault();
    if (e.key === "ArrowRight" || e.key === "]") {
      goToArrangementStep(
        Math.min(arrangement.length - 1, arrangementStep + 1)
      );
    } else {
      goToArrangementStep(Math.max(0, arrangementStep - 1));
    }
    return;
  }

  if (!mod) return;

  const key = e.key.toLowerCase();
  const editing = isEditableTarget(e.target);

  const inSlidePreview =
    e.target instanceof HTMLElement &&
    e.target.closest(".slide-preview, .section-input, .slide-card");

  if (key === "z" && !e.shiftKey) {
    if (editing && !inSlidePreview) return;
    if (!past.length) return;
    e.preventDefault();
    undo();
    return;
  }

  if ((key === "z" && e.shiftKey) || key === "y") {
    if (editing && !inSlidePreview) return;
    if (!future.length) return;
    e.preventDefault();
    redo();
  }
});

render();
