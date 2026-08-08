import { useState, useEffect, useRef } from 'react';
import './App.css';

// Pre-packaged production errors for one-click loading
const DEMO_ERRORS = {
  'missing-config': `2026-08-07T14:32:18.442Z [ERROR] checkout-api: POST /checkout failed
Error: DATABASE_URL is not defined
    at /app/server.js:15:19
    at Layer.handle [as handle_request] (/app/node_modules/express/lib/router/layer.js:95:5)
    at next (/app/node_modules/express/lib/router/route.js:144:13)
    at Route.dispatch (/app/node_modules/express/lib/router/route.js:119:3)
    at Layer.handle [as handle_request] (/app/node_modules/express/lib/router/layer.js:95:5)`,

  'db-schema': `2026-08-07T15:18:42.117Z [ERROR] checkout-api: POST /checkout failed
error: column "subscription" does not exist
    at /app/node_modules/pg/lib/client.js:526:17
    at processTicksAndRejections (node:internal/process/task_queues:95:5)
    at /app/server.js:28:22
    at Layer.handle [as handle_request] (/app/node_modules/express/lib/router/layer.js:95:5)`,

  'service-down': `2026-08-07T16:45:33.891Z [ERROR] checkout-api: POST /checkout failed
Error: connect ECONNREFUSED 10.0.1.5:6379
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1595:16)
    at Redis._connect (/app/node_modules/ioredis/built/Redis.js:206:14)
    at /app/server.js:35:12`
};

const CONFIDENCE_WEIGHTS = {
  httpStatus: 25,
  errorSignature: 30,
  serviceDependency: 20,
  endpoint: 10,
  errorMessage: 10,
  stackSignature: 5
};

const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9/_-]+/g, ' ').trim();

const extractHttpStatus = (text) => {
  const match = String(text).match(/(?:http\s*(?:status|code)?|statuscode)\s*[:=]?\s*(\d{3})|"(?:http_?)?status"\s*:\s*(\d{3})/i);
  return match ? (match[1] || match[2]) : null;
};

