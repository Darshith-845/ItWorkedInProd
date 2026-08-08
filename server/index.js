require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRouter = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// API Routes
app.use('/api', apiRouter);

// Serve static frontend in production
const frontendDistPath = path.resolve(__dirname, '..', 'client', 'dist');
app.use(express.static(frontendDistPath));

app.get('*', (req, res) => {
  // If request is not an API call and index.html exists, serve it
  if (!req.path.startsWith('/api')) {
    const indexPath = path.join(frontendDistPath, 'index.html');
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'API endpoint not found' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(` IT WORKED IN PROD - Web API running on port ${PORT}`);
  console.log(` Serving frontend from: ${frontendDistPath}`);
  console.log(`====================================================`);
});
