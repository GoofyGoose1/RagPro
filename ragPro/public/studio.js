async function postForm(url, file, extraFields = {}) {
  const fd = new FormData();
  fd.append("file", file);
  for (const [k, v] of Object.entries(extraFields)) fd.append(k, String(v));

  const res = await fetch(url, { method: "POST", body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `Request failed: ${res.status}`);
  }
  return data;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `Request failed: ${res.status}`);
  }
  return data;
}

function el(id) { return document.getElementById(id); }

function renderTable(headers, rows) {
  const safe = (x) => (x === null || x === undefined) ? "" : String(x);
  let html = "<table><thead><tr>";
  for (const h of headers) html += `<th>${safe(h)}</th>`;
  html += "</tr></thead><tbody>";
  for (const r of rows) {
    html += "<tr>";
    for (const h of headers) html += `<td>${safe(r[h])}</td>`;
    html += "</tr>";
  }
  html += "</tbody></table>";
  return html;
}

async function refreshState() {
  const res = await fetch("/api/state");
  const data = await res.json().catch(() => ({}));
  const st = data?.state || {};
  el("stateBox").textContent =
    `activeTxtPath: ${st.activeTxtPath || "—"} | activeCsvPath: ${st.activeCsvPath || "—"}`;
}

function setCsvStatus(msg, good = true) {
  el("csvStatus").innerHTML = `<span class="${good ? "ok" : "bad"}">${msg}</span>`;
}

function setTxtStatus(msg, good = true) {
  el("txtStatus").innerHTML = `<span class="${good ? "ok" : "bad"}">${msg}</span>`;
}

function logChat(text) {
  const box = el("chatLog");
  box.textContent = (box.textContent ? box.textContent + "\n" : "") + text;
}

let lastCsvFile = null;

window.addEventListener("DOMContentLoaded", async () => {
  await refreshState();

  el("btnRefreshState").addEventListener("click", refreshState);

  // TXT upload
  el("btnUploadTxt").addEventListener("click", async () => {
    const f = el("txtFile").files?.[0];
    if (!f) return setTxtStatus("בחר קובץ TXT קודם", false);

    try {
      setTxtStatus("מעלה…");
      const data = await postForm("/api/upload-text-kb", f);
      setTxtStatus("TXT הוגדר כ-KB פעיל ");
      await refreshState();
    } catch (e) {
      setTxtStatus(e.message || String(e), false);
    }
  });

  // CSV inspect
  el("btnInspectCsv").addEventListener("click", async () => {
    const f = el("csvFile").files?.[0];
    if (!f) return setCsvStatus("בחר קובץ CSV קודם", false);

    lastCsvFile = f;

    try {
      setCsvStatus("בודק CSV…");
      const data = await postForm("/api/inspect-csv", f);
      const { headers = [], previewRows = [], suggestedLabelKey = "" } = data.result || {};

      if (!headers.length) {
        setCsvStatus("לא נמצאו headers בקובץ", false);
        return;
      }

      // fill select
      const sel = el("labelKeySelect");
      sel.innerHTML = "";
      for (const h of headers) {
        const opt = document.createElement("option");
        opt.value = h;
        opt.textContent = h;
        sel.appendChild(opt);
      }
      sel.disabled = false;

      // preselect suggested labelKey if exists
      if (suggestedLabelKey && headers.includes(suggestedLabelKey)) {
        sel.value = suggestedLabelKey;
      }

      // show preview
      el("csvPreviewWrap").style.display = "block";
      el("csvPreview").innerHTML = renderTable(headers.slice(0, 10), previewRows);

      el("btnTrainCsv").disabled = false;
      setCsvStatus("בדיקה הצליחה עכשיו בחר labelKey ולחץ 'אמן CSV'");
    } catch (e) {
      setCsvStatus(e.message || String(e), false);
    }
  });

  // CSV train
  el("btnTrainCsv").addEventListener("click", async () => {
    if (!lastCsvFile) return setCsvStatus("קודם תבצע 'בדוק CSV'", false);

    const labelKey = el("labelKeySelect").value;
    if (!labelKey) return setCsvStatus("בחר labelKey", false);

    try {
      setCsvStatus("מאמן CSV… (זה יכול לקחת קצת)");
      const data = await postForm("/api/train-csv", lastCsvFile, { labelKey });
      setCsvStatus(`אימון הסתיים labelKey=${labelKey}`);
      await refreshState();
    } catch (e) {
      setCsvStatus(e.message || String(e), false);
    }
  });

  // chat
  el("btnChat").addEventListener("click", async () => {
    const msg = el("chatInput").value.trim();
    if (!msg) return;

    el("chatInput").value = "";
    logChat("אתה: " + msg);

    try {
      const data = await postJson("/api/chat", { message: msg, history: [] });
      logChat("בוט:\n" + (data.result?.answer || "(no answer)"));
    } catch (e) {
      logChat("שגיאה: " + (e.message || String(e)));
    }
  });
});
