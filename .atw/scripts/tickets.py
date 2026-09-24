#!/usr/bin/env python3
"""票解析器 —— 安装到 .atw/scripts/tickets.py。

    list                 列出所有票 + Impl 状态
    frontier             算出「Impl: ready + Blocked by 全部 done」的票
    claim <NN>           校验在 frontier 里 → Impl: doing
                         → 记 implementation_base_sha
                         → 把该票路径写进 <task>/check.jsonl
    done <NN>            标记 Impl: done，并撤掉 check.jsonl 里的那行
    summary              汇总一行，给 workflow-state 用
    selfcheck            跑内置断言，不依赖仓库状态

硬校验（直接拒绝，不是警告）：
    Blocker 引用不存在        → 失败
    Blocker 形成环            → 失败
    claim 不在 frontier 里的票 → 失败
    已有别的票在 doing        → 失败（票默认串行）

不要把这些函数塞进 task_utils.py / task.py：票是任务目录里的一层，任务目录和
meta 的读写一律走 task.py，本脚本不直接写 task.json。
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from common.paths import DIR_SCRIPTS, DIR_WORKFLOW, get_repo_root

IMPL_STATES = ("ready", "doing", "done")

# 票文件名形如 01-slug.md，编号即前缀
RE_TICKET_FILE = re.compile(r"^(\d+)-.+\.md$")
# Blocked by 里允许 "01"、"#01"、"1" 三种写法
RE_BLOCKER = re.compile(r"#?(\d+)")

# 当前票写进 check.jsonl —— 审查轴拿它当规格来对，实现轴也读得到。
# 我们只动带这个 reason 的行，用户手工加的条目原样保留。
MANAGED_REASON = "ATW current ticket"
MANIFEST_NAME = "check.jsonl"


def field_pattern(name: str) -> re.Pattern[str]:
    """匹配 `**Impl:** doing` 这类字段行。"""
    return re.compile(rf"^\*\*{re.escape(name)}:\*\*[ \t]*(.*)$", re.MULTILINE)


RE_IMPL = field_pattern("Impl")
RE_BLOCKED_BY = field_pattern("Blocked by")


@dataclass
class Ticket:
    num: int
    path: Path
    impl: str
    blockers: list[int] = field(default_factory=list)

    @property
    def label(self) -> str:
        return self.path.stem


class TicketError(Exception):
    """所有硬校验失败都走这里，main 统一转成退出码 1。"""


# ---------------------------------------------------------------------------
# 解析（纯函数，selfcheck 直接驱动这一层）
# ---------------------------------------------------------------------------

def parse_ticket(path: Path) -> Ticket:
    m = RE_TICKET_FILE.match(path.name)
    if not m:
        raise TicketError(f"票文件名不是 NN-slug.md 形式：{path.name}")
    text = path.read_text(encoding="utf-8")

    impl_match = RE_IMPL.search(text)
    if impl_match is None:
        raise TicketError(
            f"{path.name} 缺少 **Impl:** 字段。"
            " 这个字段由票模板写入，缺了说明票不是按模板生成的。"
        )
    impl = impl_match.group(1).strip().lower()
    if impl not in IMPL_STATES:
        raise TicketError(
            f"{path.name} 的 **Impl:** 是 {impl!r}，只允许 {'/'.join(IMPL_STATES)}"
        )

    blocked_match = RE_BLOCKED_BY.search(text)
    raw = blocked_match.group(1).strip() if blocked_match else ""
    blockers = [] if raw.lower() in ("", "none", "-", "无") else [
        int(x) for x in RE_BLOCKER.findall(raw)
    ]
    return Ticket(num=int(m.group(1)), path=path, impl=impl, blockers=blockers)


def load_tickets(issues_dir: Path) -> list[Ticket]:
    if not issues_dir.is_dir():
        return []
    tickets = [parse_ticket(p) for p in sorted(issues_dir.glob("*.md"))]
    seen: dict[int, Path] = {}
    for t in tickets:
        if t.num in seen:
            raise TicketError(f"票号 {t.num:02d} 重复：{seen[t.num].name} 和 {t.path.name}")
        seen[t.num] = t.path
    validate(tickets)
    return tickets


def validate(tickets: list[Ticket]) -> None:
    by_num = {t.num: t for t in tickets}
    for t in tickets:
        for b in t.blockers:
            if b not in by_num:
                raise TicketError(f"{t.label} 的 Blocked by 指向不存在的票 {b:02d}")

    # 环检测：白=未访问 / 灰=在当前递归栈上 / 黑=已确认无环
    color: dict[int, str] = {t.num: "white" for t in tickets}
    stack: list[int] = []

    def walk(num: int) -> None:
        color[num] = "grey"
        stack.append(num)
        for nxt in by_num[num].blockers:
            if color[nxt] == "grey":
                cycle = stack[stack.index(nxt):] + [nxt]
                raise TicketError(
                    "Blocker 形成环：" + " → ".join(f"{n:02d}" for n in cycle)
                )
            if color[nxt] == "white":
                walk(nxt)
        stack.pop()
        color[num] = "black"

    for t in tickets:
        if color[t.num] == "white":
            walk(t.num)


def frontier(tickets: list[Ticket]) -> list[Ticket]:
    by_num = {t.num: t for t in tickets}
    return [
        t for t in tickets
        if t.impl == "ready" and all(by_num[b].impl == "done" for b in t.blockers)
    ]


def set_impl(ticket: Ticket, state: str) -> None:
    text = ticket.path.read_text(encoding="utf-8")
    new_text, n = RE_IMPL.subn(f"**Impl:** {state}", text, count=1)
    if n != 1:
        raise TicketError(f"{ticket.label} 的 **Impl:** 字段写回失败")
    ticket.path.write_text(new_text, encoding="utf-8")
    ticket.impl = state


# ---------------------------------------------------------------------------
# task.py 交界面
# ---------------------------------------------------------------------------

def repo_root() -> Path:
    """仓库根一律走 paths.get_repo_root（认 .atw/），不问 git。

    票在任务目录里，任务目录在 .atw/ 下——用 `git rev-parse` 会把一个还没
    `git init` 的项目判成「不是仓库」，票循环跟着一起停摆。
    """
    return get_repo_root().resolve()


def run(cmd: list[str], err: str, cwd: Path | None = None) -> str:
    proc = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd)
    if proc.returncode != 0:
        raise TicketError(f"{err}：{proc.stderr.strip() or proc.stdout.strip()}")
    return proc.stdout.strip()


def task_py(root: Path) -> str:
    return str(root / DIR_WORKFLOW / DIR_SCRIPTS / "task.py")


def task_dir(root: Path, override: str | None) -> Path:
    """任务目录一律问 task.py，不自己解析 Session Pointer。"""
    if override:
        return (root / override).resolve()
    out = run(
        [sys.executable, task_py(root), "current", "--json"],
        "没有 Active Task —— 先 task.py start，不要退回 .scratch/",
        cwd=root,
    )
    rel = (json.loads(out).get("current_task") or {}).get("dir")
    if not rel:
        raise TicketError("没有 Active Task")
    return (root / rel).resolve()


def set_meta(root: Path, task: Path, key: str, value: str) -> None:
    run(
        [
            sys.executable, task_py(root), "set-meta",
            str(task.relative_to(root)), key, value,
        ],
        f"写 meta.{key} 失败",
        cwd=root,
    )


def record_base_sha(root: Path, task: Path) -> None:
    """记下 claim 时刻的 HEAD —— code-review 拿它当 diff 基线。

    仓库还没有 commit（新项目的第一张票）时 `git rev-parse HEAD` 必然失败。
    那种情况下基线就是「空仓库」，本来也没有 diff 可对，所以警告一声继续，
    不能让第一张票 claim 不动。
    """
    proc = subprocess.run(
        ["git", "rev-parse", "HEAD"], capture_output=True, text=True, cwd=root
    )
    if proc.returncode != 0:
        print(
            "警告：取不到 HEAD（仓库还没有 commit？），"
            "implementation_base_sha 未记录，code-review 需自行指定基线",
            file=sys.stderr,
        )
        return
    set_meta(root, task, "implementation_base_sha", proc.stdout.strip())


def rewrite_manifest(root: Path, task: Path, ticket: Ticket | None) -> None:
    """把当前票写进 check.jsonl —— 子代理拿到票的唯一通路。

    task.py 只有 add-context，没有删除命令，所以切票必须自己重写：先滤掉我们
    上一次写的那行（靠 MANAGED_REASON 认领），再按需追加新的。
    """
    manifest = task / MANIFEST_NAME
    lines: list[str] = []
    if manifest.exists():
        for line in manifest.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                if json.loads(line).get("reason") == MANAGED_REASON:
                    continue
            except json.JSONDecodeError:
                raise TicketError(f"{MANIFEST_NAME} 有非法 JSON 行：{line[:60]}")
            lines.append(line)
    if ticket is not None:
        rel = ticket.path.resolve().relative_to(root).as_posix()
        lines.append(json.dumps(
            {"file": rel, "reason": MANAGED_REASON}, ensure_ascii=False
        ))
    manifest.write_text("".join(f"{l}\n" for l in lines), encoding="utf-8")


# ---------------------------------------------------------------------------
# 命令
# ---------------------------------------------------------------------------

def pick(tickets: list[Ticket], num: str) -> Ticket:
    for t in tickets:
        if t.num == int(num):
            return t
    raise TicketError(f"没有编号为 {num} 的票")


def cmd_list(tickets: list[Ticket], **_) -> int:
    if not tickets:
        print("(没有票)")
        return 0
    open_nums = {t.num for t in frontier(tickets)}
    for t in tickets:
        mark = " ←frontier" if t.num in open_nums else ""
        blockers = ", ".join(f"{b:02d}" for b in t.blockers) or "-"
        print(f"{t.num:02d}  {t.impl:<5}  blocked-by: {blockers:<12} {t.label}{mark}")
    return 0


def cmd_frontier(tickets: list[Ticket], **_) -> int:
    ready = frontier(tickets)
    if not ready:
        print("(frontier 为空)")
        return 0
    for t in ready:
        print(f"{t.num:02d}  {t.label}")
    return 0


def cmd_claim(tickets: list[Ticket], root: Path, task: Path, num: str, **_) -> int:
    target = pick(tickets, num)
    if target.impl == "doing":
        print(f"{target.label} 已经在 doing，无需重复 claim")
        return 0
    # 票默认串行：同一任务一次只推进一张
    busy = [t for t in tickets if t.impl == "doing"]
    if busy:
        raise TicketError(
            f"{busy[0].label} 还在 doing。票默认串行，先 done 它再 claim 下一张"
        )
    if target not in frontier(tickets):
        blocked = [f"{b:02d}" for b in target.blockers
                   if pick(tickets, str(b)).impl != "done"]
        reason = f"未完成的 Blocker：{', '.join(blocked)}" if blocked \
            else f"Impl 是 {target.impl}，不是 ready"
        raise TicketError(f"{target.label} 不在 frontier 里（{reason}）")

    set_impl(target, "doing")
    record_base_sha(root, task)
    rewrite_manifest(root, task, target)
    print(f"claimed {target.label} → Impl: doing")
    return 0


def cmd_done(tickets: list[Ticket], root: Path, task: Path, num: str, **_) -> int:
    target = pick(tickets, num)
    if target.impl == "done":
        print(f"{target.label} 已经是 done")
        return 0
    # ready 直接跳 done 会绕过 claim，implementation_base_sha 停在上一张票，
    # 之后的 code-review 会拿错基线去 diff —— 状态看着对，审的范围是错的。
    if target.impl != "doing":
        raise TicketError(
            f"{target.label} 的 Impl 是 {target.impl}，不是 doing。"
            f"先 claim {num} 再 done —— 跳过 claim 会让 implementation_base_sha "
            "停在上一张票，code-review 的 diff 基线就错了"
        )
    set_impl(target, "done")
    rewrite_manifest(root, task, None)
    left = frontier(tickets)
    if not left and all(t.impl == "done" for t in tickets):
        # 实测过一次：三张票全 done，但没人推挡位，归档门禁卡住且没人知道为什么
        print(f"{target.label} → Impl: done。全部票已完成 —— "
              f"下一步 `task.py set-status {task} accept`")
        return 0
    nxt = "、".join(f"{t.num:02d}" for t in left) or "无（全部完成或被阻塞）"
    print(f"{target.label} → Impl: done。下一批可开工：{nxt}")
    return 0


def cmd_summary(tickets: list[Ticket], **_) -> int:
    if not tickets:
        print("票 0 张")
        return 0
    doing = [t for t in tickets if t.impl == "doing"]
    done = [t for t in tickets if t.impl == "done"]
    parts = [f"票 {len(tickets)} 张", f"done {len(done)}"]
    parts.append(f"doing {doing[0].label}" if doing else "doing -")
    parts.append("frontier " + ("、".join(f"{t.num:02d}" for t in frontier(tickets)) or "-"))
    print(" | ".join(parts))
    return 0


# ---------------------------------------------------------------------------
# 自检：只驱动纯函数，不需要仓库、Active Task 或 git
# ---------------------------------------------------------------------------

TICKET_TMPL = """# {num:02d} — {slug}

