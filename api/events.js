// Public: upcoming events and site links for the landing page.
// GET /api/events -> { events: [...], settings: { phone, bookingUrl } }
const { loadEventsData, todayEastern } = require("./_lib");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Use GET." });
  try {
    const { events, settings } = await loadEventsData();
    const today = todayEastern();
    const upcoming = events
      .filter((e) => (e.endDate || e.date) >= today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(({ id, date, endDate, time, title, description, link, linkLabel }) => ({ id, date, endDate, time, title, description, link, linkLabel }));
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    res.status(200).json({ events: upcoming, settings });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Events are unavailable right now." });
  }
};
