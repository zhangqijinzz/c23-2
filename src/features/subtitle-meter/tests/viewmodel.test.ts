import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubtitleMeterViewModel } from "../viewmodels/subtitleMeterViewModel";
import { readTextFile } from "../services/fileService";
import { downloadSubtitles } from "../services/exportService";
vi.mock("../services/fileService", () => ({
  readTextFile: vi.fn(async (file: File) =>
    file.name.endsWith(".csv")
      ? "无法解析的术语表"
      : "1\n00:00:01,000 --> 00:00:03,000\nOriginal caption",
  ),
}));
vi.mock("../repositories/projectRepository", () => ({
  projectRepository: {
    save: vi.fn(async () => undefined),
    load: vi.fn(async () => null),
  },
}));
vi.mock("../services/exportService", () => ({ downloadSubtitles: vi.fn() }));
describe("SubtitleMeterViewModel", () => {
  let vm: SubtitleMeterViewModel;
  beforeEach(() => {
    vm = new SubtitleMeterViewModel();
  });
  it("imports, edits, rechecks, snapshots, and exports", async () => {
    await vm.importFile(new File(["x"], "clip.srt"));
    expect(vm.state.phase).toBe("ready");
    const cue = vm.state.project!.cues[0];
    await vm.editCue(cue.id, { text: "Edited" });
    expect(vm.state.project!.cues[0].text).toBe("Edited");
    await vm.saveVersion();
    expect(vm.state.project!.versions).toHaveLength(1);
    await vm.exportFile();
    expect(vm.state.notice).toBe("字幕文件已导出");
  });
  it("keeps a recoverable error when an unsupported import is selected", async () => {
    await vm.importFile(new File(["x"], "clip.txt"));
    expect(vm.state.phase).toBe("error");
    expect(vm.state.notice).toContain("仅支持");
  });
  it("shows a parse failure as a recoverable import error", async () => {
    vi.mocked(readTextFile).mockResolvedValueOnce("not a subtitle block");
    await vm.importFile(new File(["x"], "clip.srt"));
    expect(vm.state.phase).toBe("error");
    expect(vm.state.notice).toContain("缺少时间码");
  });
  it("keeps editing visible immediately and reports export failures", async () => {
    await vm.importFile(new File(["x"], "clip.srt"));
    const cue = vm.state.project!.cues[0];
    const saving = vm.editCue(cue.id, { text: "Immediate edit" });
    expect(vm.state.project!.cues[0].text).toBe("Immediate edit");
    await saving;
    vi.mocked(downloadSubtitles).mockImplementationOnce(() => {
      throw new Error("download unavailable");
    });
    await vm.exportFile();
    expect(vm.state.phase).toBe("error");
    expect(vm.state.notice).toContain("导出失败");
    expect(vm.state.project!.cues[0].text).toBe("Immediate edit");
  });
  it("imports a glossary, reports term issues, and highlights hits", async () => {
    await vm.importFile(new File(["x"], "clip.srt"));
    const csv = "源术语,允许写法\nOriginal caption,规范写法";
    vi.mocked(readTextFile).mockResolvedValueOnce(csv);
    await vm.importGlossary(new File([csv], "terms.csv"));
    // 示例字幕里保留了源术语原文，应报漏译
    expect(
      vm.state.issues.some((issue) => issue.type === "glossary-missing"),
    ).toBe(true);
    expect(vm.state.glossaryHits.length).toBeGreaterThan(0);
    expect(vm.state.project?.glossary?.terms).toHaveLength(1);
  });
  it("restores a snapshot together with its glossary", async () => {
    await vm.importFile(new File(["x"], "clip.srt"));
    const csv = "源术语,允许写法\nOriginal caption,规范写法";
    vi.mocked(readTextFile).mockResolvedValueOnce(csv);
    await vm.importGlossary(new File([csv], "terms.csv"));
    await vm.saveVersion();
    await vm.removeGlossary();
    expect(vm.state.project?.glossary).toBeNull();
    expect(vm.state.issues.some((i) => i.type.startsWith("glossary"))).toBe(
      false,
    );
    await vm.restoreVersion(vm.state.project!.versions[0].id);
    expect(vm.state.project?.glossary?.terms).toHaveLength(1);
    expect(
      vm.state.issues.some((issue) => issue.type === "glossary-missing"),
    ).toBe(true);
  });
  it("rejects glossary import before a project exists", async () => {
    await expect(
      vm.importGlossary(new File(["源术语,允许写法\nA,B"], "terms.csv")),
    ).rejects.toThrow("先导入字幕");
  });
  it("keeps combined issues ordered by cue start time", async () => {
    const twoCues =
      "1\n00:00:01,000 --> 00:00:03,000\nFirst\n\n2\n00:00:04,000 --> 00:00:06,000\nSecond";
    vi.mocked(readTextFile).mockResolvedValueOnce(twoCues);
    await vm.importFile(new File(["x"], "clip.srt"));
    const csv = "源术语,允许写法\nSecond,规范写法二";
    vi.mocked(readTextFile).mockResolvedValueOnce(csv);
    await vm.importGlossary(new File([csv], "terms.csv"));
    const cueIds = vm.state.issues.map((issue) => issue.cueId);
    const firstCueId = vm.state.project!.cues[0].id;
    const secondCueId = vm.state.project!.cues[1].id;
    expect(cueIds.indexOf(firstCueId)).toBeLessThan(
      cueIds.indexOf(secondCueId),
    );
  });
});
