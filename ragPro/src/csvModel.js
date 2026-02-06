const fs = require("fs");
const Papa = require("papaparse");
const brain = require("brain.js");
const { splitTVT, minMaxFit, minMaxTransformRow } = require("./preprocess");
const { ALLOWED_FIELDS } = require("./fields");

function normalizeKey(k) {
  return String(k || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase();
}

function loadCsvNormalized(filePath) {
  const csv = fs.readFileSync(filePath, "utf8");
  const parsed = Papa.parse(csv, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  });

  if (parsed.errors?.length) {
    throw new Error("CSV parse error: " + JSON.stringify(parsed.errors[0]));
  }

  const rows = parsed.data.map((row) => {
    const out = {};
    for (const k of Object.keys(row)) out[normalizeKey(k)] = row[k];
    return out;
  });

  const headers = (parsed.meta?.fields || []).map((h) => normalizeKey(h));
  return { rows, headers };
}

function guessNumericKeys(rows) {
  const keys = Object.keys(rows[0] || {});
  return keys.filter((k) => rows.some((r) => Number.isFinite(Number(r[k]))));
}

function fitMinMaxLabel(rows, labelKey) {
  let mn = Infinity;
  let mx = -Infinity;

  for (const r of rows) {
    const v = Number(r[labelKey]);
    if (!Number.isFinite(v)) continue;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }

  if (!Number.isFinite(mn) || !Number.isFinite(mx) || mn === mx) {
    mn = 0;
    mx = 1;
  }

  return { mn, mx };
}

function normLabel(v, fit) {
  const x = Number(v);
  if (!Number.isFinite(x)) return 0;
  if (fit.mn === fit.mx) return 0;
  return (x - fit.mn) / (fit.mx - fit.mn);
}

function denormLabel(yNorm, fit) {
  return yNorm * (fit.mx - fit.mn) + fit.mn;
}

function mseOriginalScale(net, data, labelFit) {
  let sum = 0;
  for (const item of data) {
    const pred = net.run(item.input);
    const yHat = denormLabel(Number(pred.y), labelFit);
    const y = denormLabel(Number(item.output.y), labelFit);
    const e = yHat - y;
    sum += e * e;
  }
  return data.length ? sum / data.length : 0;
}

function maeOriginalScale(net, data, labelFit) {
  let sum = 0;
  for (const item of data) {
    const pred = net.run(item.input);
    const yHat = denormLabel(Number(pred.y), labelFit);
    const y = denormLabel(Number(item.output.y), labelFit);
    sum += Math.abs(yHat - y);
  }
  return data.length ? sum / data.length : 0;
}

function samplePredictions(net, data, labelFit, n = 5) {
  const out = [];

  for (let i = 0; i < Math.min(n, data.length); i++) {
    const item = data[i];

    const pred = net.run(item.input);
    const yHat = denormLabel(Number(pred.y), labelFit);
    const y = denormLabel(Number(item.output.y), labelFit);

    const error = Math.abs(y - yHat);
    const errorPercent = y !== 0
      ? (error / Math.abs(y)) * 100
      : 0;

    out.push({
      actual: y,
      predicted: yHat,
      error,
      errorPercent
    });
  }

  return out;
}


async function trainCsvNN({
  csvPath,
  labelKey,
  hiddenLayers = [16, 16],
  iterations = 1200,
  learningRate = 0.01,
}) {
  const { rows, headers } = loadCsvNormalized(csvPath);
  if (!rows.length) throw new Error("Empty CSV");

  const normalizedLabelKey = normalizeKey(labelKey);

  // enforce: labelKey must be in allowed list
  if (!ALLOWED_FIELDS.includes(normalizedLabelKey)) {
    throw new Error(
      `labelKey "${labelKey}" is not allowed.\nAllowed:\n` + ALLOWED_FIELDS.join(", ")
    );
  }

  // enforce: labelKey must exist in CSV
  if (!headers.includes(normalizedLabelKey)) {
    throw new Error(
      `labelKey "${labelKey}" not found in CSV headers.\nCSV headers:\n` +
        headers.join(", ")
    );
  }

  // Keep only rows with valid numeric label
  const filtered = rows.filter((r) => Number.isFinite(Number(r[normalizedLabelKey])));
  if (filtered.length < 10) throw new Error("Not enough valid rows with numeric label to train.");

  // Numeric columns
  const numericKeys = guessNumericKeys(filtered);

  // Features = numeric except label AND allowed
  const featureKeys = numericKeys
    .filter((k) => k !== normalizedLabelKey)
    .filter((k) => ALLOWED_FIELDS.includes(k));

  if (!featureKeys.length) {
    throw new Error("No numeric feature columns found (after allowed-fields filtering).");
  }

  // Split
  const { train, val, test } = splitTVT(filtered, 0.7, 0.15);

  // Fit scalers
  const featureFit = minMaxFit(train, featureKeys);
  const labelFit = fitMinMaxLabel(train, normalizedLabelKey);
  const labelSpan = Math.max(1e-9, labelFit.mx - labelFit.mn);

  const toItem = (r) => ({
    input: minMaxTransformRow(r, featureKeys, featureFit),
    output: { y: normLabel(r[normalizedLabelKey], labelFit) },
  });

  const trainData = train.map(toItem);
  const valData = val.map(toItem);
  const testData = test.map(toItem);

  const net = new brain.NeuralNetwork({
    hiddenLayers,
    learningRate,
    activation: "sigmoid",
  });

  const trainLog = [];
  net.train(trainData, {
    iterations,
    log: (s) => trainLog.push(s),
    logPeriod: 50,
    errorThresh: 0.002,
  });

  return {
    availableFields: ALLOWED_FIELDS,
    labelKey: normalizedLabelKey,
    labelRange: { min: labelFit.mn, max: labelFit.mx },
    usedFeatureKeys: featureKeys,
    config: { hiddenLayers, iterations, learningRate },
    metrics: {
      valMSE: mseOriginalScale(net, valData, labelFit),
      testMSE: mseOriginalScale(net, testData, labelFit),
      valMAE: maeOriginalScale(net, valData, labelFit),
      testMAE: maeOriginalScale(net, testData, labelFit),
      valMAE_percent: (maeOriginalScale(net, valData, labelFit) / labelSpan) * 100,
      testMAE_percent: (maeOriginalScale(net, testData, labelFit) / labelSpan) * 100,
    },
    examples: {
      val: samplePredictions(net, valData, labelFit, 5),
      test: samplePredictions(net, testData, labelFit, 5),
    },
    trainLog,
  };
}

module.exports = { trainCsvNN, ALLOWED_FIELDS };
