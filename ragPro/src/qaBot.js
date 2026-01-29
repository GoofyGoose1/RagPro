const fs = require("fs");
const path = require("path");
const Papa = require("papaparse");
const { ALLOWED_FIELDS } = require("./fields");

function normalizeKey(k) {
  return String(k || "").replace(/^\uFEFF/, "").trim().toLowerCase();
}
function normText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}


let cachedRows = null;
let cachedHeaders = null;
let cachedPath = null;

function loadCsvOnce(csvPath) {
  const abs = path.resolve(csvPath);
  if (cachedRows && cachedPath === abs) return { rows: cachedRows, headers: cachedHeaders };

  const csv = fs.readFileSync(abs, "utf8");
  const parsed = Papa.parse(csv, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  });

  if (parsed.errors?.length) {
    throw new Error("CSV parse error: " + JSON.stringify(parsed.errors[0]));
  }

  const headers = (parsed.meta?.fields || []).map((h) => normalizeKey(h));
  const rows = parsed.data.map((row) => {
    const out = {};
    for (const k of Object.keys(row)) out[normalizeKey(k)] = row[k];
    out.__title_norm = normText(out.title);
    return out;
  });

  cachedRows = rows;
  cachedHeaders = headers;
  cachedPath = abs;

  return { rows, headers };
}

// best match by title //
function bestMatchByTitle(rows, name) {
  const q = normText(name);
  if (!q) return null;

  let candidates = rows.filter((r) => {
    const t = r.__title_norm || "";
    return t === q || t.includes(q) || q.includes(t);
  });

  if (!candidates.length) {
    const qTokens = new Set(q.split(" "));
    candidates = rows
      .map((r) => {
        const t = r.__title_norm || "";
        const tokens = t.split(" ");
        let score = 0;
        for (const tok of tokens) if (qTokens.has(tok)) score++;
        return { r, score };
      })
      .filter((x) => x.score >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((x) => x.r);
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const ra = safeNum(a.language_rank);
    const rb = safeNum(b.language_rank);
    const aOk = ra !== null && ra > 0;
    const bOk = rb !== null && rb > 0;
    if (aOk && !bOk) return -1;
    if (!aOk && bOk) return 1;
    if (aOk && bOk) return ra - rb;
    return 0;
  });

  return candidates[0];
}

// parse helpers //
function parseTopN(question) {
  const q = question;
  let m = q.match(/\btop\s+(\d+)\b/i);
  if (!m) m = q.match(/(\d+)\s*הכי/i);
  if (!m) return 1;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(50, n));
}
function extractQuotedName(question) {
  const m1 = question.match(/"([^"]+)"/);
  if (m1) return m1[1];
  const m2 = question.match(/'([^']+)'/);
  if (m2) return m2[1];
  return null;
}
function extractNameAfterOfOrShel(question) {
  let m = question.match(/של\s+(.+)$/);
  if (m) return m[1].trim();
  m = question.match(/\bof\s+(.+)$/i);
  if (m) return m[1].trim();
  return null;
}


function detectField(question) {
  const q = question.toLowerCase();

  const map = [
    { keys: ["rank", "דירוג", "language rank"], field: "language_rank" },
    { keys: ["stars", "כוכבים"], field: "github_repo_stars" },
    { keys: ["forks", "fork", "מזלגות"], field: "github_repo_forks" },
    { keys: ["views", "צפיות", "ויקיפדיה"], field: "wikipedia_daily_page_views" },
    { keys: ["users", "משתמשים"], field: "number_of_users" },
    { keys: ["jobs", "עבודות"], field: "number_of_jobs" },
    { keys: ["open source", "קוד פתוח", "פתוח"], field: "is_open_source" },
    { keys: ["appeared", "שנה", "הופיעה"], field: "appeared" },
    { keys: ["description", "תיאור"], field: "description" },
    { keys: ["website", "אתר"], field: "website" },
    { keys: ["type", "סוג"], field: "type" },
  ];

  for (const m of map) {
    if (m.keys.some((k) => q.includes(k))) return m;
  }
  return null;
}

function topByRank(rows, n = 1) {
  return rows
    .filter((r) => safeNum(r.language_rank) !== null && safeNum(r.language_rank) > 0 && r.title)
    .sort((a, b) => safeNum(a.language_rank) - safeNum(b.language_rank))
    .slice(0, n);
}
function topByNumeric(rows, field, n = 1) {
  return rows
    .filter((r) => safeNum(r[field]) !== null && r.title)
    .sort((a, b) => safeNum(b[field]) - safeNum(a[field]))
    .slice(0, n);
}

function helpMessage() {
  return (
    "I can answer questions using ONLY these CSV field names:\n" +
    ALLOWED_FIELDS.join(", ") +
    "\n\nExamples:\n" +
    '• "most popular language"\n' +
    '• "top 5 most popular"\n' +
    '• "github_repo_stars of \\"Python\\""\n' +
    '• "language_rank of \\"JavaScript\\""\n' +
    '• "compare \\"Python\\" and \\"Java\\""'
  );
}

