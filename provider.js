const axios = require('axios');

const BLUEBUFF_API_KEY = process.env.PROVIDER_API_KEY || 'TK_4be5fef3fe569aa085aac9d94ef7a55f04c8792667c7df15074eb91ee821a728';
const BLUEBUFF_BASE = 'https://api.bluebuff.in/v2';

// Validate player UID exists in game
async function validatePlayer(gameSlug, playerID) {
  try {
    const url = `${BLUEBUFF_BASE}/validate`;
    const response = await axios.post(url, {
      apiKey: BLUEBUFF_API_KEY,
      gameSlug,
      playerId: playerID,
    });

    if (response.data.success) {
      return {
        valid: true,
        playerName: response.data.playerName || playerID,
        gameSlug,
      };
    }
    return { valid: false, error: response.data.message || 'Player not found' };
  } catch (e) {
    console.error('[provider] validatePlayer error:', e.message);
    throw e;
  }
}

// Get live packages for a game from BlueBuff
async function getPackages(gameSlug) {
  try {
    const url = `${BLUEBUFF_BASE}/games/${gameSlug}`;
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${BLUEBUFF_API_KEY}` },
    });

    if (response.data.success) {
      return response.data.items || [];
    }
    return [];
  } catch (e) {
    console.error('[provider] getPackages error:', e.message);
    return [];
  }
}

// Place order with BlueBuff (auto-delivers)
async function placeOrder(gameSlug, playerID, itemSlug, amount) {
  try {
    const url = `${BLUEBUFF_BASE}/order`;
    const response = await axios.post(url, {
      apiKey: BLUEBUFF_API_KEY,
      gameSlug,
      playerId: playerID,
      itemSlug,
      amount,
    });

    if (response.data.success) {
      return {
        success: true,
        bluebuffOrderId: response.data.orderId,
        status: response.data.status || 'processing',
      };
    }
    return { success: false, error: response.data.message };
  } catch (e) {
    console.error('[provider] placeOrder error:', e.message);
    throw e;
  }
}

// Sync all games from BlueBuff into structure
async function syncGames() {
  try {
    const url = `${BLUEBUFF_BASE}/games`;
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${BLUEBUFF_API_KEY}` },
    });

    if (response.data.success) {
      return response.data.games || [];
    }
    return [];
  } catch (e) {
    console.error('[provider] syncGames error:', e.message);
    return [];
  }
}

module.exports = {
  validatePlayer,
  getPackages,
  placeOrder,
  syncGames,
};
