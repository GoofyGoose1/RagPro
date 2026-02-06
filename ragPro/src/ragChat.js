const { searchText, searchCsv } = require("./freeSearch");
const { askQuestion } = require("./qaBot");

function normalize(s) {
  return String(s || "").trim();
}

function isHelpLike(ans) {
  const a = String(ans || "").toLowerCase();
  return a.includes("i can answer questions using only these csv field names");
}

function looksLikeCsvRuleQuestion(msg) {
  const q = String(msg || "").toLowerCase();

  const triggers = [
    "most popular",
    "most stars",
    "most views",
    "compare",
    "top ",
    " language_rank",
    " github_repo_stars",
    " github_repo_forks",
    " wikipedia_daily_page_views",
    " number_of_users",
    " number_of_jobs",
    " is_open_source",
    " of ",
    "של ",
    "השווה",
    "הכי",
  ];

  const textIntent = [
    "from the text",
    "from txt",
    "in the txt",
    "summarize",
    "סכם",
    "מתוך",
    "בטקסט",
    "קובץ txt",
  ];
  if (textIntent.some((t) => q.includes(t))) return false;

  return triggers.some((t) => q.includes(t));
}

/* --------------------- DEDUPE + STABILITY --------------------- */
function stableKey(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeTextMatches(matches, max = 2) {
  const seen = new Set();
  const out = [];
  for (const m of matches || []) {
    const chunk = String(m.chunk || "").trim();
    if (!chunk) continue;
    const k = stableKey(chunk.slice(0, 240));
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m);
    if (out.length >= max) break;
  }
  return out;
}

function dedupeCsvMatches(matches, headers, max = 2) {
  const seen = new Set();
  const out = [];
  for (const m of matches || []) {
    const row = m.row || {};
    // use title-like field if exists; else fallback to first headers
    const title = String(row.title || row.Title || "").trim();
    const fallback = headers?.length
      ? headers.slice(0, 5).map((h) => `${h}:${row[h] ?? ""}`).join("|")
      : JSON.stringify(row).slice(0, 240);

    const k = stableKey(title || fallback);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m);
    if (out.length >= max) break;
  }
  return out;
}

function wantsFullSources(msg) {
  const q = stableKey(msg);
  return (
    q === "הצג מקורות" ||
    q === "מקורות" ||
    q === "show sources" ||
    q === "sources" ||
    q === "more" ||
    q === "more details" ||
    q === "פרט" ||
    q === "תפרט"
  );
}

/* --------------------- CSV formatting --------------------- */
function formatCsvMatch(row, headers) {
  const pickAny = (keys) => {
    for (const k of keys) {
      if (row && row[k] !== undefined && row[k] !== null && row[k] !== "")
        return row[k];
    }
    return null;
  };

  const title = pickAny(["title", "Title"]) || "Unknown";
  const desc = pickAny(["description", "Description"]);
  const rank = pickAny(["language_rank"]);
  const stars = pickAny(["github_repo_stars"]);
  const views = pickAny(["wikipedia_daily_page_views"]);
  const users = pickAny(["number_of_users"]);

  const lines = [];
  lines.push(`• ${title}`);
  if (rank !== null) lines.push(`  - language_rank: ${rank}`);
  if (stars !== null) lines.push(`  - github_repo_stars: ${stars}`);
  if (views !== null) lines.push(`  - wikipedia_daily_page_views: ${views}`);
  if (users !== null) lines.push(`  - number_of_users: ${users}`);
  if (desc) {
    const d = String(desc);
    lines.push(`  - description: ${d.slice(0, 180)}${d.length > 180 ? "..." : ""}`);
  }

  if (lines.length === 1 && headers?.length) {
    const previewKeys = headers.slice(0, 6);
    const preview = previewKeys.map((h) => `${h}: ${row[h] ?? ""}`).join(" | ");
    lines.push(`  - preview: ${preview}`);
  }

  return lines.join("\n");
}

