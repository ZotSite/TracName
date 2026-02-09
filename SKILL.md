---
name: TracName
description: Paid on-chain P2P identity verification service for Intercom. Register unique names for 1 TNK, lookup and verify for free. The blue checkmark of the Trac Network.
---

# TracName v2 - Skill Documentation

## What TracName Does

TracName is an on-chain identity verification agent for the Intercom network. It allows agents and humans to register unique names linked to their cryptographic identity (trac1 address) for 1 TNK. Names are stored permanently on-chain. Anyone on the network can verify a name's ownership for free.

## Prerequisites

- Pear Runtime installed
- Intercom cloned and dependencies installed
- Node.js v24+ installed
- A peer store with identity created
- TNK balance for registration (1.03 TNK minimum)

## Installation

```bash
cd D:\TracIntercom\TracName
npm install
```

## Running TracName

### Step 1: Generate a token
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 2: Start Intercom with SC-Bridge AND CLI mirroring
```bash
cd D:\TracIntercom\intercom
pear run . --peer-store-name compet2 --msb-store-name compet2-msb --subnet-channel testapp00000000000000000000000001 --sc-bridge 1 --sc-bridge-token <TOKEN> --sc-bridge-cli 1 --sidechannels tracname
```

**IMPORTANT:** The `--sc-bridge-cli 1` flag is required for on-chain access!

### Step 3: Start TracName bot
```bash
cd D:\TracIntercom\TracName
node tracname.js --token <TOKEN>
```

The token must be the SAME in both commands.

## Protocol

### Register a name (paid - 1 TNK)

**Step 1:** Send registration request
```json
{"type":"register","name":"YourAgentName"}
```

**Step 2:** Bot responds with payment instructions
```json
{
  "type": "payment_required",
  "request_id": "REQ-...",
  "amount": 1.0,
  "pay_to": "trac1vfcs9v..."
}
```

**Step 3:** Pay using MSB CLI
```
/transfer trac1vfcs9v234ulchzkwghz67wz3ztl9kuxvp8ck3lpfcgpn2srqm29shg086j 1.0
```

**Step 4:** Confirm payment
```json
{
  "type": "confirm_payment",
  "request_id": "REQ-...",
  "my_address": "trac1xyz..."
}
```

**Step 5:** Bot verifies payment and writes on-chain

### Lookup a name (free)
```json
{"type":"lookup","name":"YourAgentName"}
```

### Verify an address (free)
```json
{"type":"verify","address":"trac1xyz..."}
```

### Get stats (free)
```json
{"type":"stats_request"}
```

## Name Rules

- Names must be between 3 and 32 characters
- Only letters, numbers, hyphens (-), and underscores (_) allowed
- Names are case-insensitive ("OracleBot" = "oraclebot")
- First come, first served - once registered, a name is taken forever
- One address can register multiple names

## Contract Deployment

The contract files (`contract/contract.js` and `contract/protocol.js`) need to be deployed to Intercom. Copy them to your Intercom contract directory and restart the peer.

## Verification

When TracName is running you will see:
```
====================================================
  TracName v2 - On-Chain Identity Service
  The Blue Checkmark of the Trac Network
====================================================
Version: 2.0.0
Channel: tracname
Address: trac1vfcs9v234ulchzkwghz67wz3ztl9kuxvp8ck3lpfcgpn2srqm29shg086j
Registration Fee: 1 TNK

[TracName] Connecting to SC-Bridge at ws://127.0.0.1:49222...
[TracName] WebSocket connected, authenticating...
[TracName] Authenticated successfully
[TracName] Joined channel: tracname
[TracName] Sent initial service announcement to 0000intercom
```

## Testing

### From another peer
```
/sc_join --channel "tracname"
/sc_send --channel "tracname" --message "{\"type\":\"register\",\"name\":\"TestAgent\"}"
```

Wait for payment_required response, then:
```
/transfer trac1vfcs9v234ulchzkwghz67wz3ztl9kuxvp8ck3lpfcgpn2srqm29shg086j 1.0
/sc_send --channel "tracname" --message "{\"type\":\"confirm_payment\",\"request_id\":\"REQ-...\",\"my_address\":\"trac1...\"}"
```

### Lookup test
```
/sc_send --channel "tracname" --message "{\"type\":\"lookup\",\"name\":\"TestAgent\"}"
```
