# 总结发布

根据总结模式已确认的多选结果执行本文件中的对应分支。多个选项同时选择时全部执行，
未选择的分支不执行。

## 本地输出目录

用户选择 Markdown 或 HTML 时，在当前项目根目录创建：

```text
atlas-{YYYYMMDD}-{safe-title}/
```

只选择 Outline 时不创建本地目录。

## Markdown

用户选择“生成 Markdown 文档”时写入：

```text
atlas-{YYYYMMDD}-{safe-title}/SUMMARY.md
```

如果总结将升级为教学，可以直接把该目录作为教学工作区并按需加入教学文件。
写入内容与对话中的总结一致。

## HTML

用户选择“生成 HTML 单文件”时，读取 `assets/summary-template.html`，替换全部占位符：

- `{{TITLE}}`：可读标题；
- `{{META}}`：来源、作者或抓取日期，没有则留空；
- `{{TOC}}`：根据二级和三级标题生成的目录；
- `{{CONTENT}}`：由 Markdown 转换得到的语义化 HTML。

输出为同目录的 `SUMMARY.html`。可以按视觉和交互需要使用远程字体、CSS、图片、
JavaScript 库或 Mermaid 运行时；多个页面会复用的配置优先放入共享 Assets。

生成后运行：

```bash
python3 scripts/validate_html.py atlas-.../SUMMARY.html
```

## Outline

用户选择“写入 Outline”时，使用当前宿主可用的 Outline MCP 能力：

1. 用户已指定 collection 或父文档时直接采用；
2. 未指定时列出 collections；单条直接使用，多条只询问一次；
3. Outline 的标题使用独立 title 字段；
4. 正文第一个非空行若为 H1，删除该行及紧随的空行；
5. 创建成功后返回文档 URL；
6. 发布失败不影响已经生成的 Markdown 或 HTML，并报告原始错误信息。

更新已有文档时先定位文档 ID，再更新正文，不新建重复文档。

## 完成标准

- 已执行用户多选的全部载体，且未执行未选择的分支；
- 文件名安全且路径明确；
- HTML 没有未替换占位符，页面结构完整；
- Outline 正文不以 H1 开头；
- 每个分支都报告成功路径或失败原因。
