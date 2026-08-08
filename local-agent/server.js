const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.LOCAL_AGENT_PORT || 4317;

app.use(cors());
app.use(express.json());

// Helper to run shell commands
function runCommand(command, cwd) {
  return new Promise((resolve, reject) => {
    console.log(`Running: "${command}" in ${cwd}`);
    exec(command, { cwd }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Command failed: "${command}". Error: ${error.message}`);
        resolve({ success: false, error: error.message, stdout, stderr });
      } else {
        resolve({ success: true, stdout, stderr });
      }
    });
  });
}

// Health Check Endpoint — Frontend uses this to detect if Local Agent is running
app.get('/health', (req, res) => {
  // Also check if docker daemon is reachable
  exec('docker info', (error, stdout, stderr) => {
    if (error) {
      return res.json({
        status: 'ok',
        agent: 'running',
        docker: 'unavailable',
        error: 'Docker daemon not running or not reachable'
      });
    }
    res.json({
      status: 'ok',
      agent: 'running',
      docker: 'available'
    });
  });
});

// Endpoint to execute a reproduction scenario
app.post('/reproduce', async (req, res) => {
  const { scenario_id } = req.body;

  if (!scenario_id) {
    return res.status(400).json({ error: 'scenario_id is required' });
  }

  const scenarioPath = path.resolve(__dirname, '..', 'scenarios', scenario_id);

  if (!fs.existsSync(scenarioPath)) {
    return res.status(404).json({ error: `Scenario "${scenario_id}" not found` });
  }

  console.log(`\n=== Starting reproduction for scenario: ${scenario_id} ===`);

  try {
    // 1. Clean up any existing containers from previous runs
    console.log('Cleaning up existing environment...');
    await runCommand('docker compose down -v', scenarioPath);

    // 2. Build and start containers
    console.log('Building and starting Docker containers...');
    const startResult = await runCommand('docker compose up --build -d', scenarioPath);
    if (!startResult.success) {
      return res.status(500).json({
        error: 'Failed to start Docker containers',
        details: startResult.error
      });
    }

    // 3. Run trigger script to execute request and capture output
    console.log('Running trigger script...');
    const triggerResult = await runCommand('bash trigger.sh', scenarioPath);

    // 4. Capture container logs
    console.log('Capturing container logs...');
    const logsResult = await runCommand('docker compose logs --no-color', scenarioPath);

    // 5. Clean up environment
    console.log('Cleaning up Docker environment...');
    await runCommand('docker compose down -v', scenarioPath);

    console.log(`=== Reproduction finished for ${scenario_id} ===\n`);

    res.json({
      success: true,
      trigger_output: triggerResult.stdout,
      trigger_error: triggerResult.stderr,
      trigger_success: triggerResult.success,
      container_logs: logsResult.stdout || logsResult.stderr || ''
    });

  } catch (err) {
    console.error('Reproduction pipeline crashed:', err);
    res.status(500).json({
      error: 'Reproduction pipeline crashed',
      message: err.message
    });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`====================================================`);
  console.log(` IT WORKED IN PROD - Local Agent running on http://localhost:${PORT}`);
  console.log(`====================================================`);
});
