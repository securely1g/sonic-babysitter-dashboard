"use strict";
const $ = id => document.getElementById(id);
const repository = "securely1g/sonic-babysitter-dashboard";
const interval = 120000;
let snapshot = null,
  loading = false,
  lastCommit = null,
  retryAt = 0,
  cachedFeed = false,
  lastUpdateError = null;
const labels = {
  resources: "Dependency lock",
  external_or_unknown: "External reservation / unknown",
  event_log_mtime: "Worker output",
  receipt: "Audit result",
  not_scheduled: "Not scheduled",
  wait_for_worker: "Audit in progress",
  wait_for_resources: "Waiting for a dependency lock",
  wait_for_capacity: "Waiting for a worker",
  coordinator_follow_up: "Coordinator follow-up",
  checks_failed: "Checks failed",
  checks_pending: "Checks running",
  dependencies_unlanded: "Unmerged prerequisite",
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  no_changes: "Unchanged",
  needs_attention: "Needs attention",
  failed: "Failed",
  reused: "Reused",
  unknown: "Unknown",
  kept_draft: "Draft",
  ready: "Ready",
  lock_conflict: "Dependency lock",
  resource_conflict: "Dependency lock",
  capacity: "Worker capacity",
  serial_only: "Exclusive execution",
  external_lease: "External reservation",
  dependency: "Dependency",
  ci: "CI",
  user_hold: "User hold",
  coordinator: "Coordinator follow-up",
  error: "Audit failure",
  none: "None",
  not_started: "Not started"
};

function label(value) {
  return labels[value] || String(value || "Unknown").replaceAll("_", " ");
}

function text(id, value) {
  $(id).textContent = value == null ? "—" : String(value);
}

function el(tag, content, className) {
  const n = document.createElement(tag);
  if (content != null) n.textContent = String(content);
  if (className) n.className = className;
  return n;
}

function prLink(pr) {
  const m = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#([1-9][0-9]*)$/.exec(pr || "");
  if (!m) return el("span", "Unavailable PR");
  const n = el("a", `${m[2]} #${m[3]}`);
  n.href = `https://github.com/${m[1]}/${m[2]}/pull/${m[3]}`;
  n.target = "_blank";
  n.rel = "noopener noreferrer";
  return n;
}

function stamp(value) {
  if (value == null) return null;
  const n = typeof value === "number" ? value * 1000 : Date.parse(value);
  return Number.isFinite(n) ? n : null;
}

function age(value) {
  const n = stamp(value);
  if (n === null) return "Unknown";
  const s = Math.max(0, (Date.now() - n) / 1000);
  return s < 60 ? "Just now" : s < 3600 ? `${Math.floor(s/60)}m ago` : s < 86400 ?
    `${Math.floor(s/3600)}h ${Math.floor(s%3600/60)}m ago` : `${Math.floor(s/86400)}d ago`;
}

function duration(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  const n = Math.max(0, seconds);
  return n < 60 ? `${Math.floor(n)}s` : n < 3600 ? `${Math.floor(n/60)}m` :
    `${Math.floor(n/3600)}h ${Math.floor(n%3600/60)}m`;
}

function date(value) {
  const n = stamp(value);
  return n === null ? "Unknown" : new Date(n).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  });
}

function pill(value) {
  return el("span", label(value),
    `pill ${["ready","completed","no_changes","reused"].includes(value)?"good":value==="failed"?"danger":value==="needs_attention"?"warning":value==="running"?"working":"neutral"}`
    );
}

function optionList(id, values) {
  const node = $(id),
    selected = node.value;
  while (node.options.length > 1) node.remove(1);
  [...new Set(values)].sort().forEach(v => {
    const o = el("option", label(v));
    o.value = v;
    node.append(o);
  });
  node.value = selected;
}

function empty(target, message) {
  target.replaceChildren(el("div", message, "empty"));
}

