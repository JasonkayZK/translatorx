import { describe, expect, it } from "vitest";
import { recoverBreaks, splitDraft } from "./segment";
import { joinSegments } from "./languages";

describe("splitDraft", () => {
  it("splits Chinese sentences and keeps paragraph breaks", () => {
    const segs = splitDraft("你好，Alex！\n感谢你的回复。我们周五见。", "zh-CN");
    expect(segs.map((s) => s.source)).toEqual(["你好，Alex！", "感谢你的回复。", "我们周五见。"]);
    expect(segs.map((s) => s.breakAfter)).toEqual([true, false, false]);
  });

  it("splits clauses only when both halves are substantial", () => {
    const segs = splitDraft("感谢你昨天的详细回复，我们周五下午在公司见面吧。", "zh-CN", "clause");
    expect(segs.map((s) => s.source)).toEqual(["感谢你昨天的详细回复，", "我们周五下午在公司见面吧。"]);
    const short = splitDraft("好的，我们周五下午见面吧。", "zh-CN", "clause");
    expect(short).toHaveLength(1);
  });

  it("ignores blank input", () => {
    expect(splitDraft("  \n \n", "zh-CN")).toEqual([]);
  });
});

describe("recoverBreaks", () => {
  it("finds newlines between LLM chunks", () => {
    const text = "你好，Alex！\n感谢你的回复。我们周五见。";
    expect(recoverBreaks(text, ["你好，Alex！", "感谢你的回复。", "我们周五见。"])).toEqual([true, false, false]);
  });
});

describe("joinSegments", () => {
  it("uses spaces only for spaced languages", () => {
    expect(joinSegments([{ text: "Hi Alex!", breakAfter: true }, { text: "Thanks." }, { text: "See you." }], "en")).toBe(
      "Hi Alex!\nThanks. See you.",
    );
    expect(joinSegments([{ text: "ありがとう。" }, { text: "またね。" }], "ja")).toBe("ありがとう。またね。");
  });
});
