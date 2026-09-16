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

// League strength tiers (based on real league name)
function leagueStrength(leagueId, leagueName) {
  const name = (leagueName || "").toLowerCase();
  
  // Top European leagues
  if (name.includes("premier league") || name.includes("la liga") || name.includes("serie a") || name.includes("bundesliga") || name.includes("ligue 1")) {
    return { xgBase: 2.9, drawFactor: 0.22 };
  }
  // Second tier European
  if (name.includes("championship") || name.includes("serie b") || name.includes("segunda") || name.includes("bundesliga 2")) {
    return { xgBase: 2.5, drawFactor: 0.28 };
  }
  // European cups
  if (name.includes("champions league") || name.includes("europa") || name.includes("conference")) {
    return { xgBase: 3.0, drawFactor: 0.25 };
  }
  // South American leagues
  if (name.includes("brasileir") || name.includes("argentina") || name.includes("colombia") || name.includes("chile") || name.includes("peru") || name.includes("uruguay") || name.includes("ecuador")) {
    return { xgBase: 2.3, drawFactor: 0.33 };
  }
  // Copa Libertadores / Sudamericana (defensive)
  if (name.includes("libertadores") || name.includes("sudamericana")) {
    return { xgBase: 2.2, drawFactor: 0.35 };
  }
  // North American (MLS - HIGH SCORING)
  if (name.includes("mls") || name.includes("major league soccer") || name.includes("usl") || name.includes("liga mx")) {
    return { xgBase: 3.1, drawFactor: 0.20 };
  }
  // Asian leagues
  if (name.includes("japan") || name.includes("j-league") || name.includes("korea") || name.includes("chinese")) {
    return { xgBase: 2.6, drawFactor: 0.28 };
  }
  // African leagues
  if (name.includes("nigeria") || name.includes("egypt") || name.includes("south africa") || name.includes("morocco")) {
    return { xgBase: 2.4, drawFactor: 0.30 };
  }
  // Default
  return { xgBase: 2.6, drawFactor: 0.27 };
}

function analyzeMatch(match) {
  const homeTeamName = (match.home_team && match.home_team.name) ? match.home_team.name : (match.home_team || "Home Team");
  const awayTeamName = (match.away_team && match.away_team.name) ? match.away_team.name : (match.away_team || "Away Team");

  let leagueName = "Unknown Competition";
  let leagueId = 0;
  if (match.league && match.league.name) { leagueName = match.league.name; leagueId = match.league.id || 0; }
  else if (match.league_name) { leagueName = match.league_name; }

  const strength = leagueStrength(leagueId, leagueName);

  // Base xG from league strength
  let homeXg = strength.xgBase * 0.55;
  let awayXg = strength.xgBase * 0.45;

  // Home advantage
  homeXg *= 1.15;

  // Use actual score if available
  let actualHomeScore = null, actualAwayScore = null;
  if (match.home_score !== null && match.home_score !== undefined && match.home_score !== "") {
    actualHomeScore = parseInt(match.home_score) || 0;
    actualAwayScore = parseInt(match.away_score) || 0;
    if (match.status === 'finished' || match.status === 'live' || match.status === 'inprogress' || match.status === '2nd_half') {
      homeXg = (homeXg * 0.3) + (actualHomeScore * 0.7) + 0.3;
      awayXg = (awayXg * 0.3) + (actualAwayScore * 0.7) + 0.3;
    }
  }

  // Round number influence
  const roundNum = parseInt(match.round_number) || 1;
  const roundFactor = Math.min(1.0, 0.85 + (roundNum * 0.02));
  homeXg *= roundFactor;
  awayXg *= roundFactor;

  homeXg = Math.max(0.6, Math.min(3.5, homeXg));
  awayXg = Math.max(0.5, Math.min(3.2, awayXg));

  const totalXg = homeXg + awayXg;

  // 1X2 Probabilities
  let homeWinProb = Math.round((homeXg / totalXg) * 100 * (1 - strength.drawFactor * 0.6));
  let awayWinProb = Math.round((awayXg / totalXg) * 100 * (1 - strength.drawFactor * 0.6));

  const matchCloseness = 1 - Math.abs(homeWinProb - awayWinProb) / 100;
  let drawProb = Math.round(strength.drawFactor * 100 * matchCloseness + 8);

  const totalProb = homeWinProb + awayWinProb + drawProb;
  homeWinProb = Math.round((homeWinProb / totalProb) * 100);
  awayWinProb = Math.round((awayWinProb / totalProb) * 100);
  drawProb = 100 - homeWinProb - awayWinProb;

  // Poisson for goals markets
  function factorial(n) { return n <= 1 ? 1 : n * factorial(n - 1); }
  function poissonUnder(k, lambda) {
    let sum = 0;
    for (let i = 0; i <= k; i++) {
      sum += Math.exp(-lambda) * Math.pow(lambda, i) / factorial(i);
    }
    return sum * 100;
  }

  const under15 = Math.round(poissonUnder(1, totalXg));
  const under25 = Math.round(poissonUnder(2, totalXg));
  const under35 = Math.round(poissonUnder(3, totalXg));
  const under45 = Math.round(poissonUnder(4, totalXg));
  const over15 = 100 - under15;
  const over25 = 100 - under25;
  const over35 = 100 - under35;
  const over45 = 100 - under45;

  // BTTS from Poisson
  const homeScoresProb = (1 - Math.exp(-homeXg));
  const awayScoresProb = (1 - Math.exp(-awayXg));
  const bttsProb = Math.round(homeScoresProb * awayScoresProb * 100);

  // Confidence
  let confidence = 35;
  if (match.status === 'finished') confidence += 30;
  if (match.status === 'live' || match.status === 'inprogress' || match.status === '2nd_half') confidence += 20;
  if (actualHomeScore !== null) confidence += 15;
  if (leagueId > 0) confidence += 5;
  confidence = Math.min(95, confidence);

  // Match result prediction
  let matchResultPrediction = "DRAW";
  if (homeWinProb > awayWinProb && homeWinProb > drawProb) matchResultPrediction = "HOME WIN";
  else if (awayWinProb > homeWinProb && awayWinProb > drawProb) matchResultPrediction = "AWAY WIN";

  // Double chance
  let doubleChancePrediction = "";
  const dc1x = homeWinProb + drawProb;
  const dcx2 = awayWinProb + drawProb;
  const dc12 = homeWinProb + awayWinProb;
  if (dc1x > dcx2 && dc1x > dc12) doubleChancePrediction = "HOME OR DRAW (1X)";
  else if (dcx2 > dc1x && dcx2 > dc12) doubleChancePrediction = "AWAY OR DRAW (X2)";
  else doubleChancePrediction = "HOME OR AWAY (12)";

  // Safest bet
  let safestBet = "NO BET";
  let safestProb = 0;
  const candidates = [
    { name: "HOME WIN", prob: homeWinProb },
    { name: "AWAY WIN", prob: awayWinProb },
    { name: "HOME DOUBLE CHANCE (1X)", prob: dc1x },
    { name: "AWAY DOUBLE CHANCE (X2)", prob: dcx2 },
    { name: "OVER 1.5 GOALS", prob: over15 },
    { name: "OVER 2.5 GOALS", prob: over25 },
    { name: "BTTS - YES", prob: bttsProb }
  ];
  candidates.forEach(function(c) {
    if (c.prob > safestProb && c.prob < 96) { safestProb = c.prob; safestBet = c.name; }
  });

  let verdict = "🔴 NO BET";
  if (safestProb > 60 && confidence > 50) verdict = "🟡 WAIT FOR MORE INFORMATION";
  if (safestProb > 72 && confidence > 65) verdict = "🟢 BET";

  return {
    match: {
      home: homeTeamName,
      away: awayTeamName,
      league: leagueName,
      kickoff: match.event_date || match.date || "Unknown",
      matchStatus: match.status || "unknown"
    },
    probabilities: { homeWin: homeWinProb, draw: drawProb, awayWin: awayWinProb },
    expectedGoals: { home: homeXg.toFixed(2), away: awayXg.toFixed(2), total: totalXg.toFixed(2) },
    predictions: { matchResult: matchResultPrediction, doubleChance: doubleChancePrediction },
    markets: {
      over15: over15, under15: under15,
      over25: over25, under25: under25,
      over35: over35, under35: under35,
      over45: over45, under45: under45,
      bttsYes: bttsProb, bttsNo: 100 - bttsProb
    },
    analysis: { confidence: confidence, safestBet: safestBet, probability: safestProb, verdict: verdict }
  };
}

