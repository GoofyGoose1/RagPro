const express = require("express");
const path = require("path");
const multer = require("multer");
const fs = require("fs");
const Papa = require("papaparse");

const { trainCsvNN } = require("./src/csvModel");
const { askQuestion } = require("./src/qaBot");
const { chatAnswer } = require("./src/ragChat");
const { trainTextLSTM } = require("./src/textModel");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

function ensureArchiveDir() {
  const archiveDir = path.join(__dirname, "archive");
  if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
  return archiveDir;
}

const STATE_PATH = path.join(__dirname, "archive", "state.json");

function readState() {
  try {
    if (!fs.existsSync(STATE_PATH)) return {};
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeState(next) {
  ensureArchiveDir();
  fs.writeFileSync(STATE_PATH, JSON.stringify(next, null, 2), "utf8");
}

function saveUploadedFile(file) {
  const archiveDir = ensureArchiveDir();
  const safeName = String(file.originalname || "upload")
    .replace(/[^\p{L}\p{N}\.\-_ ]+/gu, "_")
    .slice(0, 120);
  const savedPath = path.join(archiveDir, `${Date.now()}_${safeName}`);
  fs.writeFileSync(savedPath, file.buffer);
  return savedPath;
}

function pickUploadedFile(req) {
  return (
    (req.files || []).find((f) => f.fieldname === "file") ||
    (req.files || [])[0] ||
    null
  );
}

/* -------------------- CSV inspect helper -------------------- */
function inspectCsvBuffer(buffer) {
  const text = buffer.toString("utf8");

  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  const headers = parsed.meta?.fields || [];
  const rows = Array.isArray(parsed.data) ? parsed.data : [];
  const previewRows = rows.slice(0, 5);

  const candidates = [
    "label",
    "Label",
    "class",
    "Class",
    "category",
    "Category",
    "type",
    "Type",
    "target",
    "Target",
  ];
  const suggestedLabelKey = candidates.find((c) => headers.includes(c)) || "";

  return { headers, previewRows, suggestedLabelKey };
}

/* -------------------- routes -------------------- */

app.get("/api/health", (req, res) => res.json({ ok: true, status: "up" }));

app.get("/api/state", (req, res) => {
  res.json({ ok: true, state: readState() });
});

/* ---------- CSV INSPECT (headers + preview) ---------- */
app.post("/api/inspect-csv", upload.any(), (req, res) => {
  try {
    const file = pickUploadedFile(req);
    if (!file) throw new Error('No CSV file uploaded. Expected field name "file".');

    const result = inspectCsvBuffer(file.buffer);
    res.json({ ok: true, result });
  } catch (e) {
    console.error("/api/inspect-csv error:", e);
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

/* ---------- CSV TRAIN ---------- */
app.post("/api/train-csv", upload.any(), async (req, res) => {
  try {
    const file = pickUploadedFile(req);
    if (!file) throw new Error('No CSV file uploaded. Expected field name "file".');

    const labelKey = String(req.body.labelKey || "").trim();
    if (!labelKey) throw new Error("Missing labelKey (choose a column name from /api/inspect-csv)");

    const savedPath = saveUploadedFile(file);

    const st = readState();
    writeState({ ...st, activeCsvPath: savedPath, activeCsvLabelKey: labelKey });

    const result = await trainCsvNN({ csvPath: savedPath, labelKey });

    res.json({ ok: true, result, activeCsvPath: savedPath, activeCsvLabelKey: labelKey });
  } catch (e) {
    console.error("/api/train-csv error:", e);
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

/* ---------- TXT UPLOAD AS KB (NO TRAIN) ---------- */
app.post("/api/upload-text-kb", upload.any(), (req, res) => {
  try {
    const file = pickUploadedFile(req);
    if (!file) throw new Error('No TXT file uploaded. Expected field name "file".');

    const savedPath = saveUploadedFile(file);

    const st = readState();
    writeState({ ...st, activeTxtPath: savedPath });

    res.json({
      ok: true,
      result: { message: "TXT saved as active knowledge base" },
      activeTxtPath: savedPath,
    });
  } catch (e) {
    console.error("/api/upload-text-kb error:", e);
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

/* ---------- TXT TRAIN DEMO ---------- */
app.post("/api/train-text-demo", upload.any(), async (req, res) => {
  try {
    const file = pickUploadedFile(req);
    if (!file) throw new Error('No TXT file uploaded. Expected field name "file".');

    const savedPath = saveUploadedFile(file);

    // also set as active KB
    const st = readState();
    writeState({ ...st, activeTxtPath: savedPath });

    // short demo so it doesn't hang
    const result = await trainTextLSTM({
      txtPath: savedPath,
      iterations: 80,
      seqLen: 5,
      maxVocab: 800,
      learningRate: 0.01,
    });

    res.json({ ok: true, result, activeTxtPath: savedPath });
  } catch (e) {
    console.error("/api/train-text-demo error:", e);
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

/* ---------- TXT TRAIN ---------- */
app.post("/api/train-text", upload.any(), async (req, res) => {
  try {
    const file = pickUploadedFile(req);
    if (!file) throw new Error('No TXT file uploaded. Expected field name "file".');

    const savedPath = saveUploadedFile(file);

    const st = readState();
    writeState({ ...st, activeTxtPath: savedPath });

    const result = await trainTextLSTM({
      txtPath: savedPath,
      iterations: Number(req.body.iterations) || 80,
      seqLen: Number(req.body.seqLen) || 5,
      maxVocab: Number(req.body.maxVocab) || 800,
      learningRate: Number(req.body.learningRate) || 0.01,
    });

    res.json({ ok: true, result, activeTxtPath: savedPath });
  } catch (e) {
    console.error("/api/train-text error:", e);
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

/* ---------- CHAT (RAG over TXT + CSV free search) ---------- */
app.post("/api/chat", (req, res) => {
  try {
    const { message, history } = req.body || {};
    const st = readState();

    const result = chatAnswer({
      message,
      history: Array.isArray(history) ? history : [],
      txtPath: st.activeTxtPath || null,
      csvPath: st.activeCsvPath || null,
    });

    res.json({ ok: true, result });
  } catch (e) {
    console.error("/api/chat error:", e);
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

/* ---------- QA direct (CSV rules bot) ---------- */
app.post("/api/ask", (req, res) => {
  try {
    const { question } = req.body || {};
    const st = readState();

    // fallback to bundled csv if no active
    const csvPath = st.activeCsvPath || path.join(__dirname, "archive", "languages.csv");

    const result = askQuestion({ question, csvPath });
    res.json({ ok: true, result });
  } catch (e) {
    console.error("/api/ask error:", e);
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});


app.use((req, res) => {
  res.status(404).json({ ok: false, error: `Route not found: ${req.method} ${req.originalUrl}` });
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
