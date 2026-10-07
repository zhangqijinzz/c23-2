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
  | "glossary-missing"
  | "glossary-inconsistent"
  | "glossary-case"
  | "glossary-width";
export interface SubtitleIssue {
  id: string;
  cueId: string;
  type: IssueType;
  severity: "info" | "warning" | "error";
  message: string;
  /** 术语类问题所属词条，用于检查列表标注「术语」 */
  termId?: string;
  /** 命中文本在条目内的区间，用于编辑区高亮 */
  span?: { start: number; end: number };
}
/** 术语表条目：源术语与其在字幕中允许出现的多个写法 */
export interface GlossaryTerm {
  id: string;
  /** 源语言术语或规范词条，用于定位与提示 */
  source: string;
  /** 允许写法，可包含源术语本身（品牌名保留原文的场景） */
  allowed: string[];
  /** 首选写法，缺省取 allowed[0] */
  preferred?: string;
  /** 限定生效场景，缺省为全片生效 */
  scope?: GlossaryScope;
  note?: string;
}
/** 生效范围：所有提供的条件之间为「与」关系 */
export interface GlossaryScope {
  /** 仅这些条目序号（cue.index）生效 */
  cueIndexes?: number[];
  /** 时间场景起点（毫秒） */
  startMs?: number;
  /** 时间场景终点（毫秒） */
  endMs?: number;
  /** 条目文本包含该关键词（如说话人、场景标记）时生效 */
  keyword?: string;
}
export interface Glossary {
  version: 1;
  terms: GlossaryTerm[];
  importedAt: number;
}
/** 编辑区高亮用的术语命中信息 */
export interface GlossaryHit {
  id: string;
  termId: string;
  cueId: string;
  start: number;
  end: number;
  /** 字幕中的实际文本 */
  actual: string;
  /** 命中的规范写法 */
  expected: string;
  kind: "preferred" | "ok" | "variant" | "case" | "width" | "missing";
}
export interface SubtitleProject {
  id: string;
  name: string;
  format: Format;
  cues: SubtitleCue[];
  /** 术语表随项目一起保存在本地；缺省表示该项目没有术语表 */
  glossary?: Glossary | null;
  updatedAt: number;
  versions: Array<{
    id: string;
    label: string;
    savedAt: number;
    cues: SubtitleCue[];
    /** 快照同时保存术语表，回退时一起恢复 */
    glossary?: Glossary | null;
  }>;
}
export interface MeterState {
  phase: "empty" | "importing" | "ready" | "editing" | "exporting" | "error";
  project: SubtitleProject | null;
  issues: SubtitleIssue[];
  /** 当前项目的术语命中区间，随检查结果一起重算 */
  glossaryHits: GlossaryHit[];
  selectedId: string | null;
  notice: string;
  zoom: number;
}
export const emptyState = (): MeterState => ({
  phase: "empty",
  project: null,
  issues: [],
  glossaryHits: [],
  selectedId: null,
  notice: "",
  zoom: 1,
});
