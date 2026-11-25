// Browser side of docs/review/db-schema-audit.html (inlined by build.ts). No network.
;(function () {
  const DATA = JSON.parse(document.getElementById("data").textContent)
  const STORE = "sts-schema-audit-v1"
  const LABEL = { ok: "可以", change: "要改", ask: "有疑问" }
  const RETIRED = new Set(["退役", "不上线"])
  // Retired tables get table-level labels that mean "drop the whole table"; stored values stay ok/change/ask.
  const RETIRED_LABEL = { ok: "确认移除", change: "要保留", ask: "有疑问" }

  let reviews = {}
  try {
    reviews = JSON.parse(localStorage.getItem(STORE) || "{}") || {}
  } catch {
    reviews = {}
  }
  const save = () => {
    try {
      localStorage.setItem(STORE, JSON.stringify(reviews))
    } catch {
      /* private window: marks live until the tab closes; export JSON to keep them */
    }
  }

  // Round migration: tables answered in this round lose their old table-level verdict (kept as a note),
  // because their status may have changed (e.g. a "要改" table is now retired). Field marks are untouched.
  const ROUND = 2
  const ROUND_KEY = "sts-schema-audit-round"
  try {
    const seen = Number(localStorage.getItem(ROUND_KEY) || "1")
    if (seen < ROUND) {
      for (const t of DATA.categories.flatMap((c) => c.tables)) {
        const r = reviews[t.name]
        if (!t.reply || !r) continue
        const label = { ok: "可以", change: "要改", ask: "有疑问" }[r.status] || "未标"
        reviews[t.name] = { status: "", note: `【第 1 轮：${label}】${r.note || ""}` }
      }
      localStorage.setItem(STORE, JSON.stringify(reviews))
      localStorage.setItem(ROUND_KEY, String(ROUND))
    }
  } catch {
    /* storage unavailable: nothing to migrate */
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])
  const allTables = DATA.categories.flatMap((c) => c.tables)
  const tableByName = Object.fromEntries(allTables.map((t) => [t.name, t]))
  const isRetired = (t) => RETIRED.has(t.fate)
  /** A retired table whose removal the reviewer confirmed: its fields need no further review. */
  const isDropped = (t) => isRetired(t) && reviews[t.name]?.status === "ok"

  document.getElementById("meta").textContent =
    `结构来源：仓库 supabase/migrations 共 ${DATA.migrations.count} 个迁移（最后一个 ${DATA.migrations.last}），生成于 ${new Date(DATA.generatedAt).toLocaleString("zh-CN")}。` +
    ` ${allTables.length} 张表 / 视图，${allTables.reduce((n, t) => n + t.columns.length, 0)} 个字段。「线上」= 已在线上项目中存在（括号里是 2026-11-16 的行数）。`

  const seg = (key, labels = LABEL) => {
    const cur = reviews[key]?.status || ""
    return `<span class="seg" data-key="${esc(key)}">${Object.entries(labels)
      .map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${cur === v}">${l}</button>`)
      .join("")}</span>`
  }
  const noteBox = (key, placeholder) =>
    `<textarea data-key="${esc(key)}" rows="1" placeholder="${esc(placeholder)}">${esc(reviews[key]?.note || "")}</textarea>`
  const list = (items) => `<ul>${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`

  // ── render ───────────────────────────────────────────
  let html = ""
  let toc = ""
  DATA.categories.forEach((cat, ci) => {
    const n = ci + 1
    html += `<section class="cat" data-cat="${cat.key}"><h2 id="cat-${cat.key}">${n}. ${esc(cat.title)}</h2><p class="cat-intro">${esc(cat.intro)}</p>`
    toc += `<section data-cat="${cat.key}"><h4><a href="#cat-${cat.key}">${n}. ${esc(cat.title)}</a></h4>`
    cat.tables.forEach((t, ti) => {
      const num = `${n}.${ti + 1}`
      const badges =
        `<span class="badge ${t.fate}">${t.fate}</span>` +
        (t.live ? `<span class="badge live">线上${t.liveRows != null ? `（${t.liveRows} 行）` : ""}</span>` : "") +
        (t.draft ? `<span class="badge draft">草案</span>` : "") +
        (t.kind === "view" ? `<span class="badge 不上线">视图</span>` : "")
      html += `<article class="tbl" id="t-${t.name}" data-table="${t.name}" data-fate="${t.fate}">
        <div class="tbl-head">
          <div>
            <h3>${num} <code>${esc(t.name)}</code>${badges}<span class="badge dropmark">已确认移除，不用再看</span></h3>
            <p class="purpose"><b>作用：</b>${esc(t.purpose) || '<span class="empty">（未写说明）</span>'}</p>
            ${t.fateNote ? `<p class="fate"><b>0.5 处理：</b>${esc(t.fateNote)}</p>` : ""}
            ${t.reply ? `<p class="reply"><b>第 1 轮答复：</b>${esc(t.reply)}</p>` : ""}
          </div>
          <div class="tbl-review">
            ${isRetired(t) ? seg(t.name, RETIRED_LABEL) : seg(t.name)}
            ${noteBox(t.name, isRetired(t) ? "表级备注：确认整表移除，或写明要保留哪些字段" : "表级备注：整体意见、要加的字段…")}
            <button type="button" class="bulk" data-bulk="${t.name}">未审字段全部标为「可以」</button>
            ${isRetired(t) ? `<button type="button" class="bulk peek-btn" data-peek="${t.name}">展开 / 收起字段</button>` : ""}
          </div>
        </div>
        <div class="wrap"><table>
          <thead><tr><th>字段</th><th>类型</th><th>索引 / 键</th><th>备注（约束 / 默认）</th><th>用途说明</th><th>审计</th></tr></thead>
          <tbody>${t.columns
            .map((c) => {
              const key = `${t.name}.${c.name}`
              const cls = [c.draft ? "draft" : "", c.plan && c.plan.startsWith("MVP 删除") ? "drop-col" : ""].join(" ")
              return `<tr data-key="${esc(key)}" class="${cls}">
                <td class="f"><code>${esc(c.name)}</code>${c.plan ? `<br><span class="badge plan${c.plan.startsWith("MVP 删除") ? " del" : ""}">${esc(c.plan)}</span>` : ""}</td>
                <td class="t"><code>${esc(c.type)}</code></td>
                <td class="k">${c.keys.length ? list(c.keys) : ""}</td>
                <td class="n">${list(c.notes)}</td>
                <td class="m">${esc(c.meaning) || '<span class="empty">（未写说明）</span>'}</td>
                <td class="r">${seg(key)}${noteBox(key, "备注")}</td>
              </tr>`
            })
            .join("")}</tbody>
        </table></div>
        ${
          t.extras.length
            ? `<details class="extras"><summary>表级约束、索引、触发器、RLS 策略（原始定义）</summary>${t.extras
                .map((e) => `<h5>${esc(e.label)}</h5>${list(e.items)}`)
                .join("")}</details>`
            : ""
        }
      </article>`
      toc += `<a class="t" href="#t-${t.name}" data-toc="${t.name}"><span>${num} ${esc(t.name)}</span><span class="p"></span></a>`
    })
    html += `</section>`
    toc += `</section>`
  })
  document.getElementById("list").innerHTML = html
  document.getElementById("toc").innerHTML = toc

  // ── state → view ─────────────────────────────────────
  const grow = (ta) => {
    ta.style.height = "auto"
    ta.style.height = ta.scrollHeight + 2 + "px"
  }
  const paint = (key) => {
    const st = reviews[key]?.status || ""
    document.querySelectorAll(`.seg[data-key="${CSS.escape(key)}"] button`).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === st)))
    const row = document.querySelector(`tr[data-key="${CSS.escape(key)}"]`)
    if (row) row.dataset.status = st
    else {
      const art = document.getElementById(`t-${key}`)
      if (art) art.dataset.status = st
    }
  }
  const setReview = (key, patch) => {
    const next = { ...(reviews[key] || {}), ...patch }
    if (!next.status && !next.note) delete reviews[key]
    else reviews[key] = next
    save()
  }

  const counts = () => {
    let total = 0, done = 0, change = 0, ask = 0, dropped = 0
    for (const t of allTables) {
      const gone = isDropped(t)
      if (gone) dropped++
      let tDone = 0, tFlag = 0
      for (const c of t.columns) {
        const r = reviews[`${t.name}.${c.name}`]
        total++
        // Fields of a table confirmed for removal count as reviewed; their own marks no longer matter.
        if (r?.status || gone) { done++; tDone++ }
        if (gone) continue
        if (r?.status === "change") change++
        if (r?.status === "ask") ask++
        if (r?.status === "change" || r?.status === "ask") tFlag++
      }
      const tr = reviews[t.name]?.status
      if (tr === "change" || tr === "ask") tFlag++
      const art = document.getElementById(`t-${t.name}`)
      if (art) art.classList.toggle("dropped", gone)
      const a = document.querySelector(`a[data-toc="${CSS.escape(t.name)}"]`)
      if (a) {
        a.querySelector(".p").textContent = gone ? "确认移除" : `${tDone}/${t.columns.length}${tFlag ? ` · ${tFlag}!` : ""}`
        a.classList.toggle("done", tDone === t.columns.length && !tFlag && !gone)
        a.classList.toggle("flag", tFlag > 0)
        a.classList.toggle("gone", gone)
      }
    }
    const tablesDone = allTables.filter((t) => reviews[t.name]?.status).length
    document.getElementById("count").textContent =
      `字段 ${done}/${total} · 要改 ${change} · 疑问 ${ask} · 表 ${tablesDone}/${allTables.length}${dropped ? ` · 确认移除 ${dropped} 表` : ""}`
  }

  const applyFilter = () => {
    const q = document.getElementById("search").value.trim().toLowerCase()
    const mode = document.getElementById("filter").value
    const hideRetired = document.getElementById("hide-retired").checked
    for (const art of document.querySelectorAll("article.tbl")) {
      const t = tableByName[art.dataset.table]
      const tableHit = !q || t.name.toLowerCase().includes(q) || t.purpose.toLowerCase().includes(q)
      let visible = 0
      for (const row of art.querySelectorAll("tbody tr")) {
        const c = t.columns.find((x) => `${t.name}.${x.name}` === row.dataset.key)
        const r = isDropped(t) ? { status: "ok", note: reviews[row.dataset.key]?.note } : reviews[row.dataset.key]
        const textHit = tableHit || c.name.toLowerCase().includes(q) || c.meaning.toLowerCase().includes(q)
        const modeHit =
          mode === "all" ||
          (mode === "todo" && !r?.status) ||
          (mode === "noted" && r?.note) ||
          (r?.status === mode)
        const show = textHit && modeHit
        row.classList.toggle("hidden", !show)
        if (show) visible++
      }
      const tr = reviews[t.name]
      const tableModeHit = mode === "all" || (mode === "todo" ? !tr?.status : mode === "noted" ? !!tr?.note : tr?.status === mode)
      art.classList.toggle("hidden", (hideRetired && RETIRED.has(t.fate)) || (visible === 0 && !(tableHit && tableModeHit)))
    }
    for (const sec of document.querySelectorAll("section.cat")) {
      sec.classList.toggle("hidden", !sec.querySelector("article.tbl:not(.hidden)"))
    }
    for (const a of document.querySelectorAll("a[data-toc]")) {
      a.classList.toggle("hidden", hideRetired && RETIRED.has(tableByName[a.dataset.toc].fate))
    }
  }

  // ── events ───────────────────────────────────────────
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".seg button")
    if (b) {
      const key = b.parentElement.dataset.key
      const v = b.dataset.v
      setReview(key, { status: reviews[key]?.status === v ? "" : v })
      paint(key)
      counts()
      return
    }
    const peek = e.target.closest("button[data-peek]")
    if (peek) {
      document.getElementById(`t-${peek.dataset.peek}`).classList.toggle("peek")
      return
    }
    const bulk = e.target.closest("button[data-bulk]")
    if (bulk) {
      const t = tableByName[bulk.dataset.bulk]
      for (const c of t.columns) {
        const key = `${t.name}.${c.name}`
        if (!reviews[key]?.status) {
          setReview(key, { status: "ok" })
          paint(key)
        }
      }
      counts()
    }
  })
  document.addEventListener("input", (e) => {
    const ta = e.target.closest("textarea[data-key]")
    if (!ta) return
    setReview(ta.dataset.key, { note: ta.value })
    grow(ta)
  })
  for (const id of ["search", "filter", "hide-retired"]) document.getElementById(id).addEventListener("input", applyFilter)

  const download = (name, text, type) => {
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob([text], { type }))
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  const stamp = () => new Date().toISOString().slice(0, 10)

  document.getElementById("export-json").addEventListener("click", () => {
    const items = Object.entries(reviews).map(([key, r]) => {
      const [tbl, col] = key.split(".")
      const t = tableByName[tbl]
      const c = col ? t?.columns.find((x) => x.name === col) : undefined
      return { key, table: tbl, column: col || null, type: c?.type ?? null, meaning: c ? c.meaning : t?.purpose, status: r.status || "", note: r.note || "" }
    })
    download(
      `数据库字段审计-${stamp()}.json`,
      JSON.stringify({ kind: "sts-schema-audit", version: 1, generatedAt: DATA.generatedAt, migrations: DATA.migrations, exportedAt: new Date().toISOString(), items }, null, 2),
      "application/json"
    )
  })

  document.getElementById("export-md").addEventListener("click", () => {
    const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n+/g, "<br>")
    const lines = [
      "# 数据库字段审计结果",
      "",
      `- 导出：${new Date().toLocaleString("zh-CN")}`,
      `- 结构来源：${DATA.migrations.count} 个迁移，最后一个 \`${DATA.migrations.last}\``,
      `- 进度：${document.getElementById("count").textContent}`,
      "",
    ]
    const droppedTables = allTables.filter(isDropped)
    if (droppedTables.length) {
      lines.push("## 确认整表移除", "", ...droppedTables.map((t) => `- \`${t.name}\`（${t.fate}）${reviews[t.name].note ? `：${reviews[t.name].note.replace(/\n+/g, " ")}` : ""}`), "")
    }
    DATA.categories.forEach((cat, ci) => {
      const blocks = []
      cat.tables.forEach((t, ti) => {
        if (isDropped(t)) return
        const tr = reviews[t.name]
        const rows = t.columns.filter((c) => {
          const r = reviews[`${t.name}.${c.name}`]
          return r && (r.status === "change" || r.status === "ask" || r.note)
        })
        const todo = t.columns.filter((c) => !reviews[`${t.name}.${c.name}`]?.status).length
        if (!tr && !rows.length && !todo) return
        blocks.push(`### ${ci + 1}.${ti + 1} \`${t.name}\`（${t.fate}）`, "")
        if (tr) blocks.push(`- 表级：${(isRetired(t) ? RETIRED_LABEL : LABEL)[tr.status] || "未标"}${tr.note ? ` · ${tr.note.replace(/\n+/g, " ")}` : ""}`)
        if (todo) blocks.push(`- 未审字段：${todo} / ${t.columns.length}`)
        if (rows.length) {
          blocks.push("", "| 字段 | 类型 | 结论 | 备注 |", "| --- | --- | --- | --- |")
          for (const c of rows) {
            const r = reviews[`${t.name}.${c.name}`]
            blocks.push(`| \`${c.name}\` | ${cell(c.type)} | ${LABEL[r.status] || "未标"} | ${cell(r.note)} |`)
          }
        }
        blocks.push("")
      })
      if (blocks.length) lines.push(`## ${ci + 1}. ${cat.title}`, "", ...blocks)
    })
    download(`数据库字段审计结果-${stamp()}.md`, lines.join("\n"), "text/markdown")
  })

  document.getElementById("import").addEventListener("change", async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text())
      const items = Array.isArray(parsed) ? parsed : parsed.items
      if (!Array.isArray(items)) throw new Error("文件里没有 items")
      let n = 0
      for (const it of items) {
        if (!it?.key) continue
        reviews[it.key] = { status: it.status || "", note: it.note || "" }
        n++
      }
      save()
      alert(`已导入 ${n} 条`)
      location.reload()
    } catch (err) {
      alert("导入失败：" + err.message)
    }
    e.target.value = ""
  })

  document.getElementById("reset").addEventListener("click", () => {
    if (!confirm("清空本页全部审计标记和备注？建议先导出 JSON。")) return
    reviews = {}
    save()
    location.reload()
  })

  for (const key of Object.keys(reviews)) paint(key)
  document.querySelectorAll("textarea[data-key]").forEach((ta) => ta.value && grow(ta))
  counts()
  applyFilter()
})()
