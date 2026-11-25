"use strict";

const get = (id) => document.getElementById(id);
const state = {card: null, result: null, photo: null, probe: null, mode: "probe", chart: "profile", busy: false};
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
  const select = get("library");
  select.replaceChildren(new Option("选取已存卡片", ""));
  for (const card of cards) select.append(new Option(card.name, card.id));
  select.value = state.card?.id || "";
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
