/**
 * TracName v2 - Paid On-chain P2P Identity Verification Service for Intercom
 *
 * The blue checkmark of the Trac Network.
 * Features:
 * - Paid registration (1 TNK per name)
 * - On-chain storage via Intercom contracts
 * - Payment verification via Explorer API
 * - Free lookups and verifications
 */

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  wsUrl: 'ws://127.0.0.1:49222',
  mainChannel: 'tracname',
  entryChannel: '0000intercom',
  tracAddress: 'trac1vfcs9v234ulchzkwghz67wz3ztl9kuxvp8ck3lpfcgpn2srqm29shg086j',
  version: '2.0.0',
  registrationFee: 1.0,
  paymentTimeoutMs: 10 * 60 * 1000,       // 10 minutes to pay
  paymentCheckRetries: 6,
  paymentCheckIntervalMs: 10 * 1000,      // 10 sec between checks
  explorerBaseUrl: 'https://explorer.trac.network',
  announceIntervalMs: 5 * 60 * 1000,
  reconnectDelayMs: 5000,
  cleanupIntervalMs: 60 * 1000,
  pendingFile: path.join(__dirname, 'pending.json'),
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
let startTime = Date.now();
let announceInterval = null;
let cleanupInterval = null;
let token = null;
let totalNames = 0;

// Pending registrations awaiting payment (in memory)
const pendingPayments = new Map();

// Pending registrations with verified payment (persisted for crash recovery)
let pendingWrites = {};

// CLI callback system
const pendingCliCallbacks = new Map();
let cliCallbackCounter = 0;

// Load pending writes from file (crash recovery)
function loadPendingWrites() {
  try {
    if (fs.existsSync(CONFIG.pendingFile)) {
      const data = fs.readFileSync(CONFIG.pendingFile, 'utf8');
      pendingWrites = JSON.parse(data);
      const count = Object.keys(pendingWrites).length;
      if (count > 0) {
        console.log(`[TracName] Loaded ${count} pending writes from storage (crash recovery)`);
      }
    }
  } catch (err) {
    console.error('[TracName] Error loading pending writes:', err.message);
    pendingWrites = {};
  }
}

// Save pending writes to file
function savePendingWrites() {
  try {
    fs.writeFileSync(CONFIG.pendingFile, JSON.stringify(pendingWrites, null, 2));
  } catch (err) {
    console.error('[TracName] Error saving pending writes:', err.message);
  }
}

// Remove a pending write
function removePendingWrite(requestId) {
  delete pendingWrites[requestId];
  savePendingWrites();
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

// Convert raw amount (18 decimals) to TNK
function rawToTNK(amountRaw) {
  const raw = BigInt(amountRaw);
  const decimals = BigInt('1000000000000000000');
  return Number(raw / decimals) + Number(raw % decimals) / Number(decimals);
}

// Verify payment via Explorer API
async function verifyPayment(fromAddress, toAddress, minAmountTNK, afterTimestamp) {
  const minAmountRaw = BigInt(Math.floor(minAmountTNK * 1000)) * BigInt('1000000000000000');

  try {
    const response = await fetch(
      `${CONFIG.explorerBaseUrl}/api/transactions?offset=0&max=50&address=${toAddress}`
    );
    const data = await response.json();
    const transactions = JSON.parse(data.transactions);

    const match = transactions.find(tx => {
      const txTime = new Date(tx.createdAt).getTime();
      return (
        tx.address === fromAddress &&
        tx.to === toAddress &&
        BigInt(tx.am) >= minAmountRaw &&
        txTime >= afterTimestamp &&
        tx.type === 13
      );
    });

    if (match) {
      return {
        verified: true,
        tx_hash: match.tx,
        tx_id: match.id,
        amount_tnk: rawToTNK(match.am),
        timestamp: match.createdAt,
        confirmations: match.confirmed_length
      };
    }
  } catch (error) {
    console.error('[TracName] Payment verification error:', error.message);
  }

  return { verified: false };
}

// Send CLI command and wait for result
function sendCli(command) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !authenticated) {
      reject(new Error('WebSocket not connected'));
      return;
    }

    const id = ++cliCallbackCounter;
    const uniqueKey = `${id}::${command}`;  // Unique key to avoid collisions
    const timeoutId = setTimeout(() => {
      pendingCliCallbacks.delete(uniqueKey);
      reject(new Error('CLI timeout'));
    }, 30000);

    pendingCliCallbacks.set(uniqueKey, { resolve, reject, timeoutId, id, command });
    ws.send(JSON.stringify({ type: 'cli', command }));
  });
}

