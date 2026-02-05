/**
 * TracName - P2P Identity Verification Service for Intercom
 *
 * The blue checkmark of the Trac Network.
 * A name registry service that:
 * - Allows agents to register unique names linked to their public key
 * - Provides name lookup (who owns this name?)
 * - Provides key verification (what name belongs to this key?)
 * - Announces presence on "0000intercom"
 * - Stores all registrations locally for persistence
 */

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  wsUrl: 'ws://127.0.0.1:49222',
  mainChannel: 'tracname',
  entryChannel: '0000intercom',
  announceIntervalMs: 5 * 60 * 1000, // 5 minutes
  namesFile: path.join(__dirname, 'names.json'),
  tracAddress: 'trac1vfcs9v234ulchzkwghz67wz3ztl9kuxvp8ck3lpfcgpn2srqm29shg086j',
  version: '1.0.0',
  reconnectDelayMs: 5000,
  // Name validation rules
  nameMinLength: 3,
  nameMaxLength: 32,
  namePattern: /^[a-zA-Z0-9_-]+$/
};

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const result = { token: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--token' && args[i + 1]) {
      result.token = args[i + 1];
      i++;
    }
  }

  return result;
}

// State
let ws = null;
let authenticated = false;
let names = [];
let startTime = Date.now();
let announceInterval = null;
let token = null;

// Load names from file
function loadNames() {
  try {
    if (fs.existsSync(CONFIG.namesFile)) {
      const data = fs.readFileSync(CONFIG.namesFile, 'utf8');
      names = JSON.parse(data);
      console.log(`[TracName] Loaded ${names.length} existing names from storage`);
    }
  } catch (err) {
    console.error('[TracName] Error loading names:', err.message);
    names = [];
  }
}

// Save names to file
function saveNames() {
  try {
    fs.writeFileSync(CONFIG.namesFile, JSON.stringify(names, null, 2));
  } catch (err) {
    console.error('[TracName] Error saving names:', err.message);
  }
}

// Generate next certificate ID
function getNextCertificateId() {
  const num = names.length + 1;
  return `TN-${String(num).padStart(5, '0')}`;
}

// Validate name format
function validateName(name) {
  if (!name || typeof name !== 'string') {
    return { valid: false, message: 'Name must be a non-empty string' };
  }

  if (name.length < CONFIG.nameMinLength) {
    return { valid: false, message: `Name must be at least ${CONFIG.nameMinLength} characters` };
  }

  if (name.length > CONFIG.nameMaxLength) {
    return { valid: false, message: `Name must be at most ${CONFIG.nameMaxLength} characters` };
  }

  if (!CONFIG.namePattern.test(name)) {
    return { valid: false, message: 'Name can only contain letters, numbers, hyphens, and underscores' };
  }

  return { valid: true };
}

// Check if name is already taken (case-insensitive)
function isNameTaken(name) {
  const nameLower = name.toLowerCase();
  return names.find(n => n.name_lower === nameLower);
}

// Find name by public key
function findNameByPublicKey(publicKey) {
  return names.filter(n => n.public_key === publicKey);
}

// Find name entry by name (case-insensitive)
function findNameEntry(name) {
  const nameLower = name.toLowerCase();
  return names.find(n => n.name_lower === nameLower);
}

// Register a new name
function registerName(name, publicKey) {
  const validation = validateName(name);
  if (!validation.valid) {
    return {
      success: false,
      message: validation.message
    };
  }

  const existing = isNameTaken(name);
  if (existing) {
    return {
      success: false,
      name: name,
      message: `Name '${name}' is already taken`,
      owned_by: existing.public_key
    };
  }

  const certificateId = getNextCertificateId();
  const registeredAt = new Date().toISOString();

  const entry = {
    certificate_id: certificateId,
    name: name,
    name_lower: name.toLowerCase(),
    public_key: publicKey,
    registered_at: registeredAt
  };

  names.push(entry);
  saveNames();

  console.log(`[TracName] Registered '${name}' -> ${publicKey.substring(0, 16)}... (${certificateId})`);

  return {
    success: true,
    name: name,
    public_key: publicKey,
    registered_at: registeredAt,
    certificate_id: certificateId,
    message: `Name '${name}' successfully registered`
  };
}

