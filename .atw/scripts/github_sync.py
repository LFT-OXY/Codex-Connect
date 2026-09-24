#!/usr/bin/env python3
"""任务目录 → 远程 GitHub 的单向同步。安装到 .atw/scripts/github_sync.py。

**权威始终在任务目录，远程是镜像。** 不做双向——双向要处理冲突合并，而正文是
你自己写的，远程改正文的场景基本不存在。

    create         确保任务有对应的远程 Issue，号码写进 meta.source_ref
    sync-spec      把 <task>/prd.md 整篇推到 Issue 正文
    sync-tickets   每张票建一个 sub-issue + 原生 blocked_by 依赖边，
                   票文件回填 **Issue:** #NN
    archive        关闭远程 Issue
    selfcheck      跑内置断言（不联网）

**本脚本默认不接线，也不该默认接线。** 镜像是逐仓选择：装了 ATW 不等于
这个仓库要把任务目录推到 GitHub Issues。所以 `.atw/config.yaml` 的 `hooks:`
整段出厂就是注释掉的（模板里没有任何一个默认开启的 hook），`workflow.md`
也不提它——那个文件对 tracker 是中立的。

一个仓库**是否**跑镜像，写在 `docs/agents/issue-tracker.md` 里，由
`atw-init-repo` 技能落盘。选「ATW 任务目录 + GitHub」变体的仓库，那份文档会
列出下面两条显式命令和该加的两个 hook；选「纯本地」变体的，文档里有一节
「Re-enabling the GitHub mirror」讲怎么打开。**别到别处找接线，那里没有。**

两种触发方式，不能都当 Hook：

    create / archive          真 Hook，加进 .atw/config.yaml 的 hooks: 段
    sync-spec / sync-tickets  显式调用，由跑流程的人/代理按 tracker 文档执行

原因：**Lifecycle Hook 事件全在任务生命周期转换时触发**，没有任何事件在
prd.md 或 issues/*.md 被写入时触发。所以「写完 Spec 自动同步」靠 hooks: 配置
做不到。

失败策略按调用方式分：

    Hook 场景（create/archive）    gh 缺失、没有远程仓库 → 警告后退出 0，
                                  不能因为同步失败就阻断建任务/归档
    显式场景（sync-*）            同样情况 → 退出 1，因为是你主动要求同步的

环境变量 TASK_JSON_PATH 指向 task.json：Hook 场景由 task.py 自动设置，
显式调用时自己传。
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

# 票的解析复用 tickets.py，不在这里造第二个解析器——
# 一个概念只有一个地方校验，Blocker 成环之类的检查也就只有一份实现。
sys.path.insert(0, str(Path(__file__).resolve().parent))
from tickets import (  # noqa: E402
    Ticket, TicketError, field_pattern, load_tickets,
)

RE_ISSUE = field_pattern("Issue")

# 「已经建过这条边」这类错误是幂等重跑的正常结果，不当失败
ALREADY_EXISTS = ("already", "must be unique", "duplicate")
# 没有 GitHub 远程不是故障，是「这个仓库不走镜像」。三个 cmd_* 据此优雅跳过，
# 否则 Specify / Slice 的完成条件在纯本地仓库里永远满足不了，流程直接死锁。
NO_REMOTE_HINTS = ("no git remotes found", "not a git repository")


class SyncError(Exception):
    """同步失败。Hook 场景转成警告，显式场景转成退出码 1。"""


# ---------------------------------------------------------------------------
# 纯函数（selfcheck 驱动这一层）
# ---------------------------------------------------------------------------

def dependency_order(tickets: list[Ticket]) -> list[Ticket]:
    """按依赖顺序排序：blocker 一定排在被它挡住的票前面。

    必须先建 blocker 的 Issue 才能拿到它的 database id 去建依赖边。
    load_tickets 已经保证无环、无悬空引用，所以这里不用再校验一次。
    """
    by_num = {t.num: t for t in tickets}
    ordered: list[Ticket] = []
    seen: set[int] = set()

    def visit(t: Ticket) -> None:
        if t.num in seen:
            return
        seen.add(t.num)
        for b in t.blockers:
            visit(by_num[b])
        ordered.append(t)

    for t in sorted(tickets, key=lambda x: x.num):
        visit(t)
    return ordered


def read_issue_ref(path: Path) -> str | None:
    """读票文件里的 **Issue:** #58，返回 "58"。没填返回 None。"""
    m = RE_ISSUE.search(path.read_text(encoding="utf-8"))
    if not m:
        return None
    value = m.group(1).strip().lstrip("#")
    return value or None


def write_issue_ref(path: Path, number: str) -> None:
    text = path.read_text(encoding="utf-8")
    new_text, n = RE_ISSUE.subn(f"**Issue:** #{number}", text, count=1)
    if n != 1:
        raise SyncError(f"{path.name} 没有 **Issue:** 字段，无法回填")
    path.write_text(new_text, encoding="utf-8")


# ---------------------------------------------------------------------------
# gh 交界面
# ---------------------------------------------------------------------------

