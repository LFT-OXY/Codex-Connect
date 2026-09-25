# 05 — 接入 Pi 用量与 Provider 展开

**What to build:** 本机 Pi 原生会话记录的用量进入统计；Pi 卡片可展开查看各 Provider 占比。

**Blocked by:** 01
**Status:** ready-for-agent
**Impl:** ready

## Acceptance criteria

- [ ] Pi Adapter 实现原生用量读取：遵循 PI_CODING_AGENT_DIR；读取 assistant 消息的 input/output/cacheRead/cacheWrite/reasoning；Provider 取自消息；按 entry id 去重；未写完的文件尾不读
- [ ] 对话数按每条 assistant 消息计
- [ ] Harness 卡片支持展开到 Provider 子项，占比极小时显示「<0.01%」
- [ ] Adapter 与 Host 请求层测试覆盖 Provider 子项
- [ ] 产品文档同步更新
