# 04 — 界面品牌与"关于"页

**What to build:** 用户在设置页中英文界面里看到的产品名都是 Codex Connect，设置页头部和标题栏设置按钮是新图标；"关于"页展示 Codex Connect 简介、开源地址 `LFT-OXY/Codex-Connect`，并在其下显示"基于开源项目 codex-host 开发"及上游链接；Harness 安装引导和原生层直接呈现给用户的提示也使用 Codex Connect。

**Blocked by:** 02 — 安装包命名与新图标；03 — 应用内更新与反馈指向本仓库
**Status:** ready-for-agent
**Impl:** done

- [x] 本地化文案（中英文）中面向用户的 codexhost 产品名全部改为 Codex Connect
- [x] Harness 安装引导中的产品名改为 Codex Connect
- [x] "关于"页新增上游署名一行（中文"基于开源项目 codex-host 开发"及英文对应文案），链接 `https://github.com/BytePioneer-AI/codex-host`
- [x] 设置品牌图标改为新图标位图，以 data URL 内联，不引入网络或本地路径依赖；Renderer 边界约束不被破坏
- [x] Rust 原生层的用户可见文字（错误弹窗、启动失败报错）使用 Codex Connect；stderr 诊断日志前缀保留 codexhost（原生 usage 的命令名同步改为 `codex-connect`；描述内部组件的错误正文如 "codexhost Host chain" 按诊断输出保留）
- [x] CSS 类名、DOM id 等内部标识不变
- [x] renderer settings 受影响测试更新并通过，新增断言覆盖署名链接
- [x] 用 `npm start` 启动后人工确认小尺寸品牌图标可辨认；若不可辨认，改为按新图标形状绘制的简化矢量版（已确认 24px 标题栏按钮与 32px 设置页头部可辨认，保留位图）
