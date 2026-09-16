const express = require('express');
const axios = require('axios');
const path = require('path');
const app = express();

app.use(express.json());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============ LEAGUE STRENGTH TABLES (for fallback model only) ============
function leagueXg(leagueName) {
  const name = (leagueName || "").toLowerCase();
  if (name.includes("premier league")) return 3.0;
  if (name.includes("la liga")) return 2.6;
  if (name.includes("bundesliga")) return 3.2;
  if (name.includes("serie a")) return 2.7;
  if (name.includes("ligue 1")) return 2.7;
  if (name.includes("champions league")) return 3.0;
  if (name.includes("europa")) return 2.9;
  if (name.includes("conference")) return 2.9;
  if (name.includes("mls")) return 3.2;
  if (name.includes("liga mx")) return 3.0;
  if (name.includes("brasileir")) return 2.4;
  if (name.includes("argentina")) return 2.2;
  if (name.includes("colombia")) return 2.1;
  if (name.includes("chile")) return 2.3;
  if (name.includes("libertadores")) return 2.2;
  if (name.includes("sudamericana")) return 2.1;
  if (name.includes("championship")) return 2.6;
  if (name.includes("japan") || name.includes("korea")) return 2.7;
  if (name.includes("nigeria") || name.includes("egypt") || name.includes("tunisia")) return 2.4;
  if (name.includes("bulgaria")) return 2.3;
  if (name.includes("girabola") || name.includes("angola")) return 2.2;
  if (name.includes("copa")) return 2.3;
  if (name.includes("cup")) return 2.7;
  return 2.5;
}

function leagueDraw(leagueName) {
  const name = (leagueName || "").toLowerCase();
  if (name.includes("ligue 1")) return 0.30;
  if (name.includes("serie a")) return 0.28;
  if (name.includes("argentina")) return 0.35;
  if (name.includes("colombia")) return 0.34;
  if (name.includes("chile")) return 0.32;
  if (name.includes("libertadores")) return 0.36;
  if (name.includes("sudamericana")) return 0.36;
  if (name.includes("copa")) return 0.32;
  if (name.includes("mls")) return 0.22;
  if (name.includes("bundesliga")) return 0.24;
  if (name.includes("premier league")) return 0.24;
  return 0.27;
}

function getTeamName(team) {
  if (!team) return "Unknown";
  if (typeof team === 'string') return team;
  if (team.name) return team.name;
  return "Unknown";
}

