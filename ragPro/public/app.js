async function safeJson(res) {
  try { return await res.json(); } catch { return {}; }
}

function $(id) { return document.getElementById(id); }

function setPre(id, text) {
  const el = $(id);
  if (el) el.textContent = text || "";
}

function setBadge(text, ok = true) {
  const badge = $("kbBadge");
  if (!badge) return;
  const span = badge.querySelector("span");
  if (span) span.textContent = text;

  badge.style.opacity = "1";
  badge.style.borderColor = ok ? "rgba(0,255,160,.35)" : "rgba(255,80,80,.35)";
}

function appendChat(role, text) {
  const chatBox = $("chatBox");
  if (!chatBox) return;

  const welcome = chatBox.querySelector(".chat-welcome");
  if (welcome) welcome.remove();

  const wrap = document.createElement("div");
  wrap.className = "chat-msg " + (role === "user" ? "me" : "bot");
  wrap.style.padding = "10px 12px";
  wrap.style.margin = "8px 0";
  wrap.style.borderRadius = "12px";
  wrap.style.background = role === "user" ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.18)";
  wrap.style.border = "1px solid rgba(255,255,255,.10)";

  const title = document.createElement("div");
  title.style.opacity = ".85";
  title.style.fontWeight = "700";
  title.style.marginBottom = "6px";
  title.textContent = role === "user" ? "אתה" : "בוט";

  const body = document.createElement("div");
  body.style.whiteSpace = "pre-wrap";
  body.textContent = text || "";

  wrap.appendChild(title);
  wrap.appendChild(body);
  chatBox.appendChild(wrap);

  chatBox.scrollTop = chatBox.scrollHeight;
}

async function refreshState() {
  const res = await fetch("/api/state");
  const data = await safeJson(res);
  const st = data?.state || {};

  const hasTxt = !!st.activeTxtPath;
  const hasCsv = !!st.activeCsvPath;

  const msg =
    `TXT: ${hasTxt ? "פעיל" : "— לא הועלה"} | ` +
    `CSV: ${hasCsv ? "פעיל" : "— לא הועלה"}`;

  setBadge(msg, hasTxt || hasCsv);

  setPre("chatDebug", JSON.stringify(st, null, 2));
}

function wireFileLabel(inputId, textId) {
  const inp = $(inputId);
  const txt = $(textId);
  if (!inp || !txt) return;
  inp.addEventListener("change", () => {
    const f = inp.files && inp.files[0];
    txt.textContent = f ? f.name : (inputId === "csvFile" ? "בחר קובץ CSV" : "בחר קובץ TXT");
  });
}

async function postForm(url, formData) {
  const res = await fetch(url, { method: "POST", body: formData });
  const data = await safeJson(res);
  if (!res.ok || data?.ok === false) throw new Error(data?.error || `Request failed: ${res.status}`);
  return data;
}

function makeCsvPreviewText(headers, previewRows) {
  const h = headers || [];
  const rows = previewRows || [];
  const cols = h.slice(0, 10);

  const lines = [];
  lines.push("headers:");
  lines.push(cols.join(" | "));
  lines.push("");
  lines.push("preview (first rows):");
  rows.forEach((r, i) => {
    const rowLine = cols.map(c => String(r?.[c] ?? "")).join(" | ");
    lines.push(`${i + 1}) ${rowLine}`);
  });
  return lines.join("\n");
}