// Read from contract state
async function contractGet(key) {
  try {
    const result = await sendCli(`/get --key "${key}"`);
    return result.result;
  } catch (err) {
    console.error('[TracName] Contract get error:', err.message);
    return null;
  }
}

// Execute transaction on contract
async function contractTx(command, simulate = false) {
  try {
    const simFlag = simulate ? ' --sim 1' : '';
    const result = await sendCli(`/tx --command '${command}'${simFlag}`);
    return result;
  } catch (err) {
    console.error('[TracName] Contract tx error:', err.message);
    return { ok: false, error: err.message };
  }
}

// Fetch total names from contract
async function fetchTotalNames() {
  const total = await contractGet('stats/total');
  totalNames = total || 0;
  return totalNames;
}

// Send message to a channel
function sendToChannel(channel, message) {
  if (ws && ws.readyState === WebSocket.OPEN && authenticated) {
    ws.send(JSON.stringify({
      type: 'send',
      channel: channel,
      message: JSON.stringify(message)  // SC-Bridge expects a JSON string
    }));
  }
}

// Generate request ID
function generateRequestId() {
  return 'REQ-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
}

// Check if pubkey already has a pending request
function hasPendingRequest(pubkey) {
  for (const [, pending] of pendingPayments) {
    if (pending.pubkey === pubkey) {
      return true;
    }
  }
  return false;
}

// Handle register request
async function handleRegister(name, pubkey) {
  // Validate name
  const validation = validateName(name);
  if (!validation.valid) {
    return {
      type: 'register_response',
      success: false,
      name: name,
      message: validation.message
    };
  }

  // Check if pubkey already has a pending request
  if (hasPendingRequest(pubkey)) {
    return {
      type: 'register_response',
      success: false,
      name: name,
      message: 'You already have a pending registration. Please complete or wait for it to expire.'
    };
  }

  // Check if name is available on-chain
  const nameLower = name.toLowerCase();
  const existing = await contractGet('name/' + nameLower);
  if (existing) {
    return {
      type: 'register_response',
      success: false,
      name: name,
      message: `Name '${name}' is already taken`,
      owned_by: existing.address
    };
  }

  // Create pending payment request
  const requestId = generateRequestId();
  const expiresAt = Date.now() + CONFIG.paymentTimeoutMs;

  pendingPayments.set(requestId, {
    requestId: requestId,
    name: name,
    nameLower: nameLower,
    pubkey: pubkey,
    createdAt: Date.now(),
    expiresAt: expiresAt
  });

  console.log(`[TracName] Payment required for '${name}' - Request: ${requestId}`);

  return {
    type: 'payment_required',
    request_id: requestId,
    name: name,
    amount: CONFIG.registrationFee,
    currency: 'TNK',
    pay_to: CONFIG.tracAddress,
    instructions: `Send ${CONFIG.registrationFee} TNK to the address above using /transfer in your MSB CLI, then send a confirm_payment message with your trac1 address`,
    expires_in_seconds: Math.floor(CONFIG.paymentTimeoutMs / 1000)
  };
}

