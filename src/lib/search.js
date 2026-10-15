import { toLatinDigits } from "./numbers.js";

export const normalize = (value) =>
  toLatinDigits(value.normalize("NFKC"))
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/_/g, " ")
    .toLowerCase();

export const searchTerms = (query) => [
  ...new Set(normalize(query).trim().split(/\s+/).filter(Boolean)),
];

const graphemes = new Intl.Segmenter("ar", { granularity: "grapheme" });

export function findMatchRanges(text, terms) {
  if (!terms.length || !text) return [];
  let normalized = "";
  const offsets = [];
  // Keep a map back to whole original graphemes, including Arabic diacritics
  // and presentation-form ligatures expanded by NFKC normalization.
  for (const { segment, index } of graphemes.segment(text)) {
    const part = normalize(segment);
    normalized += part;
    for (let i = 0; i < part.length; i++)
      offsets.push([index, index + segment.length]);
  }
  const ranges = [];
  for (const term of terms) {
    if (!term) continue;
    let start = normalized.indexOf(term);
    while (start !== -1) {
      ranges.push([offsets[start][0], offsets[start + term.length - 1][1]]);
      start = normalized.indexOf(term, start + 1);
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range[0] <= previous[1])
      previous[1] = Math.max(previous[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

export function searchExcerpt(text, terms, length = 145) {
  const [match] = findMatchRanges(text, terms);
  if (!match) return "";
  let start = Math.max(0, match[0] - 35);
  if (start > 0) {
    const boundary = text.indexOf(" ", start);
    if (boundary !== -1 && boundary < match[0]) start = boundary + 1;
  }
  let end = Math.min(text.length, Math.max(start + length, match[1]));
  if (end < text.length) {
    const boundary = text.lastIndexOf(" ", end);
    if (boundary >= match[1]) end = boundary;
  }
  return `${start ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}