// Lookup a name
function lookupName(name) {
  const entry = findNameEntry(name);
  if (entry) {
    return {
      found: true,
      name: entry.name,
      public_key: entry.public_key,
      registered_at: entry.registered_at,
      certificate_id: entry.certificate_id
    };
  }
  return {
    found: false,
    name: name,
    message: `Name '${name}' not found`
  };
}

// Verify a public key
function verifyPublicKey(publicKey) {
  const entries = findNameByPublicKey(publicKey);
  if (entries.length > 0) {
    // Return the first name (primary) but indicate if there are more
    const primary = entries[0];
    return {
      found: true,
      public_key: publicKey,
      name: primary.name,
      registered_at: primary.registered_at,
      certificate_id: primary.certificate_id,
      total_names: entries.length
    };
  }
  return {
    found: false,
    public_key: publicKey,
    message: 'No name registered for this public key'
  };
}

// Get statistics
function getStats() {
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  return {
    type: 'stats_response',
    total_names: names.length,
    uptime_seconds: uptimeSeconds,
    last_certificate_id: names.length > 0 ? names[names.length - 1].certificate_id : null,
    service: 'TracName',
    version: CONFIG.version
  };
}

// Get service announcement message
function getAnnouncement() {
  return {
    type: 'service_announce',
    service: 'TracName',
    description: 'P2P identity verification service - the blue checkmark of the Trac Network',
    channel: CONFIG.mainChannel,
    version: CONFIG.version,
    commands: ['register', 'lookup', 'verify', 'stats_request'],
    total_names: names.length
  };
}

// Send message to a channel
function sendToChannel(channel, message) {
  if (ws && ws.readyState === WebSocket.OPEN && authenticated) {
    ws.send(JSON.stringify({
      type: 'send',
      channel: channel,
      message: message
    }));
  }
}

// Handle incoming sidechannel message
function handleSidechannelMessage(msg) {
  const { channel, message, from } = msg;

  // Only process messages on our main channel
  if (channel !== CONFIG.mainChannel) {
    return;
  }

  // Parse the message if it's a string
  let payload = message;
  if (typeof message === 'string') {
    try {
      payload = JSON.parse(message);
    } catch {
      console.log('[TracName] Received non-JSON message, ignoring');
      return;
    }
  }

  if (!payload || !payload.type) {
    return;
  }

  console.log(`[TracName] Received ${payload.type} from ${from ? from.substring(0, 16) + '...' : 'unknown'}`);

  switch (payload.type) {
    case 'register': {
      if (!payload.name) {
        sendToChannel(CONFIG.mainChannel, {
          type: 'register_response',
          success: false,
          message: 'Missing name field in register request'
        });
        return;
      }

      if (!from) {
        sendToChannel(CONFIG.mainChannel, {
          type: 'register_response',
          success: false,
          message: 'Cannot register: unable to identify sender'
        });
        return;
      }

      // Use the 'from' field as the public key (provided by the network)
      const result = registerName(payload.name, from);
      sendToChannel(CONFIG.mainChannel, {
        type: 'register_response',
        ...result
      });
      break;
    }

    case 'lookup': {
      if (!payload.name) {
        sendToChannel(CONFIG.mainChannel, {
          type: 'lookup_response',
          found: false,
          message: 'Missing name field in lookup request'
        });
        return;
      }

      const result = lookupName(payload.name);
      sendToChannel(CONFIG.mainChannel, {
        type: 'lookup_response',
        ...result
      });
      console.log(`[TracName] Lookup '${payload.name}': ${result.found ? 'FOUND' : 'NOT FOUND'}`);
      break;
    }

    case 'verify': {
      if (!payload.public_key) {
        sendToChannel(CONFIG.mainChannel, {
          type: 'verify_response',
          found: false,
          message: 'Missing public_key field in verify request'
        });
        return;
      }

      const result = verifyPublicKey(payload.public_key);
      sendToChannel(CONFIG.mainChannel, {
        type: 'verify_response',
        ...result
      });
      console.log(`[TracName] Verify ${payload.public_key.substring(0, 16)}...: ${result.found ? result.name : 'NOT FOUND'}`);
      break;
    }

    case 'stats_request': {
      const stats = getStats();
      sendToChannel(CONFIG.mainChannel, stats);
      console.log(`[TracName] Stats sent: ${stats.total_names} names, uptime ${stats.uptime_seconds}s`);
      break;
    }

    default:
      console.log(`[TracName] Unknown message type: ${payload.type}`);
  }
}

