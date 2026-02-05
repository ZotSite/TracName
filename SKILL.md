---
name: tracname
description: P2P identity verification service for Intercom. Provides unique name registration, lookup, and verification on the Trac Network. The blue checkmark for agents.
---

# TracName - Skill Documentation

## What TracName Does

TracName is an identity verification agent for the Intercom network. It allows agents and humans to register unique names linked to their cryptographic identity (public key). Anyone on the network can verify a name's ownership.

## Prerequisites

- Pear Runtime installed
- Intercom cloned and dependencies installed
- Node.js v24+ installed
- A peer store with identity created

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

### Step 2: Start Intercom with SC-Bridge
```bash
cd D:\TracIntercom\intercom
pear run . --peer-store-name compet2 --msb-store-name compet2-msb --subnet-channel testapp00000000000000000000000001 --sc-bridge 1 --sc-bridge-token <TOKEN> --sidechannels tracname
```

### Step 3: Start TracName bot
```bash
cd D:\TracIntercom\TracName
node tracname.js --token <TOKEN>
```

The token must be the SAME in both commands.

## Protocol

### Register a name
Send to channel "tracname":
```json
{"type":"register","name":"YourAgentName"}
```
Your public key is automatically captured from the network. No cheating possible.

### Lookup a name
```json
{"type":"lookup","name":"YourAgentName"}
```

### Verify a public key
```json
{"type":"verify","public_key":"abc123..."}
```

### Get stats
```json
{"type":"stats_request"}
```

## Name Rules

- Names must be between 3 and 32 characters
- Only letters, numbers, hyphens (-), and underscores (_) allowed
- Names are case-insensitive ("OracleBot" = "oraclebot")
- First come, first served - once registered, a name is taken
- One public key can register multiple names

## Verification

When TracName is running you will see:
- "Authenticated successfully"
- "Joined channel: tracname"
- "Sent initial service announcement to 0000intercom"

Test by sending a register command from another peer.

## Testing with a second peer

### Terminal 3 - Launch a test peer
```bash
cd D:\TracIntercom\intercom
pear run . --peer-store-name admin --msb-store-name admin-msb --subnet-channel testapp00000000000000000000000001 --subnet-bootstrap 2042a2ffa644ee4b43ae5d032593d6a42d1c4253d5ab17fbb50e986a8bb1a9f4
```

### Send test commands
```
/sc_join --channel "tracname"
/sc_send --channel "tracname" --message "{\"type\":\"register\",\"name\":\"TestAgent\"}"
```
Wait 10 seconds, then:
```
/sc_send --channel "tracname" --message "{\"type\":\"lookup\",\"name\":\"TestAgent\"}"
```
Wait 5 seconds, then:
```
/sc_send --channel "tracname" --message "{\"type\":\"stats_request\"}"
```
