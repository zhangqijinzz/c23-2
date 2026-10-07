import type { Format, SubtitleCue } from "../models";
import { formatSubtitles } from "../formatters/subtitleFormatter";

function download(name: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadSubtitles(
  name: string,
  cues: SubtitleCue[],
  format: Format,
): void {
  const content = formatSubtitles(cues, format);
  download(
    `${name.replace(/\.(srt|vtt)$/i, "")}-checked.${format}`,
    content,
    format === "vtt" ? "text/vtt;charset=utf-8" : "text/plain;charset=utf-8",
  );
}

export function downloadTermReport(name: string, markdown: string): void {
  download(
    `${name.replace(/\.(srt|vtt)$/i, "")}-term-report.md`,
    markdown,
    "text/markdown;charset=utf-8",
  );
}