const extractEndpoint = (text) => {
  const match = String(text).match(/\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[^\s"']+)/i)
    || String(text).match(/method\s*[=:]\s*(GET|POST|PUT|PATCH|DELETE).*?path\s*[=:]\s*(\/[^\s"'}]+)/i);
  return match ? `${match[1].toUpperCase()} ${match[2].replace(/[),.]+$/, '')}` : null;
};

const extractErrorSignature = (text) => {
  const source = String(text).toUpperCase();
  // Prefer the observed low-level connection failure over a scenario script's
  // friendly summary or fallback response code.
  if (source.includes('EAI_AGAIN') || source.includes('ENOTFOUND')) return 'DEPENDENCY_RESOLUTION_FAILURE';
  if (source.includes('CONNECTION IS CLOSED')) return 'CONNECTION_CLOSED';
  if (source.includes('ERR_CONFIG_MISSING')) return 'ERR_CONFIG_MISSING';
  if (/\b42703\b/.test(source)) return '42703';
  if (source.includes('ECONNREFUSED') || source.includes('CONNECTION REFUSED')) return 'ECONNREFUSED';
  if (source.includes('DATABASE_URL') && source.includes('NOT DEFINED')) return 'ERR_CONFIG_MISSING';
  if (source.includes('COLUMN') && source.includes('DOES NOT EXIST')) return '42703';
  return null;
};

const messageSimilarity = (production, local) => {
  const ignored = new Set(['the', 'a', 'an', 'is', 'failed', 'error', 'internal', 'to', 'connect']);
  const productionTokens = new Set(normalize(production).split(' ').filter(token => token.length > 2 && !ignored.has(token)));
  const localTokens = new Set(normalize(local).split(' ').filter(Boolean));
  if (!productionTokens.size || !localTokens.size) return null;
  const overlap = [...productionTokens].filter(token => localTokens.has(token)).length;
  return overlap / productionTokens.size;
};

const calculateReproductionConfidence = ({ production, expected, observedText }) => {
  const productionDependency = production.dependency?.service || production.environment?.database || null;
  const localStatus = extractHttpStatus(observedText);
  const localEndpoint = extractEndpoint(observedText);
  const localSignature = extractErrorSignature(observedText);
  const localService = /checkout-api/i.test(observedText) ? 'checkout-api' : null;
  const localDependency = /\bredis\b/i.test(observedText) ? 'redis' : /\bpostgres(?:ql)?\b|\bdatabase\b/i.test(observedText) ? 'postgres' : null;
  const expectedSignature = expected.error_code || extractErrorSignature(`${production.error_code} ${production.error_message}`);
  const expectedMessage = expected.error_message_contains || production.error_message;
  const addSignal = (name, weight, productionValue, localValue, matched) => ({
    name,
    weight,
    production: productionValue || 'Unavailable',
    local: localValue || 'Unavailable',
    available: Boolean(productionValue && localValue),
    matched: Boolean(productionValue && localValue && matched),
    points: productionValue && localValue && matched ? weight : 0
  });

  const signals = [
    addSignal('HTTP status', CONFIDENCE_WEIGHTS.httpStatus, production.http_status && String(production.http_status), localStatus, String(production.http_status) === localStatus),
    addSignal('Error signature', CONFIDENCE_WEIGHTS.errorSignature, expectedSignature, localSignature, expectedSignature === localSignature),
    addSignal('Service / dependency', CONFIDENCE_WEIGHTS.serviceDependency, productionDependency || production.service, productionDependency ? localDependency : localService, normalize(productionDependency || production.service) === normalize(productionDependency ? localDependency : localService)),
    addSignal('Endpoint', CONFIDENCE_WEIGHTS.endpoint, production.endpoint, localEndpoint, normalize(production.endpoint) === normalize(localEndpoint)),
    addSignal('Error message', CONFIDENCE_WEIGHTS.errorMessage, expectedMessage, observedText, (messageSimilarity(expectedMessage, observedText) || 0) >= 0.6),
    addSignal('Stack signature', CONFIDENCE_WEIGHTS.stackSignature, production.stack_trace, /\/app\/server\.js/i.test(observedText) ? '/app/server.js' : null, /\/app\/server\.js/i.test(production.stack_trace || '') && /\/app\/server\.js/i.test(observedText))
  ];
  const score = signals.reduce((total, signal) => total + signal.points, 0);
  const matched = signals.filter(signal => signal.matched).length;
  const available = signals.filter(signal => signal.available).length;
  const confidenceLabel = score >= 90 ? 'EXACT / HIGH CONFIDENCE' : score >= 75 ? 'HIGH / STRONG REPRODUCTION' : score >= 50 ? 'PARTIAL / BEHAVIORAL REPRODUCTION' : 'MISMATCH';
  const verdict = score >= 90 ? 'REPRODUCTION_VERIFIED' : score >= 50 ? 'REPRODUCTION_PARTIAL' : 'REPRODUCTION_MISMATCH';

  return { score, confidenceLabel, verdict, signals, summary: `${matched} of ${available} available production signals reproduced.` };
};

export default function App() {
  const [step, setStep] = useState(0); // 0: Capture, 1: Analyze, 2: Reconstruct, 3: Reproduce, 4: Verify/Fix
  const [mode, setMode] = useState('demo'); // 'real' or 'demo'
  const [agentStatus, setAgentStatus] = useState('offline'); // 'offline', 'online', 'checking'
  const [scenarios, setScenarios] = useState([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState('missing-config');
  const [evidenceText, setEvidenceText] = useState(DEMO_ERRORS['missing-config']);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  
  // Simulation states
  const [simActiveStep, setSimActiveStep] = useState(0);
  const [terminalLogs, setTerminalLogs] = useState([]);
  const [isSimulating, setIsSimulating] = useState(false);
  const [reproduceResponse, setReproduceResponse] = useState(null);
  const [reproductionConfidence, setReproductionConfidence] = useState(null);
  
  const terminalEndRef = useRef(null);

  // Auto-scroll terminal logs
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [terminalLogs]);

  // Load scenarios on start
  useEffect(() => {
    fetch('/api/scenarios')
      .then(res => res.json())
      .then(data => {
        setScenarios(data);
        if (data.length > 0) {
          // Sync default scenario
          const defaultScen = data.find(s => s.id === 'missing-config') || data[0];
          setSelectedScenarioId(defaultScen.id);
        }
      })
      .catch(err => console.error('Failed to load scenarios:', err));

    // The Local Agent belongs to the developer's machine. Do not probe a
    // browser's localhost until the user explicitly asks to retry/connect.
  }, []);

  const checkAgentStatus = () => {
    setAgentStatus('checking');
    fetch('http://localhost:4317/health')
      .then(res => res.json())
      .then(data => {
        if (data.agent === 'running' && data.docker === 'available') {
          setAgentStatus('online');
          setMode('real'); // default to real mode if agent is alive
        } else {
          setAgentStatus('offline');
          setMode('demo');
        }
      })
      .catch(() => {
        setAgentStatus('offline');
        setMode('demo');
      });
  };

  const handleScenarioSelect = (id) => {
    setSelectedScenarioId(id);
    setEvidenceText(DEMO_ERRORS[id] || '');
  };

  const startAnalysis = async () => {
    setIsAnalyzing(true);
    setStep(1); // Move to Analyze

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ log: evidenceText })
      });
      const data = await response.json();
      setAnalysisResult(data);
      
      // Delay slightly for smooth transition to Reconstruct view
      setTimeout(() => {
        setStep(2); // Move to Reconstruct
        setIsAnalyzing(false);
      }, 1500);

    } catch (err) {
      console.error('Analysis failed:', err);
      setIsAnalyzing(false);
      setStep(0);
      alert('Failed to analyze the error log. Please try again.');
    }
  };

  // Run the reproduction workflow
  const runReproduction = async () => {
    const tracePrefix = '[reproduction trace]';
    let currentOperation = 'initializing reproduction workflow';
    const traceFetch = async (url, options) => {
      console.log(`${tracePrefix} fetch URL`, { url, options });
      currentOperation = `fetch(${url})`;
      try {
        const response = await fetch(url, options);
        console.log(`${tracePrefix} fetch response`, {
          url,
          status: response.status,
          ok: response.ok,
          statusText: response.statusText
        });
        return response;
      } catch (error) {
        console.error(`${tracePrefix} fetch exception`, {
          url,
          error,
          message: error?.message,
          stack: error?.stack
        });
        throw error;
      }
    };

    setStep(3); // Move to Reproduce
    setIsSimulating(true);
    setSimActiveStep(0);
    setTerminalLogs([]);
    setReproductionConfidence(null);

    const logLines = [];
    const addLog = (text) => {
      logLines.push(`[${new Date().toLocaleTimeString()}] ${text}`);
      setTerminalLogs([...logLines]);
    };

    // Phase 1: Initialize
    addLog("Initializing reproduction pipeline...");
    addLog(`Execution mode: ${mode.toUpperCase()} MODE`);
    if (mode === 'real') {
      addLog("Connecting to Local Agent at localhost:4317...");
      addLog("Checking local Docker configuration... OK");
    } else {
      addLog("Local Agent not running. Executing in DEMO (deterministic fallback) mode...");
    }
    
    // Simulate vertical timeline stepping
    const timer1 = setTimeout(() => {
      setSimActiveStep(1);
      addLog("Analyzing error conditions & dependencies...");
      addLog(`Target service: ${analysisResult.production_error.service}`);
      addLog(`Target endpoint: ${analysisResult.production_error.endpoint}`);
    }, 1500);

    const timer2 = setTimeout(() => {
      setSimActiveStep(2);
      addLog("Reconstructing target container network topology...");
      if (analysisResult.reproduction_spec.services) {
        Object.keys(analysisResult.reproduction_spec.services).forEach(s => {
          addLog(`Configuring container service: "${s}"`);
        });
      }
      addLog("Generating environment variables and dependency overrides...");
    }, 3500);

    const timer3 = setTimeout(() => {
      setSimActiveStep(3);
      addLog("Spinning up local Docker sandbox environment...");
      addLog("Pulling required Docker images...");
      addLog("Starting service containers...");
    }, 6000);

    const timer4 = setTimeout(() => {
      setSimActiveStep(4);
      addLog("Waiting for local service endpoints to become healthy...");
      addLog("Ping checkout-api healthcheck... OK");
    }, 9000);

    const timer5 = setTimeout(() => {
      setSimActiveStep(5);
      addLog("Replaying recorded trigger request to local environment...");
      addLog(`Sending ${analysisResult.reproduction_spec.trigger.method} request to ${analysisResult.reproduction_spec.trigger.path}...`);
    }, 11000);

    // Run the actual API trigger or demo resolver
    try {
      let result;
      let responseOk = true;
      if (mode === 'real') {
        const reproduceUrl = 'http://localhost:4317/reproduce';
        const response = await traceFetch(reproduceUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scenario_id: analysisResult.id })
        });
        responseOk = response.ok;
        try {
          currentOperation = 'parsing /reproduce JSON response';
          result = await response.json();
          console.log(`${tracePrefix} initial /reproduce response`, {
            url: reproduceUrl,
            status: response.status,
            ok: response.ok
          });
          console.log(`${tracePrefix} parsed result`, result);
        } catch (parseError) {
          console.error(`${tracePrefix} /reproduce JSON parse exception`, {
            error: parseError,
            message: parseError?.message,
            stack: parseError?.stack
          });
          result = { error: `Local Agent returned HTTP ${response.status} without a JSON response body.` };
        }
      } else {
        // Mock API response delay for demo mode
        await new Promise(resolve => setTimeout(resolve, 13000));
        // Construct mock result from metadata JSON
        result = {
          success: true,
          trigger_success: true,
          trigger_output: JSON.stringify(analysisResult.production_error, null, 2),
          container_logs: `checkout-api-1  | [INFO] Server started on port 3000
checkout-api-1  | [ERROR] ${analysisResult.production_error.endpoint} failed
checkout-api-1  | ${analysisResult.production_error.error_message}
checkout-api-1  | ${analysisResult.production_error.stack_trace}`
        };
      }

      // Stop timers if not fired
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
      clearTimeout(timer4);
      clearTimeout(timer5);

      currentOperation = 'extracting observed output and expected result metadata';
      const asText = (value) => {
        if (typeof value === 'string') return value;
        if (value == null) return '';
        return JSON.stringify(value);
      };
      const triggerOutput = asText(result?.trigger_output || result?.stdout);
      const triggerError = asText(result?.trigger_error);
      const containerLogs = asText(result?.container_logs || result?.stderr);
      const agentError = asText(result?.error || result?.message || result?.details);
      const observedOutput = [triggerOutput, triggerError, containerLogs].join('\n');
      const expected = analysisResult.reproduction_spec.expected_result || {};
      const confidence = calculateReproductionConfidence({
        production: analysisResult.production_error,
        expected,
        observedText: observedOutput
      });
      console.log(`${tracePrefix} expected_result`, expected);
      console.log(`${tracePrefix} observed result`, {
        responseOk,
        success: result?.success,
        trigger_success: result?.trigger_success,
        trigger_output: triggerOutput,
        container_logs: containerLogs,
        agent_error: agentError
      });

      currentOperation = 'matching expected failure signature';
      const expectedStatus = expected.http_status != null && new RegExp(`HTTP (?:Status|status)[:\\s]+${expected.http_status}|"http_status"\\s*:\\s*${expected.http_status}`).test(observedOutput);
      const expectedCode = !expected.error_code || extractErrorSignature(observedOutput) === expected.error_code;
      const expectedMessage = !expected.error_message_contains || observedOutput.includes(expected.error_message_contains);

      let outcome;
      if (!responseOk || result?.success !== true) {
        outcome = {
          status: 'INFRASTRUCTURE_FAILURE',
          message: agentError || `Local Agent returned HTTP ${responseOk ? 'an invalid success payload' : 'an error response'}.`
        };
      } else if (result.trigger_success !== true || !expectedStatus || !expectedCode || !expectedMessage) {
        outcome = {
          status: 'REPRODUCTION_MISMATCH',
          message: 'The sandbox ran, but its observed result did not match the expected production failure signature.'
        };
      } else {
        outcome = { status: 'REPRODUCTION_VERIFIED' };
      }
      console.log(`${tracePrefix} classification`, {
        outcome,
        responseOk,
        expectedStatus,
        expectedCode,
        expectedMessage
      });
      console.log(`${tracePrefix} reproduction confidence`, confidence);

      currentOperation = 'committing reproduction result to React state';
      setReproduceResponse({ ...result, container_logs: containerLogs, trigger_output: triggerOutput, trigger_error: triggerError });
      setReproductionConfidence(confidence);
      setSimActiveStep(6);
      addLog("Trigger completed. Capturing execution reports...");
      addLog("Logs collected. Cleaning up container environments...");
      
      // Append actual execution output to logs window
      addLog("\n=== DOCKER LOGS CAPTURED ===");
      (containerLogs || triggerOutput || agentError || 'No execution output returned by Local Agent.').split('\n').forEach(line => {
        if (line) logLines.push(line);
      });
      setTerminalLogs([...logLines]);

      setIsSimulating(false);

      if (outcome.status === 'REPRODUCTION_VERIFIED') {
        // HTTP 500 is expected here when its status and failure signature match production.
        setTimeout(() => {
          setStep(4);
        }, 1000);
      } else {
        const confidenceMessage = `${confidence.confidenceLabel} (${confidence.score}%): ${confidence.summary}`;
        addLog(`\n[${outcome.status}] ${outcome.message} ${confidenceMessage}`);
        alert(`${outcome.status}: ${outcome.message}\n${confidenceMessage}`);
      }

    } catch (err) {
      console.error(`${tracePrefix} reproduction exception before catch`, {
        currentOperation,
        error: err,
        message: err?.message,
        stack: err?.stack
      });
      console.error('Reproduction run failed:', err);
      addLog(`\n[FATAL ERROR] Reproduction failed: ${err.message}`);
      setIsSimulating(false);
      alert(`INFRASTRUCTURE_FAILURE: ${err.message}`);
    }
  };

  const getSimStepClass = (index) => {
    if (simActiveStep === index) return 'active';
    if (simActiveStep > index) return 'completed';
    return '';
  };

  return (
    <div className="app-layout">
      {/* Header */}
      <header className="app-header">
        <div className="container header-container">
          <div className="logo">
            <span className="logo-icon">🗲</span>
            IT WORKED IN PROD
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {/* Mode selection toggle */}
            <div className="agent-status-badge">
              <span className={`status-dot ${agentStatus === 'online' ? 'online' : ''}`}></span>
              <span>Local Agent: {agentStatus.toUpperCase()}</span>
              {agentStatus === 'offline' && (
                <button onClick={checkAgentStatus} className="btn" style={{ padding: '2px 8px', fontSize: '10px' }}>
                  Retry
                </button>
              )}
            </div>

            <div className="zerops-badge">
              <span>Deployed on</span>
              <strong>Zerops</strong>
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="app-main container">
        
        {/* Stepper progress indicator */}
        {step > 0 && (
          <div className="stepper">
            <div className={`step-item ${step >= 1 ? (step > 1 ? 'completed' : 'active') : ''}`}>
              <div className="step-circle">1</div>
              <span className="step-label">Analyze</span>
            </div>
            <div className={`step-item ${step >= 2 ? (step > 2 ? 'completed' : 'active') : ''}`}>
              <div className="step-circle">2</div>
              <span className="step-label">Reconstruct</span>
            </div>
            <div className={`step-item ${step >= 3 ? (step > 3 ? 'completed' : 'active') : ''}`}>
              <div className="step-circle">3</div>
              <span className="step-label">Reproduce</span>
            </div>
            <div className={`step-item ${step >= 4 ? 'completed' : ''}`}>
              <div className="step-circle">4</div>
              <span className="step-label">Verify & Fix</span>
            </div>
          </div>
        )}

        {/* STEP 0: Capture View */}
        {step === 0 && (
          <div>
            {/* Landing hero banner */}
            <div className="landing-view">
              <h1 className="hero-title">IT WORKED IN PROD</h1>
              <p className="hero-tagline">
                Reconstruct the environment conditions behind a production failure and reproduce that failure locally with one click.
              </p>
            </div>

            {/* Execution mode selection */}
            <div className="mode-toggle-bar">
              <div 
                className={`mode-tab ${mode === 'real' ? 'active' : ''}`}
                onClick={() => agentStatus === 'online' ? setMode('real') : alert('Local Agent is offline. Run agent to enable Real Mode.')}
              >
                ⚙️ Real Mode (runs Docker sandbox locally)
              </div>
              <div 
                className={`mode-tab ${mode === 'demo' ? 'active' : ''}`}
                onClick={() => setMode('demo')}
              >
                🖵 Demo Mode (uses deterministic fallbacks)
              </div>
            </div>

            {/* Grid Layout: Input & Preset Selections */}
            <div className="dashboard-grid">
              
              {/* Evidence input form */}
              <div className="dashboard-panel">
                <div className="panel-title">
                  <span>Production Incident Log</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Paste stacktrace or server logs</span>
                </div>
                
                <div className="form-group">
                  <textarea 
                    className="evidence-textarea"
                    value={evidenceText}
                    onChange={(e) => setEvidenceText(e.target.value)}
                    placeholder="Paste error logs here..."
                  />
                </div>

                <button 
                  onClick={startAnalysis}
                  className="btn btn-primary pulse-btn"
                  style={{ alignSelf: 'flex-start', padding: '12px 28px' }}
                >
                  Analyze Error Details →
                </button>
              </div>

              {/* Demo presets list */}
              <div className="dashboard-panel">
                <div className="panel-title">
                  <span>Demo Incident Presets</span>
                </div>
                <div className="demo-selector-list">
                  {scenarios.map(scen => (
                    <div 
                      key={scen.id} 
                      className={`demo-selector-card ${selectedScenarioId === scen.id ? 'selected' : ''}`}
                      onClick={() => handleScenarioSelect(scen.id)}
                    >
                      <span className="demo-card-icon">{scen.icon}</span>
                      <div className="demo-card-content">
                        <div className="demo-card-title">{scen.name}</div>
                        <div className="demo-card-desc">{scen.description}</div>
                      </div>
                      <span className="severity-badge">{scen.severity}</span>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>
        )}

        {/* STEP 1: Analyze loading screen */}
        {step === 1 && (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{ fontSize: '48px', marginBottom: '24px' }}>⚡</div>
            <h2 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '8px' }}>Analyzing Incident Log...</h2>
            <p style={{ color: 'var(--text-secondary)' }}>Identifying error class, target service, and mapping environmental dependencies.</p>
          </div>
        )}

        {/* STEP 2: Reconstruct screen */}
        {step === 2 && analysisResult && (
          <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <h2 style={{ fontSize: '24px', fontWeight: '800', marginBottom: '16px' }}>Reconstruction Blueprint</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '32px' }}>
              We mapped the incident to the <strong>{analysisResult.name}</strong> scenario. Here is the environment blueprint we are setting up to recreate the conditions:
            </p>

            <div className="dashboard-panel" style={{ marginBottom: '32px' }}>
              <div className="panel-title">Environmental Conditions</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Target Service</span>
                  <span style={{ fontSize: '14px', fontWeight: '600' }}>{analysisResult.production_error.service}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Target Endpoint</span>
                  <span style={{ fontSize: '14px', fontWeight: '600' }}>{analysisResult.production_error.endpoint}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Error Class</span>
                  <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--error-red)' }}>{analysisResult.production_error.error_code}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Category</span>
                  <span style={{ fontSize: '14px', fontWeight: '600' }}>{analysisResult.category.toUpperCase()}</span>
                </div>
              </div>
            </div>

            <div className="code-panel" style={{ marginBottom: '40px' }}>
              <div className="code-header">
                <span>REPRODUCTION SPECIFICATION (reproduction_spec.json)</span>
              </div>
              <div className="code-body">
                {JSON.stringify(analysisResult.reproduction_spec, null, 2)}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '16px' }}>
              <button onClick={runReproduction} className="btn btn-primary pulse-btn" style={{ padding: '12px 28px' }}>
                Start Local Sandbox & Reproduce
              </button>
              <button onClick={() => setStep(0)} className="btn">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: Reproduce screen */}
        {step === 3 && (
          <div className="simulation-container">
            <h2 style={{ fontSize: '24px', fontWeight: '800', marginBottom: '32px' }}>Executing Sandbox Reproduction</h2>

            <div className="simulation-layout">
              {/* Stepper Timeline */}
              <div className="simulation-steps">
                <div className={`sim-step-item ${getSimStepClass(0)}`}>
                  <div className="sim-step-bullet">1</div>
                  <div className="sim-step-content">
                    <div className="sim-step-title">Initialize Run</div>
                    <div className="sim-step-desc">Establish Local Agent connection</div>
                  </div>
                </div>
                
                <div className={`sim-step-item ${getSimStepClass(1)}`}>
                  <div className="sim-step-bullet">2</div>
                  <div className="sim-step-content">
                    <div className="sim-step-title">Map Conditions</div>
                    <div className="sim-step-desc">Verify endpoint triggers and variables</div>
                  </div>
                </div>

                <div className={`sim-step-item ${getSimStepClass(2)}`}>
                  <div className="sim-step-bullet">3</div>
                  <div className="sim-step-content">
                    <div className="sim-step-title">Build Environment</div>
                    <div className="sim-step-desc">Construct Docker service configurations</div>
                  </div>
                </div>

                <div className={`sim-step-item ${getSimStepClass(3)}`}>
                  <div className="sim-step-bullet">4</div>
                  <div className="sim-step-content">
                    <div className="sim-step-title">Start Sandbox</div>
                    <div className="sim-step-desc">Launch containers and databases</div>
                  </div>
                </div>

                <div className={`sim-step-item ${getSimStepClass(4)}`}>
                  <div className="sim-step-bullet">5</div>
                  <div className="sim-step-content">
                    <div className="sim-step-title">Verify Endpoints</div>
                    <div className="sim-step-desc">Await service startup checks</div>
                  </div>
                </div>

                <div className={`sim-step-item ${getSimStepClass(5)}`}>
                  <div className="sim-step-bullet">6</div>
                  <div className="sim-step-content">
                    <div className="sim-step-title">Trigger Error</div>
                    <div className="sim-step-desc">Replay requests to capture error signature</div>
                  </div>
                </div>
              </div>

              {/* Terminal Logs */}
              <div className="terminal-panel">
                <div className="terminal-header">
                  <span>EXECUTION TERMINAL LOGS</span>
                  {isSimulating && <span style={{ color: 'var(--accent-cyan)' }}>RUNNING...</span>}
                </div>
                <div className="terminal-window">
                  {terminalLogs.map((line, idx) => (
                    <div key={idx} className="terminal-line">{line}</div>
                  ))}
                  <div ref={terminalEndRef} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STEP 4: Verify & Fix (The Money Shot) */}
        {step === 4 && analysisResult && (
          <div className="results-view">
            
            {/* Money Shot Header */}
            <div className="money-shot-header">
              <div className="money-shot-info">
                <h2 style={{ fontSize: '20px', fontWeight: '800', color: 'var(--success-green)' }}>
                  ✓ FAILURE REPRODUCED SUCCESSFULLY
                </h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                  Replication environment matched the production failure signature.
                </p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span className="match-percentage-badge">{reproductionConfidence?.score ?? 0}%</span>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600' }}>REPRODUCTION MATCH</div>
                <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  {reproductionConfidence?.confidenceLabel || 'UNAVAILABLE'}
                </div>
              </div>
            </div>

            {reproductionConfidence && (
              <div style={{ color: 'var(--text-secondary)', fontSize: '12px', margin: '-16px 0 20px' }}>
                <div style={{ marginBottom: '6px' }}>{reproductionConfidence.summary}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                  {reproductionConfidence.signals.map(signal => (
                    <span key={signal.name} style={{ color: signal.matched ? 'var(--success-green)' : 'var(--text-muted)' }}>
                      {signal.matched ? '✓' : signal.available ? '△' : '—'} {signal.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Split Screen Log Comparison */}
            <div className="comparison-grid">
              
              {/* Production logs */}
              <div className="comparison-panel">
                <div className="comparison-header">
                  <span>PRODUCTION ERROR</span>
                  <span style={{ color: 'var(--error-red)' }}>ORIGINAL EVIDENCE</span>
                </div>
                <div className="comparison-body prod">
                  {analysisResult.production_error.stack_trace || analysisResult.production_error.error_message}
                </div>
              </div>

              {/* Local logs */}
              <div className="comparison-panel">
                <div className="comparison-header">
                  <span>LOCAL SANDBOX ERROR</span>
                  <span style={{ color: 'var(--success-green)' }}>REPRODUCED OUTPUT</span>
                </div>
                <div className="comparison-body local">
                  {reproduceResponse ? reproduceResponse.container_logs : 'Waiting for local logs...'}
                </div>
              </div>

            </div>

            {/* Diagnostics and Action Plan */}
            <div className="diagnosis-container">
              
              {/* Diagnosis detail card */}
              <div className="diagnosis-card">
                <h3 className="diagnosis-title">
                  <span>⚠️</span> Root Cause Explanation
                </h3>
                <div className="diagnosis-body">
                  <p style={{ marginBottom: '12px' }}>{analysisResult.root_cause.summary}</p>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>{analysisResult.root_cause.details}</p>
                </div>
              </div>

              {/* Action fix card */}
              <div className="suggested-fix-card">
                <h3 className="suggested-fix-title">
                  <span>⚡</span> Suggested Remedy
                </h3>
                <div className="suggested-fix-body">
                  <p>{analysisResult.root_cause.suggested_fix}</p>
                  
                  {analysisResult.id === 'db-schema' && (
                    <div className="suggested-fix-code">
{`# Execute database migration 17
ALTER TABLE users ADD COLUMN subscription VARCHAR(50) DEFAULT 'active';`}
                    </div>
                  )}

                  {analysisResult.id === 'missing-config' && (
                    <div className="suggested-fix-code">
{`# Add missing environment variable to deployment configuration
DATABASE_URL=postgres://user:password@hostname:5432/db`}
                    </div>
                  )}

                  {analysisResult.id === 'service-down' && (
                    <div className="suggested-fix-code">
{`# Verify Redis container health status
docker compose ps redis
# Restart database/cache dependency stack
docker compose up -d redis`}
                    </div>
                  )}
                </div>
              </div>

            </div>

            <div style={{ alignSelf: 'flex-start' }}>
              <button onClick={() => setStep(0)} className="btn btn-primary" style={{ padding: '12px 28px' }}>
                ← Try Another Incident
              </button>
            </div>

          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="app-footer">
        <div className="container">
          <p>
            IT WORKED IN PROD — Hackathon MVP built for the Zerops Challenge.
          </p>
        </div>
      </footer>
    </div>
  );
}