// TODAY ENDPOINT
app.get('/api/today', async (req, res) => {
  const API_KEY = process.env.BZZOIRO_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "API key not configured." });
  try {
    const listUrl = "https://sports.bzzoiro.com/api/events/?limit=10";
    const listResponse = await axios.get(listUrl, { headers: { Authorization: "Token " + API_KEY }, timeout: 10000 });
    const rawEvents = listResponse.data.results || [];
    if (rawEvents.length === 0) return res.json({ status: "no_matches", message: "No matches found today." });
    const analyzedMatches = rawEvents.map(analyzeMatch);
    res.json({ status: "success", count: analyzedMatches.length, matches: analyzedMatches });
  } catch (error) {
    res.status(500).json({ error: "Failed: " + error.message });
  }
});

// SEARCH ENDPOINT (Now includes finished matches too)
app.get('/api/analyze', async (req, res) => {
  const teamName = req.query.teamName || 'Arsenal';
  const API_KEY = process.env.BZZOIRO_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "API key not configured." });
  
  try {
    // Fetch upcoming, live, AND finished matches
    const listUrl = "https://sports.bzzoiro.com/api/events/?team_name=" + encodeURIComponent(teamName) + "&limit=20";
    const listResponse = await axios.get(listUrl, { headers: { Authorization: "Token " + API_KEY }, timeout: 10000 });
    const rawEvents = listResponse.data.results || [];
    
    if (rawEvents.length === 0) return res.json({ status: "no_matches", message: "No matches found for " + teamName + ". Try another team name." });
    
    const analyzedMatches = rawEvents.map(analyzeMatch);
    
    // Sort: live first, then upcoming, then finished
    analyzedMatches.sort(function(a, b) {
      const priority = { live: 0, inprogress: 0, "2nd_half": 0, upcoming: 1, notstarted: 1, finished: 2 };
      const aP = priority[a.match.matchStatus] !== undefined ? priority[a.match.matchStatus] : 1;
      const bP = priority[b.match.matchStatus] !== undefined ? priority[b.match.matchStatus] : 1;
      return aP - bP;
    });
    
    res.json({ status: "success", count: analyzedMatches.length, searchTerm: teamName, matches: analyzedMatches });
  } catch (error) {
    res.status(500).json({ error: "Failed: " + error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));
