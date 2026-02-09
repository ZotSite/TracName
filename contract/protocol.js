/**
 * TracName Protocol - Command router for TracName contract
 *
 * Maps CLI commands to contract functions:
 * - /tx --command '{"op":"register","name":"SebAi","for_address":"trac1xyz..."}'
 *   -> type: 'registerName', value: { op: "register", name: "SebAi", for_address: "trac1xyz..." }
 *
 * - /tx --command 'stats'
 *   -> type: 'readStats', value: null
 */

import { Protocol } from "trac-peer";
import { bufferToBigInt, bigIntToDecimalString } from "trac-msb/src/utils/amountSerialization.js";

class TracNameProtocol extends Protocol {
  constructor(peer, base, options = {}) {
    super(peer, base, options);
  }

  async extendApi() {
    // API accessible programmatically
    this.api.getServiceInfo = function() {
      return {
        service: 'TracName',
        version: '2.0.0',
        description: 'Decentralized identity and name registration service'
      };
    }
  }

  mapTxCommand(command) {
    let obj = { type: '', value: null };

    // Simple command: stats
    if (command === 'stats') {
      obj.type = 'readStats';
      obj.value = null;
      return obj;
    }

    // JSON command: register
    const json = this.safeJsonParse(command);
    if (json && json.op !== undefined) {
      if (json.op === 'register') {
        obj.type = 'registerName';
        obj.value = json;
        return obj;
      }
    }

    return null; // No matching command
  }

  async printOptions() {
    console.log('TracName v2.0.0 - On-chain Identity Service');
    console.log('');
    console.log('Transaction commands (/tx):');
    console.log('  /tx --command \'{"op":"register","name":"YourName","for_address":"trac1..."}\' — Register a name');
    console.log('  /tx --command \'stats\' — Display registration stats');
    console.log('');
    console.log('Read commands (/get):');
    console.log('  /get --key "name/<name_lower>" — Lookup a name');
    console.log('  /get --key "key/<trac1_address>" — Get names for an address');
    console.log('  /get --key "stats/total" — Get total registered names');
    console.log('');
    console.log('Sidechannel: tracname');
  }

  async customCommand(input) {
    await super.tokenizeInput(input);

    // /get command - read from contract state
    if (this.input.startsWith("/get")) {
      const m = input.match(/(?:^|\s)--key(?:=|\s+)(\"[^\"]+\"|'[^']+'|\S+)/);
      const raw = m ? m[1].trim() : null;
      if (!raw) {
        console.log('Usage: /get --key "<hyperbee-key>" [--confirmed true|false] [--unconfirmed 1]');
        return;
      }
      const key = raw.replace(/^\"(.*)\"$/, "$1").replace(/^'(.*)'$/, "$1");
      const confirmedMatch = input.match(/(?:^|\s)--confirmed(?:=|\s+)(\S+)/);
      const unconfirmedMatch = input.match(/(?:^|\s)--unconfirmed(?:=|\s+)?(\S+)?/);
      const confirmed = unconfirmedMatch ? false : confirmedMatch ? confirmedMatch[1] === "true" || confirmedMatch[1] === "1" : true;
      const v = confirmed ? await this.getSigned(key) : await this.get(key);
      console.log(v);
      return;
    }

    // /msb command - show MSB info
    if (this.input.startsWith("/msb")) {
      const txv = await this.peer.msbClient.getTxvHex();
      const peerMsbAddress = this.peer.msbClient.pubKeyHexToAddress(this.peer.wallet.publicKey);
      const entry = await this.peer.msbClient.getNodeEntryUnsigned(peerMsbAddress);
      const balance = entry?.balance ? bigIntToDecimalString(bufferToBigInt(entry.balance)) : 0;
      const feeBuf = this.peer.msbClient.getFee();
      const fee = feeBuf ? bigIntToDecimalString(bufferToBigInt(feeBuf)) : 0;
      const validators = this.peer.msbClient.getConnectedValidatorsCount();
      console.log({
        networkId: this.peer.msbClient.networkId,
        msbBootstrap: this.peer.msbClient.bootstrapHex,
        txv,
        msbSignedLength: this.peer.msbClient.getSignedLength(),
        msbUnsignedLength: this.peer.msbClient.getUnsignedLength(),
        connectedValidators: validators,
        peerMsbAddress,
        peerMsbBalance: balance,
        msbFee: fee,
      });
      return;
    }

    // /sc_join command - join a sidechannel
    if (this.input.startsWith("/sc_join")) {
      const args = this.parseArgs(input);
      const name = args.channel || args.ch || args.name;
      if (!name) { console.log('Usage: /sc_join --channel "<n>"'); return; }
      if (!this.peer.sidechannel) { console.log('Sidechannel not initialized.'); return; }
      await this.peer.sidechannel.addChannel(String(name));
      console.log('Joined sidechannel:', name);
      return;
    }

    // /sc_send command - send message to sidechannel
    if (this.input.startsWith("/sc_send")) {
      const args = this.parseArgs(input);
      const name = args.channel || args.ch || args.name;
      const message = args.message || args.msg;
      if (!name || message === undefined) { console.log('Usage: /sc_send --channel "<n>" --message "<text>"'); return; }
      if (!this.peer.sidechannel) { console.log('Sidechannel not initialized.'); return; }
      await this.peer.sidechannel.sendMessage(String(name), typeof message === 'string' ? message : JSON.stringify(message));
      console.log('Sent to', name);
      return;
    }

    // /sc_stats command - show sidechannel stats
    if (this.input.startsWith("/sc_stats")) {
      if (!this.peer.sidechannel) { console.log('Sidechannel not initialized.'); return; }
      const channels = this.peer.sidechannel.getChannels();
      const connectionCount = this.peer.sidechannel.getConnectionCount();
      console.log({ channels, connectionCount });
      return;
    }

    // /sc_open command - request to open a channel
    if (this.input.startsWith("/sc_open")) {
      const args = this.parseArgs(input);
      const name = args.channel || args.ch || args.name;
      const via = args.via || null;
      if (!name) { console.log('Usage: /sc_open --channel "<n>" [--via "<channel>"]'); return; }
      if (!this.peer.sidechannel) { console.log('Sidechannel not initialized.'); return; }
      await this.peer.sidechannel.requestChannel(String(name), via ? String(via) : undefined);
      console.log('Requested channel:', name);
      return;
    }
  }
}

export default TracNameProtocol;