def gh(*args: str, tolerate_existing: bool = False) -> str:
    proc = subprocess.run(
        ["gh", *args], capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    )
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout).strip()
        if tolerate_existing and any(k in err.lower() for k in ALREADY_EXISTS):
            return ""
        raise SyncError(f"gh {' '.join(args)} 失败：{err}")
    return proc.stdout.strip()


def require_gh() -> str:
    """确认 gh 可用且当前仓库有 GitHub 远程，返回 owner/repo。"""
    try:
        return gh("repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner")
    except FileNotFoundError:
        raise SyncError("找不到 gh 命令。装一个 GitHub CLI，或者把这个 Hook 从 config.yaml 里去掉")


def is_no_remote_error(msg: str) -> bool:
    """区分「这仓库没有远程」和「gh 真的出错了」。"""
    return any(h in msg.lower() for h in NO_REMOTE_HINTS)


def remote_repo() -> str | None:
    """有 GitHub 远程返回 owner/repo，纯本地仓库返回 None，其余照常抛错。"""
    try:
        return require_gh()
    except SyncError as e:
        if is_no_remote_error(str(e)):
            return None
        raise


def issue_db_id(repo: str, number: str) -> str:
    """依赖边要的是 database id，不是 #number 也不是 node_id。"""
    return gh("api", f"repos/{repo}/issues/{number}", "--jq", ".id")


# ---------------------------------------------------------------------------
# 任务目录
# ---------------------------------------------------------------------------

def read_task() -> tuple[dict, Path, Path]:
    raw = os.environ.get("TASK_JSON_PATH", "")
    if not raw:
        raise SyncError(
            "TASK_JSON_PATH 没设。Hook 场景由 task.py 自动设置；"
            "显式调用时自己传：TASK_JSON_PATH=<task>/task.json python3 ..."
        )
    task_json = Path(raw).resolve()
    if not task_json.is_file():
        raise SyncError(f"找不到 {task_json}")
    return json.loads(task_json.read_text(encoding="utf-8")), task_json, task_json.parent


def write_task(data: dict, path: Path) -> None:
    path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def source_ref(task: dict) -> str | None:
    meta = task.get("meta")
    ref = meta.get("source_ref") if isinstance(meta, dict) else None
    return str(ref).lstrip("#") if ref else None


# ---------------------------------------------------------------------------
# 命令
# ---------------------------------------------------------------------------

def cmd_create() -> None:
    task, task_json, task_dir = read_task()
    if source_ref(task):
        print(f"已有远程 Issue #{source_ref(task)}，不重复创建")
        return

    repo = remote_repo()
    if repo is None:
        print("本仓库没有 GitHub 远程，跳过 Issue 创建")
        return
    title = task.get("title") or task.get("id") or task_dir.name
    # 建任务时 prd.md 还是默认骨架，推上去是噪声。先占位，等 sync-spec 推正文。
    url = gh("issue", "create", "--repo", repo, "--title", str(title),
             "--body", "Spec 尚未写入。写完后由 `github_sync.py sync-spec` 同步正文。")
    number = url.rstrip("/").rsplit("/", 1)[-1]

    task.setdefault("meta", {})["source_ref"] = number
    write_task(task, task_json)
    print(f"已创建远程 Issue #{number}，并写进 meta.source_ref")


def cmd_sync_spec() -> None:
    task, _, task_dir = read_task()
    number = source_ref(task)
    if not number:
        if remote_repo() is None:
            print("本仓库没有 GitHub 远程，跳过 Spec 同步")
            return
        raise SyncError("meta.source_ref 是空的。先跑 create，或者手工填上已有的 Issue 号")

    prd = task_dir / "prd.md"
    if not prd.is_file():
        raise SyncError(f"找不到 {prd}。Specify 阶段还没写 Spec？")

    repo = require_gh()
    gh("issue", "edit", number, "--repo", repo, "--body-file", str(prd))
    print(f"prd.md → Issue #{number}")


def cmd_sync_tickets() -> None:
    task, _, task_dir = read_task()
    parent = source_ref(task)
    if not parent:
        if remote_repo() is None:
            print("本仓库没有 GitHub 远程，跳过票同步")
            return
        raise SyncError("meta.source_ref 是空的。先跑 create")

    tickets = load_tickets(task_dir / "issues")
    if not tickets:
        print("没有票（单会话任务的正常状态），跳过")
        return

    repo = require_gh()
    numbers: dict[int, str] = {}

    # 必须按依赖顺序：先建 blocker 才能拿到它的 database id 去建边
    for t in dependency_order(tickets):
        number = read_issue_ref(t.path)
        if number:
            gh("issue", "edit", number, "--repo", repo, "--body-file", str(t.path))
            print(f"{t.label} → 更新 Issue #{number}")
        else:
            url = gh("issue", "create", "--repo", repo,
                     "--title", t.label, "--body-file", str(t.path))
            number = url.rstrip("/").rsplit("/", 1)[-1]
            write_issue_ref(t.path, number)
            print(f"{t.label} → 新建 Issue #{number}，已回填 **Issue:**")
            # 挂成来源 Issue 的 sub-issue。重跑时 GitHub 会报「已存在」，忽略即可
            gh("api", "--method", "POST", f"repos/{repo}/issues/{parent}/sub_issues",
               "-F", f"sub_issue_id={issue_db_id(repo, number)}",
               tolerate_existing=True)
        numbers[t.num] = number

    # 依赖边单独一轮：这时候所有票都有号了
    for t in tickets:
        for b in t.blockers:
            gh("api", "--method", "POST",
               f"repos/{repo}/issues/{numbers[t.num]}/dependencies/blocked_by",
               "-F", f"issue_id={issue_db_id(repo, numbers[b])}",
               tolerate_existing=True)
            print(f"依赖边：#{numbers[t.num]} blocked_by #{numbers[b]}")


