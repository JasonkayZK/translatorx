import { expect, it } from "vitest";
import { inspectImage } from "./background-image";

function png(width: number, height: number, animated = false) {
  const data = new Uint8Array(animated ? 65 : 45);
  data.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
  const view = new DataView(data.buffer);
  view.setUint32(16, width); view.setUint32(20, height);
  if (animated) { view.setUint32(33, 8); data.set([97,99,84,76], 37); }
  const end = animated ? 53 : 33;
  data.set([0,0,0,0,73,69,78,68,0,0,0,0], end);
  return data;
}
function webp(animated = false) {
  const data = new Uint8Array(30);
  data.set([82,73,70,70,22,0,0,0,87,69,66,80,86,80,56,88,10,0,0,0]);
  data[20] = animated ? 2 : 0; data[24] = 39; data[27] = 19;
  return data;
}
it("reads raster dimensions from signatures rather than filename or MIME", () => {
  expect(inspectImage(png(1200, 800))).toEqual({ width: 1200, height: 800, mime: "image/png" });
  expect(inspectImage(webp())).toEqual({ width: 40, height: 20, mime: "image/webp" });
  const jpeg = new Uint8Array([255,216,255,192,0,11,8,0,20,0,40,1,1,17,0,255,217]);
  expect(inspectImage(jpeg)).toEqual({ width: 40, height: 20, mime: "image/jpeg" });
});
it("checks the WebP bitstream dimensions even when its canvas header is small", () => {
  const data = new Uint8Array(44);
  data.set(webp());
  const view = new DataView(data.buffer);
  view.setUint32(4, 36, true);
  data.set([86,80,56,76,5,0,0,0,47,255,255,255,15,0], 30);
  expect(() => inspectImage(data)).toThrow();
});

it("rejects dimensions and input sizes before full image decoding", () => {
  expect(() => inspectImage(png(100000, 100000))).toThrow();
  expect(() => inspectImage(png(0, 100))).toThrow();
  expect(() => inspectImage(new Uint8Array(10 * 1024 * 1024 + 1))).toThrow();
});
it("rejects animated, truncated and non-raster input", () => {
  expect(() => inspectImage(png(2, 2, true))).toThrow();
  expect(() => inspectImage(webp(true))).toThrow();
  expect(() => inspectImage(png(2, 2).slice(0, 22))).toThrow();
  expect(() => inspectImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toThrow();
});