async function setupCsvInspect() {
  const csvFile = $("csvFile");
  const inspectBtn = $("inspectCsvBtn");
  const labelSel = $("labelKeySelect");
  const trainBtn = $("trainCsvBtn");
  const previewWrap = $("csvInspectPreview");
  const previewOut = $("csvInspectOut");

  if (!csvFile || !inspectBtn || !labelSel || !trainBtn) return;

  inspectBtn.addEventListener("click", async () => {
    try {
      const f = csvFile.files && csvFile.files[0];
      if (!f) throw new Error("בחר קובץ CSV קודם");

      setPre("csvOut", "בודק CSV...");
      trainBtn.disabled = true;
      labelSel.disabled = true;

      const fd = new FormData();
      fd.append("file", f);

      const data = await postForm("/api/inspect-csv", fd);
      const { headers = [], previewRows = [], suggestedLabelKey = "" } = data.result || {};

      // fill select
      labelSel.innerHTML = `<option value="">בחר עמודת יעד...</option>`;
      headers.forEach(h => {
        const opt = document.createElement("option");
        opt.value = h;
        opt.textContent = h;
        labelSel.appendChild(opt);
      });

      if (suggestedLabelKey && headers.includes(suggestedLabelKey)) {
        labelSel.value = suggestedLabelKey;
      }

      labelSel.disabled = false;
      trainBtn.disabled = !labelSel.value;

      labelSel.addEventListener("change", () => {
        trainBtn.disabled = !labelSel.value;
      }, { once: true });

      // show preview
      if (previewWrap && previewOut) {
        previewWrap.style.display = "block";
        previewOut.textContent = makeCsvPreviewText(headers, previewRows);
      }

      setPre("csvOut", "בדיקה הצליחה. בחר labelKey ואז לחץ 'אמן רשת עצבית'.");
    } catch (e) {
      setPre("csvOut", "fail" + (e.message || String(e)));
    }
  });
}

function setupCsvTrain() {
  const form = $("csvForm");
  if (!form) return;

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try {
      const fd = new FormData(form);
      // enforce file exists
      const file = $("csvFile")?.files?.[0];
      if (!file) throw new Error("בחר קובץ CSV");

      setPre("csvOut", "מאמן CSV...");
      const data = await postForm("/api/train-csv", fd);
      setPre("csvOut", "אימון הסתיים\n" + JSON.stringify(data.result, null, 2));
      await refreshState();
    } catch (e) {
      setPre("csvOut", "fail" + (e.message || String(e)));
    }
  });
}

function setupTxtUploadKb() {
  const btn = $("uploadTxtKbBtn");
  const fileInput = $("txtFile");
  if (!btn || !fileInput) return;

  btn.addEventListener("click", async () => {
    try {
      const f = fileInput.files && fileInput.files[0];
      if (!f) throw new Error("בחר קובץ TXT");

      setPre("txtOut", "מעלה TXT כ-KB...");
      const fd = new FormData();
      fd.append("file", f);

      const data = await postForm("/api/upload-text-kb", fd);
      setPre("txtOut", "success" + (data.result?.message || "TXT הוגדר כ-KB פעיל"));
      await refreshState();
    } catch (e) {
      setPre("txtOut", "fail" + (e.message || String(e)));
    }
  });
}

function setupTxtTrainDemo() {
  const form = $("txtForm");
  if (!form) return;

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try {
      const f = $("txtFile")?.files?.[0];
      if (!f) throw new Error("בחר קובץ TXT");

      setPre("txtOut", "מאמן LSTM (דמו)...");
      const fd = new FormData();
      fd.append("file", f);

      const data = await postForm("/api/train-text-demo", fd);
      setPre("txtOut", "אימון דמו הסתיים\n" + JSON.stringify(data.result, null, 2));
      await refreshState();
    } catch (e) {
      setPre("txtOut", "fail" + (e.message || String(e)));
    }
  });
}

function setupChat() {
  const input = $("chatInput");
  const send = $("chatSend");
  const clear = $("chatClear");

  async function doSend() {
    const msg = (input?.value || "").trim();
    if (!msg) return;
    input.value = "";

    appendChat("user", msg);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, history: [] })
      });
      const data = await safeJson(res);
      if (!res.ok || data?.ok === false) throw new Error(data?.error || "Chat request failed");

      const ans = data.result?.answer || "(no answer)";
      appendChat("bot", ans);
    } catch (e) {
      appendChat("bot", "שגיאה: " + (e.message || String(e)));
    }
  }

  send?.addEventListener("click", doSend);
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSend();
  });

  clear?.addEventListener("click", () => {
    const box = $("chatBox");
    if (!box) return;
    box.innerHTML = `
      <div class="chat-welcome">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <p>התחל שיחה על ידי שליחת שאלה</p>
      </div>
    `;
    setPre("chatDebug", "");
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  wireFileLabel("csvFile", "csvFileText");
  wireFileLabel("txtFile", "txtFileText");

  $("refreshStateTop")?.addEventListener("click", refreshState);

  await refreshState();

  await setupCsvInspect();
  setupCsvTrain();

  setupTxtUploadKb();
  setupTxtTrainDemo();

  setupChat();
});
