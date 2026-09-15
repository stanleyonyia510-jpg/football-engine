// Vercel expects a "handler" function, not a listening server.
export default async function handler(req, res) {
  // 1. Set CORS headers so your frontend can talk to it
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // 2. Get the data from the request
  const { teamName } = req.query;
  const API_KEY = process.env.BZZOIRO_API_KEY;

  if (!API_KEY) {
    return res.status(500).json({ error: "API key not configured." });
  }

  try {
    // 3. Fetch from Bzzoiro
    const response = await fetch(https://api.bzzoiro.com/v2/events/?team_name=${teamName}&limit=3, {
      headers: { Authorization: Token ${API_KEY} }
    });
    
    const data = await response.json();
    
    // 4. Send the data back
    res.status(200).json({ 
      status: "success", 
      count: data.results ? data.results.length : 0,
      matches: data.results || []
    });

  } catch (error) {
    res.status(500).json({ error: "Failed to fetch from Bzzoiro." });
  }
}
