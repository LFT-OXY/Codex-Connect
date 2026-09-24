/* ─────────────────────────────────────────────────────────────
   Oxy Learning Hub · 课程共享脚本
   由 lesson-template.html 通过 {{ASSET_PREFIX}}course.js 引入。
   依赖的约定（模板与课程正文需保持一致）：
     #theme-toggle / #theme-label   主题切换按钮
     #lesson-status / #complete-lesson   完成状态
     #progress-line / #read-fill / #read-label   阅读进度
     #toc-list                      目录容器（条目按正文小节自动生成）
     main section[id] > h2          目录来源
     [data-quiz] .quiz-option       互动选择题
     .copy-response[data-target]    开放题复制
   ───────────────────────────────────────────────────────────── */
(() => {
	const root = document.documentElement;

	/* ── 主题切换 ────────────────────────────────────────
	   首帧的主题由模板 <head> 中的内联脚本决定，避免闪色；
	   这里只负责按钮状态与后续切换。 */
	const toggle = document.querySelector("#theme-toggle");
	const themeLabel = document.querySelector("#theme-label");

	const renderTheme = () => {
		if (!toggle) return;
		const toDark = root.dataset.theme !== "dark"; // 点击后要切到的目标
		if (themeLabel) themeLabel.textContent = toDark ? "深色" : "浅色";
		toggle.setAttribute(
			"aria-label",
			toDark ? "切换到深色主题" : "切换到浅色主题",
		);
	};

	if (toggle) {
		toggle.addEventListener("click", () => {
			root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
			localStorage.setItem("oxy-theme", root.dataset.theme);
			renderTheme();
		});
		window
			.matchMedia("(prefers-color-scheme: dark)")
			.addEventListener("change", (e) => {
				if (localStorage.getItem("oxy-theme")) return; // 手动选过就不再跟随系统
				root.dataset.theme = e.matches ? "dark" : "light";
				renderTheme();
			});
		renderTheme();
	}

	/* ── 完成状态 ──────────────────────────────────────── */
	const key = `oxy-learning:${location.pathname}:${document.title}`;
	const status = document.querySelector("#lesson-status");
	const complete = document.querySelector("#complete-lesson");

	const renderCompletion = () => {
		if (!status || !complete) return;
		const done = localStorage.getItem(key) === "complete";
		const dot = status.querySelector(".dot") ?? document.createElement("span");
		dot.className = "dot";
		status.replaceChildren(dot, done ? "已完成，等待你的回答" : "尚未标记完成");
		status.classList.toggle("is-done", done);
		complete.textContent = done ? "取消完成标记" : "标记本课已完成";
	};

	if (complete) {
		complete.addEventListener("click", () => {
			if (localStorage.getItem(key) === "complete")
				localStorage.removeItem(key);
			else localStorage.setItem(key, "complete");
			renderCompletion();
		});
		renderCompletion();
	}

	/* ── 目录：按正文小节自动生成，课程不必手写一份 ──── */
	const tocList = document.querySelector("#toc-list");
	const sections = [...document.querySelectorAll("main section[id]")];

	if (tocList) {
		sections.forEach((section) => {
			const heading = section.querySelector("h2");
			if (!heading) return;
			const num = heading.querySelector(".n")?.textContent.trim() ?? "";
			const text = [...heading.childNodes]
				.filter(
					(node) => !(node.nodeType === 1 && node.classList.contains("n")),
				)
				.map((node) => node.textContent)
				.join("")
				.trim();

			const link = document.createElement("a");
			link.href = `#${section.id}`;
			link.textContent = num ? `${num}　${text}` : text;

			const item = document.createElement("li");
			item.append(link);
			tocList.append(item);
		});
	}

	const tocLinks = [...document.querySelectorAll("#toc-list a")];
	if (tocLinks.length) {
		const observer = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					if (!entry.isIntersecting) return;
					tocLinks.forEach((link) =>
						link.classList.toggle(
							"is-active",
							link.getAttribute("href") === `#${entry.target.id}`,
						),
					);
				});
			},
			{ rootMargin: "-88px 0px -70% 0px" },
		);
		sections.forEach((section) => observer.observe(section));
	}

	/* ── 阅读进度 ──────────────────────────────────────── */
	const line = document.querySelector("#progress-line");
	const fill = document.querySelector("#read-fill");
	const readLabel = document.querySelector("#read-label");

	const renderProgress = () => {
		const scrollable =
			document.documentElement.scrollHeight - window.innerHeight;
		const pct =
			scrollable > 0
				? Math.min(100, Math.round((window.scrollY / scrollable) * 100))
				: 0;
		if (line) line.style.width = `${pct}%`;
		if (fill) fill.style.width = `${pct}%`;
		if (readLabel) readLabel.textContent = `已读 ${pct}%`;
	};
	window.addEventListener("scroll", renderProgress, { passive: true });
	renderProgress();

	/* ── 互动选择题 ────────────────────────────────────── */
	document.querySelectorAll("[data-quiz]").forEach((quiz) => {
		const feedback = quiz.querySelector(".quiz-feedback");
		quiz.querySelectorAll(".quiz-option").forEach((option) => {
			option.addEventListener("click", () => {
				const correct = option.dataset.correct === "true";
				option.classList.toggle("is-correct", correct);
				option.classList.toggle("is-wrong", !correct);
				if (feedback) {
					feedback.className = `quiz-feedback ${correct ? "ok" : "no"}`;
					feedback.textContent = `${correct ? "回答正确。" : "再想一想。"} ${option.dataset.explanation || ""}`;
				}
				if (correct) {
					quiz.querySelectorAll(".quiz-option").forEach((item) => {
						item.disabled = true;
					});
				}
			});
		});
	});

	/* ── 开放题复制 ────────────────────────────────────── */
	document.querySelectorAll(".copy-response").forEach((button) => {
		const reset = () => {
			button.textContent = "复制我的回答";
		};
		button.addEventListener("click", async () => {
			const field = document.querySelector(
				`#${CSS.escape(button.dataset.target)}`,
			);
			if (!field) return;
			if (!field.value.trim()) {
				button.textContent = "还没写内容";
				setTimeout(reset, 1600);
				return;
			}
			try {
				await navigator.clipboard.writeText(field.value);
			} catch {
				field.select();
				document.execCommand("copy");
			}
			button.textContent = "已复制，粘贴回对话即可";
			setTimeout(reset, 2200);
		});
	});
})();
