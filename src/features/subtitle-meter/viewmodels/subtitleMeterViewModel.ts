import { detectIssues } from "../analyzers/issueDetector";
import { formatSubtitles } from "../formatters/subtitleFormatter";
import {
  emptyState,
  type Format,
  type MeterState,
  type SubtitleCue,
  type SubtitleIssue,
  type SubtitleProject,
  type TermMark,
} from "../models";
import { parseSubtitles, detectFormat } from "../parsers/subtitleParser";
import { projectRepository } from "../repositories/projectRepository";
import {
  downloadSubtitles,
  downloadTermReport,
} from "../services/exportService";
import { readTextFile } from "../services/fileService";
import { parseGlossary } from "../terminology/glossaryParser";
import { checkTerms } from "../terminology/termChecker";
import {
  buildTermUsageReport,
  formatTermUsageReport,
} from "../terminology/termUsageReport";

function analyze(project: SubtitleProject): {
  issues: SubtitleIssue[];
  termMarks: TermMark[];
} {
  const base = detectIssues(project.cues);
  if (!project.glossary) return { issues: base, termMarks: [] };
  const termResult = checkTerms(project.cues, project.glossary);
  return {
    issues: [...base, ...termResult.issues],
    termMarks: termResult.marks,
  };
}

export class SubtitleMeterViewModel {
  state: MeterState = emptyState();
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.state;
  private publish(patch: Partial<MeterState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private async commit(
    project: SubtitleProject,
    phase: MeterState["phase"] = "editing",
  ) {
    project.updatedAt = Date.now();
    const { issues, termMarks } = analyze(project);
    this.publish({ project, issues, termMarks, phase, notice: "" });
    try {
      await projectRepository.save(project);
    } catch {
      if (this.state.project?.updatedAt === project.updatedAt) {
        this.publish({
          phase: "error",
          notice: "本地保存失败；当前修改仍保留在页面中，请导出备份",
        });
      }
    }
  }
  async restore() {
    try {
      const project = await projectRepository.load();
      if (project) {
        const { issues, termMarks } = analyze(project);
        this.publish({
          project,
          issues,
          termMarks,
          phase: "ready",
          selectedId: project.cues[0]?.id ?? null,
          notice: "已恢复上次编辑",
        });
      }
    } catch {
      this.publish({ notice: "本地项目暂时无法读取，可继续导入字幕文件" });
    }
  }
  async importFile(file: File) {
    this.publish({ phase: "importing", notice: "正在读取并解析字幕文件…" });
    try {
      const format = detectFormat(file.name),
        text = await readTextFile(file),
        cues = parseSubtitles(text, format);
      const project: SubtitleProject = {
        id: "subtitle-meter.current.v1",
        name: file.name,
        format,
        cues,
        updatedAt: Date.now(),
        versions: [],
      };
      this.publish({
        selectedId: cues[0].id,
        notice: `已解析 ${cues.length} 条字幕`,
      });
      await this.commit(project, "ready");
    } catch (error) {
      this.publish({
        phase: "error",
        notice:
          error instanceof Error ? error.message : "导入失败，请检查文件后重试",
      });
    }
  }
  async importGlossaryFile(file: File) {
    const project = this.state.project;
    if (!project) {
      this.publish({ notice: "请先导入字幕，再导入术语表" });
      return;
    }
    this.publish({
      phase: "importing",
      notice: `正在读取术语表 ${file.name}…`,
    });
    try {
      const raw = await readTextFile(file);
      const glossary = parseGlossary(raw, file.name);
      await this.commit({ ...project, glossary }, "ready");
      const termIssueCount = this.state.issues.filter((issue) =>
        issue.type.startsWith("term-"),
      ).length;
      this.publish({
        notice: `已导入术语表「${file.name}」：${glossary.terms.length} 条术语，术语相关提醒 ${termIssueCount} 项`,
      });
    } catch (error) {
      this.publish({
        phase: "ready",
        notice:
          error instanceof Error
            ? `术语表导入失败：${error.message}`
            : "术语表导入失败，请检查文件后重试",
      });
    }
  }
  async clearGlossary() {
    const project = this.state.project;
    if (!project?.glossary) return;
    const next = structuredClone(project) as SubtitleProject;
    delete next.glossary;
    await this.commit(next, "ready");
    this.publish({ notice: "已移除术语表，检查结果恢复为字幕基础检查" });
  }
  selectCue(id: string) {
    this.publish({ selectedId: id });
  }
  setZoom(zoom: number) {
    this.publish({ zoom });
  }
  async editCue(
    id: string,
    patch: Partial<Pick<SubtitleCue, "text" | "startMs" | "endMs">>,
  ) {
    if (!this.state.project) return;
    const cues = this.state.project.cues.map((cue) =>
      cue.id === id ? { ...cue, ...patch } : cue,
    );
    await this.commit({ ...this.state.project, cues });
  }
  async saveVersion() {
    const project = this.state.project;
    if (!project) return;
    const versions = [
      ...project.versions,
      {
        id: `v-${Date.now()}`,
        label: `快照 ${project.versions.length + 1}`,
        savedAt: Date.now(),
        cues: structuredClone(project.cues),
        glossary: project.glossary
          ? structuredClone(project.glossary)
          : undefined,
      },
    ];
    await this.commit({ ...project, versions });
    this.publish({ notice: "已保存版本快照（含当前术语表）" });
  }
  async restoreVersion(id: string) {
    const project = this.state.project,
      version = project?.versions.find((item) => item.id === id);
    if (!project || !version) return;
    const restored: SubtitleProject = {
      ...project,
      cues: structuredClone(version.cues),
      glossary: version.glossary
        ? structuredClone(version.glossary)
        : undefined,
    };
    await this.commit(restored);
    this.publish({
      notice: version.glossary
        ? `已恢复${version.label}（含当时术语表）`
        : `已恢复${version.label}`,
    });
  }
  async exportFile() {
    const project = this.state.project;
    if (!project) return;
    this.publish({ phase: "exporting" });
    try {
      formatSubtitles(project.cues, project.format);
      downloadSubtitles(project.name, project.cues, project.format);
      this.publish({ phase: "ready", notice: "字幕文件已导出" });
    } catch {
      this.publish({
        phase: "error",
        notice: "导出失败，编辑内容已保留，请重试",
      });
    }
  }
  async exportTermReport() {
    const project = this.state.project;
    if (!project?.glossary) return;
    try {
      const report = buildTermUsageReport(
        project.cues,
        project.glossary,
        project.name,
      );
      downloadTermReport(project.name, formatTermUsageReport(report));
      this.publish({
        notice: `术语使用情况清单已导出：${report.rows.length} 条术语`,
      });
    } catch {
      this.publish({ phase: "error", notice: "术语清单导出失败，请重试" });
    }
  }
  setFormat(format: Format) {
    const project = this.state.project;
    if (project) void this.commit({ ...project, format });
  }
}
export const createViewModel = () => new SubtitleMeterViewModel();