// Normalize: strip accents, lowercase, keep letters/numbers/spaces
function normalizeName(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Remove common prefixes/suffixes to find the "core" name
function coreName(name) {
  const stop = ["fc", "sc", "cf", "ac", "afc", "the", "and", "city", "club",
                "united", "de", "do", "da", "aif", "if", "sk", "cd", "cs", "us", "as", "cd",
                "sportif", "sportive", "clube", "sport", "sportivo", "sporting",
                "atletico", "athletic", "atlantico"];
  const words = normalizeName(name).split(" ").filter(function(w) {
    return w.length > 2 && stop.indexOf(w) === -1;
  });
  return words.join(" ");
}

// Get the most distinctive keyword (usually the last long word)
function distinctiveKeyword(name) {
  const core = coreName(name);
  const words = core.split(" ").filter(function(w) { return w.length > 3; });
  if (words.length > 0) return words[words.length - 1];
  return core || normalizeName(name);
}

// ============ EXTRACT THE AI PREDICTION LINE ============
// Find the text that starts with "Prediction:" and extract the bolded prediction
function extractPredictionLine(aiText) {
  if (!aiText) return null;
  // Match "Prediction:" followed by optional whitespace/newlines, then *text*
  const patterns = [
    /Prediction:\s*\n*\s*\\([^]+?)\\*/i,
    /Prediction:\s*\\([^]+?)\\*/i,
    /Prediction:\s*\n*\s*([^\n]+?)(?:\n|$)/i
  ];
  for (let i = 0; i < patterns.length; i++) {
    const m = aiText.match(patterns[i]);
    if (m && m[1] && m[1].trim().length > 3) {
      return m[1].trim();
    }
  }
  return null;
}

// ============ PARSE THE PREDICTED SCORE ============
// Returns { firstTeamText, firstScore, secondScore, secondTeamText }
function parsePredictionScore(predictionLine) {
  if (!predictionLine) return null;

  // Look for "X-Y" or "X – Y" or "X — Y" or "X:Y" between 0-9 on each side
  const scorePatterns = [
    /(\d+)\s*[-–—]\s*(\d+)/,
    /(\d+)\s*:\s*(\d+)/
  ];

  for (let i = 0; i < scorePatterns.length; i++) {
    const m = predictionLine.match(scorePatterns[i]);
    if (m) {
      const firstScore = parseInt(m[1]);
      const secondScore = parseInt(m[2]);

      // Everything before the score
      const beforeScore = predictionLine.substring(0, m.index).trim();
      // Everything after the score
      const afterScore = predictionLine.substring(m.index + m[0].length).trim();

      // Clean up the "after" text (remove periods)
      const afterClean = afterScore.replace(/^[.\s]+|[.\s]+$/g, "");

      return {
        firstTeamText: beforeScore,
        firstScore: firstScore,
        secondScore: secondScore,
        secondTeamText: afterClean
      };
    }
  }
  return null;
}

// ============ MATCH AI TEAM TEXT TO HOME OR AWAY ============
// Returns "HOME", "AWAY", or null
function matchTeamText(teamText, homeName, awayName) {
  if (!teamText || teamText.length < 2) return null;
  const textNorm = normalizeName(teamText);

  const homeCore = coreName(homeName);
  const awayCore = coreName(awayName);
  const homeKey = distinctiveKeyword(homeName);
  const awayKey = distinctiveKeyword(awayName);

  // Full core match
  const homeCoreMatch = homeCore.length > 2 && textNorm.indexOf(homeCore) !== -1;
  const awayCoreMatch = awayCore.length > 2 && textNorm.indexOf(awayCore) !== -1;

  if (homeCoreMatch && !awayCoreMatch) return "HOME";
  if (awayCoreMatch && !homeCoreMatch) return "AWAY";

  // Keyword match (unique last word)
  const homeKeyMatch = homeKey && textNorm.indexOf(homeKey) !== -1;
  const awayKeyMatch = awayKey && textNorm.indexOf(awayKey) !== -1;

  if (homeKeyMatch && !awayKeyMatch) return "HOME";
  if (awayKeyMatch && !homeKeyMatch) return "AWAY";

  // Both matched (like "Sofia" shared) — try full name fallback
  const homeFullMatch = textNorm.indexOf(normalizeName(homeName)) !== -1;
  const awayFullMatch = textNorm.indexOf(normalizeName(awayName)) !== -1;

  if (homeFullMatch && !awayFullMatch) return "HOME";
  if (awayFullMatch && !homeFullMatch) return "AWAY";

  // Ambiguous → return null
  return null;
}

// ============ THE MAIN AI PREDICTION PARSER ============
// Returns { predictedHomeScore, predictedAwayScore, predictedWinner, source }
function parseAIPrediction(aiText, homeTeam, awayTeam) {
  if (!aiText) return null;

  const homeName = getTeamName(homeTeam);
  const awayName = getTeamName(awayTeam);

  // STEP 1: Extract the explicit Prediction line
  const predictionLine = extractPredictionLine(aiText);
  if (!predictionLine) {
    return null; // No explicit prediction → no override
  }

  // STEP 2: Parse the score
  const parsed = parsePredictionScore(predictionLine);
  if (!parsed) {
    return null; // No score found → no override
  }

  // STEP 3: Match first team to HOME or AWAY
  const firstTeamSide = matchTeamText(parsed.firstTeamText, homeName, awayName);
  const secondTeamSide = matchTeamText(parsed.secondTeamText, homeName, awayName);

  let predictedHomeScore = null;
  let predictedAwayScore = null;
  let predictedWinner = null;

  if (firstTeamSide === "HOME") {
    predictedHomeScore = parsed.firstScore;
    predictedAwayScore = parsed.secondScore;
  } else if (firstTeamSide === "AWAY") {
    predictedAwayScore = parsed.firstScore;
    predictedHomeScore = parsed.secondScore;
  } else if (secondTeamSide === "HOME") {
    // First team unrecognized, but second team = HOME
    predictedHomeScore = parsed.secondScore;
    predictedAwayScore = parsed.firstScore;
  } else if (secondTeamSide === "AWAY") {
    // First team unrecognized, but second team = AWAY
    predictedAwayScore = parsed.secondScore;
    predictedHomeScore = parsed.firstScore;
  } else {
    // Could not match either team → no override
    return null;
  }

  // STEP 4: Determine winner
  if (predictedHomeScore > predictedAwayScore) predictedWinner = "HOME";
  else if (predictedAwayScore > predictedHomeScore) predictedWinner = "AWAY";
  else predictedWinner = "DRAW";

  return {
    predictedHomeScore: predictedHomeScore,
    predictedAwayScore: predictedAwayScore,
    predictedWinner: predictedWinner,
    predictionLine: predictionLine,
    source: "ai_prediction"
  };
}

// ============ ANALYZE A MATCH ============
function analyzeMatch(match) {
  const homeTeamName = getTeamName(match.home_team);
  const awayTeamName = getTeamName(match.away_team);

  let leagueName = "Unknown Competition";
  if (match.league && match.league.name) leagueName = match.league.name;
  else if (match.league_name) leagueName = match.league_name;

  const baseXg = leagueXg(leagueName);
  const drawFactor = leagueDraw(leagueName);

  // Model estimate — clearly labeled, not "real xG"
  let homeXg = baseXg * 0.55;
  let awayXg = baseXg * 0.45;
  homeXg *= 1.12; // small home advantage

  const hasScore = match.home_score !== null && match.home_score !== undefined && match.home_score !== "";
  const status = match.status || "unknown";
  const isPlayed = status === 'finished' || status === 'live' || status === 'inprogress' ||
                   status === '2nd_half' || status === '1st_half' || status === 'halftime';

  if (hasScore && isPlayed) {
    const actualH = parseInt(match.home_score) || 0;
    const actualA = parseInt(match.away_score) || 0;
    homeXg = (homeXg * 0.3) + (actualH * 0.7);
    awayXg = (awayXg * 0.3) + (actualA * 0.7);
  }

  homeXg = Math.max(0.5, Math.min(4.0, homeXg));
  awayXg = Math.max(0.4, Math.min(3.8, awayXg));
  const totalXg = homeXg + awayXg;

  // Base probabilities (model estimate)
  const diff = homeXg - awayXg;
  let homeWinProb = Math.max(15, Math.min(70, Math.round(45 + (diff * 12))));
  let awayWinProb = Math.max(15, Math.min(70, Math.round(30 - (diff * 12))));
  let drawProb = Math.round(drawFactor * 100);
  drawProb = Math.max(15, Math.min(35, drawProb));

  let aiPreview = "";
  if (match.ai_preview && match.ai_preview.text) aiPreview = match.ai_preview.text;

  // Try to parse the AI prediction
  let aiPrediction = null;
  if (aiPreview) {
    aiPrediction = parseAIPrediction(aiPreview, match.home_team, match.away_team);
  }

  // Override probabilities if we have a valid AI prediction
  if (aiPrediction && aiPrediction.predictedWinner === "HOME") {
    homeWinProb = 58;
    drawProb = 24;
    awayWinProb = 18;
  } else if (aiPrediction && aiPrediction.predictedWinner === "AWAY") {
    awayWinProb = 58;
    drawProb = 24;
    homeWinProb = 18;
  } else if (aiPrediction && aiPrediction.predictedWinner === "DRAW") {
    drawProb = 38;
    homeWinProb = 31;
    awayWinProb = 31;
  }

  // Normalize to 100
  const totalP = homeWinProb + awayWinProb + drawProb;
  homeWinProb = Math.round((homeWinProb / totalP) * 100);
  awayWinProb = Math.round((awayWinProb / totalP) * 100);
  drawProb = 100 - homeWinProb - awayWinProb;

  // Goals markets (from model estimate)
  function factorial(n) { return n <= 1 ? 1 : n * factorial(n - 1); }
  function poissonUnder(k, lambda) {
    let sum = 0;
    for (let i = 0; i <= k; i++) sum += Math.exp(-lambda) * Math.pow(lambda, i) / factorial(i);
    return Math.min(99, Math.max(1, sum * 100));
  }
  const under15 = Math.round(poissonUnder(1, totalXg));
  const under25 = Math.round(poissonUnder(2, totalXg));
  const under35 = Math.round(poissonUnder(3, totalXg));
  const under45 = Math.round(poissonUnder(4, totalXg));

  const homeScoresProb = 1 - Math.exp(-homeXg);
  const awayScoresProb = 1 - Math.exp(-awayXg);
  const bttsProb = Math.min(90, Math.max(25, Math.round(homeScoresProb * awayScoresProb * 100)));

  // Confidence — based ONLY on real data availability
  let confidence = 20;
  let confidenceLabel = "LOW";
  if (hasScore && isPlayed) { confidence += 20; }
  if (status === 'finished') { confidence += 20; }
  if (status === 'live' || status === 'inprogress') { confidence += 15; }
  // Note: AI prediction existence alone does NOT boost confidence
  if (aiPrediction) { confidence += 5; } // small boost for having an explicit prediction

  confidence = Math.min(75, confidence); // Cap at 75 — never pretend certainty
  if (confidence >= 60) confidenceLabel = "MODERATE";
  if (confidence >= 70) confidenceLabel = "HIGH";

  // Match Result — MUST follow AI prediction when available
  let matchResultPrediction = "NO CLEAR AI PREDICTION";
  let doubleChancePrediction = "NO CLEAR AI PREDICTION";

  if (aiPrediction) {
    if (aiPrediction.predictedWinner === "HOME") {
      matchResultPrediction = "HOME WIN";
      doubleChancePrediction = "HOME OR DRAW (1X)";
    } else if (aiPrediction.predictedWinner === "AWAY") {
      matchResultPrediction = "AWAY WIN";
      doubleChancePrediction = "AWAY OR DRAW (X2)";
    } else if (aiPrediction.predictedWinner === "DRAW") {
      matchResultPrediction = "DRAW";
      doubleChancePrediction = "HOME OR DRAW (1X)";
    }
  }

  // Safest Bet — must be consistent with the match result
  let safestBet = "NO BET";
  let safestProb = 0;
  const dc1x = homeWinProb + drawProb;
  const dcx2 = awayWinProb + drawProb;

  if (aiPrediction) {
    // Primary market = the AI's prediction
    if (aiPrediction.predictedWinner === "HOME") {
      safestBet = "HOME WIN";
      safestProb = homeWinProb;
    } else if (aiPrediction.predictedWinner === "AWAY") {
      safestBet = "AWAY WIN";
      safestProb = awayWinProb;
    } else if (aiPrediction.predictedWinner === "DRAW") {
      safestBet = "DRAW";
      safestProb = drawProb;
    }
  } else {
    // No AI prediction — fall back to model, but only if strong
    const candidates = [
      { name: "HOME WIN", prob: homeWinProb },
      { name: "AWAY WIN", prob: awayWinProb },
      { name: "HOME DOUBLE CHANCE (1X)", prob: dc1x },
      { name: "AWAY DOUBLE CHANCE (X2)", prob: dcx2 },
      { name: "OVER 1.5 GOALS", prob: 100 - under15 },
      { name: "OVER 2.5 GOALS", prob: 100 - under25 }
    ];
    candidates.forEach(function(c) {
      if (c.prob > safestProb && c.prob < 95) { safestProb = c.prob; safestBet = c.name; }
    });
    if (safestProb < 60) { safestBet = "NO BET"; safestProb = 0; }
  }

  // Verdict
  let verdict = "🔴 NO BET";
  if (!aiPrediction && safestProb >= 60) verdict = "🟡 WAIT FOR MORE INFORMATION";
  if (aiPrediction && confidence >= 60) verdict = "🟡 WAIT FOR MORE INFORMATION";
  if (aiPrediction && confidence >= 70) verdict = "🟢 BET";

  let venue = "";
  if (match.venue && match.venue.name) venue = match.venue.name;
  let referee = "";
  if (match.referee && match.referee.name) referee = match.referee.name;

  // Build the structured response
  const aiPredictionOutput = aiPrediction ? {
    predictedHomeTeam: aiPrediction.predictedHomeScore >= 0 ? homeTeamName : null,
    predictedAwayTeam: aiPrediction.predictedAwayScore >= 0 ? awayTeamName : null,
    predictedHomeScore: aiPrediction.predictedHomeScore,
    predictedAwayScore: aiPrediction.predictedAwayScore,
    predictedWinner: aiPrediction.predictedWinner,
    predictionLine: aiPrediction.predictionLine
  } : null;

  return {
    matchId: match.id || null,
    match: {
      home: homeTeamName,
      away: awayTeamName,
      league: leagueName,
      kickoff: match.event_date || match.date || "Unknown",
      matchStatus: status,
      venue: venue,
      referee: referee
    },
    aiPreview: aiPreview,
    aiPrediction: aiPredictionOutput,
    probabilities: { homeWin: homeWinProb, draw: drawProb, awayWin: awayWinProb },
    expectedGoals: {
      home: homeXg.toFixed(2),
      away: awayXg.toFixed(2),
      total: totalXg.toFixed(2),
      label: "MODEL ESTIMATE"
    },
    predictions: {
      matchResult: matchResultPrediction,
      doubleChance: doubleChancePrediction
    },
    markets: {
      over15: 100 - under15, under15: under15,
      over25: 100 - under25, under25: under25,
      over35: 100 - under35, under35: under35,
      over45: 100 - under45, under45: under45,
      bttsYes: bttsProb, bttsNo: 100 - bttsProb
    },
    analysis: {
      confidence: confidence,
      confidenceLabel: confidenceLabel,
      safestBet: safestBet,
      probability: safestProb,
      verdict: verdict
    }
  };
}

// ============ ENDPOINTS ============
app.get('/api/today', async (req, res) => {
  const API_KEY = process.env.BZZOIRO_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "API key not configured." });
  try {
    const listUrl = "https://sports.bzzoiro.com/api/events/?limit=50";
    const listResponse = await axios.get(listUrl, { headers: { Authorization: "Token " + API_KEY }, timeout: 15000 });
    const rawEvents = listResponse.data.results || [];
    if (rawEvents.length === 0) return res.json({ status: "no_matches", message: "No matches found." });
    const analyzedMatches = rawEvents.map(analyzeMatch);
    res.json({ status: "success", count: analyzedMatches.length, matches: analyzedMatches });
  } catch (error) {
    res.status(500).json({ error: "Failed: " + error.message });
  }
});

