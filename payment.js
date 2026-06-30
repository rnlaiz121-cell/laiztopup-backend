const express = require('express');
const router = express.Router();
const { db } = require('../server');
const provider = require('../services/provider');
const paymentGateway = require('../services/payment-gateway');

// Create payment order
router.post('/create', async (req, res) => {
  try {
    const { orderId, userId, amount, mobile, gameSlug, pkgSlug } = req.body;
    
    if (!orderId || !amount || !mobile) {
      return res.status(400).json({ error: 'orderId, amount, mobile required' });
    }

    // Create payment via gateway
    const paymentResult = await paymentGateway.createOrder({
      orderId,
      amount,
      mobile,
    });

    if (!paymentResult.success) {
      return res.status(400).json({ error: paymentResult.error });
    }

    // Store order in Firestore
    if (db && userId) {
      await db.collection('users').doc(userId).collection('orders').doc(orderId).set({
        amount,
        gameSlug,
        pkgSlug,
        mobile,
        paymentId: paymentResult.paymentId,
        paymentUrl: paymentResult.paymentUrl,
        status: 'pending_payment',
        createdAt: new Date(),
      }, { merge: true });
    }

    res.json({
      success: true,
      paymentId: paymentResult.paymentId,
      paymentUrl: paymentResult.paymentUrl,
    });
  } catch (e) {
    console.error('[payment] create error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Check payment status
router.get('/check/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const status = await paymentGateway.checkStatus(orderId);
    res.json(status);
  } catch (e) {
    console.error('[payment] check error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Webhook: payment confirmed
router.post('/webhook', async (req, res) => {
  try {
    const { orderId, status, transactionId } = req.body;
    
    if (status === 'success') {
      // Verify independently
      const verified = await paymentGateway.checkStatus(orderId);
      if (verified.status !== 'success') {
        return res.status(400).json({ error: 'Payment verification failed' });
      }

      // Now safe to deliver
      // Call BlueBuff to place order and deliver
      // (This would be implemented in provider service)
      
      if (db) {
        await db.collection('payments').doc(orderId).set({
          status: 'confirmed',
          transactionId,
          confirmedAt: new Date(),
        }, { merge: true });
      }
    }

    res.json({ received: true });
  } catch (e) {
    console.error('[payment] webhook error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