// Handle WebSocket message
function handleWsMessage(data) {
  let msg;
  try {
    msg = JSON.parse(data.toString());
  } catch {
    console.error('[TracName] Invalid JSON from SC-Bridge');
    return;
  }

  switch (msg.type) {
    case 'hello':
      console.log('[TracName] Received hello from SC-Bridge');
      break;

    case 'auth_ok':
      console.log('[TracName] Authenticated successfully');
      authenticated = true;
      // Join the tracname channel
      ws.send(JSON.stringify({ type: 'join', channel: CONFIG.mainChannel }));
      // Start periodic announcements
      startAnnouncements();
      break;

    case 'joined':
      console.log(`[TracName] Joined channel: ${msg.channel || CONFIG.mainChannel}`);
      // Send initial announcement
      setTimeout(() => {
        sendToChannel(CONFIG.entryChannel, getAnnouncement());
        console.log('[TracName] Sent initial service announcement to 0000intercom');
      }, 1000);
      break;

    case 'sent':
      // Message sent confirmation
      break;

    case 'sidechannel_message':
      handleSidechannelMessage(msg);
      break;

    case 'error':
      console.error('[TracName] SC-Bridge error:', msg.message || msg.error || JSON.stringify(msg));
      break;

    default:
      // Ignore other message types
      break;
  }
}

// Start periodic announcements
function startAnnouncements() {
  if (announceInterval) {
    clearInterval(announceInterval);
  }

  announceInterval = setInterval(() => {
    if (authenticated) {
      sendToChannel(CONFIG.entryChannel, getAnnouncement());
      console.log('[TracName] Sent periodic service announcement');
    }
  }, CONFIG.announceIntervalMs);
}

// Connect to SC-Bridge
function connect() {
  console.log(`[TracName] Connecting to SC-Bridge at ${CONFIG.wsUrl}...`);

  ws = new WebSocket(CONFIG.wsUrl);

  ws.on('open', () => {
    console.log('[TracName] WebSocket connected, authenticating...');
    ws.send(JSON.stringify({ type: 'auth', token: token }));
  });

  ws.on('message', handleWsMessage);

  ws.on('close', () => {
    console.log('[TracName] WebSocket disconnected');
    authenticated = false;
    if (announceInterval) {
      clearInterval(announceInterval);
      announceInterval = null;
    }
    // Reconnect after delay
    setTimeout(connect, CONFIG.reconnectDelayMs);
  });

  ws.on('error', (err) => {
    console.error('[TracName] WebSocket error:', err.message);
  });
}

// Main entry point
function main() {
  const args = parseArgs();

  if (!args.token) {
    console.error('Usage: node tracname.js --token <SC_BRIDGE_TOKEN>');
    console.error('');
    console.error('The token must match the --sc-bridge-token used when starting Intercom.');
    process.exit(1);
  }

  token = args.token;

  console.log('');
  console.log('================================================');
  console.log('  TracName - P2P Identity Verification Service  ');
  console.log('  The Blue Checkmark of the Trac Network        ');
  console.log('================================================');
  console.log(`Version: ${CONFIG.version}`);
  console.log(`Channel: ${CONFIG.mainChannel}`);
  console.log(`Address: ${CONFIG.tracAddress}`);
  console.log('');

  // Load existing names
  loadNames();

  // Connect to SC-Bridge
  connect();

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[TracName] Shutting down...');
    if (announceInterval) {
      clearInterval(announceInterval);
    }
    if (ws) {
      ws.close();
    }
    process.exit(0);
  });
}

main();
