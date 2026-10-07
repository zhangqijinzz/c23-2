import type { GlossaryScope, GlossaryTerm } from "../models";

/** 毫秒 → mm:ss（或 h:mm:ss），undefined 表示该侧开放 */
export function formatScopeStamp(ms: number | undefined): string {
  if (ms === undefined) return "…";
  const total = Math.max(0, Math.round(ms / 1000));
  const s = total % 60,
    m = Math.floor(total / 60) % 60,
    h = Math.floor(total / 3600);
  const pad = (value: number) => String(value).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** 场景限定的可读说明，用于提示文案；返回 "" 表示全片生效 */
export function describeScope(scope: GlossaryScope | undefined): string {
  if (!scope) return "";
  const parts: string[] = [];
  if (scope.cueIndexes) parts.push(`条目 ${scope.cueIndexes.join(",")}`);
  if (scope.startMs !== undefined || scope.endMs !== undefined)
    parts.push(
      `${formatScopeStamp(scope.startMs)}-${formatScopeStamp(scope.endMs)}`,
    );
  if (scope.keyword) parts.push(`含「${scope.keyword}」`);
  return parts.join(" · ");
}

/** 检查列表提示用：带括号 */
export function scopeNote(term: GlossaryTerm): string {
  const text = describeScope(term.scope);
  return text ? `（${text}）` : "";
}

/** 清单用：分号连接，缺省为「全片」 */
export function scopeLabel(term: GlossaryTerm): string {
  return describeScope(term.scope) || "全片";
}