function freshness() {
  if (!snapshot) return;
  const n = stamp(snapshot.generated_at);
  const stale = n === null || (Date.now() - n) / 1000 > 240;
  text("feed-state", lastUpdateError ? "Update unavailable" : stale ? "Snapshot stale" : cachedFeed ? "Cached snapshot" : "Live snapshot");
  $("feed-state").className = `pill ${stale || cachedFeed || lastUpdateError ? "warning" : "good"}`;
  text("updated", `Updated ${age(snapshot.generated_at)}`);
  text("snapshot-age", `Snapshot: ${date(snapshot.generated_at)}`);
  updateNotice(stale);
}

function updateNotice(stale = false) {
  const messages = (snapshot?.warnings || []).map(label);
  if (lastUpdateError) {
    messages.unshift(`${lastUpdateError}. ${snapshot ? "Showing the last available snapshot." : "Please try again shortly."}`);
  }
  if (stale) {
    messages.push("This snapshot is older than four minutes. It may not reflect current progress; the last available data is shown.");
  }
  if (cachedFeed) messages.push("Using the cached feed for updates. Updates may be delayed; check the snapshot time below.");
  $("notice").hidden = !messages.length;
  text("notice", messages.join(" · "));
}

function readiness(row) {
  const r = row.readiness || {};
  if (["CLOSED", "MERGED"].includes(r.state)) return r.state.toLowerCase();
  if (r.is_draft === true) return "kept_draft";
  if (r.is_draft === false && r.state === "OPEN") return "ready";
  return "unknown";
}

function renderRows() {
  const query = $("search").value.toLowerCase(),
    status = $("status-filter").value,
    area = $("area-filter").value;
  const rows = (snapshot?.rows || []).filter(r => ($("scope-filter").value !== "cycle" || r.audit?.status !==
      "not_scheduled") && (!query || `${r.pr} ${r.title} ${r.author||""}`.toLowerCase().includes(query)) &&
    (!status || r.audit?.status === status) && (!area || (r.areas || []).includes(area)));
  rows.sort((a, b) => {
    const order = {
      running: 0,
      queued: 1,
      failed: 2,
      needs_attention: 3
    };
    return (order[a.audit?.status] ?? 4) - (order[b.audit?.status] ?? 4) || a.pr.localeCompare(b.pr);
  });
  const body = $("pr-rows");
  body.replaceChildren();
  for (const r of rows) {
    const tr = el("tr"),
      name = el("td");
    const link = prLink(r.pr);
    link.className = "pr-link";
    name.append(link, el("span", r.title, "pr-title"), el("span", r.author ? `by ${r.author}` :
      "Author unavailable", "muted"));
    for (const a of r.areas || []) name.append(el("span", a, "area"));
    tr.append(name);
    const audit = el("td");
    audit.append(pill(r.audit?.status));
    if (r.audit?.duration_seconds != null) audit.append(el("span", duration(r.audit.duration_seconds),
      "muted"));
    tr.append(audit);
    const ready = el("td");
    ready.append(pill(readiness(r)), el("span", `Observed ${age(r.readiness?.observed_at)}`, "muted"));
    tr.append(ready);
    const reason = el("td", null, "reason"),
      wait = r.runtime_wait || {};
    if (wait.kind && wait.kind !== "none") reason.append(el("div", label(wait.kind)));
    for (const b of r.blockers || []) reason.append(el("div", label(b.kind) + ": " + label(b.code)));
    if ((r.blockers || []).some(b => b.kind === "ci")) reason.append(el("span",
      `CI observed ${age(r.ci?.observed_at)}`, "muted"));
    if ((r.blockers || []).some(b => b.kind === "dependency")) reason.append(el("span",
      `Dependencies assessed ${age(r.readiness?.assessed_at)}`, "muted"));
    if (!(r.blockers || []).length && (!wait.kind || wait.kind === "none")) reason.append(el("div", label(r
      .next_action)));
    const refs = new Set([...(wait.blocking_prs || []), ...(r.blockers || []).flatMap(b => b.related_prs ||
    [])]);
    for (const pr of [...refs].slice(0, 5)) reason.append(prLink(pr));
    if (refs.size > 5) reason.append(el("span", `+${refs.size-5} more`, "muted"));
    if (wait.hidden_blockers) reason.append(el("span",
      `${wait.hidden_blockers} private / unavailable blocker(s)`, "muted"));
    tr.append(reason);
    const activity = el("td", age(r.audit?.last_activity_at));
    activity.append(el("span", label(r.audit?.activity_source), "muted"));
    tr.append(activity);
    body.append(tr);
  }
  if (!rows.length) {
    const td = el("td", "No PRs match these filters.");
    td.colSpan = 5;
    const tr = el("tr");
    tr.append(td);
    body.append(tr);
  }
  text("shown", `${rows.length} shown`);
}

