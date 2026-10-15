import assert from "node:assert/strict";
import test from "node:test";
import {
  findMatchRanges,
  searchExcerpt,
  searchTerms,
} from "../src/lib/search.js";

const hits = (text, query) =>
  findMatchRanges(text, searchTerms(query)).map(([start, end]) =>
    text.slice(start, end),
  );

test("highlights original Arabic letters with their diacritics", () => {
  assert.deepEqual(hits("الصِّحَّة لا تُعَوَّض", "الصحة تعوض"), [
    "الصِّحَّة",
    "تُعَوَّض",
  ]);
});

test("matches alif variants, alif maqsura, and tatweel", () => {
  assert.deepEqual(hits("إصـلاح الأذى", "اصلاح الاذي"), ["إصـلاح", "الأذى"]);
});

test("maps compatibility ligatures back to the whole original glyph", () => {
  assert.deepEqual(hits("ﻻ تحزن", "لا"), ["ﻻ"]);
});

test("highlights all occurrences and merges overlapping matches", () => {
  assert.deepEqual(hits("الحياة والحياة", "حياة حياة ياة"), ["حياة", "حياة"]);
});

test("treats regex and HTML punctuation as literal text", () => {
  assert.deepEqual(hits("<script> [a+b]", "<script> [a+b]"), [
    "<script>",
    "[a+b]",
  ]);
});

test("empty queries and missing words have no highlights", () => {
  assert.deepEqual(hits("نص عربي", "  "), []);
  assert.deepEqual(hits("نص عربي", "مفقود"), []);
});

test("excerpts keep a body match away from the beginning in context", () => {
  const text = `${"تمهيد طويل ".repeat(35)}استثمار ماله في مشروع مفيد ${"وتفاصيل إضافية ".repeat(20)}`;
  const excerpt = searchExcerpt(text, searchTerms("استثمار ماله"));
  assert.ok(excerpt.startsWith("…"));
  assert.ok(excerpt.endsWith("…"));
  assert.ok(excerpt.includes("استثمار ماله"));
  assert.ok(excerpt.length < 160);
  assert.deepEqual(hits(excerpt, "استثمار ماله"), ["استثمار", "ماله"]);
});
