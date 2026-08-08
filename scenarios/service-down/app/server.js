const express = require('express');
const Redis = require('ioredis');

const app = express();
const PORT = 3000;

app.use(express.json());

// Connect to Redis — will fail if Redis is unavailable
const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: 1,
  retryStrategy: () => null, // Don't retry — fail fast for clear error
  lazyConnect: true,
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'checkout-api' });
});

// Checkout endpoint — requires Redis for session/cart data
app.post('/checkout', async (req, res) => {
  const sessionId = req.body.session_id || 'sess_abc123';

  try {
    // Connect if not already connected
    if (redis.status === 'wait') {
      await redis.connect();
    }

    // Try to fetch cart data from Redis
    const cartData = await redis.get(`cart:${sessionId}`);

    if (!cartData) {
      return res.status(404).json({ error: 'Cart not found' });
    }

    res.json({
      status: 'success',
      orderId: 'ord_' + Math.random().toString(36).slice(2, 10),
      cart: JSON.parse(cartData),
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
        errno: err.errno,
        syscall: err.syscall,
        address: err.address,
        port: err.port,
        stack: err.stack,
      },
      request: {
        method: req.method,
        path: req.path,
        body: req.body,
      },
      dependency: {
        service: 'redis',
        host: process.env.REDIS_HOST || 'redis',
        port: process.env.REDIS_PORT || '6379',
      },
    }));

    res.status(500).json({
      error: 'Internal Server Error',
      message: `Redis connection failed: ${err.message}`,
      code: err.code || 'ECONNREFUSED',
      timestamp: new Date().toISOString(),
      service: 'checkout-api',
      endpoint: 'POST /checkout',
      dependency: {
        service: 'redis',
        host: process.env.REDIS_HOST || 'redis',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        status: 'unavailable',
      },
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'INFO',
    service: 'checkout-api',
    message: `Server started on port ${PORT}`,
    dependencies: {
      redis: {
        host: process.env.REDIS_HOST || 'redis',
        port: process.env.REDIS_PORT || '6379',
      },
    },
  }));
});