function renderBlockers() {
  const groups = new Map();
  for (const r of snapshot.rows || []) {
    const w = r.runtime_wait || {};
    const items = [...(r.blockers || []).map(b => ({
      ...b,
      type: "PR blocker"
    })), ...(w.kind && w.kind !== "none" ? [{
      kind: w.kind,
      code: w.kind,
      related_prs: w.blocking_prs || [],
      type: "Scheduling wait"
    }] : [])];
    for (const b of items) {
      const key = `${b.type}:${b.kind}:${b.code}:${(b.related_prs||[]).join(",")}`;
      if (!groups.has(key)) groups.set(key, {
        ...b,
        prs: []
      });
      groups.get(key).prs.push(r.pr);
    }
  }
  text("blocker-count", groups.size);
  const target = $("blocker-list");
  target.replaceChildren();
  if (!groups.size) {
    empty(target, "No blockers reported in the visible PRs.");
    return;
  }
  for (const g of [...groups.values()].sort((a, b) => b.prs.length - a.prs.length)) {
    const card = el("article", null, "blocker-card");
    card.append(el("span", g.type, "tag"), el("h3",
      `${label(g.kind)} · ${g.prs.length} PR${g.prs.length===1?"":"s"}`), el("p", label(g.code)));
    if (g.related_prs?.length) {
      const refs = el("div", null, "links");
      for (const pr of g.related_prs) refs.append(prLink(pr));
      card.append(refs);
    }
    card.append(el("p", "Affected PRs"));
    const links = el("div", null, "links");
    for (const pr of g.prs) links.append(prLink(pr));
    card.append(links);
    target.append(card);
  }
}

function renderPromotions() {
  const target = $("promotions");
  target.replaceChildren();
  if (!snapshot.promotions?.length) {
    empty(target, "No verified babysitter Ready promotions recorded for this cycle.");
    return;
  }
  for (const p of snapshot.promotions) {
    const card = el("article", null, "promotion"),
      info = el("div"),
      name = el("strong");
    name.append(prLink(p.pr));
    info.append(name, el("span", `Marked Ready ${date(p.event_at)}`, "muted"));
    card.append(info, pill("ready"));
    target.append(card);
  }
}

function definition(id, pairs) {
  $(id).replaceChildren();
  for (const [k, v] of pairs) $(id).append(el("dt", k), el("dd", v == null ? "—" : v));
}

function validateSnapshot(data) {
  if (!data || data.schema_version !== 1 || !Array.isArray(data.rows) || !data.cycle || !data.counts ||
      stamp(data.generated_at) === null) throw new Error(
    "Unsupported status snapshot");
}

