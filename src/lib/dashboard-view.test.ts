import { describe, expect, it } from "vitest";
import { shouldShowExportSection } from "@/lib/dashboard-view";

describe("shouldShowExportSection", () => {
  it("shows when there are kept cards to export", () => {
    expect(shouldShowExportSection(true, false)).toBe(true);
  });

  it("shows when an export error exists, even with nothing to export", () => {
    expect(shouldShowExportSection(false, true)).toBe(true);
  });

  it("shows when both are true", () => {
    expect(shouldShowExportSection(true, true)).toBe(true);
  });

  it("hides when there is nothing to export and no error", () => {
    expect(shouldShowExportSection(false, false)).toBe(false);
  });
});
