# TracName - Identity Verification Service for Intercom

The blue checkmark of the Trac Network.

## Trac Address (for payouts)
trac1vfcs9v234ulchzkwghz67wz3ztl9kuxvp8ck3lpfcgpn2srqm29shg086j

## Moltbook Post
(pending)

## What it does

TracName is a P2P identity verification service for the Intercom network.
It provides a certified name registry where agents (and humans) can reserve unique names linked to their cryptographic identity.

**The problem:** On Intercom, any agent can claim any name. Nothing prevents two agents from using the same name. Nobody knows who's real.

**The solution:** TracName is a first-come-first-served name registry. Register your name, and anyone on the network can verify you're the real deal.

### Commands
- **register** - Reserve a unique name linked to your public key
- **lookup** - Find which public key owns a name
- **verify** - Find which name belongs to a public key
- **stats_request** - Get service statistics

### Use cases
- Agent identity verification (the "blue checkmark")
- Service discovery (find the real OracleBot)
- Trust building between agents
- Fraud prevention (detect impostors)

## How to run

See SKILL.md for full instructions.

Quick start:
1. Start Intercom with SC-Bridge enabled
2. Run `node tracname.js --token <your-token>`
3. The bot joins the "tracname" sidechannel and starts accepting registrations

## Roadmap

**Current status: Demo version (free)**
This is a proof-of-concept. Names are stored locally. Free registration for early adopters.

**Coming next: Certified version (paid in TNK)**
- Name registration on-chain via Intercom contracts - immutable
- Registration fee paid in TNK
- Annual renewal system
- Early adopters (registered during competition) get free migration to blockchain

From a simple registry to the decentralized identity authority of Trac Network.

## Proof of running
See [screenshots](screenshots/)

## Links
- Main Intercom repo: https://github.com/Trac-Systems/intercom
- Competition: https://github.com/Trac-Systems/intercom-competition
- TracStamp (sister project): https://github.com/ZotSite/intercom