function render(data) {
  validateSnapshot(data);
  snapshot = data;
  const c = data.counts,
    cy = data.cycle;
  text("cycle-phase", cy.phase === "running" && cy.state === "running" ? "Auditing Project PRs" :
    `${label(cy.phase)} · ${label(cy.state)}`);
  text("elapsed", `${duration(cy.elapsed_seconds)} elapsed`);
  text("cycle-id", cy.run_id || "No current cycle");
  text("progress-text", `${c.finished||0} of ${c.planned||0} audits finished`);
  text("reuse-text", `${c.reused||0} audits reused`);
  $("progress-fill").style.width = `${Math.min(100,100*(c.finished||0)/Math.max(1,c.planned||0))}%`;
  for (const [id, key] of Object.entries({
      active: "active",
      pending: "pending",
      finished: "finished",
      attention: "needs_attention",
      failed: "failed",
      "ready-count": "verified_promotions"
    })) text(id, c[key] ?? 0);
  text("active-title", cy.process_state === "alive" ? "Workers active" : "Last reported active");
  text("active", `${c.active||0} / ${c.max_workers||"—"}`);
  text("row-count", data.rows.length);
  optionList("status-filter", data.rows.map(r => r.audit?.status).filter(Boolean));
  optionList("area-filter", data.rows.flatMap(r => r.areas || []));
  text("visibility",
    `Showing ${c.visible||0} public Project PRs. ${c.hidden||0} private or unavailable Project PRs are hidden; ${c.excluded_non_project||0} non-Project records are excluded. Cycle totals cover scheduled jobs, including hidden jobs.`
    );
  const m = data.host_metrics || {};
  definition("runtime-values", [
    ["Process", label(cy.process_state)],
    ["Cycle state", label(cy.state)],
    ["Last queue update", date(cy.status_updated_at)],
    ["Memory", m.memory_current_bytes == null ? "Unavailable" :
      `${(m.memory_current_bytes/2**30).toFixed(1)} GiB`
    ],
    ["Peak memory", m.memory_peak_bytes == null ? "Unavailable" :
      `${(m.memory_peak_bytes/2**30).toFixed(1)} GiB`
    ],
    ["OOM kills", m.oom_kill ?? "Unavailable"]
  ]);
  const prev = cy.last_completed || {};
  definition("previous-values", [
    ["Run", prev.run_id],
    ["Outcome", label(prev.status)],
    ["Finished", date(prev.completed_at)]
  ]);
  renderRows();
  renderBlockers();
  renderPromotions();
  freshness();
}
async function getJSON(url) {
  const r = await fetch(url, {cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(20000)});
  if (!r.ok) {
    if (url.startsWith("https://api.github.com/") && (r.status === 403 || r.status === 429)) {
      const reset = Number(r.headers.get("x-ratelimit-reset"));
      retryAt = Number.isFinite(reset) && reset * 1000 > Date.now() ? reset * 1000 : Date.now() + 600000;
    }
    throw new Error(`Status request failed (${r.status})`);
  }
  return r.json();
}
async function refresh() {
  if (loading) return;
  loading = true;
  $("refresh").disabled = true;
  try {
    let data, acceptedCommit = null, fromCache = false;
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
      data = await getJSON("status.json");
    } else {
      try {
        if (Date.now() < retryAt) throw new Error("Revision lookup is backing off");
        const ref = await getJSON(`https://api.github.com/repos/${repository}/git/ref/heads/live`);
        const sha = ref.object?.sha;
        if (!/^[a-f0-9]{40}$/.test(sha || "")) throw new Error("Invalid status revision");
        if (sha === lastCommit && snapshot && !cachedFeed) {
          lastUpdateError = null;
          freshness();
          return;
        }
        data = await getJSON(`https://raw.githubusercontent.com/${repository}/${sha}/status.json`);
        acceptedCommit = sha;
      } catch (_) {
        data = await getJSON(`https://raw.githubusercontent.com/${repository}/live/status.json`);
        fromCache = true;
      }
    }
    validateSnapshot(data);
    lastUpdateError = null;
    if (snapshot && stamp(data.generated_at) < stamp(snapshot.generated_at)) {
      cachedFeed = fromCache || cachedFeed;
      freshness();
      return;
    }
    render(data);
    if (acceptedCommit) lastCommit = acceptedCommit;
    cachedFeed = fromCache;
    freshness();
  } catch (e) {
    lastUpdateError = e.message;
    updateNotice();
    text("feed-state", "Update unavailable");
    $("feed-state").className = "pill warning";
  } finally {
    loading = false;
    $("refresh").disabled = false;
  }
}

$("refresh").addEventListener("click", refresh);
for (const id of ["search", "status-filter", "area-filter", "scope-filter"]) $(id).addEventListener("input",
  renderRows);
for (const button of document.querySelectorAll("[data-tab]")) button.addEventListener("click", () => {
  for (const b of document.querySelectorAll("[data-tab]")) b.classList.toggle("selected", b === button);
  for (const panel of document.querySelectorAll(".tab-content")) panel.hidden = panel.id !== button
    .dataset.tab;
});
refresh();
setInterval(() => {
  if (!document.hidden) refresh();
}, interval);
setInterval(freshness, 15000);
