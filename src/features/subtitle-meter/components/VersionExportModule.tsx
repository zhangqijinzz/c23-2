import type { Format, SubtitleProject } from "../models";
import type { SubtitleMeterViewModel } from "../viewmodels/subtitleMeterViewModel";
export function VersionExportModule({
  project,
  vm,
  phase,
}: {
  project: SubtitleProject;
  vm: SubtitleMeterViewModel;
  phase: string;
}) {
  return (
    <section className="module version-module">
      <div className="module-head">
        <div>
          <span className="module-kicker">04 / VERSIONS & EXPORT</span>
          <h2>版本与交付</h2>
        </div>
        <span className="saved-label">● 自动保存</span>
      </div>
      <div className="version-row">
        <div>
          <strong>本地快照</strong>
          <small>
            {project.versions.length
              ? `最近：${project.versions.at(-1)?.label}`
              : "保存当前版本以便回退"}
          </small>
          {project.glossary && (
            <small className="glossary-badge">
              快照包含术语表「{project.glossary.fileName}」
            </small>
          )}
        </div>
        <button
          className="secondary-button"
          onClick={() => void vm.saveVersion()}
        >
          ＋ 保存快照
        </button>
      </div>
      {project.versions.length > 0 && (
        <div className="version-list">
          {project.versions.map((version) => (
            <button
              key={version.id}
              onClick={() => void vm.restoreVersion(version.id)}
            >
              {version.label}
              {version.glossary && (
                <em className="version-glossary-mark">含术语表</em>
              )}
              <span>恢复 ↗</span>
            </button>
          ))}
        </div>
      )}
      {project.glossary && (
        <div className="term-report-row">
          <div>
            <strong>术语使用情况清单</strong>
            <small>交付附件 · 汇总每个术语的命中位置、漏译与写法差异</small>
          </div>
          <button
            className="secondary-button"
            onClick={() => void vm.exportTermReport()}
          >
            导出清单 <span>↓</span>
          </button>
        </div>
      )}
      <div className="export-row">
        <label>
          格式
          <select
            aria-label="导出格式"
            value={project.format}
            onChange={(e) => vm.setFormat(e.target.value as Format)}
          >
            <option value="srt">SRT</option>
            <option value="vtt">WebVTT</option>
          </select>
        </label>
        <button
          className="export-button"
          disabled={phase === "exporting"}
          onClick={() => void vm.exportFile()}
        >
          导出字幕 <span>↓</span>
        </button>
      </div>
      <p className="privacy-note">字幕文件与项目版本仅保存在当前浏览器</p>
    </section>
  );
}
