require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const axios = require('axios');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Firebase Admin
let db;
try {
  const serviceAccount = {
    project_id: process.env.FIREBASE_PROJECT_ID || 'laiztopup-17e14',
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
  };

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  db = admin.firestore();
} catch (e) {
  console.warn('[server] Firebase Admin not configured yet. Using mock mode.');
}

// ===================== BLUEBUFF API (real spec) =====================
// Docs: https://bluebuff.in/api/service
// Auth header: x-api-key: TK_xxx (NOT "Authorization: Bearer")
const BLUEBUFF_API_KEY = process.env.PROVIDER_API_KEY || '';
const BLUEBUFF_BASE = 'https://bluebuff.in/api/service';

const bbHeaders = {
  'x-api-key': BLUEBUFF_API_KEY,
  'Content-Type': 'application/json',
};

// GET /api/service/balance
async function getWalletBalance() {
  const response = await axios.get(`${BLUEBUFF_BASE}/balance`, { headers: bbHeaders });
  return response.data;
}

// GET /api/service/games
async function getGames() {
  const response = await axios.get(`${BLUEBUFF_BASE}/games`, { headers: bbHeaders });
  return response.data.success ? (response.data.games || []) : [];
}

// GET /api/service/games/{gameSlug}
async function getPackages(gameSlug) {
  const response = await axios.get(`${BLUEBUFF_BASE}/games/${gameSlug}`, { headers: bbHeaders });
  return response.data.success ? response.data.game : null;
}

// POST /api/service/validate  (zoneId required for MLBB, optional for others)
async function validatePlayer(gameSlug, playerId, zoneId) {
  const payload = { gameSlug, playerId };
  if (zoneId) payload.zoneId = zoneId;

  const response = await axios.post(`${BLUEBUFF_BASE}/validate`, payload, { headers: bbHeaders });
  if (response.data.success === 200 || response.data.success === true) {
    return { valid: true, ...response.data.data };
  }
  return { valid: false, error: response.data.message || 'Validation failed' };
}

// POST /api/service/order
async function placeOrder(gameSlug, itemSlug, playerId, zoneId) {
  const payload = { gameSlug, itemSlug, playerId };
  if (zoneId) payload.zoneId = zoneId;

  const response = await axios.post(`${BLUEBUFF_BASE}/order`, payload, { headers: bbHeaders });
  return response.data; // { success, status, message, order, usage }
}

// GET /api/service/status/{orderId}
async function checkOrderStatus(orderId) {
  const response = await axios.get(`${BLUEBUFF_BASE}/status/${orderId}`, { headers: bbHeaders });
  return response.data;
}

// ===================== PAYMENT GATEWAY (xyzpay) =====================
const GATEWAY_API_TOKEN = process.env.PAYMENT_API_TOKEN || '';
const GATEWAY_BASE = 'https://api.xyzpay.site';

async function createPaymentOrder({ orderId, amount, mobile }) {
  const response = await axios.post(`${GATEWAY_BASE}/api/create-order`, {
    token: GATEWAY_API_TOKEN,
    orderId,
    amount,
    mobile,
    returnUrl: `https://laiztopup-17e14.web.app/payment.html?orderId=${orderId}`,
  });
  if (response.data.success) {
    return { success: true, paymentId: response.data.paymentId, paymentUrl: response.data.paymentUrl };
  }
  return { success: false, error: response.data.message || 'Failed' };
}

async function checkPaymentStatus(orderId) {
  const response = await axios.post(`${GATEWAY_BASE}/api/check-status`, {
    token: GATEWAY_API_TOKEN,
    orderId,
  });
  return response.data.success
    ? { status: response.data.status, transactionId: response.data.transactionId }
    : { status: 'failed' };
}

// ===================== ROUTES =====================

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Wallet balance (for admin/debug use)
app.get('/api/provider/balance', async (req, res) => {
  try {
    res.json(await getWalletBalance());
  } catch (e) {
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

// All games
app.get('/api/topup/games', async (req, res) => {
  try {
    res.json({ games: await getGames() });
  } catch (e) {
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

// Packages/items for one game
app.get('/api/topup/packages/:gameSlug', async (req, res) => {
  try {
    const game = await getPackages(req.params.gameSlug);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    res.json(game);
  } catch (e) {
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

// Validate player UID (zoneId optional, required for MLBB)
app.post('/api/topup/check-role', async (req, res) => {
  try {
    const { gameSlug, playerID, zoneId } = req.body;
    if (!gameSlug || !playerID) return res.status(400).json({ error: 'gameSlug and playerID required' });
    res.json(await validatePlayer(gameSlug, playerID, zoneId));
  } catch (e) {
    res.status(400).json({ valid: false, error: e.response?.data?.message || e.message });
  }
});

// Create payment order (customer pays first)
app.post('/api/payment/create', async (req, res) => {
  try {
    const { orderId, userId, amount, mobile, gameSlug, itemSlug, playerId, zoneId } = req.body;
    if (!orderId || !amount || !mobile) return res.status(400).json({ error: 'Missing params' });

    const paymentResult = await createPaymentOrder({ orderId, amount, mobile });
    if (!paymentResult.success) return res.status(400).json({ error: paymentResult.error });

    if (db && userId) {
      await db.collection('users').doc(userId).collection('orders').doc(orderId).set({
        amount, gameSlug, itemSlug, playerId, zoneId, mobile,
        paymentId: paymentResult.paymentId,
        paymentUrl: paymentResult.paymentUrl,
        status: 'pending_payment',
        createdAt: new Date(),
      }, { merge: true });
    }

    res.json({ success: true, paymentId: paymentResult.paymentId, paymentUrl: paymentResult.paymentUrl });
  } catch (e) {
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

app.get('/api/payment/check/:orderId', async (req, res) => {
  try {
    res.json(await checkPaymentStatus(req.params.orderId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Webhook: payment confirmed by gateway -> NOW place the real BlueBuff order
app.post('/api/payment/webhook', async (req, res) => {
  try {
    const { orderId, status } = req.body;
    if (status !== 'success') return res.json({ received: true });

    // Verify independently with the gateway before fulfilling
    const verified = await checkPaymentStatus(orderId);
    if (verified.status !== 'success') {
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    let bbResult = null;
    let orderSnap = null;

    if (db) {
      // Find the order across users (orderId is the doc id we set at /create)
      const usersSnap = await db.collectionGroup('orders').where(admin.firestore.FieldPath.documentId(), '==', orderId).limit(1).get();
      if (!usersSnap.empty) orderSnap = usersSnap.docs[0];
    }

    if (orderSnap) {
      const data = orderSnap.data();
      bbResult = await placeOrder(data.gameSlug, data.itemSlug, data.playerId, data.zoneId);
      await orderSnap.ref.set({
        status: bbResult.success ? 'delivered' : 'failed',
        bluebuffOrder: bbResult.order || null,
        confirmedAt: new Date(),
      }, { merge: true });
    }

    res.json({ received: true, fulfillment: bbResult });
  } catch (e) {
    console.error('[webhook] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Manual order status check (BlueBuff side)
app.get('/api/topup/order-status/:orderId', async (req, res) => {
  try {
    res.json(await checkOrderStatus(req.params.orderId));
  } catch (e) {
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`[server] Listening on port ${PORT}`);
});

module.exports = { db, admin };