/* --------------------- MAIN --------------------- */
function chatAnswer({ message, history = [], txtPath, csvPath }) {
  const msg = normalize(message);
  if (!msg) return { answer: "כתוב הודעה 🙂", sources: [] };

  const fullMode = wantsFullSources(msg);
  const sources = [];

  let qaAnswer = null;

  if (csvPath && looksLikeCsvRuleQuestion(msg)) {
    try {
      const qa = askQuestion({ question: msg, csvPath });
      if (qa?.answer && !isHelpLike(qa.answer)) {
        qaAnswer = String(qa.answer).trim();
        sources.push({ type: "csv_rules", note: "Answered by qaBot CSV rules" });
      }
    } catch {
    }
  }

  // Search TXT
  let textMatches = [];
  if (txtPath) {
    try {
      const t = searchText({ txtPath, query: msg, topK: 8 });
      textMatches = dedupeTextMatches(t.matches || [], fullMode ? 5 : 2);
      if (textMatches.length)
        sources.push({ type: "txt", path: txtPath, count: textMatches.length });
    } catch {
      textMatches = [];
    }
  }

  // Search CSV
  let csvMatches = [];
  let csvHeaders = [];
  if (csvPath) {
    try {
      const c = searchCsv({ csvPath, query: msg, topK: 8 });
      csvHeaders = c.headers || [];
      csvMatches = dedupeCsvMatches(c.matches || [], csvHeaders, fullMode ? 4 : 2);
      if (csvMatches.length)
        sources.push({ type: "csv", path: csvPath, count: csvMatches.length });
    } catch {
      csvMatches = [];
    }
  }

  // If Nothing found
  if (!qaAnswer && !textMatches.length && !csvMatches.length) {
    const hints = [];
    if (!txtPath) hints.push("• העלה קובץ TXT כדי שאענה ממנו.");
    if (!csvPath) hints.push("• העלה קובץ CSV כדי שאוכל גם לחפש בו.");
    return {
      answer:
        "לא מצאתי מידע רלוונטי בקבצים הפעילים.\n" +
        (hints.length ? "\nכדי שזה יעבוד:\n" + hints.join("\n") : ""),
      sources: [],
    };
  }

  // If only QA answer and no matches, return it (short)
  if (qaAnswer && !textMatches.length && !csvMatches.length) {
    return { answer: qaAnswer, sources };
  }

  if (fullMode) {
    const parts = [];

    if (qaAnswer) {
      parts.push("תשובה לפי כללי CSV (qaBot):");
      parts.push(qaAnswer);
    }

    parts.push("\n התאמות בקבצים:");

    if (textMatches.length) {
      parts.push("\n TXT (קטעים תואמים):");
      textMatches.forEach((m, i) => {
        const chunk = String(m.chunk || "").trim();
        parts.push(`(${i + 1}) ${chunk}`);
      });
    }

    if (csvMatches.length) {
      parts.push("\n CSV (שורות תואמות):");
      csvMatches.forEach((m, i) => {
        parts.push(`(${i + 1})\n${formatCsvMatch(m.row, csvHeaders)}\n`);
      });
    }

    return { answer: parts.join("\n"), sources };
  }

  const parts = [];

  if (qaAnswer) {
    parts.push(qaAnswer);
  } else if (textMatches.length) {
    // otherwise: first TXT match
    const chunk = String(textMatches[0].chunk || "").trim();
    parts.push(chunk.slice(0, 520) + (chunk.length > 520 ? "..." : ""));
  } else if (csvMatches.length) {
    // otherwise: first CSV match
    parts.push(formatCsvMatch(csvMatches[0].row, csvHeaders));
  }

  const moreTxt = Math.max(0, textMatches.length - (qaAnswer ? 0 : 1)); 
  const moreCsv = Math.max(0, csvMatches.length - (qaAnswer || textMatches.length ? 0 : 1));

  const extras = [];
  if (moreTxt > 0) extras.push(`TXT: עוד ${moreTxt}`);
  if (moreCsv > 0) extras.push(`CSV: עוד ${moreCsv}`);
  if (qaAnswer && (textMatches.length || csvMatches.length)) extras.push("יש גם התאמות בקבצים");

  if (extras.length) {
    parts.push(`\nℹ️ ${extras.join(" | ")}. כתוב "הצג מקורות" כדי לראות הכל.`);
  }

  return { answer: parts.join("\n"), sources };
}

module.exports = { chatAnswer };
