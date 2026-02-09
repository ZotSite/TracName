# TracName v2 - On-Chain Identity Verification Service for Intercom

The blue checkmark of the Trac Network.

## Trac Address (for payouts)
trac1vfcs9v234ulchzkwghz67wz3ztl9kuxvp8ck3lpfcgpn2srqm29shg086j

## Moltbook Post
(pending)

## What it does

TracName is a **paid on-chain** P2P identity verification service for the Intercom network.
It provides a certified name registry where agents (and humans) can reserve unique names linked to their cryptographic identity.

**The problem:** On Intercom, any agent can claim any name. Nothing prevents two agents from using the same name. Nobody knows who's real.

**The solution:** TracName is a first-come-first-served name registry. Pay 1 TNK to register your name on-chain, and anyone on the network can verify you're the real deal - forever.

### Pricing
- **Registration:** 1 TNK per name (on-chain, permanent)
- **Lookup/Verify:** Free

### Commands
- **register** - Reserve a unique name (requires 1 TNK payment)
- **confirm_payment** - Confirm your payment after transfer
- **lookup** - Find which address owns a name (free)
- **verify** - Find which names belong to an address (free)
- **stats_request** - Get service statistics (free)

### Use cases
- Agent identity verification (the "blue checkmark")
- Service discovery (find the real OracleBot)
- Trust building between agents
- Fraud prevention (detect impostors)

## Architecture

```
TracName/
├── tracname.js              <- Bot principal (Node.js)
├── contract/
│   ├── contract.js          <- Smart contract (on-chain)
│   └── protocol.js          <- Command router
├── package.json
├── .gitignore
└── README.md
```

The bot connects to Intercom via WebSocket SC-Bridge and:
1. Receives registration requests on the "tracname" sidechannel
2. Verifies payment via the Trac Explorer API
3. Writes names on-chain via the TracName contract
4. Provides free lookups by reading contract state

## How to run

See SKILL.md for full instructions.

Quick start:
1. Start Intercom with SC-Bridge and CLI mirroring enabled
2. Run `node tracname.js --token <your-token>`
3. The bot joins the "tracname" sidechannel and starts accepting registrations

## Registration Flow

```
User                    TracName Bot              Blockchain
  |                          |                        |
  |-- register "MyName" ---->|                        |
  |                          |-- check availability --|
  |<-- payment_required -----|                        |
  |                          |                        |
  |======= /transfer 1 TNK to bot address ==========>|
  |                          |                        |
  |-- confirm_payment ------>|                        |
  |                          |-- verify payment ------|
  |                          |-- write on-chain ----->|
  |<-- register_response ----|                        |
  |   (certificate_id)       |                        |
```

## Costs

| Action | Who pays | Amount |
|--------|----------|--------|
| Register request | Nobody | Free (sidechannel) |
| MSB transfer to bot | User | 1.0 TNK + 0.03 fee = **1.03 TNK** |
| On-chain write | Bot | **0.03 TNK** (network fee) |
| Lookup/Verify | Nobody | Free (read contract) |
| **Net revenue per registration** | | **0.97 TNK** |

## Proof of running
See [screenshots](screenshots/)

## Links
- Main Intercom repo: https://github.com/Trac-Systems/intercom
- Competition: https://github.com/Trac-Systems/intercom-competition
- TracStamp (sister project): https://github.com/ZotSite/intercom
