const express = require('express');
const router = express.Router();
const provider = require('../services/provider');

// Check player role/UID
router.post('/check-role', async (req, res) => {
  try {
    const { gameSlug, playerID } = req.body;
    if (!gameSlug || !playerID) {
      return res.status(400).json({ error: 'gameSlug and playerID required' });
    }
    const result = await provider.validatePlayer(gameSlug, playerID);
    res.json(result);
  } catch (e) {
    console.error('[topup] check-role error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Get live packages for a game
router.get('/packages/:gameSlug', async (req, res) => {
  try {
    const { gameSlug } = req.params;
    const packages = await provider.getPackages(gameSlug);
    res.json({ packages });
  } catch (e) {
    console.error('[topup] packages error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Sync all games from BlueBuff
router.post('/sync-games', async (req, res) => {
  try {
    const games = await provider.syncGames();
    res.json({ success: true, count: games.length, games });
  } catch (e) {
    console.error('[topup] sync-games error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