// Handle payment confirmation
async function handleConfirmPayment(requestId, userAddress, pubkey) {
  const pending = pendingPayments.get(requestId);

  if (!pending) {
    return {
      type: 'payment_failed',
      request_id: requestId,
      message: 'Request not found or expired. Please start a new registration.'
    };
  }

  // Verify the requester is the same
  if (pending.pubkey !== pubkey) {
    return {
      type: 'payment_failed',
      request_id: requestId,
      message: 'This request belongs to a different identity.'
    };
  }

  // Check expiration
  if (Date.now() > pending.expiresAt) {
    pendingPayments.delete(requestId);
    return {
      type: 'payment_failed',
      request_id: requestId,
      message: 'Request expired. Please start a new registration.'
    };
  }

  console.log(`[TracName] Verifying payment for '${pending.name}' from ${userAddress}`);

  // Send checking message
  sendToChannel(CONFIG.mainChannel, {
    type: 'payment_checking',
    request_id: requestId,
    message: 'Verifying payment on the blockchain, please wait...'
  });

  // Verify payment with retries
  let paymentResult = null;
  for (let i = 0; i < CONFIG.paymentCheckRetries; i++) {
    paymentResult = await verifyPayment(
      userAddress,
      CONFIG.tracAddress,
      CONFIG.registrationFee,
      pending.createdAt
    );

    if (paymentResult.verified) {
      break;
    }

    if (i < CONFIG.paymentCheckRetries - 1) {
      console.log(`[TracName] Payment not found, retry ${i + 1}/${CONFIG.paymentCheckRetries}...`);
      await new Promise(r => setTimeout(r, CONFIG.paymentCheckIntervalMs));
    }
  }

  if (!paymentResult.verified) {
    return {
      type: 'payment_failed',
      request_id: requestId,
      name: pending.name,
      message: 'Payment not found after verification. Please check your transaction and try again.'
    };
  }

  console.log(`[TracName] Payment verified! TX: ${paymentResult.tx_hash.substring(0, 16)}...`);

  // Remove from pending payments
  pendingPayments.delete(requestId);

  // Execute on-chain registration
  const registrationTimestamp = new Date().toISOString();
  const txCommand = JSON.stringify({
    op: 'register',
    name: pending.name,
    for_address: userAddress,
    timestamp: registrationTimestamp  // Bot provides timestamp for determinism
  });

  // Save to pending writes AFTER generating timestamp (crash recovery)
  pendingWrites[requestId] = {
    name: pending.name,
    for_address: userAddress,
    pubkey: pubkey,
    payment_tx: paymentResult.tx_hash,
    amount_paid: paymentResult.amount_tnk,
    timestamp: registrationTimestamp,  // Save for crash recovery
    status: 'payment_verified',
    createdAt: pending.createdAt
  };
  savePendingWrites();

  console.log(`[TracName] Writing '${pending.name}' on-chain...`);
  const txResult = await contractTx(txCommand);

  if (!txResult.ok) {
    console.error('[TracName] On-chain write failed:', txResult.error || txResult.output);
    return {
      type: 'register_response',
      success: false,
      name: pending.name,
      message: 'On-chain registration failed. Your payment was received. Please contact support.',
      payment_tx: paymentResult.tx_hash
    };
  }

  // Success - remove from pending writes
  removePendingWrite(requestId);

  // Update total
  await fetchTotalNames();

  // Get the certificate ID from contract
  const nameEntry = await contractGet('name/' + pending.nameLower);
  const certificateId = nameEntry ? nameEntry.certificate_id : 'TN-?????';

  console.log(`[TracName] Registered '${pending.name}' for ${userAddress} - ${certificateId}`);

  return {
    type: 'register_response',
    success: true,
    certificate_id: certificateId,
    name: pending.name,
    address: userAddress,
    public_key: pubkey,
    registered_at: nameEntry ? nameEntry.registered_at : new Date().toISOString(),
    payment_tx: paymentResult.tx_hash,
    amount_paid: paymentResult.amount_tnk,
    on_chain: true
  };
}

