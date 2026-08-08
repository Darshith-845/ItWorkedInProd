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

// ioredis may reject a request after closing the connection, even though its
// error event contains the underlying TCP failure. Keep that genuine socket
// error so the reproduction reports what actually happened on the network.
let lastRedisConnectionError = null;
redis.on('error', (err) => {
  lastRedisConnectionError = err;
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
    const observedError = lastRedisConnectionError || err;
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      service: 'checkout-api',
      endpoint: 'POST /checkout',
      error: {
        message: observedError.message,
        code: observedError.code,
        errno: observedError.errno,
        syscall: observedError.syscall,
        address: observedError.address,
        port: observedError.port,
        stack: observedError.stack,
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
      message: `Redis connection failed: ${observedError.message}`,
      code: observedError.code || 'REDIS_CONNECTION_ERROR',
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
