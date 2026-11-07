// app.js — 화면. criteria.json · keywords.json 을 읽고, 채점 때만 data/answer.json 을 읽는다.
// AI 는 /api/classify (서버 함수) 로만 부른다. 열쇠는 서버에만 있다. 보내는 문장은 모두 가린 문장이다.
(function () {
  const $ = (sel) => document.querySelector(sel);
  const state = { criteria: null, keywords: null, lastAI: null };
  const AI_BATCH = 10;
  const AI_CLIENT_TIMEOUT_MS = 75000; // 서버 함수가 Gemini 를 60초 기다린 뒤 이유를 돌려줄 여유

  async function loadJSON(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(path + " 을(를) 읽지 못했습니다 (" + res.status + ")");
    return res.json();
  }

  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") n.className = v;
      else n.setAttribute(k, v);
    }
    for (const c of [].concat(children || [])) {
      n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return n;
  }

  function timestamp() {
    const d = new Date();
    const p = (x) => String(x).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  // ---- AI 부르기 ----
  // 돌려주는 모양: { ok, model, results: [{id, 칸, 긴급도, 이유}], missing: [{id, error}], error }
  async function callAI(items) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), AI_CLIENT_TIMEOUT_MS);
    try {
      const res = await fetch("api/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
        signal: ctrl.signal,
      });
      let data = null;
      try {
        data = await res.json();
      } catch (_) {
        return { ok: false, error: "AI 서버 함수가 없거나 응답을 읽지 못했습니다 (" + res.status + ")" };
      }
      if (!res.ok || !data || !data.ok) {
        return { ok: false, error: (data && data.error) || "AI 서버 응답 " + res.status };
      }
      return { ok: true, model: data.model, results: data.results || [], missing: data.missing || [] };
    } catch (e) {
      if (e.name === "AbortError") return { ok: false, error: "AI 응답을 기다리다 멈췄습니다" };
      return { ok: false, error: "AI 서버에 닿지 못했습니다 (" + e.message + ")" };
    } finally {
      clearTimeout(timer);
    }
  }

  // ---- 탭 ----
  function setupTabs() {
    const tabs = document.querySelectorAll('[role="tab"]');
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        tabs.forEach((t) => {
          const on = t === tab;
          t.setAttribute("aria-selected", on ? "true" : "false");
          document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
        });
      });
    });
  }

  // ---- 기준 안내 (criteria.json 에서 그린다) ----
  function renderCriteria() {
    const c = state.criteria;
    $("#criteria-list").replaceChildren(
      ...c.순서.map((name) => {
        const def = (c.칸.find((k) => k.이름 === name) || {}).정의 || "";
        return el("li", {}, [el("b", {}, name), el("span", { class: "def" }, def)]);
      })
    );
    $("#criteria-count").textContent = c.순서.length + "개 칸";
    $("#criteria-rule").textContent = c.순서_규칙 + " (" + c.순서.join(" → ") + ")";
    $("#urgency-list").replaceChildren(
      ...c.긴급도.map((u) => el("li", {}, [el("b", {}, u.이름), el("span", { class: "def" }, u.정의)]))
    );
    $("#criteria-owner").textContent = c.owner + " · version " + c.version;
  }

  // ---- 분류 탭 ----
  let classifySeq = 0;
  async function classifyOne() {
    const raw = $("#input").value.trim();
    const out = $("#result");
    if (!raw) {
      out.hidden = true;
      return;
    }
    const seq = ++classifySeq;
    const masked = window.Mask.mask(raw);
    const rule = window.Rules.classify(masked, state.criteria, state.keywords);

    $("#r-masked").textContent = masked;
    $("#r-cat").textContent = "…";
    $("#r-urg").textContent = "…";
    $("#r-urg-wrap").dataset.level = "";
    $("#r-reason").textContent = "";
    $("#r-source").textContent = "AI가 가르는 중…";
    $("#r-notice").hidden = true;
    out.hidden = false;
    $("#go").disabled = true;

    const ai = await callAI([{ id: "q1", text: masked }]);
    if (seq !== classifySeq) return;
    $("#go").disabled = false;

    let r, source;
    const hit = ai.ok ? ai.results.find((x) => x.id === "q1") : null;
    if (hit) {
      r = hit;
      source = "AI (" + ai.model + ")";
    } else {
      r = rule;
      source = "규칙";
      const why = ai.ok ? ((ai.missing[0] || {}).error || "AI 답이 없습니다") : ai.error;
      $("#r-notice-why").textContent = why;
      $("#r-notice").hidden = false;
    }
    $("#r-cat").textContent = r.칸;
    $("#r-urg").textContent = r.긴급도;
    $("#r-urg-wrap").dataset.level = String(state.criteria.긴급도.findIndex((u) => u.이름 === r.긴급도));
    $("#r-reason").textContent = r.이유;
    $("#r-source").textContent = source;
  }

  // ---- 채점 공통 ----
  function tally(answers, predOf) {
    let cat = 0, urg = 0, both = 0;
    const wrong = [];
    for (const a of answers) {
      const p = predOf(a.id);
      const okC = !!p && p.칸 === a.칸;
      const okU = !!p && p.긴급도 === a.긴급도;
      if (okC) cat++;
      if (okU) urg++;
      if (okC && okU) both++;
      else wrong.push({ a, p, okC, okU });
    }
    return { n: answers.length, cat, urg, both, wrong };
  }

  const pct = (k, n) => (n ? Math.round((k / n) * 1000) / 10 : 0) + "%";

  function ruleResults(answers) {
    const map = {};
    for (const a of answers) {
      const masked = window.Mask.mask(a.text);
      map[a.id] = Object.assign({ masked }, window.Rules.classify(masked, state.criteria, state.keywords));
    }
    return map;
  }

  function setBusy(on) {
    $("#score-btn").disabled = on;
    $("#score-ai-btn").disabled = on;
  }

  // ---- 규칙으로 채점 ----
  async function scoreRules() {
    const box = $("#score-out");
    setBusy(true);
    box.replaceChildren(el("p", { class: "muted" }, "채점 중…"));
    try {
      const answers = await loadJSON("data/answer.json");
      const rules = ruleResults(answers);
      const t = tally(answers, (id) => rules[id]);

      const stats = el("div", { class: "stats" }, [
        stat("칸 정확도", t.cat + " / " + t.n, pct(t.cat, t.n)),
        stat("긴급도 정확도", t.urg + " / " + t.n, pct(t.urg, t.n)),
        stat("둘 다 맞음", t.both + " / " + t.n, pct(t.both, t.n)),
      ]);
      const cond = el("p", { class: "cond" },
        "잰 조건: 규칙만(AI 없음) · 낱말 keywords.json(data/practice.json 에서 뽑음) · 기준 criteria.json version " +
        state.criteria.version + " · 정답 data/answer.json " + t.n + "문장 · 가린 문장으로 판정 · " + timestamp());

      const list = el("ol", { class: "wrong" }, t.wrong.map(({ a, p, okC, okU }) =>
        el("li", {}, [
          el("div", { class: "w-head" }, [el("span", { class: "id" }, a.id), " ", p.masked]),
          el("div", { class: "w-row" }, [field("칸", a.칸, p.칸, okC), field("긴급도", a.긴급도, p.긴급도, okU)]),
          el("div", { class: "muted small" }, p.이유),
        ])
      ));
      box.replaceChildren(
        stats, cond,
        el("h3", {}, "틀린 문장 " + t.wrong.length + "개 (정답 → 판정)"),
        t.wrong.length ? list : el("p", { class: "muted" }, "틀린 문장이 없습니다.")
      );
    } catch (e) {
      box.replaceChildren(el("p", { class: "error" }, e.message));
    } finally {
      setBusy(false);
    }
  }

  // ---- AI로 채점 ----
  async function scoreAI() {
    const box = $("#score-out");
    setBusy(true);
    try {
      const answers = await loadJSON("data/answer.json");
      const rules = ruleResults(answers);
      const items = answers.map((a) => ({ id: a.id, text: rules[a.id].masked }));
      const total = items.length;
      const ai = {};
      const aiErr = {};
      const models = new Set();
      let done = 0;
      const progress = el("p", { class: "progress" }, "AI 채점 중… 0/" + total);
      box.replaceChildren(progress);

      for (let i = 0; i < total; i += AI_BATCH) {
        const chunk = items.slice(i, i + AI_BATCH);
        const res = await callAI(chunk);
        if (res.ok) {
          models.add(res.model);
          res.results.forEach((r) => (ai[r.id] = r));
          res.missing.forEach((m) => (aiErr[m.id] = m.error));
        } else {
          chunk.forEach((c) => (aiErr[c.id] = res.error));
        }
        chunk.forEach((c) => {
          if (!ai[c.id] && !aiErr[c.id]) aiErr[c.id] = "AI 답이 없습니다";
        });
        done += chunk.length;
        progress.textContent = "AI 채점 중… " + done + "/" + total;
      }

      const tR = tally(answers, (id) => rules[id]);
      const tA = tally(answers, (id) => ai[id]);
      const noAnswer = Object.keys(aiErr).length;
      const model = models.size ? [...models].join(", ") : "(응답 없음)";
      const stamp = timestamp();
      const batches = Math.ceil(total / AI_BATCH);

      const cell = (k, n) => k + " / " + n + " (" + pct(k, n) + ")";
      const table = el("table", { class: "cmp" }, [
        el("thead", {}, el("tr", {}, [el("th", {}, ""), el("th", {}, "규칙"), el("th", {}, "AI")])),
        el("tbody", {}, [
          el("tr", {}, [el("th", {}, "칸 정확도"), el("td", {}, cell(tR.cat, tR.n)), el("td", {}, cell(tA.cat, tA.n))]),
          el("tr", {}, [el("th", {}, "긴급도 정확도"), el("td", {}, cell(tR.urg, tR.n)), el("td", {}, cell(tA.urg, tA.n))]),
          el("tr", {}, [el("th", {}, "둘 다 맞음"), el("td", {}, cell(tR.both, tR.n)), el("td", {}, cell(tA.both, tA.n))]),
          el("tr", {}, [el("th", {}, "답 못 받음"), el("td", {}, "—"), el("td", { class: noAnswer ? "bad" : "" }, noAnswer + "건 (오답으로 셈)")]),
        ]),
      ]);
      const condText =
        "잰 조건: 정답 data/answer.json " + total + "문장 · 가린 문장으로 판정 · 기준 criteria.json version " +
        state.criteria.version + " · 규칙: keywords.json(data/practice.json 에서 뽑음) · AI: " + model + ", " +
        AI_BATCH + "개씩 " + batches + "번 보냄 · 답 못 받은 문장은 오답 · " + stamp;

      const detailRows = answers.map((a) => {
        const r = rules[a.id], x = ai[a.id];
        const mark = (p) => (p && p.칸 === a.칸 && p.긴급도 === a.긴급도 ? "ok" : "bad");
        return el("tr", {}, [
          el("td", {}, [el("div", { class: "id" }, a.id), el("div", { class: "small" }, r.masked)]),
          el("td", {}, a.칸 + "·" + a.긴급도),
          el("td", { class: mark(r) }, r.칸 + "·" + r.긴급도),
          el("td", { class: mark(x), title: x ? x.이유 : aiErr[a.id] }, x ? x.칸 + "·" + x.긴급도 : "답 없음"),
        ]);
      });
      const details = el("details", { class: "detail" }, [
        el("summary", {}, "문장별 결과 보기"),
        el("table", { class: "cmp per" }, [
          el("thead", {}, el("tr", {}, [el("th", {}, "문장"), el("th", {}, "정답"), el("th", {}, "규칙"), el("th", {}, "AI")])),
          el("tbody", {}, detailRows),
        ]),
      ]);

      const failList = noAnswer
        ? el("div", { class: "fail" }, [
            el("h3", {}, "AI 답을 못 받은 문장 " + noAnswer + "건"),
            el("ul", {}, Object.entries(aiErr).map(([id, why]) => el("li", {}, [el("span", { class: "id" }, id), " ", why]))),
          ])
        : "";

      state.lastAI = {
        만든_시각: stamp,
        조건: {
          정답: "data/answer.json",
          문장_수: total,
          기준: "criteria.json version " + state.criteria.version,
          판정_문장: "가린 문장",
          규칙: "keywords.json (data/practice.json 에서 뽑음)",
          AI_모델: model,
          보낸_방식: AI_BATCH + "개씩 " + batches + "번",
          답_못_받은_문장: "오답으로 셈",
        },
        요약: {
          규칙: { 칸: tR.cat, 긴급도: tR.urg, 둘_다: tR.both, 전체: tR.n },
          AI: { 칸: tA.cat, 긴급도: tA.urg, 둘_다: tA.both, 전체: tA.n, 답_못_받음: noAnswer },
        },
        문장: answers.map((a) => ({
          id: a.id,
          가린_문장: rules[a.id].masked,
          정답: { 칸: a.칸, 긴급도: a.긴급도 },
          규칙: { 칸: rules[a.id].칸, 긴급도: rules[a.id].긴급도, 이유: rules[a.id].이유 },
          AI: ai[a.id] ? { 칸: ai[a.id].칸, 긴급도: ai[a.id].긴급도, 이유: ai[a.id].이유 } : null,
          AI_오류: aiErr[a.id] || null,
        })),
      };
      const dl = el("button", { type: "button", class: "btn-outline" }, "AI 채점 결과 내려받기");
      dl.addEventListener("click", downloadAI);

      box.replaceChildren(
        el("p", { class: "progress done" }, "AI 채점 끝 " + total + "/" + total),
        table,
        el("p", { class: "cond" }, condText),
        dl,
        failList,
        details
      );
    } catch (e) {
      box.replaceChildren(el("p", { class: "error" }, e.message));
    } finally {
      setBusy(false);
    }
  }

  function downloadAI() {
    if (!state.lastAI) return;
    const blob = new Blob([JSON.stringify(state.lastAI, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: "ai_채점결과.json" });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function stat(label, value, sub) {
    return el("div", { class: "stat" }, [
      el("div", { class: "muted small" }, label),
      el("div", { class: "big" }, value),
      el("div", { class: "muted small" }, sub),
    ]);
  }

  function field(label, want, got, ok) {
    return el("span", { class: "field " + (ok ? "ok" : "bad") }, [
      label + ": ", el("b", {}, want), ok ? "" : " → " + got,
    ]);
  }

  // ---- 시작 ----
  async function init() {
    setupTabs();
    try {
      const [criteria, keywords] = await Promise.all([loadJSON("criteria.json"), loadJSON("keywords.json")]);
      state.criteria = criteria;
      state.keywords = keywords;
      renderCriteria();
      $("#go").disabled = false;
      setBusy(false);
    } catch (e) {
      $("#load-error").textContent =
        e.message + " — 파일을 바로 열면(file://) 읽을 수 없습니다. 웹 서버로 열어 주세요.";
      $("#load-error").hidden = false;
    }
    $("#form").addEventListener("submit", (ev) => {
      ev.preventDefault();
      classifyOne();
    });
    // 문장 한 줄: Enter 는 분류, Shift+Enter 는 줄바꿈. 글자 수 표시
    const input = $("#input");
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
        ev.preventDefault();
        if (!$("#go").disabled) $("#form").requestSubmit();
      }
    });
    const updateCount = () => ($("#count").textContent = input.value.length + " / " + input.maxLength);
    input.addEventListener("input", updateCount);
    $("#form").addEventListener("submit", updateCount);
    updateCount();

    // 예시 문장: examples.json 에서 그린다. 누르면 입력 칸에 넣기만 한다 (분류는 «분류하기»로)
    loadJSON("examples.json")
      .then((ex) => {
        const list = (ex && ex.문장) || [];
        if (!list.length) return;
        $("#example-list").replaceChildren(
          ...list.map((text) => {
            const b = el("button", { type: "button" }, text);
            b.addEventListener("click", () => {
              input.value = text.slice(0, input.maxLength);
              updateCount();
              input.focus();
            });
            return b;
          })
        );
        $("#examples").hidden = false;
      })
      .catch(() => {}); // 예시가 없어도 분류기는 그대로 쓴다
    $("#score-btn").addEventListener("click", scoreRules);
    $("#score-ai-btn").addEventListener("click", scoreAI);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
