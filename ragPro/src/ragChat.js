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

function formatCsvMatch(row, headers) {
  const pickAny = (keys) => {
    for (const k of keys) {
      if (row && row[k] !== undefined && row[k] !== null && row[k] !== "") return row[k];
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
    const preview = previewKeys
      .map((h) => `${h}: ${row[h] ?? ""}`)
      .join(" | ");
    lines.push(`  - preview: ${preview}`);
  }

  return lines.join("\n");
}

function chatAnswer({ message, history = [], txtPath, csvPath }) {
  const msg = normalize(message);
  if (!msg) return { answer: "כתוב הודעה 🙂", sources: [] };

  const sources = [];
  let qaAnswer = null;

  if (csvPath && looksLikeCsvRuleQuestion(msg)) {
    try {
      const qa = askQuestion({ question: msg, csvPath });
      if (qa?.answer && !isHelpLike(qa.answer)) {
        qaAnswer = qa.answer;
        sources.push({ type: "csv_rules", note: "Answered by qaBot CSV rules" });
      }
    } catch {
      
    }
  }

  let textMatches = [];
  if (txtPath) {
    try {
      const t = searchText({ txtPath, query: msg, topK: 5 });
      textMatches = (t.matches || []).slice(0, 5);
      if (textMatches.length) sources.push({ type: "txt", path: txtPath, count: textMatches.length });
    } catch {
      textMatches = [];
    }
  }

  let csvMatches = [];
  let csvHeaders = [];
  if (csvPath) {
    try {
      const c = searchCsv({ csvPath, query: msg, topK: 3 });
      csvHeaders = c.headers || [];
      csvMatches = (c.matches || []).slice(0, 3);
      if (csvMatches.length) sources.push({ type: "csv", path: csvPath, count: csvMatches.length });
    } catch {
      csvMatches = [];
    }
  }

  if (qaAnswer && !textMatches.length && !csvMatches.length) {
    return { answer: qaAnswer, sources };
  }


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


  const parts = [];

  if (qaAnswer) {
    parts.push("✅ תשובה לפי כללי CSV (qaBot):");
    parts.push(qaAnswer);
  }

  if (textMatches.length || csvMatches.length) {
    parts.push("\n🔎 מצאתי גם התאמות בקבצים שלך:");

    if (textMatches.length) {
      parts.push("\n📄 מתוך TXT (קטעים תואמים):");
      textMatches.forEach((m, i) => {
        const chunk = String(m.chunk || "").trim();
        parts.push(`(${i + 1}) ${chunk}`);
      });
    }

    if (csvMatches.length) {
      parts.push("\n📊 מתוך CSV (שורות תואמות):");
      csvMatches.forEach((m, i) => {
        parts.push(`(${i + 1})\n${formatCsvMatch(m.row, csvHeaders)}\n`);
      });
    }
  }

  return { answer: parts.join("\n"), sources };
}

module.exports = { chatAnswer };
