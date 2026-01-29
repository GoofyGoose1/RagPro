async function postForm(url, formEl) {
  const fd = new FormData(formEl);
  const res = await fetch(url, { method: "POST", body: fd });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Request failed");
  return json;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Request failed");
  return json;
}

function el(tag, cls, text) {
  const x = document.createElement(tag);
  if (cls) x.className = cls;
  if (text !== undefined) x.textContent = text;
  return x;
}

function safeText(s) {
  return String(s ?? "");
}

window.addEventListener("DOMContentLoaded", () => {
  console.log("🚀 RagPro initialized");
  
  const csvFileInput = document.getElementById('csvFile');
  if (csvFileInput) {
    csvFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      const label = e.target.nextElementSibling;
      const textSpan = label.querySelector('.file-text');
      
      if (file) {
        if (textSpan) textSpan.textContent = `✓ ${file.name}`;
        label.style.borderColor = '#10b981';
        label.style.background = 'rgba(16, 185, 129, 0.05)';
        label.style.color = '#10b981';
      } else {
        if (textSpan) textSpan.textContent = 'בחר קובץ CSV';
        label.style.borderColor = '';
        label.style.background = '';
        label.style.color = '';
      }
    });
  }

  const txtFileInput = document.getElementById('txtFile');
  if (txtFileInput) {
    txtFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      const label = e.target.nextElementSibling;
      const textSpan = label.querySelector('.file-text');
      
      if (file) {
        if (textSpan) textSpan.textContent = `✓ ${file.name}`;
        label.style.borderColor = '#10b981';
        label.style.background = 'rgba(16, 185, 129, 0.05)';
        label.style.color = '#10b981';
      } else {
        if (textSpan) textSpan.textContent = 'בחר קובץ TXT';
        label.style.borderColor = '';
        label.style.background = '';
        label.style.color = '';
      }
    });
  }

  // CSV TRAIN
  
  const csvForm = document.getElementById("csvForm");
  if (csvForm) {
    csvForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const out = document.getElementById("csvOut");
      out.textContent = "מאמן רשת עצבית...";
      try {
        const json = await postForm("/api/train-csv", e.target);
        out.textContent = JSON.stringify(json.result, null, 2);
        refreshStateBadge();
      } catch (err) {
        out.textContent = "שגיאה: " + err.message;
      }
    });
  }

  // TEXT TRAIN
  
  const txtForm = document.getElementById("txtForm");
  if (txtForm) {
    txtForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const out = document.getElementById("txtOut");
      out.textContent = "מאמן LSTM...";
      try {
        const json = await postForm("/api/train-text", e.target);
        out.textContent = JSON.stringify(json.result, null, 2);
        refreshStateBadge();
      } catch (err) {
        out.textContent = "שגיאה: " + err.message;
      }
    });
  }

  // CHAT
 
  const chatBox = document.getElementById("chatBox");
  const chatInput = document.getElementById("chatInput");
  const chatSend = document.getElementById("chatSend");
  const chatClear = document.getElementById("chatClear");

  let history = [];

  function addBubble(role, content) {

    const welcome = chatBox.querySelector('.chat-welcome');
    if (welcome) {
      welcome.remove();
    }

    const wrap = el("div", `bubble ${role}`);
    wrap.textContent = safeText(content);
    chatBox.appendChild(wrap);
    chatBox.scrollTop = chatBox.scrollHeight;
  }

  async function sendChat() {
    const msg = (chatInput.value || "").trim();
    if (!msg) return;

    chatInput.value = "";
    addBubble("user", msg);

    history.push({ role: "user", content: msg });
    history = history.slice(-12);

    addBubble("bot", "חושב...");

    try {
      const json = await postJson("/api/chat", { message: msg, history });
      chatBox.lastChild.textContent = json.result.answer;

      history.push({ role: "assistant", content: json.result.answer });
      history = history.slice(-12);
    } catch (err) {
      chatBox.lastChild.textContent = "שגיאה: " + err.message;
    }
  }

  if (chatSend) chatSend.addEventListener("click", sendChat);
  if (chatInput) {
    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        sendChat();
      }
    });
  }

  if (chatClear) {
    chatClear.addEventListener("click", () => {
      history = [];
      chatBox.innerHTML = `
        <div class="chat-welcome">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <p>התחל שיחה על ידי שליחת שאלה</p>
        </div>
      `;
    });
  }


  async function refreshStateBadge() {
    const badge = document.getElementById("kbBadge");
    if (!badge) return;

    try {
      const res = await fetch("/api/state");
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "state failed");

      const st = json.state || {};
      const hasTxt = !!st.activeTxtPath;
      const hasCsv = !!st.activeCsvPath;

      const dot = badge.querySelector('.status-dot');
      const span = badge.querySelector('span');

      // Update status text
      let statusText = '';
      if (hasTxt && hasCsv) {
        statusText = 'CSV + TXT מאומנים ומוכנים';
      } else if (hasTxt) {
        statusText = 'TXT מאומן';
      } else if (hasCsv) {
        statusText = 'CSV מאומן';
      } else {
        statusText = 'ממתין להעלאת קבצים';
      }

      if (span) span.textContent = statusText;

      if (dot) {
        if (hasTxt && hasCsv) {
          dot.style.background = '#10b981'; 
        } else if (hasTxt || hasCsv) {
          dot.style.background = '#f59e0b'; 
        } else {
          dot.style.background = '#6b7280'; 
        }
      }
    } catch (err) {
      console.error("Failed to refresh state badge:", err);
    }
  }

  refreshStateBadge();
});