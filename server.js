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

const BLUEBUFF_API_KEY = process.env.PROVIDER_API_KEY || 'TK_4be5fef3fe569aa085aac9d94ef7a55f04c8792667c7df15074eb91ee821a728';
const BLUEBUFF_BASE = 'https://api.bluebuff.in/v2';

async function validatePlayer(gameSlug, playerID) {
  try {
    const response = await axios.post(`${BLUEBUFF_BASE}/validate`, {
      apiKey: BLUEBUFF_API_KEY,
      gameSlug,
      playerId: playerID,
    });
    if (response.data.success) {
      return { valid: true, playerName: response.data.playerName || playerID, gameSlug };
    }
    return { valid: false, error: response.data.message || 'Player not found' };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

async function getPackages(gameSlug) {
  try {
    const response = await axios.get(`${BLUEBUFF_BASE}/games/${gameSlug}`, {
      headers: { Authorization: `Bearer ${BLUEBUFF_API_KEY}` },
    });
    return response.data.success ? (response.data.items || []) : [];
  } catch (e) {
    return [];
  }
}

const GATEWAY_API_TOKEN = process.env.PAYMENT_API_TOKEN || 'YOUR_XYZPAY_TOKEN_HERE';
const GATEWAY_BASE = 'https://api.xyzpay.site';

async function createPaymentOrder({ orderId, amount, mobile }) {
  try {
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
  } catch (e) {
    throw e;
  }
}

async function checkPaymentStatus(orderId) {
  try {
    const response = await axios.post(`${GATEWAY_BASE}/api/check-status`, {
      token: GATEWAY_API_TOKEN,
      orderId,
    });
    return response.data.success ? { status: response.data.status, transactionId: response.data.transactionId } : { status: 'failed' };
  } catch (e) {
    return { status: 'error', error: e.message };
  }
}

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/topup/check-role', async (req, res) => {
  try {
    const { gameSlug, playerID } = req.body;
    if (!gameSlug || !playerID) return res.status(400).json({ error: 'Missing params' });
    res.json(await validatePlayer(gameSlug, playerID));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/topup/packages/:gameSlug', async (req, res) => {
  try {
    res.json({ packages: await getPackages(req.params.gameSlug) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/payment/create', async (req, res) => {
  try {
    const { orderId, userId, amount, mobile, gameSlug, pkgSlug } = req.body;
    if (!orderId || !amount || !mobile) return res.status(400).json({ error: 'Missing params' });
    const paymentResult = await createPaymentOrder({ orderId, amount, mobile });
    if (!paymentResult.success) return res.status(400).json({ error: paymentResult.error });
    if (db && userId) {
      await db.collection('users').doc(userId).collection('orders').doc(orderId).set({
        amount, gameSlug, pkgSlug, mobile, paymentId: paymentResult.paymentId,
        paymentUrl: paymentResult.paymentUrl, status: 'pending_payment', createdAt: new Date(),
      }, { merge: true });
    }
    res.json({ success: true, paymentId: paymentResult.paymentId, paymentUrl: paymentResult.paymentUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/payment/check/:orderId', async (req, res) => {
  try {
    res.json(await checkPaymentStatus(req.params.orderId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/payment/webhook', async (req, res) => {
  try {
    const { orderId, status } = req.body;
    if (status === 'success') {
      const verified = await checkPaymentStatus(orderId);
      if (verified.status !== 'success') return res.status(400).json({ error: 'Verification failed' });
      if (db) {
        await db.collection('payments').doc(orderId).set({ status: 'confirmed', confirmedAt: new Date() }, { merge: true });
      }
    }
    res.json({ received: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
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