app.get('/api/analyze', async (req, res) => {
  const teamName = req.query.teamName || '';
  const API_KEY = process.env.BZZOIRO_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "API key not configured." });
  try {
    let listUrl;
    if (teamName && teamName.trim() !== '') {
      listUrl = "https://sports.bzzoiro.com/api/events/?team_name=" + encodeURIComponent(teamName) + "&limit=50";
    } else {
      listUrl = "https://sports.bzzoiro.com/api/events/?limit=50";
    }
    const listResponse = await axios.get(listUrl, { headers: { Authorization: "Token " + API_KEY }, timeout: 15000 });
    const rawEvents = listResponse.data.results || [];
    if (rawEvents.length === 0) return res.json({ status: "no_matches", message: "No matches found. Try another search." });
    const analyzedMatches = rawEvents.map(analyzeMatch);
    res.json({ status: "success", count: analyzedMatches.length, searchTerm: teamName, matches: analyzedMatches });
  } catch (error) {
    res.status(500).json({ error: "Failed: " + error.message });
  }
});

app.get('/api/live', async (req, res) => {
  const API_KEY = process.env.BZZOIRO_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "API key not configured." });
  try {
    let rawEvents = [];
    try {
      const liveUrl = "https://sports.bzzoiro.com/api/events/live/";
      const liveResponse = await axios.get(liveUrl, { headers: { Authorization: "Token " + API_KEY }, timeout: 10000 });
      rawEvents = liveResponse.data.results || [];
    } catch (e) {
      const listResponse = await axios.get("https://sports.bzzoiro.com/api/events/?limit=50", { headers: { Authorization: "Token " + API_KEY }, timeout: 10000 });
      const all = listResponse.data.results || [];
      rawEvents = all.filter(function(m) {
        const s = (m.status || "").toLowerCase();
        return s === 'live' || s === 'inprogress' || s === '2nd_half' || s === '1st_half' || s === 'halftime';
      });
    }
    const analyzedMatches = rawEvents.map(analyzeMatch);
    res.json({ status: "success", count: analyzedMatches.length, matches: analyzedMatches });
  } catch (error) {
    res.status(500).json({ error: "Failed: " + error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));
