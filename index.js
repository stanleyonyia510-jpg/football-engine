export default async function handler(req, res) {
  const API_KEY = process.env.BZZOIRO_API_KEY;

  if (!API_KEY) {
    return res.status(200).json({ message: "API key is missing in Vercel settings." });
  }

  try {
    const response = await fetch("https://api.bzzoiro.com/v2/events/?limit=1", {
      headers: { Authorization: Token ${API_KEY} }
    });
    const data = await response.json();
    return res.status(200).json({ success: true, data: data });
  } catch (error) {
    return res.status(200).json({ success: false, error: error.message });
  }
}
