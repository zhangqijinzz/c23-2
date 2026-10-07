import { detectIssues } from "../analyzers/issueDetector";
import { formatSubtitles } from "../formatters/subtitleFormatter";
import { checkGlossary } from "../glossary/glossaryChecker";
import { parseGlossary } from "../glossary/glossaryParser";
import { formatTermUsageReport } from "../glossary/termUsageReport";
import {
  emptyState,
  type Format,
  type Glossary,
  type GlossaryHit,
  type MeterState,
  type SubtitleCue,
  type SubtitleIssue,
  type SubtitleProject,
} from "../models";
import { detectFormat, parseSubtitles } from "../parsers/subtitleParser";
import { projectRepository } from "../repositories/projectRepository";
import { downloadReport, downloadSubtitles } from "../services/exportService";
import { readTextFile } from "../services/fileService";
export class SubtitleMeterViewModel {
  state: MeterState = emptyState();
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.state;
  /** 汇总时间轴基础检查与术语表检查；没有术语表时结果与旧版完全一致 */
  private inspect(project: SubtitleProject): {
    issues: SubtitleIssue[];
    glossaryHits: GlossaryHit[];
  } {
    const base = detectIssues(project.cues);
    if (!project.glossary || project.glossary.terms.length === 0)
      return { issues: base, glossaryHits: [] };
    const { issues: glossaryIssues, hits } = checkGlossary(
      project.cues,
      project.glossary,
    );
    // 按条目时间统一排序，使术语提醒与时间轴提醒交错时仍按播放顺序排列
    const startById = new Map(
      project.cues.map((cue) => [cue.id, cue.startMs] as const),
    );
    const issues = [...base, ...glossaryIssues].sort(
      (a, b) => (startById.get(a.cueId) ?? 0) - (startById.get(b.cueId) ?? 0),
    );
    return { issues, glossaryHits: hits };
  }
  private publish(patch: Partial<MeterState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private async commit(
    project: SubtitleProject,
    phase: MeterState["phase"] = "editing",
  ) {
    project.updatedAt = Date.now();
    const { issues, glossaryHits } = this.inspect(project);
    this.publish({ project, issues, glossaryHits, phase, notice: "" });
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
        const { issues, glossaryHits } = this.inspect(project);
        this.publish({
          project,
          issues,
          glossaryHits,
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
        // 导入新字幕即开始新项目，不沿用上一份术语表
        glossary: null,
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
  /** 导入术语表并作为项目一部分保存，返回逐行告警（致命错误抛出异常） */
  async importGlossary(file: File): Promise<string[]> {
    const project = this.state.project;
    if (!project) throw new Error("请先导入字幕，再添加术语表");
    const raw = await readTextFile(file);
    const { glossary, warnings } = parseGlossary(raw);
    if (!glossary.terms.length) throw new Error("术语表中没有可用条目");
    await this.commit({ ...project, glossary });
    this.publish({
      notice: `已导入 ${glossary.terms.length} 条术语${warnings.length ? `，${warnings.length} 行告警` : ""}`,
    });
    return warnings;
  }
  async removeGlossary() {
    const project = this.state.project;
    if (!project?.glossary) return;
    await this.commit({ ...project, glossary: null });
    this.publish({ notice: "已移除术语表" });
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
        glossary: project.glossary ? structuredClone(project.glossary) : null,
      },
    ];
    await this.commit({ ...project, versions });
    this.publish({ notice: "已保存版本快照" });
  }
  async restoreVersion(id: string) {
    const project = this.state.project,
      version = project?.versions.find((item) => item.id === id);
    if (!project || !version) return;
    // 快照连同术语表一起回退
    const glossary: Glossary | null =
      version.glossary === undefined ? null : structuredClone(version.glossary);
    await this.commit({
      ...project,
      cues: structuredClone(version.cues),
      glossary,
    });
    this.publish({ notice: `已恢复${version.label}` });
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
  /** 交付时附带术语使用情况清单（CSV） */
  exportGlossaryReport() {
    const project = this.state.project;
    if (!project?.glossary) return;
    try {
      const content = formatTermUsageReport(project.cues, project.glossary);
      downloadReport(project.name, content);
      this.publish({ notice: "术语使用情况清单已导出" });
    } catch {
      this.publish({
        phase: "error",
        notice: "清单生成失败，编辑内容已保留，请重试",
      });
    }
  }
  setFormat(format: Format) {
    const project = this.state.project;
    if (project) void this.commit({ ...project, format });
  }
}
export const createViewModel = () => new SubtitleMeterViewModel();
