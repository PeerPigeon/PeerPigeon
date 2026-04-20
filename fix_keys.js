const fs = require('fs');
const file = 'examples/vue3/src/App.vue';
let src = fs.readFileSync(file, 'utf8');

const badBody = `    async ensureCryptoKeys() {
      const parseStored = (raw) => {
        if (!raw) return null;
      const key = initialKey;
            parsed &&
            typeof parsed.pub === 'string' &&
            typeof parsed.priv === 'string' &&
            typeof parsed.epub === 'string' &&
            typeof parsed.epriv === 'string'
        await this.storage.delete(this.storageActiveSpace, key);
    },`;

const goodBody = `    async ensureCryptoKeys() {
      const parseStored = (raw) => {
        if (!raw) return null;
        try {
          const parsed = JSON.parse(raw);
          if (
            parsed &&
            typeof parsed.pub === 'string' &&
            typeof parsed.priv === 'string' &&
            typeof parsed.epub === 'string' &&
            typeof parsed.epriv === 'string'
          ) {
            return parsed;
          }
          return null;
        } catch {
          return null;
        }
      };

      let keys = parseStored(sessionStorage.getItem(this.cryptoStorageKey));
      if (!keys) {
        keys = await generateRandomPair();
        try {
          sessionStorage.setItem(this.cryptoStorageKey, JSON.stringify(keys));
        } catch {
          // ignore storage failures
        }
      }

      this.cryptoKeys = keys;
      this.registerLocalPublicCryptoInfo();
    },`;

if (!src.includes(badBody)) { console.log('BAD BODY NOT FOUND'); process.exit(1); }
src = src.replace(badBody, goodBody);
fs.writeFileSync(file, src);
console.log('OK length', src.length);
