import { describe, expect, it } from "vitest";
import { filePathFor, isBusinessFilePath, isImageFile, safeFileName } from "./files";

const B = "386bd80b-e724-48bf-8f13-69d0b77645da";

describe("record files", () => {
  it("keeps names readable and path-safe", () => {
    expect(safeFileName("Kitchen photo (1).JPG")).toBe("Kitchen-photo-1.JPG");
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("..")).toBe("file");
  });

  it("puts files in the business's folder and accepts only those", () => {
    const p = filePathFor(B, "tbl_photos", "a b.png", "x1");
    expect(p).toBe(`${B}/tbl_photos/x1/a-b.png`);
    expect(isBusinessFilePath(B, p)).toBe(true);
    expect(isBusinessFilePath("other", p)).toBe(false);
    expect(isBusinessFilePath(B, `${B}/../other/x/a.png`)).toBe(false);
    expect(isBusinessFilePath(B, `${B}/tbl/a.png`)).toBe(false);
  });

  it("recognises images", () => {
    expect(isImageFile({ mime: "image/jpeg" })).toBe(true);
    expect(isImageFile({ name: "lease.pdf", mime: "application/pdf" })).toBe(false);
  });
});
