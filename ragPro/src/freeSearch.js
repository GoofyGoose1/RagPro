const fs = require("fs");
const path = require("path");
const Papa = require("papaparse");

function normText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(q) {
  const t = normText(q);
  if (!t) return [];
  return t.split(" ").filter(Boolean);
}

function scoreText(text, tokens) {
  const t = normText(text);
  if (!t) return 0;
  let score = 0;
  for (const tok of tokens) {
    if (t.includes(tok)) score += 1;
  }
  return score;
}

// CSV SEARCH //
let csvCache = { absPath: null, rows: null, headers: null };

function loadCsv(csvPath) {
  const abs = path.resolve(csvPath);
  if (csvCache.absPath === abs && csvCache.rows) return csvCache;

  const csv = fs.readFileSync(abs, "utf8");
  const parsed = Papa.parse(csv, {
    header: true,
    dynamicTyping: false,
    skipEmptyLines: true,
  });

  if (parsed.errors?.length) {
    throw new Error("CSV parse error: " + JSON.stringify(parsed.errors[0]));
  }

  const headers = (parsed.meta?.fields || []).map((h) => String(h || "").trim());
  const rows = parsed.data || [];

  csvCache = { absPath: abs, rows, headers };
  return csvCache;
}

function searchCsv({ csvPath, query, topK = 5 }) {
  const { rows, headers } = loadCsv(csvPath);
  const tokens = tokenize(query);
  if (!tokens.length) return { matches: [], headers };

  const scored = rows
    .map((r, idx) => {
      const blob = headers
        .map((h) => (r[h] === undefined || r[h] === null ? "" : String(r[h])))
        .join(" ");
      const s = scoreText(blob, tokens);
      return { idx, score: s, row: r };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(50, topK)));

  return {
    headers,
    matches: scored.map((x) => ({
      score: x.score,
      row: x.row,
    })),
  };
}

// TEXT SEARCH //
let textCache = { absPath: null, chunks: null };

function chunkText(raw) {
  const paras = raw
    .split(/\n\s*\n/g)
    .map((p) => p.trim())
    .filter(Boolean);

  if (paras.length >= 5) return paras;

  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function loadText(txtPath) {
  const abs = path.resolve(txtPath);
  if (textCache.absPath === abs && textCache.chunks) return textCache;

  const raw = fs.readFileSync(abs, "utf8");
  const chunks = chunkText(raw);

  textCache = { absPath: abs, chunks };
  return textCache;
}

function searchText({ txtPath, query, topK = 5 }) {
  const { chunks } = loadText(txtPath);
  const tokens = tokenize(query);
  if (!tokens.length) return { matches: [] };

  const scored = chunks
    .map((c) => ({ chunk: c, score: scoreText(c, tokens) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(50, topK)));

  return { matches: scored };
}

module.exports = { searchCsv, searchText };
