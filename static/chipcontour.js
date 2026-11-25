"use strict";

const get = (id) => document.getElementById(id);
const state = {card: null, result: null, photo: null, probe: null, mode: "probe", chart: "profile", busy: false,
  cards: [], candidates: [], matchQuery: null, match: null};
const settings = [...document.querySelectorAll("[data-setting]")];

async function api(path, options) {
  const response = await fetch("/chipcontour" + path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "请求失败，请检查输入后重试。");
  return body;
}

function route(tail) {
  return "/cards/" + state.card.id + tail;
}

function savedQuery() {
  return "?revision=" + state.card.revision;
}

function notice(message, target = "notice") {
  const element = get(target);
  element.textContent = message;
  element.hidden = !message;
}

async function action(work, target = "notice") {
  if (state.busy) return;
  state.busy = true;
  document.querySelectorAll("button, select").forEach((node) => { node.disabled = true; });
  notice("", target);
  try {
    await work();
  } catch (error) {
    notice(error.message, target);
  } finally {
    state.busy = false;
    document.querySelectorAll("button, select").forEach((node) => { node.disabled = false; });
  }
}

async function library() {
  const {cards} = await api("/cards");
  state.cards = cards;
  const select = get("library");
  select.replaceChildren(new Option("选取已存卡片", ""));
  for (const card of cards) select.append(new Option(card.name, card.id));
  select.value = state.card?.id || "";
  matchOptions();
}

function matchOptions() {
  const select = get("match-second");
  const keep = select.value;
  select.replaceChildren();
  const others = state.cards.filter((card) => card.id !== state.card?.id);
  if (!others.length) {
    select.append(new Option("先准备另一张断片卡", ""));
    return;
  }
  for (const card of others) select.append(new Option(card.name, card.id));
  if (others.some((card) => card.id === keep)) select.value = keep;
}

const cardName = (id) => state.cards.find((card) => card.id === id)?.name || "另一张";

function candidateText(c) {
  const shift = (c.shift > 0 ? "+" : "") + c.shift;
  return `位移 ${shift} · 连续 ${c.rows} 行 · 第一张 Y ${c.y1_first}–${c.y1_last} · ` +
    `第二张 Y ${c.y2_first}–${c.y2_last} · 平均差 ${c.mean_diff.toFixed(2)} px · 最大差 ${c.max_diff} px`;
}

function renderMatch() {
  const box = get("match-results");
  box.replaceChildren();
  state.candidates.forEach((candidate, index) => {
    const row = document.createElement("div");
    row.className = "candidate" + (index === 0 ? " recommended" : "");
    const text = document.createElement("span");
    text.textContent = (index === 0 ? "推荐 · " : "") + candidateText(candidate);
    const use = document.createElement("button");
    use.type = "button";
    use.textContent = "采用";
    use.addEventListener("click", () => {
      state.match = {...state.matchQuery, candidate};
      renderMatch();
      paintChart();
      notice("已采用该对位。打开「断边走势」图，点一行即切到另一张卡的对应原行。");
    });
    row.append(text, use);
    box.append(row);
  });
  get("match-adopted").hidden = !state.match;
  if (state.match) {
    get("match-summary").textContent =
      `已采用：${cardName(state.match.first)} ↔ ${cardName(state.match.second)} · ${candidateText(state.match.candidate)}`;
  }
}

