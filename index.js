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

app.get('/api/analyze', async (req, res) => {
  const teamName = req.query.teamName || 'Arsenal';
  const API_KEY = process.env.BZZOIRO_API_KEY;

  if (!API_KEY) {
    return res.status(500).json({ error: "API key not configured." });
  }

  try {
    const url = "https://sports.bzzoiro.com/api/events/?team_name=" + encodeURIComponent(teamName) + "&limit=20";
    
    const response = await axios.get(url, {
      headers: { Authorization: "Token " + API_KEY }
    });

    const rawEvents = response.data.results || [];

    if (rawEvents.length === 0) {
      return res.json({ 
        status: "no_matches", 
        message: "No matches found for " + teamName + ". Try another team name." 
      });
    }

    const analyzedMatches = rawEvents.map(function(match) {
      let leagueName = "Unknown Competition";
      if (match.league && match.league.name) leagueName = match.league.name;
      else if (match.league_name) leagueName = match.league_name;

      const homeTeamName = (match.home_team && match.home_team.name) ? match.home_team.name : (match.home_team || "Home Team");
      const awayTeamName = (match.away_team && match.away_team.name) ? match.away_team.name : (match.away_team || "Away Team");

      const homeXg = parseFloat(match.home_xg) || 1.5;
      const awayXg = parseFloat(match.away_xg) || 1.2;
      const totalXg = homeXg + awayXg;

      const homeAttack = match.home_attack_rating || 0.6;
      const awayAttack = match.away_attack_rating || 0.5;

      let homeWinProb = 40 + (homeAttack * 30) - (awayAttack * 20);
      let awayWinProb = 30 + (awayAttack * 30) - (homeAttack * 20);
      let drawProb = 100 - homeWinProb - awayWinProb;

      homeWinProb = Math.max(10, Math.min(80, homeWinProb));
      awayWinProb = Math.max(10, Math.min(80, awayWinProb));
      drawProb = 100 - homeWinProb - awayWinProb;

      let over25Prob = 50;
      if (totalXg > 2.5) over25Prob = 65;
      if (totalXg > 3.0) over25Prob = 75;
      if (totalXg < 2.0) over25Prob = 35;

      let bttsProb = 50;
      if (homeXg > 1.0 && awayXg > 1.0) bttsProb = 65;
      if (homeXg < 0.8 || awayXg < 0.8) bttsProb = 35;

      let dataPoints = 0;
      if (match.home_xg) dataPoints += 20;
      if (match.away_xg) dataPoints += 20;
      if (match.home_attack_rating) dataPoints += 20;
      if (match.away_attack_rating) dataPoints += 20;
      if (match.lineups) dataPoints += 20;
      const confidenceScore = dataPoints;

      let safestBet = "NO BET";
      let safestProb = 0;

      if (homeWinProb > 60) { safestBet = "HOME WIN"; safestProb = homeWinProb; }
      else if (awayWinProb > 60) { safestBet = "AWAY WIN"; safestProb = awayWinProb; }
      else if (homeWinProb > 45 && drawProb > 25) { safestBet = "HOME DOUBLE CHANCE (1X)"; safestProb = homeWinProb + drawProb; }
      else if (awayWinProb > 45 && drawProb > 25) { safestBet = "AWAY DOUBLE CHANCE (X2)"; safestProb = awayWinProb + drawProb; }
      else if (over25Prob > 60) { safestBet = "OVER 2.5 GOALS"; safestProb = over25Prob; }
      else if (bttsProb > 60) { safestBet = "BTTS - YES"; safestProb = bttsProb; }

      let verdict = "🔴 NO BET";
      if (safestProb > 65 && confidenceScore > 40) verdict = "🟡 WAIT FOR MORE INFORMATION";
      if (safestProb > 75 && confidenceScore > 60) verdict = "🟢 BET";

      return {
        match: {
          home: homeTeamName,
          away: awayTeamName,
          league: leagueName,
          kickoff: match.event_date || match.date || "Unknown",
          matchStatus: match.status || "unknown"
        },
        probabilities: { homeWin: Math.round(homeWinProb), draw: Math.round(drawProb), awayWin: Math.round(awayWinProb) },
        expectedGoals: { home: homeXg.toFixed(2), away: awayXg.toFixed(2), total: totalXg.toFixed(2) },
        markets: { over25: Math.round(over25Prob), under25: Math.round(100 - over25Prob), bttsYes: Math.round(bttsProb), bttsNo: Math.round(100 - bttsProb) },
        analysis: { confidence: confidenceScore, safestBet: safestBet, probability: Math.round(safestProb), verdict: verdict }
      };
    });

    res.json({
      status: "success",
      count: analyzedMatches.length,
      searchTerm: teamName,
      matches: analyzedMatches
    });

  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Failed to fetch from Bzzoiro: " + error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));
