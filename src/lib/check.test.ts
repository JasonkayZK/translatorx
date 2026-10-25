import { describe, expect, it } from "vitest";
import { blankMatches, buildCloze, compare, hintText, isTypo, nextHintIndex, normalize, sentenceHint, typingState, DEFAULT_CHECK } from "./check";

describe("normalize", () => {
  it("folds case, curly apostrophes and optionally accents", () => {
    expect(normalize("Don’t", DEFAULT_CHECK)).toBe("don't");
    expect(normalize("Café", { ...DEFAULT_CHECK, ignoreAccents: true })).toBe("cafe");
    expect(normalize("Café", DEFAULT_CHECK)).toBe("café");
  });
});

describe("compare", () => {
  it("accepts a perfect answer regardless of case and punctuation", () => {
    const r = compare("Thanks for your reply, see you Friday.", "thanks for your reply see you friday", "en");
    expect(r.perfect).toBe(true);
    expect(r.total).toBe(7);
    expect(r.score).toBe(1);
  });

  it("marks wrong, missing and extra words", () => {
    const r = compare("I will see you on Friday", "I see you at on Friday now", "en");
    const kinds = r.ops.map((o) => o.kind);
    expect(kinds).toContain("missing");
    expect(kinds).toContain("extra");
    expect(r.perfect).toBe(false);
    expect(r.correct).toBe(5);
  });

  it("treats a one-letter slip as a typo, not a wrong word", () => {
    const r = compare("definitely", "definately", "en");
    expect(r.ops[0].kind).toBe("typo");
    expect(r.score).toBe(0.5);
  });

  it("works for unspaced languages", () => {
    const r = compare("ありがとうございます。", "ありがとうございます", "ja");
    expect(r.perfect).toBe(true);
  });

  it("points hints at the first unfinished word", () => {
    const r = compare("See you on Friday", "See you", "en");
    expect(nextHintIndex(r)).toBe(2);
    expect(nextHintIndex(compare("Hi there", "hi there", "en"))).toBe(-1);
  });

  it("counts punctuation when asked", () => {
    const strict = { ...DEFAULT_CHECK, ignorePunctuation: false };
    expect(compare("Hello, world.", "Hello world", "en", strict).perfect).toBe(false);
  });
});

describe("typos and hints", () => {
  it("ignores short words", () => {
    expect(isTypo("the", "teh")).toBe(false);
    expect(isTypo("friday", "fridya")).toBe(false);
    expect(isTypo("friday", "fridey")).toBe(true);
  });
  it("reveals progressively", () => {
    expect(hintText("recommend", 1)).toBe("rec…");
    expect(hintText("recommend", 2)).toBe("recommend");
  });
});

describe("cloze", () => {
  it("is deterministic and preserves the text", () => {
    const text = "The model was trained on a curated dataset.";
    const a = buildCloze(text, "en", 0.4);
    const b = buildCloze(text, "en", 0.4);
    expect(a).toEqual(b);
    const rebuilt = a.map((p) => (p.type === "text" ? p.text : p.answer)).join("");
    expect(rebuilt).toBe(text);
    expect(a.filter((p) => p.type === "blank").length).toBe(3);
  });
  it("blanks every word at ratio 1", () => {
    const parts = buildCloze("See you soon", "en", 1);
    expect(parts.filter((p) => p.type === "blank").map((p) => (p.type === "blank" ? p.answer : ""))).toEqual(["See", "you", "soon"]);
  });
  it("matches blanks loosely by case", () => {
    expect(blankMatches("Friday", " friday ", DEFAULT_CHECK)).toBe(true);
    expect(blankMatches("Friday", "Fri", DEFAULT_CHECK)).toBe(false);
  });
});

describe("typing", () => {
  it("tracks per-character state", () => {
    const s = typingState("Hi you", "Hx", DEFAULT_CHECK);
    expect(s.chars.map((c) => c.state)).toEqual(["ok", "bad", "pending", "pending", "pending", "pending"]);
    expect(s.errors).toBe(1);
    expect(s.done).toBe(false);
    expect(typingState("Hi", "hi", DEFAULT_CHECK).done).toBe(true);
  });
});

describe("sentenceHint", () => {
  it("reveals a growing prefix of a spaced sentence", () => {
    expect(sentenceHint("See you at three on Friday afternoon.", "en", 1)).toBe("See you…");
    expect(sentenceHint("See you at three on Friday afternoon.", "en", 2)).toBe("See you at three…");
  });

  it("never gives away a whole unspaced sentence", () => {
    const h = sentenceHint("今天的会议改到明天上午了。", "zh-CN", 2);
    expect(h.endsWith("…")).toBe(true);
    expect(h.length).toBeLessThan("今天的会议改到明天上午了。".length);
  });
});
