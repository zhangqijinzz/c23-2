import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubtitleMeterViewModel } from "../viewmodels/subtitleMeterViewModel";
import { readTextFile } from "../services/fileService";
import { downloadTermReport } from "../services/exportService";

vi.mock("../services/fileService", () => ({
  readTextFile: vi.fn(
    async () =>
      "1\n00:00:01,000 --> 00:00:03,000\nNebula 抵达\n\n2\n00:00:04,000 --> 00:00:06,000\n星云 很好",
  ),
}));
vi.mock("../repositories/projectRepository", () => ({
  projectRepository: {
    save: vi.fn(async () => undefined),
    load: vi.fn(async () => null),
  },
}));
vi.mock("../services/exportService", () => ({
  downloadSubtitles: vi.fn(),
  downloadTermReport: vi.fn(),
}));

const glossaryCsv = () =>
  new File(
    ["术语,标准译法,允许写法,弃用译法\nNebula,星云,星云号,纳布拉"],
    "terms.csv",
    { type: "text/csv" },
  );

describe("SubtitleMeterViewModel glossary flow", () => {
  let vm: SubtitleMeterViewModel;
  beforeEach(() => {
    vm = new SubtitleMeterViewModel();
    vi.clearAllMocks();
    vi.mocked(readTextFile).mockImplementation(async (file: File) => {
      if (file.name.endsWith(".csv"))
        return "术语,标准译法,允许写法,弃用译法\nNebula,星云,星云号,纳布拉";
      return "1\n00:00:01,000 --> 00:00:03,000\nNebula 抵达\n\n2\n00:00:04,000 --> 00:00:06,000\n星云 很好";
    });
  });

  it("behaves exactly as before without a glossary", async () => {
    await vm.importFile(new File(["x"], "clip.srt"));
    expect(vm.state.termMarks).toEqual([]);
    expect(vm.state.issues.some((i) => i.type.startsWith("term-"))).toBe(false);
  });

  it("refuses a glossary before any project exists", async () => {
    await vm.importGlossaryFile(glossaryCsv());
    expect(vm.state.notice).toContain("先导入字幕");
    expect(vm.state.project?.glossary).toBeUndefined();
  });

  it("imports a glossary, flags term issues, and exposes marks", async () => {
    await vm.importFile(new File(["x"], "clip.srt"));
    await vm.importGlossaryFile(glossaryCsv());
    expect(vm.state.project?.glossary?.terms).toHaveLength(1);
    const types = vm.state.issues.map((i) => i.type);
    expect(types).toContain("term-missing");
    // 第二条「星云」是符合的命中，也应有标记
    expect(vm.state.termMarks.map((m) => m.kind)).toContain("term-ok");
  });

  it("reports invalid glossary files without losing the project", async () => {
    await vm.importFile(new File(["x"], "clip.srt"));
    vi.mocked(readTextFile).mockResolvedValueOnce("bad,headers\n1,2");
    await vm.importGlossaryFile(new File(["x"], "bad.csv"));
    expect(vm.state.notice).toContain("术语表导入失败");
    expect(vm.state.project).not.toBeNull();
    expect(vm.state.project?.glossary).toBeUndefined();
  });

  it("stores the glossary in snapshots and restores it on rollback", async () => {
    await vm.importFile(new File(["x"], "clip.srt"));
    await vm.importGlossaryFile(glossaryCsv());
    await vm.saveVersion();
    expect(vm.state.project?.versions[0].glossary?.terms).toHaveLength(1);

    await vm.clearGlossary();
    expect(vm.state.project?.glossary).toBeUndefined();
    expect(vm.state.termMarks).toEqual([]);

    await vm.restoreVersion(vm.state.project!.versions[0].id);
    expect(vm.state.project?.glossary?.fileName).toBe("terms.csv");
    expect(vm.state.termMarks.length).toBeGreaterThan(0);
  });

  it("exports a term usage report when a glossary exists", async () => {
    await vm.importFile(new File(["x"], "clip.srt"));
    await vm.importGlossaryFile(glossaryCsv());
    await vm.exportTermReport();
    expect(downloadTermReport).toHaveBeenCalledTimes(1);
    const markdown = vi.mocked(downloadTermReport).mock.calls[0][1];
    expect(markdown).toContain("术语使用情况清单");
  });

  it("does nothing for report export without a glossary", async () => {
    await vm.importFile(new File(["x"], "clip.srt"));
    await vm.exportTermReport();
    expect(downloadTermReport).not.toHaveBeenCalled();
  });
});