def cmd_archive() -> None:
    task, _, task_dir = read_task()
    number = source_ref(task)
    if not number:
        print("没有 meta.source_ref，没有远程 Issue 要关")
        return
    repo = require_gh()

    # 先关子 issue 再关父 issue。归档门禁已保证所有票 Impl: done，
    # 漏关的话镜像里会永久留下 N 个 OPEN 的票，几个任务之后 issue 列表全是噪音。
    for t in load_tickets(task_dir / "issues"):
        sub = read_issue_ref(t.path)
        if sub:
            gh("issue", "close", sub, "--repo", repo, "--comment", "任务已归档。")
            print(f"{t.label} → 已关闭 Issue #{sub}")

    gh("issue", "close", number, "--repo", repo, "--comment", "任务已归档。")
    print(f"已关闭 Issue #{number}")


# ---------------------------------------------------------------------------
# 自检：只跑不联网的那部分
# ---------------------------------------------------------------------------

TICKET_TMPL = """# {label}

**Status:** ready-for-agent
**Impl:** ready
**Blocked by:** {blocked}
**Issue:**{issue}

## What to build
略
"""


def cmd_selfcheck() -> None:
    with tempfile.TemporaryDirectory() as d:
        issues = Path(d).resolve()
        specs = [(1, "03", ""), (2, "01", " #58"), (3, "none", "")]
        for num, blocked, issue in specs:
            (issues / f"{num:02d}-t{num}.md").write_text(
                TICKET_TMPL.format(label=f"{num:02d}-t{num}", blocked=blocked,
                                   issue=issue),
                encoding="utf-8",
            )
        tickets = load_tickets(issues)

        # 03 谁都不挡 → 最先；01 被 03 挡 → 其次；02 被 01 挡 → 最后
        order = [t.num for t in dependency_order(tickets)]
        assert order == [3, 1, 2], order

        # 回填过的读得出来，没填的是 None
        by_num = {t.num: t for t in tickets}
        assert read_issue_ref(by_num[2].path) == "58"
        assert read_issue_ref(by_num[1].path) is None

        write_issue_ref(by_num[1].path, "57")
        assert read_issue_ref(by_num[1].path) == "57"
        # 回填不能动别的字段
        again = load_tickets(issues)
        assert {t.num: t.blockers for t in again} == {1: [3], 2: [1], 3: []}

        # 缺 **Issue:** 字段要报错，不能静默跳过
        (issues / "04-t4.md").write_text(
            "# 04-t4\n\n**Status:** ready-for-agent\n**Impl:** ready\n"
            "**Blocked by:** none\n", encoding="utf-8")
        try:
            write_issue_ref(issues / "04-t4.md", "60")
        except SyncError:
            pass
        else:
            raise AssertionError("缺 **Issue:** 字段本该报错")

    # 无远程仓库要能和真故障区分开，否则纯本地项目会卡死在 Specify
    assert is_no_remote_error("gh repo view 失败：no git remotes found")
    assert is_no_remote_error("fatal: not a git repository")
    assert not is_no_remote_error("gh issue create 失败：HTTP 403 权限不足")
    assert not is_no_remote_error("找不到 gh 命令")

    print("selfcheck 通过")


COMMANDS = {
    "create": cmd_create,
    "sync-spec": cmd_sync_spec,
    "sync-tickets": cmd_sync_tickets,
    "archive": cmd_archive,
    "selfcheck": cmd_selfcheck,
}
# 失败一律返回非零。run_task_hooks（task_utils.py）用 capture_output=True
# 吞掉两个流，**只在非零退出时**才把 stderr 打出来 —— 早前为了「不阻断建任务」
# 返回 0，结果是钩子失败彻底无声：远程 Issue 没建、票没同步、归档没关，
# 全都一声不吭。
#
# 而「非零会阻断」这个前提是错的：run_task_hooks 只打印 [WARN]，不抛异常，
# 调用方继续往下走。返回非零既不阻断，又换回全部可观测性。


def main(argv: list[str]) -> int:
    action = argv[1] if len(argv) > 1 else ""
    if action not in COMMANDS:
        print(f"用法：{Path(argv[0]).name} {{{' | '.join(COMMANDS)}}}", file=sys.stderr)
        return 1
    try:
        COMMANDS[action]()
        return 0
    except (SyncError, TicketError, FileNotFoundError) as e:
        print(f"错误：{e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
