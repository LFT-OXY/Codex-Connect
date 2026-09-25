# 01 — 用量页首条链路：Claude Code

**What to build:** 用户在设置中打开新的「用量」标签页（对话框放大到接近整个窗口），切换日/周/月/总计/自定义，看到本机 Claude Code 原生记录统计出的 Token 总数、范围起止、Harness 占比条与卡片、每日明细表（日期、总计、输入、输出、缓存、推理、对话数）；有刷新按钮；再次打开只读取新增记录。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** ready

## Acceptance criteria

- [ ] 公共 Adapter 契约新增可选的原生用量读取能力：输入不透明游标，输出不含正文的用量记录与新游标
- [ ] Claude Code Adapter 实现该能力：含子代理文件、按消息去重、按文件增量读取、对话数按主会话带文本的用户消息计
- [ ] Host 用量服务：去重、UTC 半小时桶聚合、游标与桶持久化在 codexhost 数据目录；并发请求共享同一次读取
- [ ] shared-contracts 定义用量查询方法与 schema；Host 路由与 Renderer 客户端遵循 host-rpc 规范；始终使用本地 Host
- [ ] Renderer 按本机时区请求；周从周一开始、「总计」= 最近 24 个月、自定义起止生效
- [ ] 设置外壳支持页面声明放大尺寸，「用量」页使用该尺寸
- [ ] Token 总数 = 输入 + 缓存读 + 缓存写 + 输出 + 推理（不重复计）；大数以 K/M/B 显示
- [ ] 主切入点测试：临时目录伪造 Claude Code 记录，经 Host 请求层断言总数、周期边界、时区归日、增量与去重
- [ ] Claude Code 解析有 Adapter 级测试；页面有假 DOM 渲染测试
- [ ] 新增产品文档描述用量页当前行为并登记到 docs/index.md
