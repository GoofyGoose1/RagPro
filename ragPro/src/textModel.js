const fs = require("fs");
const brain = require("brain.js");
const { splitTVT, cleanTextBasic } = require("./preprocess");

function tokenize(text) {
  const cleaned = cleanTextBasic(text);
  if (!cleaned) return [];
  return cleaned.split(" ").filter(Boolean);
}

function buildVocab(tokens, maxVocab = 3000) {
  const freq = new Map();
  for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);

  const sorted = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxVocab);

  const vocab = sorted.map(([w]) => w);
  const index = new Map(vocab.map((w, i) => [w, i]));
  return { vocab, index };
}

function wordToScalar(word, vocabIndex, vocabSize) {
  const i = vocabIndex.has(word) ? vocabIndex.get(word) : 0;
  return vocabSize <= 1 ? 0 : i / (vocabSize - 1);
}

function makeSequences(tokens, seqLen = 6) {
  const seqs = [];
  for (let i = 0; i + seqLen < tokens.length; i++) {
    const inp = tokens.slice(i, i + seqLen);
    const out = tokens[i + seqLen];
    seqs.push({ inp, out });
  }
  return seqs;
}

function scalarToWord(s, vocab) {
  if (!vocab.length) return "";
  const i = Math.max(0, Math.min(vocab.length - 1, Math.round(s * (vocab.length - 1))));
  return vocab[i];
}

function evalNextWord(model, data, vocab) {
  let correct = 0;
  for (const ex of data) {
    const predScalar = model.run(ex.inputScalars);
    const predWord = scalarToWord(Number(predScalar), vocab);
    if (predWord === ex.trueWord) correct++;
  }
  return data.length ? correct / data.length : 0;
}

async function trainTextLSTM({
  txtPath,
  seqLen = 6,
  iterations = 800,
  learningRate = 0.01,
  maxVocab = 3000
}) {
  const raw = fs.readFileSync(txtPath, "utf8");
  const tokens = tokenize(raw);
  if (tokens.length < seqLen + 10) throw new Error("Text too short for training");

  const { vocab, index } = buildVocab(tokens, maxVocab);
  const examples = makeSequences(tokens, seqLen);
  const { train, val, test } = splitTVT(examples, 0.7, 0.15);

  const trainData = train.map(ex =>
    ex.inp.map(w => wordToScalar(w, index, vocab.length))
  );

  const lstm = new brain.recurrent.LSTMTimeStep({
    learningRate,
    hiddenLayers: [32, 32],
    outputSize: 1,
    inputSize: 1
  });

  const trainLog = [];
  lstm.train(trainData, {
    iterations,
    log: (s) => trainLog.push(s),
    logPeriod: 50,
    errorThresh: 0.01
  });

  const toEval = (arr) => arr.map(ex => ({
    inputScalars: ex.inp.map(w => wordToScalar(w, index, vocab.length)),
    trueWord: ex.out
  })).slice(0, 300);

  const valAcc = evalNextWord(lstm, toEval(val), vocab);
  const testAcc = evalNextWord(lstm, toEval(test), vocab);

  // sample generation
  const seedWords = tokens.slice(0, seqLen);
  let currentSeq = seedWords.map(w => wordToScalar(w, index, vocab.length));

  const generated = seedWords.slice();
  for (let i = 0; i < 25; i++) {
    const nextScalar = lstm.run(currentSeq.slice(-seqLen));
    const nextWord = scalarToWord(Number(nextScalar), vocab);
    generated.push(nextWord);
    currentSeq.push(wordToScalar(nextWord, index, vocab.length));
  }

  return {
    vocabSize: vocab.length,
    config: { seqLen, iterations, learningRate, maxVocab },
    metrics: { valAcc, testAcc },
    sample: generated.join(" "),
    trainLog
  };
}

module.exports = { trainTextLSTM };