// Handle lookup request
async function handleLookup(name) {
  const nameLower = name.toLowerCase();
  const entry = await contractGet('name/' + nameLower);

  if (entry) {
    return {
      type: 'lookup_response',
      found: true,
      name: entry.name,
      address: entry.address,
      registered_at: entry.registered_at,
      certificate_id: entry.certificate_id,
      on_chain: true
    };
  }

  return {
    type: 'lookup_response',
    found: false,
    name: name,
    message: `Name '${name}' not found`
  };
}

// Handle verify request (by address)
async function handleVerify(address) {
  const names = await contractGet('key/' + address);

  if (names && names.length > 0) {
    return {
      type: 'verify_response',
      found: true,
      address: address,
      names: names,
      primary_name: names[0],
      total_names: names.length,
      on_chain: true
    };
  }

  return {
    type: 'verify_response',
    found: false,
    address: address,
    message: 'No name registered for this address'
  };
}

// Handle stats request
async function handleStats() {
  const total = await fetchTotalNames();
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

  return {
    type: 'stats_response',
    total_names: total,
    uptime_seconds: uptimeSeconds,
    pending_registrations: pendingPayments.size,
    service: 'TracName',
    version: CONFIG.version,
    registration_fee: CONFIG.registrationFee,
    currency: 'TNK',
    on_chain: true
  };
}

// Handle incoming sidechannel message
async function handleSidechannelMessage(msg) {
  const { channel, message, from } = msg;

  if (channel !== CONFIG.mainChannel) {
    return;
  }

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

  const fromShort = from ? from.substring(0, 16) + '...' : 'unknown';
  console.log(`[TracName] Received ${payload.type} from ${fromShort}`);

  let response = null;

  switch (payload.type) {
    case 'register':
      if (!payload.name) {
        response = { type: 'register_response', success: false, message: 'Missing name field' };
      } else if (!from) {
        response = { type: 'register_response', success: false, message: 'Cannot identify sender' };
      } else {
        response = await handleRegister(payload.name, from);
      }
      break;

    case 'confirm_payment':
      if (!payload.request_id || !payload.my_address) {
        response = { type: 'payment_failed', message: 'Missing request_id or my_address field' };
      } else if (!from) {
        response = { type: 'payment_failed', message: 'Cannot identify sender' };
      } else {
        response = await handleConfirmPayment(payload.request_id, payload.my_address, from);
      }
      break;

    case 'lookup':
      if (!payload.name) {
        response = { type: 'lookup_response', found: false, message: 'Missing name field' };
      } else {
        response = await handleLookup(payload.name);
        console.log(`[TracName] Lookup '${payload.name}': ${response.found ? 'FOUND' : 'NOT FOUND'}`);
      }
      break;

    case 'verify':
      if (!payload.address) {
        response = { type: 'verify_response', found: false, message: 'Missing address field' };
      } else {
        response = await handleVerify(payload.address);
        console.log(`[TracName] Verify ${payload.address.substring(0, 16)}...: ${response.found ? response.primary_name : 'NOT FOUND'}`);
      }
      break;

    case 'stats_request':
      response = await handleStats();
      console.log(`[TracName] Stats sent: ${response.total_names} names, uptime ${response.uptime_seconds}s`);
      break;

    default:
      console.log(`[TracName] Unknown message type: ${payload.type}`);
  }

  if (response) {
    sendToChannel(CONFIG.mainChannel, response);
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
      ws.send(JSON.stringify({ type: 'join', channel: CONFIG.mainChannel }));
      startAnnouncements();
      startCleanup();
      recoverPendingWrites();
      break;

    case 'joined':
      console.log(`[TracName] Joined channel: ${msg.channel || CONFIG.mainChannel}`);
      setTimeout(async () => {
        await fetchTotalNames();
        sendToChannel(CONFIG.entryChannel, getAnnouncement());
        console.log('[TracName] Sent initial service announcement to 0000intercom');
      }, 1000);
      break;

    case 'sent':
      break;

    case 'sidechannel_message':
      handleSidechannelMessage(msg);
      break;

    case 'cli_result': {
      // Find callback by command suffix (handles unique key collision prevention)
      for (const [key, callback] of pendingCliCallbacks) {
        if (callback.command === msg.command) {
          clearTimeout(callback.timeoutId);
          pendingCliCallbacks.delete(key);
          callback.resolve(msg);
          break;  // Only resolve first match (FIFO)
        }
      }
      break;
    }

    case 'error':
      console.error('[TracName] SC-Bridge error:', msg.message || msg.error || JSON.stringify(msg));
      break;

    default:
      break;
  }
}

