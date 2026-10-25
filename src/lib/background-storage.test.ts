// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { readBackground, writeBackground, deleteBackground } from "./background-storage";
vi.mock("./background-image", () => ({ validateBackgroundData: async (s: string) => { if (s === "bad") throw new Error("bad image"); } }));
afterEach(async () => { vi.restoreAllMocks(); await deleteBackground(); });

it("stores images outside localStorage and retains them across separate reads", async () => {
  localStorage.setItem("learning-data", "keep");
  await writeBackground("png-data");
  expect(await readBackground()).toBe("png-data");
  expect(localStorage.getItem("learning-data")).toBe("keep");
  expect(Object.values(localStorage).join("")).not.toContain("png-data");
});
it("keeps the old image when validation or the transaction fails", async () => {
  await writeBackground("old-image");
  await expect(writeBackground("bad")).rejects.toThrow();
  const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
  await expect(writeBackground("replacement")).rejects.toThrow();
  put.mockRestore();
  expect(await readBackground()).toBe("old-image");
});
it("serializes an import followed by removal and allows repeated removal", async () => {
  const save = writeBackground("new-image");
  const clear = deleteBackground();
  await Promise.all([save, clear]);
  expect(await readBackground()).toBeNull();
  await deleteBackground();
  expect(await readBackground()).toBeNull();
});
