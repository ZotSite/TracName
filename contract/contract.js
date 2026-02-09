/**
 * TracName Contract - On-chain identity registration
 *
 * Storage structure:
 * - name/<name_lower>    -> { certificate_id, name, name_lower, address, registered_at }
 * - key/<trac_address>   -> ["name1", "name2"] (reverse index)
 * - stats/total          -> number (total registered names)
 */

import { Contract } from 'trac-peer';

class TracNameContract extends Contract {
  constructor(protocol, options = {}) {
    super(protocol, options);

    // Register the registerName function with schema validation
    this.addSchema('registerName', {
      value: {
        $$strict: true,
        $$type: "object",
        op: { type: "string", enum: ["register"] },
        name: { type: "string", min: 3, max: 32, pattern: /^[a-zA-Z0-9_-]+$/ },
        for_address: { type: "string", min: 10, max: 100 },
        timestamp: { type: "string", min: 1, max: 50 }  // Bot provides timestamp (deterministic)
      }
    });

    // Register read stats function (no payload needed)
    this.addFunction('readStats');
  }

  /**
   * Register a name for an address
   * Called by the bot after payment verification
   * this.address = bot's address (the one executing /tx)
   * this.value.for_address = user's address (the actual owner)
   */
  async registerName() {
    const name = this.value.name;
    const nameLower = name.toLowerCase();
    const forAddress = this.value.for_address;

    // Check if name is already taken
    const existingName = await this.get('name/' + nameLower);
    this.assert(existingName === null, new Error('Name already taken: ' + name));

    // Get current total for certificate ID
    let total = await this.get('stats/total');
    if (total === null) {
      total = 0;
    }
    const newTotal = total + 1;
    const certificateId = 'TN-' + String(newTotal).padStart(5, '0');

    // Create the name entry (timestamp provided by bot for determinism)
    const entry = this.protocol.safeClone({
      certificate_id: certificateId,
      name: name,
      name_lower: nameLower,
      address: forAddress,
      registered_at: this.value.timestamp  // Deterministic: same value on all peers
    });

    // Store the name entry
    await this.put('name/' + nameLower, entry);

    // Update the reverse index (address -> names)
    let addressNames = await this.get('key/' + forAddress);
    if (addressNames === null) {
      addressNames = [];
    }
    // Clone to avoid modifying the original
    const updatedNames = this.protocol.safeClone(addressNames);
    updatedNames.push(name);
    await this.put('key/' + forAddress, updatedNames);

    // Update total count
    await this.put('stats/total', newTotal);

    console.log('TracName: Registered', name, 'for', forAddress, '- Certificate:', certificateId);
  }

  /**
   * Read and display stats (for debugging/admin)
   */
  async readStats() {
    const total = await this.get('stats/total');
    console.log('TracName Stats:', { total_names: total || 0 });
  }
}

export default TracNameContract;
