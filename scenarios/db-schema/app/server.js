const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = 3000;

app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'checkout-api', database: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', error: err.message });
  }
});

// Checkout endpoint — queries users.subscription (schema v17)
// This WILL fail if the database only has schema v16 (no subscription column)
app.post('/checkout', async (req, res) => {
  const userId = req.body.user_id || 'usr_001';

  try {
    // This query expects schema v17 which includes the `subscription` column
    const result = await pool.query(
      'SELECT email, name, subscription FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    // Check subscription tier for checkout eligibility
    if (user.subscription !== 'active' && user.subscription !== 'premium') {
      return res.status(403).json({
        error: 'Checkout not allowed',
        message: `User subscription status is "${user.subscription}"`,
      });
    }

    res.json({
      status: 'success',
      orderId: 'ord_' + Math.random().toString(36).slice(2, 10),
      user: { email: user.email, name: user.name },
    });
  } catch (err) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      service: 'checkout-api',
      endpoint: 'POST /checkout',
      error: {
        message: err.message,
        code: err.code,
        detail: err.detail,
        hint: err.hint,
        position: err.position,
        stack: err.stack,
      },
      request: {
        method: req.method,
        path: req.path,
        body: req.body,
      },
    }));

    res.status(500).json({
      error: 'Internal Server Error',
      message: err.message,
      code: err.code || 'DATABASE_ERROR',
      timestamp: new Date().toISOString(),
      service: 'checkout-api',
      endpoint: 'POST /checkout',
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'INFO',
    service: 'checkout-api',
    message: `Server started on port ${PORT}`,
    database: process.env.DATABASE_URL ? 'configured' : 'NOT CONFIGURED',
  }));
});