// Get service announcement
function getAnnouncement() {
  return {
    type: 'service_announce',
    service: 'TracName',
    description: 'Decentralized identity and name registration service (1 TNK per registration, on-chain)',
    channel: CONFIG.mainChannel,
    version: CONFIG.version,
    commands: ['register', 'confirm_payment', 'lookup', 'verify', 'stats_request'],
    total_names: totalNames,
    registration_fee: CONFIG.registrationFee,
    currency: 'TNK',
    on_chain: true,
    pay_to: CONFIG.tracAddress
  };
}

// Start periodic announcements
function startAnnouncements() {
  if (announceInterval) {
    clearInterval(announceInterval);
  }

  announceInterval = setInterval(async () => {
    if (authenticated) {
      await fetchTotalNames();
      sendToChannel(CONFIG.entryChannel, getAnnouncement());
      console.log('[TracName] Sent periodic service announcement');
    }
  }, CONFIG.announceIntervalMs);
}

// Cleanup expired pending payments
function startCleanup() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
  }

  cleanupInterval = setInterval(() => {
    const now = Date.now();
    let expired = 0;

    for (const [requestId, pending] of pendingPayments) {
      if (now > pending.expiresAt) {
        pendingPayments.delete(requestId);
        expired++;
      }
    }

    if (expired > 0) {
      console.log(`[TracName] Cleaned up ${expired} expired pending payments`);
    }
  }, CONFIG.cleanupIntervalMs);
}

// Recover pending writes after crash
async function recoverPendingWrites() {
  const pendingIds = Object.keys(pendingWrites);
  if (pendingIds.length === 0) return;

  console.log(`[TracName] Recovering ${pendingIds.length} pending on-chain writes...`);

  for (const requestId of pendingIds) {
    const pending = pendingWrites[requestId];

    // Use saved timestamp or generate new one (for old pending entries)
    const timestamp = pending.timestamp || new Date().toISOString();

    const txCommand = JSON.stringify({
      op: 'register',
      name: pending.name,
      for_address: pending.for_address,
      timestamp: timestamp
    });

    console.log(`[TracName] Retrying write for '${pending.name}'...`);
    const txResult = await contractTx(txCommand);

    if (txResult.ok) {
      console.log(`[TracName] Recovered '${pending.name}' successfully`);
      removePendingWrite(requestId);
    } else {
      console.error(`[TracName] Failed to recover '${pending.name}':`, txResult.error || txResult.output);
    }
  }
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
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = null;
    }
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
    console.error('IMPORTANT: Intercom must be started with --sc-bridge-cli 1 for on-chain access.');
    process.exit(1);
  }

  token = args.token;

  console.log('');
  console.log('====================================================');
  console.log('  TracName v2 - On-Chain Identity Service           ');
  console.log('  The Blue Checkmark of the Trac Network            ');
  console.log('====================================================');
  console.log(`Version: ${CONFIG.version}`);
  console.log(`Channel: ${CONFIG.mainChannel}`);
  console.log(`Address: ${CONFIG.tracAddress}`);
  console.log(`Registration Fee: ${CONFIG.registrationFee} TNK`);
  console.log('');

  loadPendingWrites();
  connect();

  process.on('SIGINT', () => {
    console.log('\n[TracName] Shutting down...');
    if (announceInterval) clearInterval(announceInterval);
    if (cleanupInterval) clearInterval(cleanupInterval);
    if (ws) ws.close();
    process.exit(0);
  });
}

main();