function paintSource() {
  const canvas = get("capture");
  const ctx = canvas.getContext("2d");
  const {photo, card, probe, result} = state;
  if (!photo) return;
  canvas.width = card.width;
  canvas.height = card.height;
  ctx.drawImage(photo, 0, 0);
  const cfg = card.settings;
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#78ada1";
  ctx.setLineDash([6, 5]);
  ctx.strokeRect(cfg.left, cfg.top, cfg.right-cfg.left, cfg.bottom-cfg.top);
  ctx.setLineDash([]);
  ctx.fillStyle = "#faf1d4";
  for (const row of result.outline) {
    if (row.x !== null) ctx.fillRect(row.x - 1, row.y, 3, 1);
  }
  if (result.profile.length) {
    ctx.strokeStyle = "#9dcbd4";
    ctx.beginPath();
    ctx.moveTo(cfg.left, result.focus);
    ctx.lineTo(cfg.right, result.focus);
    ctx.stroke();
  }
  if (result.reading) {
    ctx.strokeStyle = "#d2518c";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(result.reading.x, result.reading.y, 5, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (probe) {
    ctx.strokeStyle = "#faf4e7";
    ctx.strokeRect(probe.x - 6, probe.y - 6, 12, 12);
  }
}

function paintChart() {
  const canvas = get("chart");
  const ctx = canvas.getContext("2d");
  const {width, height} = canvas;
  const {result, card} = state;
  const cfg = card.settings;
  const outline = state.chart === "coverage";
  const lo = outline ? cfg.top : cfg.left;
  const hi = outline ? cfg.bottom : cfg.right;
  const observed = outline ? result.outline.map((row) => [row.y, row.offset_px])
    : result.profile.map((point) => [point.x, point.brightness]);
  const bound = outline ? Math.max(5, ...observed.map(([, value]) => value || 0)) : 255;
  const xAt = (x) => 43 + (width - 79) * (x - lo) / Math.max(1, hi - lo);
  const yAt = (y) => height - 26 - (height - 46) * y / bound;
  get("chart-title").textContent = outline ? "原图断边到框的距离" : "原行实测亮度";
  get("chart-caption").textContent = outline ? "有证距离 · 原片 Y" : "真实亮度 · 原片 X";
  ctx.fillStyle = "#f7f8f1";
  ctx.fillRect(0, 0, width, height);
  ctx.font = "12px monospace";
  ctx.fillStyle = "#39544b";
  ctx.strokeStyle = "#d3e0d7";
  for (const level of [0, Math.round(bound / 2), bound]) {
    ctx.fillText(level, 8, yAt(level) + 3);
    ctx.beginPath();
    ctx.moveTo(xAt(lo), yAt(level));
    ctx.lineTo(xAt(hi), yAt(level));
    ctx.stroke();
  }
  ctx.fillText(String(lo), xAt(lo), height - 7);
  ctx.fillText(String(hi), xAt(hi) - 15, height - 7);
  const linkable = outline && state.match &&
    (card.id === state.match.first || card.id === state.match.second);
  canvas.classList.toggle("linkable", Boolean(linkable));
  if (linkable) {
    const onFirst = card.id === state.match.first;
    const c = state.match.candidate;
    const a = onFirst ? c.y1_first : c.y2_first;
    const b = onFirst ? c.y1_last : c.y2_last;
    ctx.fillStyle = "rgba(120, 173, 161, 0.18)";
    ctx.fillRect(xAt(a), 20, Math.max(2, xAt(b) - xAt(a)), height - 46);
  }
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#426e60";
  ctx.beginPath();
  let prior = false;
  for (const [position, level] of observed) {
    if (level === null) {
      prior = false;
      continue;
    }
    if (prior) ctx.lineTo(xAt(position), yAt(level));
    else ctx.moveTo(xAt(position), yAt(level));
    prior = true;
  }
  ctx.stroke();
  if (outline && result.focus >= cfg.top && result.focus <= cfg.bottom) {
    ctx.strokeStyle = "#b04c72";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(xAt(result.focus), 20);
    ctx.lineTo(xAt(result.focus), height - 26);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (!outline) {
    ctx.strokeStyle = "#a4675b";
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(xAt(lo), yAt(cfg.cutoff));
    ctx.lineTo(xAt(hi), yAt(cfg.cutoff));
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function pointLabel(point) {
  const kind = point.solid === null ? "框外" : (point.solid ? "亮于下限" : "低于下限");
  return "(" + point.x + ", " + point.y + ") · RGB " + point.rgb.join("/") +
    " · 亮度 " + point.brightness.toFixed(2) + " · " + kind;
}

function show() {
  const {card, result} = state;
  get("workspace").hidden = false;
  get("empty").hidden = true;
  get("origin").textContent = (card.synthetic ? "合成练习图" : "导入原片") + " · 修订 " + card.revision;
  get("card-title").textContent = card.name;
  get("dimensions").textContent = card.width + " × " + card.height + " px · " + card.photo_name;
  get("name").value = card.name;
  for (const field of settings) field.value = card.settings[field.dataset.setting];
  get("probe-x").max = card.width - 1;
  get("probe-y").max = card.height - 1;
  get("probe-x").value = state.probe?.x ?? result.reading?.x ?? Math.round((card.settings.left + card.settings.right) / 2);
  get("probe-y").value = state.probe?.y ?? result.focus;
  get("probe-result").textContent = state.probe ? pointLabel(state.probe) : "选择原片像素";
  const reading = result.reading;
  get("edge-value").textContent = reading ? reading.offset_mm.toFixed(2) : "—";
  get("edge-unit").textContent = "mm";
  get("measurement-state").textContent = "原片 Y " + result.focus;
  get("selected-level").textContent = reading
    ? reading.offset_px + " px · 断边 X " + reading.x
    : (result.profile.length ? "该行无连续四点的边证" : "截线在测量框外");
  for (const [id, filename] of Object.entries({proof: "proof.png", csv: "profile.csv", zip: "observation.zip"})) {
    get(id).href = "/chipcontour" + route("/export/" + filename) + savedQuery();
  }
  matchOptions();
  renderMatch();
  paintSource();
  paintChart();
}

async function open(card) {
  const base = "/cards/" + card.id;
  const photo = new Image();
  photo.src = "/chipcontour" + base + "/capture.png";
  const [result] = await Promise.all([api(base + "/measurement?revision=" + card.revision), photo.decode()]);
  Object.assign(state, {card, result, photo, probe: null});
  get("library").value = card.id;
  show();
}

async function probe(x, y) {
  state.probe = await api(route("/probe") + savedQuery() + "&x=" + x + "&y=" + y);
  get("probe-x").value = x;
  get("probe-y").value = y;
  get("probe-result").textContent = pointLabel(state.probe);
  paintSource();
}

get("practice").addEventListener("click", () => action(async () => {
  await open(await api("/practice", {method: "POST"}));
  await library();
}));

get("library").addEventListener("change", () => {
  if (get("library").value) action(async () => open(await api("/cards/" + get("library").value)));
});
get("open-import").addEventListener("click", () => {
  notice("", "import-notice");
  get("import").showModal();
});
get("cancel-import").addEventListener("click", () => get("import").close());
get("upload").addEventListener("submit", (event) => {
  event.preventDefault();
  action(async () => {
    const card = await api("/cards", {method: "POST", body: new FormData(event.target)});
    await open(card);
    await library();
    get("import").close();
    event.target.reset();
  }, "import-notice");
});
document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => {
  state.mode = button.dataset.mode;
  document.querySelectorAll("[data-mode]").forEach((item) =>
    item.setAttribute("aria-pressed", String(item === button)));
}));
get("capture").addEventListener("click", (event) => {
  if (!state.card) return;
  const canvas = event.currentTarget;
  const rect = canvas.getBoundingClientRect();
  const x = Math.max(0, Math.min(canvas.width - 1, Math.floor((event.clientX - rect.left) * canvas.width / rect.width)));
  const y = Math.max(0, Math.min(canvas.height - 1, Math.floor((event.clientY - rect.top) * canvas.height / rect.height)));
  action(async () => {
    await probe(x, y);
    if (state.mode === "mark") {
      settings.find((field) => field.dataset.setting === "focus").value = y;
      notice("已填入实际原片截线。");
    }
  });
});
get("probe-form").addEventListener("submit", (event) => {
  event.preventDefault();
  action(() => probe(get("probe-x").value, get("probe-y").value));
});
get("calibration").addEventListener("submit", (event) => {
  event.preventDefault();
  action(async () => {
    const fields = Object.fromEntries(settings.map((field) => [
      field.dataset.setting, field.tagName === "SELECT" ? field.value : Number(field.value),
    ]));
    const card = await api(route(""), {
      method: "PATCH", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({revision: state.card.revision, name: get("name").value, settings: fields}),
    });
    await open(card);
    await library();
  });
});
get("match-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!state.card) return;
  action(async () => {
    const body = {
      first: state.card.id,
      second: get("match-second").value,
      max_shift: Number(get("match-shift").value),
      tolerance: Number(get("match-tolerance").value),
    };
    if (!body.second) throw new Error("请选择第二张断片卡。");
    const {candidates} = await api("/pairing", {
      method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body),
    });
    state.matchQuery = {first: body.first, second: body.second};
    state.candidates = candidates;
    state.match = null;
    renderMatch();
    paintChart();
    notice(candidates.length
      ? `找到 ${candidates.length} 种对位，已按有证连续行更多、改变量对得更准排序。`
      : "没有满足条件的对合段：两照同段都要至少六个连续有证原行，且改变量差不超限。");
  });
});
get("match-clear").addEventListener("click", () => {
  state.match = null;
  renderMatch();
  paintChart();
  notice("已取消对合。");
});
get("chart").addEventListener("click", (event) => {
  if (state.chart !== "coverage" || !state.match || !state.card || !state.result) return;
  const {first, second, candidate} = state.match;
  if (state.card.id !== first && state.card.id !== second) return;
  const canvas = event.currentTarget;
  const rect = canvas.getBoundingClientRect();
  const px = (event.clientX - rect.left) * canvas.width / rect.width;
  const cfg = state.card.settings;
  const fraction = Math.max(0, Math.min(1, (px - 43) / (canvas.width - 79)));
  const y = Math.round(cfg.top + fraction * Math.max(1, cfg.bottom - cfg.top));
  const forward = state.card.id === first;
  const targetId = forward ? second : first;
  const targetY = forward ? y + candidate.shift : y - candidate.shift;
  action(async () => {
    const target = await api("/cards/" + targetId);
    if (targetY < 0 || targetY > target.height - 1) {
      notice("对应原行超出另一张原照范围。");
      return;
    }
    const updated = await api("/cards/" + targetId, {
      method: "PATCH", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({revision: target.revision, settings: {focus: targetY}}),
    });
    await open(updated);
    const hit = state.result.outline.find((row) => row.y === targetY);
    if (!hit) {
      notice(`已切到「${updated.name}」原行 ${targetY}，该原行在对方测量框外。`);
    } else if (hit.x === null) {
      notice(`已切到「${updated.name}」原行 ${targetY}，该行读不出实际断边。`);
    } else {
      await probe(hit.x, targetY);
      notice(`已切到「${updated.name}」原行 ${targetY}，点读真实断边像素。`);
    }
  });
});
get("prepare").addEventListener("click", () => action(async () => {
  const {url} = await api(route("/prepare") + savedQuery(), {method: "POST"});
  location.assign(url);
}));
document.querySelectorAll("[data-chart]").forEach((button) => button.addEventListener("click", () => {
  state.chart = button.dataset.chart;
  document.querySelectorAll("[data-chart]").forEach((item) =>
    item.setAttribute("aria-pressed", String(item === button)));
  if (state.card) paintChart();
}));
action(library);
