export type Format = "srt" | "vtt";
export interface SubtitleCue {
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}
export type IssueType =
  | "overlap"
  | "too-short"
  | "too-fast"
  | "too-long"
  | "empty"
  | "invalid-time"
  | "term-missing"
  | "term-inconsistent"
  | "term-case"
  | "term-width";
export interface SubtitleIssue {
  id: string;
  cueId: string;
  type: IssueType;
  severity: "info" | "warning" | "error";
  message: string;
}
/** 条目编辑区中命中的术语片段 */
export interface TermMark {
  cueId: string;
  termId: string;
  source: string;
  start: number;
  end: number;
  matched: string;
  kind:
    | "term-ok"
    | "term-missing"
    | "term-inconsistent"
    | "term-case"
    | "term-width";
}
export interface ProjectVersion {
  id: string;
  label: string;
  savedAt: number;
  cues: SubtitleCue[];
  glossary?: Glossary;
}
export interface SubtitleProject {
  id: string;
  name: string;
  format: Format;
  cues: SubtitleCue[];
  updatedAt: number;
  versions: ProjectVersion[];
  glossary?: Glossary;
}
export interface MeterState {
  phase: "empty" | "importing" | "ready" | "editing" | "exporting" | "error";
  project: SubtitleProject | null;
  issues: SubtitleIssue[];
  termMarks: TermMark[];
  selectedId: string | null;
  notice: string;
  zoom: number;
}
export const emptyState = (): MeterState => ({
  phase: "empty",
  project: null,
  issues: [],
  termMarks: [],
  selectedId: null,
  notice: "",
  zoom: 1,
});
export interface Glossary {
  version: 1;
  importedAt: number;
  fileName: string;
  terms: GlossaryTerm[];
}
export interface GlossaryTerm {
  id: string;
  /** 原文术语，命中检测以此为准 */
  source: string;
  /** 标准译法 */
  preferred: string;
  /** 其它允许写法（与标准译法共同构成允许列表） */
  allowed: string[];
  /** 弃用译法，出现即视为译法不一致 */
  forbidden: string[];
  /** 仅在指定条目序号范围内生效；空数组表示全项目生效 */
  ranges: Array<{ from: number; to: number }>;
  note?: string;
}
