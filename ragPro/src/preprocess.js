function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function splitTVT(arr, trainRatio = 0.7, valRatio = 0.15) {
  const copy = arr.slice();
  shuffleInPlace(copy);
  const n = copy.length;
  const nTrain = Math.max(1, Math.floor(n * trainRatio));
  const nVal = Math.max(1, Math.floor(n * valRatio));
  const train = copy.slice(0, nTrain);
  const val = copy.slice(nTrain, nTrain + nVal);
  const test = copy.slice(nTrain + nVal);
  return { train, val, test };
}

function minMaxFit(rows, featureKeys) {
  const min = {};
  const max = {};
  for (const k of featureKeys) {
    min[k] = Infinity;
    max[k] = -Infinity;
  }
  for (const r of rows) {
    for (const k of featureKeys) {
      const v = Number(r[k]);
      if (!Number.isFinite(v)) continue;
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

function minMaxTransformRow(row, featureKeys, fit) {
  const out = {};
  for (const k of featureKeys) {
    const v = Number(row[k]);
    const a = fit.min[k], b = fit.max[k];
    if (!Number.isFinite(v) || !Number.isFinite(a) || !Number.isFinite(b) || a === b) out[k] = 0;
    else out[k] = (v - a) / (b - a);
  }
  return out;
}

function cleanTextBasic(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = { splitTVT, minMaxFit, minMaxTransformRow, cleanTextBasic };
