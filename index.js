// This is our server. It will run on Vercel for free.
const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

// Our API endpoint that the frontend will call
app.post('/api/analyze', async (req, res) => {
  const { teamName, dateFrom, dateTo } = req.body;
  
  // Use the environment variable for security
  const API_KEY = process.env.BZZOIRO_API_KEY; 
  
  if (!API_KEY) {
    return res.status(500).json({ error: "API key not configured." });
  }

  try {
    // 1. Fetch events from Bzzoiro
    const response = await axios.get('https://api.bzzoiro.com/v2/events/', {
      headers: { Authorization: Token ${API_KEY} },
      params: {
        team_name: teamName,
        date_from: dateFrom,
        date_to: dateTo,
        limit: 5
      }
    });

    const events = response.data.results || [];
    
    // 2. We will add the complex analysis logic here later.
    // For now, let's just send the raw data back.
    res.json({ 
      status: "success", 
      count: events.length,
      matches: events 
    });

  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Failed to fetch from Bzzoiro." });
  }
});

// Default route
app.get('/', (req, res) => {
  res.send('Football Engine is running!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(Server running on port ${PORT}));