// main engine //
function answerQuestion(rows, questionRaw) {
  const question = String(questionRaw || "").trim();
  const q = question.toLowerCase();

  if (!question) return { answer: helpMessage() };

  if (q.includes("fields") || q.includes("headers") || q.includes("עמודות") || q.includes("שדות")) {
    return { answer: ALLOWED_FIELDS.join(", ") };
  }

  if (q.includes("most popular") || q.includes("הכי פופולר") || q.includes("מקום ראשון")) {
    const n = parseTopN(question);
    const top = topByRank(rows, n);
    if (!top.length) return { answer: "No valid language_rank found in the CSV." };

    if (n === 1) {
      return { answer: `Most popular by language_rank: ${top[0].title} (language_rank: ${top[0].language_rank}).`, data: top[0] };
    }
    return { answer: top.map((r, i) => `${i + 1}) ${r.title} (language_rank: ${r.language_rank})`).join("\n"), data: top };
  }

  if (q.includes("most stars") || q.includes("הכי הרבה כוכבים")) {
    const n = parseTopN(question);
    const top = topByNumeric(rows, "github_repo_stars", n);
    if (!top.length) return { answer: "No valid github_repo_stars found in the CSV." };
    return { answer: top.map((r, i) => `${i + 1}) ${r.title} (github_repo_stars: ${r.github_repo_stars})`).join("\n"), data: top };
  }

  if (q.includes("most views") || q.includes("הכי הרבה צפיות")) {
    const n = parseTopN(question);
    const top = topByNumeric(rows, "wikipedia_daily_page_views", n);
    if (!top.length) return { answer: "No valid wikipedia_daily_page_views found in the CSV." };
    return { answer: top.map((r, i) => `${i + 1}) ${r.title} (wikipedia_daily_page_views: ${r.wikipedia_daily_page_views})`).join("\n"), data: top };
  }

  if (q.includes("compare") || q.includes("השווה")) {
    const quoted = question.match(/"([^"]+)"\s*(?:ו|and)\s*"([^"]+)"/i);
    let a = null, b = null;
    if (quoted) {
      a = quoted[1];
      b = quoted[2];
    } else {
      const m = question.match(/בין\s+(.+?)\s*(?:ו|and)\s*(.+)$/i);
      if (m) {
        a = m[1].trim();
        b = m[2].trim();
      }
    }

    if (!a || !b) return { answer: 'To compare, write: compare "Python" and "Java"' };

    const ra = bestMatchByTitle(rows, a);
    const rb = bestMatchByTitle(rows, b);
    if (!ra || !rb) return { answer: "Could not find one of the languages. Try quotes like \"C#\"." };

    return {
      answer:
        `Compare: ${ra.title} vs ${rb.title}\n` +
        `language_rank: ${ra.language_rank ?? "N/A"} vs ${rb.language_rank ?? "N/A"}\n` +
        `github_repo_stars: ${ra.github_repo_stars ?? "N/A"} vs ${rb.github_repo_stars ?? "N/A"}\n` +
        `wikipedia_daily_page_views: ${ra.wikipedia_daily_page_views ?? "N/A"} vs ${rb.wikipedia_daily_page_views ?? "N/A"}\n` +
        `number_of_users: ${ra.number_of_users ?? "N/A"} vs ${rb.number_of_users ?? "N/A"}\n` +
        `number_of_jobs: ${ra.number_of_jobs ?? "N/A"} vs ${rb.number_of_jobs ?? "N/A"}`,
      data: { a: ra, b: rb },
    };
  }

  const field = detectField(question);
  const name = extractQuotedName(question) || extractNameAfterOfOrShel(question);

  if (field && name) {
    if (!ALLOWED_FIELDS.includes(field.field)) {
      return { answer: `Field not allowed: ${field.field}\n\n${helpMessage()}` };
    }

    const row = bestMatchByTitle(rows, name);
    if (!row) return { answer: `Language not found: "${name}". Try English name like "JavaScript".` };

    const val = row[field.field];

    if (field.field === "is_open_source") {
      return { answer: `${row.title} — is_open_source: ${val ? "true" : "false"}`, data: row };
    }

    if (val === undefined || val === null || val === "") {
      return { answer: `${row.title} — ${field.field}: N/A`, data: row };
    }

    return { answer: `${row.title} — ${field.field}: ${val}`, data: row };
  }

  return { answer: helpMessage() };
}

/** public API */
function askQuestion({ question, csvPath }) {
  const { rows } = loadCsvOnce(csvPath);
  return answerQuestion(rows, question);
}

function getAllowedFields() {
  return ALLOWED_FIELDS;
}

module.exports = { askQuestion, getAllowedFields };
