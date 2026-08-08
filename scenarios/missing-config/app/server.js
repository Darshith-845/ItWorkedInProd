const express = require('express');
const app = express();
const PORT = 3000;

app.use(express.json());

// Health check — works even without DATABASE_URL
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'checkout-api' });
});

// Checkout endpoint — requires DATABASE_URL
app.post('/checkout', (req, res) => {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    // This is what happens in production when the env var is missing
    const error = new Error('DATABASE_URL is not defined');
    error.code = 'ERR_CONFIG_MISSING';

    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      service: 'checkout-api',
      endpoint: 'POST /checkout',
      error: {
        message: error.message,
        code: error.code,
        stack: error.stack,
      },
      request: {
        method: req.method,
        path: req.path,
        body: req.body,
      },
    }));

    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Database connection failed: DATABASE_URL is not defined',
      code: 'ERR_CONFIG_MISSING',
      timestamp: new Date().toISOString(),
      service: 'checkout-api',
      endpoint: 'POST /checkout',
    });
  }

  // If DATABASE_URL exists, simulate a successful checkout
  res.json({
    status: 'success',
    orderId: 'ord_' + Math.random().toString(36).slice(2, 10),
    message: 'Checkout completed',
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'INFO',
    service: 'checkout-api',
    message: `Server started on port ${PORT}`,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ? '[SET]' : '[NOT SET]',
      NODE_ENV: process.env.NODE_ENV || 'development',
    },
  }));
});