**Status:** ready-for-agent
**Impl:** {impl}
**Blocked by:** {blocked}
**Issue:**

## What to build
略
"""


def cmd_selfcheck(**_) -> int:
    def build(tmp: Path, specs) -> list[Ticket]:
        for n, impl, blocked in specs:
            (tmp / f"{n:02d}-t{n}.md").write_text(
                TICKET_TMPL.format(num=n, slug=f"t{n}", impl=impl, blocked=blocked),
                encoding="utf-8",
            )
        return load_tickets(tmp)

    def fails(fn, needle: str) -> None:
        try:
            fn()
        except TicketError as e:
            assert needle in str(e), f"错误信息不含 {needle!r}：{e}"
            return
        raise AssertionError(f"本该失败却通过了（期望 {needle!r}）")

    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)

        # 01 无阻塞、02 被 01 挡、03 的阻塞已 done
        ts = build(tmp, [(1, "ready", "none"), (2, "ready", "01"), (3, "ready", "04"),
                         (4, "done", "none")])
        assert [t.num for t in frontier(ts)] == [1, 3], [t.num for t in frontier(ts)]

        # 01 做完后 02 进入 frontier
        set_impl(ts[0], "done")
        assert [t.num for t in frontier(load_tickets(tmp))] == [2, 3]

        # doing 的票不算 frontier —— 否则会被重复认领
        set_impl(ts[1], "doing")
        assert [t.num for t in frontier(load_tickets(tmp))] == [3]

    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        # ready 直接 done 必须被拒 —— 绕过 claim 就没写 implementation_base_sha
        ts = build(tmp, [(1, "ready", "none"), (2, "doing", "none")])
        fails(lambda: cmd_done(ts, tmp, tmp, "01"), "不是 doing")
        assert load_tickets(tmp)[0].impl == "ready", "被拒之后不该改动票"
        # doing 的票正常收掉
        assert cmd_done(ts, tmp, tmp, "02") == 0
        assert load_tickets(tmp)[1].impl == "done"
        # 重复 done 幂等，不报错
        assert cmd_done(load_tickets(tmp), tmp, tmp, "02") == 0

    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        fails(lambda: build(tmp, [(1, "ready", "09")]), "不存在的票")

    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        fails(lambda: build(tmp, [(1, "ready", "02"), (2, "ready", "01")]), "形成环")

    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        fails(lambda: build(tmp, [(1, "ready", "01")]), "形成环")  # 自环

    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        fails(lambda: build(tmp, [(1, "claimed", "none")]), "只允许")

    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        (tmp / "01-t1.md").write_text("# 01\n\n**Status:** ready-for-agent\n",
                                      encoding="utf-8")
        fails(lambda: load_tickets(tmp), "缺少 **Impl:** 字段")

    # check.jsonl：只换自己写的行，用户手工加的条目原样保留
    with tempfile.TemporaryDirectory() as d:
        root = Path(d).resolve()  # macOS 的 /var 是 /private/var 的软链，两边都要 resolve
        task = root / DIR_WORKFLOW / "tasks/demo"
        issues = task / "issues"
        issues.mkdir(parents=True)
        ts = build(issues, [(1, "ready", "none"), (2, "ready", "none")])
        manifest = task / MANIFEST_NAME
        manifest.write_text(
            json.dumps({"file": "docs/adr/0001.md", "reason": "手工加的"}) + "\n",
            encoding="utf-8",
        )
        rewrite_manifest(root, task, ts[0])
        rewrite_manifest(root, task, ts[1])  # 切票
        rows = [json.loads(l) for l in manifest.read_text(encoding="utf-8").splitlines()]
        assert len(rows) == 2, rows
        assert rows[0]["reason"] == "手工加的"
        assert rows[1]["file"].endswith("02-t2.md"), rows[1]
        rewrite_manifest(root, task, None)  # done 之后撤掉
        rows = [json.loads(l) for l in manifest.read_text(encoding="utf-8").splitlines()]
        assert len(rows) == 1 and rows[0]["reason"] == "手工加的", rows

    print("selfcheck 通过")
    return 0


COMMANDS = {
    "list": cmd_list, "frontier": cmd_frontier, "claim": cmd_claim,
    "done": cmd_done, "summary": cmd_summary, "selfcheck": cmd_selfcheck,
}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="ATW 票解析器")
    p.add_argument("command", choices=sorted(COMMANDS))
    p.add_argument("num", nargs="?", help="票号，claim / done 用")
    p.add_argument("--task-dir", help="仓库相对的任务目录，缺省问 task.py current")
    args = p.parse_args(argv)

    try:
        if args.command == "selfcheck":
            return cmd_selfcheck()
        if args.command in ("claim", "done") and not args.num:
            raise TicketError(f"{args.command} 需要票号")
        root = repo_root()
        task = task_dir(root, args.task_dir)
        tickets = load_tickets(task / "issues")
        return COMMANDS[args.command](
            tickets=tickets, root=root, task=task, num=args.num
        )
    except TicketError as e:
        print(f"错误：{e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
