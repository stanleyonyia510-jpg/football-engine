const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

// Health check
app.get('/', (req, res) => {
  res.send('Football Engine is running!');
});

// MAIN ANALYSIS ENDPOINT
app.get('/api/analyze', async (req, res) => {
  const teamName = req.query.teamName || 'Arsenal';
  const API_KEY = process.env.BZZOIRO_API_KEY;

  if (!API_KEY) {
    return res.status(500).json({ error: "API key not configured." });
  }

  try {
    const url = "https://sports.bzzoiro.com/api/events/?team_name=" + teamName + "&limit=5";
    const response = await axios.get(url, {
      headers: { Authorization: "Token " + API_KEY }
    });

    const events = response.data.results || [];

    if (events.length === 0) {
      return res.json({ status: "no_matches", message: "No upcoming matches found for " + teamName });
    }

    // Take the first match for a detailed analysis
    const match = events[0];
    
    // --- THE ANALYSIS BRAIN ---
    
    // 1. Calculate Expected Goals (xG) - Using provided xG or estimating from stats
    const homeXg = match.home_xg || 1.5;
    const awayXg = match.away_xg || 1.2;
    const totalXg = homeXg + awayXg;

    // 2. Calculate 1X2 Probabilities (Simple Poisson-like model)
    const homeAttack = match.home_attack_rating || 0.6;
    const awayAttack = match.away_attack_rating || 0.5;
    const homeDefense = match.home_defense_rating || 0.6;
    const awayDefense = match.away_defense_rating || 0.5;

    let homeWinProb = 40 + (homeAttack * 30) - (awayAttack * 20);
    let awayWinProb = 30 + (awayAttack * 30) - (homeAttack * 20);
    let drawProb = 100 - homeWinProb - awayWinProb;

    // Clamp values
    homeWinProb = Math.max(10, Math.min(80, homeWinProb));
    awayWinProb = Math.max(10, Math.min(80, awayWinProb));
    drawProb = 100 - homeWinProb - awayWinProb;

    // 3. Goals Model
    let over25Prob = 50;
    if (totalXg > 2.5) over25Prob = 65;
    if (totalXg > 3.0) over25Prob = 75;
    if (totalXg < 2.0) over25Prob = 35;

    // 4. BTTS Model
    let bttsProb = 50;
    if (homeXg > 1.0 && awayXg > 1.0) bttsProb = 65;
    if (homeXg < 0.8 || awayXg < 0.8) bttsProb = 35;

    // 5. Confidence Score (based on data completeness)
    let dataPoints = 0;
    if (match.home_xg) dataPoints += 20;
    if (match.away_xg) dataPoints += 20;
    if (match.home_attack_rating) dataPoints += 20;
    if (match.away_attack_rating) dataPoints += 20;
    if (match.lineups) dataPoints += 20;
    const confidenceScore = dataPoints;

    // 6. Safest Bet Selection
    let safestBet = "NO BET";
    let safestProb = 0;
    
    if (homeWinProb > 60) { safestBet = "HOME WIN"; safestProb = homeWinProb; }
    else if (awayWinProb > 60) { safestBet = "AWAY WIN"; safestProb = awayWinProb; }
    else if (homeWinProb > 50 && drawProb > 25) { safestBet = "HOME DOUBLE CHANCE (1X)"; safestProb = homeWinProb + drawProb; }
    else if (awayWinProb > 50 && drawProb > 25) { safestBet = "AWAY DOUBLE CHANCE (X2)"; safestProb = awayWinProb + drawProb; }
    else if (over25Prob > 60) { safestBet = "OVER 2.5 GOALS"; safestProb = over25Prob; }
    else if (bttsProb > 60) { safestBet = "BTTS - YES"; safestProb = bttsProb; }

    // Final Verdict
    let verdict = "🔴 NO BET";
    if (safestProb > 70 && confidenceScore > 50) verdict = "🟡 WAIT FOR MORE INFO";
    if (safestProb > 75 && confidenceScore > 70) verdict = "🟢 BET";

    // --- END ANALYSIS ---

    res.json({
      status: "success",
      match: {
        home: match.home_team,
        away: match.away_team,
        league: match.league_name || "Unknown",
        kickoff: match.event_date,
        status: match.status
      },
      probabilities: {
        homeWin: Math.round(homeWinProb),
        draw: Math.round(drawProb),
        awayWin: Math.round(awayWinProb)
      },
      expectedGoals: {
        home: homeXg.toFixed(2),
        away: awayXg.toFixed(2),
        total: totalXg.toFixed(2)
      },
      markets: {
        over25: Math.round(over25Prob),
        under25: Math.round(100 - over25Prob),
        bttsYes: Math.round(bttsProb),
        bttsNo: Math.round(100 - bttsProb)
      },
      analysis: {
        confidence: confidenceScore,
        safestBet: safestBet,
        probability: Math.round(safestProb),
        verdict: verdict
      },
      rawData: match // Send the raw data too, so we can see it
    });

  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Failed to fetch from Bzzoiro: " + error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));
