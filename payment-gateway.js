const axios = require('axios');

const GATEWAY_API_TOKEN = process.env.PAYMENT_API_TOKEN || 'YOUR_XYZPAY_TOKEN';
const GATEWAY_BASE = 'https://api.xyzpay.site';

// Create payment order
async function createOrder({ orderId, amount, mobile }) {
  try {
    const url = `${GATEWAY_BASE}/api/create-order`;
    const response = await axios.post(url, {
      token: GATEWAY_API_TOKEN,
      orderId,
      amount,
      mobile,
      returnUrl: `https://laiztopup-17e14.web.app/payment.html?orderId=${orderId}`,
    }, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (response.data.success) {
      return {
        success: true,
        paymentId: response.data.paymentId,
        paymentUrl: response.data.paymentUrl,
      };
    }
    return { success: false, error: response.data.message || 'Failed to create order' };
  } catch (e) {
    console.error('[payment-gateway] createOrder error:', e.message);
    throw e;
  }
}

// Check payment status
async function checkStatus(orderId) {
  try {
    const url = `${GATEWAY_BASE}/api/check-status`;
    const response = await axios.post(url, {
      token: GATEWAY_API_TOKEN,
      orderId,
    });

    if (response.data.success) {
      return {
        status: response.data.status, // 'success', 'pending', 'failed'
        transactionId: response.data.transactionId,
        amount: response.data.amount,
      };
    }
    return { status: 'failed', error: response.data.message };
  } catch (e) {
    console.error('[payment-gateway] checkStatus error:', e.message);
    return { status: 'error', error: e.message };
  }
}

module.exports = {
  createOrder,
  checkStatus,
};
