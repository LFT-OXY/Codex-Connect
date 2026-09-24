#!/usr/bin/env python3

import argparse
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

PLACEHOLDER = re.compile(r"\{\{[A-Z_]+\}\}")
URI_SCHEME = re.compile(r"^[a-z][a-z0-9+.-]*:", re.IGNORECASE)

def is_local_reference(value: str) -> bool:
    value = value.strip()
    return bool(value) and not value.startswith("//") and not URI_SCHEME.match(value)

class HTMLStructureParser(HTMLParser):
    """提取文档结构、本地资源和本地导航，不限制远程能力。"""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.in_head = False
        self.in_title = False
        self.html_has_lang = False
        self.has_viewport = False
        self.title_parts: list[str] = []
        self.duplicate_attributes: list[str] = []
        self.local_assets: list[str] = []
        self.local_links: list[str] = []
        self.ids: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        attributes: dict[str, str] = {}
        for name, value in attrs:
            name = name.lower()
            if name in attributes:
                self.duplicate_attributes.append(f"{tag} 含重复属性 {name}")
                continue
            attributes[name] = value or ""

        element_id = attributes.get("id", "").strip()
        if element_id:
            self.ids.add(element_id)

        if tag == "html":
            self.html_has_lang = bool(attributes.get("lang", "").strip())
        elif tag == "head":
            self.in_head = True
        elif tag == "body":
            self.in_head = False
            self.in_title = False
        elif tag == "title" and self.in_head:
            self.in_title = True

        if (
            tag == "meta"
            and self.in_head
            and attributes.get("name", "").lower() == "viewport"
            and attributes.get("content", "").strip()
        ):
            self.has_viewport = True

        asset_attributes = {
            "script": ("src",),
            "link": ("href",),
            "img": ("src", "srcset"),
            "source": ("src", "srcset"),
            "video": ("src", "poster"),
            "audio": ("src",),
        }
        for name in asset_attributes.get(tag, ()):
            for item in attributes.get(name, "").split(","):
                candidate = item.strip().split()[0] if item.strip() else ""
                if candidate and is_local_reference(candidate) and not candidate.startswith("#"):
                    self.local_assets.append(candidate)

        if tag == "a":
            href = attributes.get("href", "").strip()
            if href and is_local_reference(href):
                self.local_links.append(href)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "head":
            self.in_head = False
        elif tag == "title":
            self.in_title = False

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.title_parts.append(data)

def parse(text: str) -> HTMLStructureParser:
    parser = HTMLStructureParser()
    parser.feed(text)
    return parser

def validate_text(text: str) -> list[str]:
    """验证必要结构；远程资源、网络 API 和页面跳转均允许。"""
    errors: list[str] = []
    parser = parse(text)

    if PLACEHOLDER.search(text):
        errors.append("仍有未替换的模板占位符")
    if parser.duplicate_attributes:
        errors.extend(parser.duplicate_attributes)
    if not parser.html_has_lang:
        errors.append("html 根元素缺少非空 lang 属性")
    if not parser.has_viewport:
        errors.append("head 中缺少 viewport 元数据")
    if not "".join(parser.title_parts).strip():
        errors.append("head 中缺少非空 title")

    return errors

def validate(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    errors = validate_text(text)
    parser = parse(text)

    for asset in parser.local_assets:
        clean = asset.split("?", 1)[0].split("#", 1)[0]
        if clean and not (path.parent / clean).resolve().is_file():
            errors.append(f"本地资源不存在：{asset}")

    for link in parser.local_links:
        target, _, fragment = link.partition("#")
        target_path = path if not target else (path.parent / target).resolve()
        if not target_path.is_file():
            errors.append(f"本地链接目标不存在：{link}")
            continue
        if fragment and target_path.suffix.lower() in {".html", ".htm"}:
            target_parser = parse(target_path.read_text(encoding="utf-8"))
            if fragment not in target_parser.ids:
                errors.append(f"本地链接锚点不存在：{link}")

    return errors

def self_test() -> None:
    """最小自检：远程资源和网络 API 可用，结构错误仍会被发现。"""
    good = """<!doctype html><html lang="zh-CN"><head>
    <meta name="viewport" content="width=device-width"><title>课程</title>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope">
    </head><body><script>fetch('/lesson'); location.replace('#done')</script></body></html>"""
    bad_cases = [
        good.replace("课程", "{{TITLE}}"),
        good.replace('<html lang="zh-CN">', "<html>"),
        good.replace('<meta name="viewport" content="width=device-width">', ""),
        good.replace("<title>课程</title>", "<title></title>"),
        good.replace("<title>课程</title>", '<title id="a" id="b">课程</title>'),
    ]

    if validate_text(good):
        raise RuntimeError("远程资源或网络 API 被错误拒绝")
    if any(not validate_text(case) for case in bad_cases):
        raise RuntimeError("占位符或文档结构检查未生效")

def main() -> int:
    parser = argparse.ArgumentParser(description="验证 Oxy Learning Hub HTML 结构与本地引用")
    parser.add_argument("files", nargs="*", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        self_test()
        print("自检通过")
        return 0
    if not args.files:
        parser.error("请提供至少一个 HTML 文件，或使用 --self-test")

    failed = False
    for path in args.files:
        if not path.is_file():
            print(f"失败 {path}: 文件不存在")
            failed = True
            continue

        errors = validate(path)
        if errors:
            failed = True
            print(f"失败 {path}:")
            for error in errors:
                print(f"  - {error}")
        else:
            print(f"通过 {path}")

    return 1 if failed else 0

if __name__ == "__main__":
    sys.exit(main())
