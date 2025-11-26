// PeerPigeon Browser Bundle - includes UnSEA crypto library
// Generated automatically - do not edit directly

var PeerPigeon = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };
  var __commonJS = (cb, mod2) => function __require2() {
    return mod2 || (0, cb[__getOwnPropNames(cb)[0]])((mod2 = { exports: {} }).exports, mod2), mod2.exports;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod2, isNodeMode, target) => (target = mod2 != null ? __create(__getProtoOf(mod2)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod2 || !mod2.__esModule ? __defProp(target, "default", { value: mod2, enumerable: true }) : target,
    mod2
  ));
  var __toCommonJS = (mod2) => __copyProps(__defProp({}, "__esModule", { value: true }), mod2);
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // node_modules/unsea/dist/unsea.mjs
  var unsea_exports = {};
  __export(unsea_exports, {
    SECURITY_CONFIG: () => SECURITY_CONFIG,
    clearKeys: () => clearKeys,
    decryptMessageWithMeta: () => decryptMessageWithMeta,
    encryptMessageWithMeta: () => encryptMessageWithMeta,
    exportToJWK: () => exportToJWK,
    exportToPEM: () => exportToPEM,
    generateRandomPair: () => generateRandomPair,
    generateSignedWork: () => generateSignedWork,
    generateWork: () => generateWork,
    getSecurityInfo: () => getSecurityInfo,
    importFromJWK: () => importFromJWK,
    importFromPEM: () => importFromPEM,
    loadKeys: () => loadKeys,
    saveKeys: () => saveKeys,
    signMessage: () => signMessage,
    verifyMessage: () => verifyMessage,
    verifySignedWork: () => verifySignedWork,
    verifyWork: () => verifyWork
  });
  function isBytes(a) {
    return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
  }
  function anumber(n) {
    if (!Number.isSafeInteger(n) || n < 0)
      throw new Error("positive integer expected, got " + n);
  }
  function abytes(b, ...lengths) {
    if (!isBytes(b))
      throw new Error("Uint8Array expected");
    if (lengths.length > 0 && !lengths.includes(b.length))
      throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b.length);
  }
  function ahash(h) {
    if (typeof h !== "function" || typeof h.create !== "function")
      throw new Error("Hash should be wrapped by utils.createHasher");
    anumber(h.outputLen);
    anumber(h.blockLen);
  }
  function aexists(instance, checkFinished = true) {
    if (instance.destroyed)
      throw new Error("Hash instance has been destroyed");
    if (checkFinished && instance.finished)
      throw new Error("Hash#digest() has already been called");
  }
  function aoutput(out, instance) {
    abytes(out);
    const min = instance.outputLen;
    if (out.length < min) {
      throw new Error("digestInto() expects output buffer of length at least " + min);
    }
  }
  function clean(...arrays) {
    for (let i = 0; i < arrays.length; i++) {
      arrays[i].fill(0);
    }
  }
  function createView(arr) {
    return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
  }
  function rotr(word, shift) {
    return word << 32 - shift | word >>> shift;
  }
  function bytesToHex(bytes) {
    abytes(bytes);
    if (hasHexBuiltin)
      return bytes.toHex();
    let hex = "";
    for (let i = 0; i < bytes.length; i++) {
      hex += hexes[bytes[i]];
    }
    return hex;
  }
  function asciiToBase16(ch) {
    if (ch >= asciis._0 && ch <= asciis._9)
      return ch - asciis._0;
    if (ch >= asciis.A && ch <= asciis.F)
      return ch - (asciis.A - 10);
    if (ch >= asciis.a && ch <= asciis.f)
      return ch - (asciis.a - 10);
    return;
  }
  function hexToBytes(hex) {
    if (typeof hex !== "string")
      throw new Error("hex string expected, got " + typeof hex);
    if (hasHexBuiltin)
      return Uint8Array.fromHex(hex);
    const hl = hex.length;
    const al = hl / 2;
    if (hl % 2)
      throw new Error("hex string expected, got unpadded hex of length " + hl);
    const array = new Uint8Array(al);
    for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
      const n1 = asciiToBase16(hex.charCodeAt(hi));
      const n2 = asciiToBase16(hex.charCodeAt(hi + 1));
      if (n1 === void 0 || n2 === void 0) {
        const char = hex[hi] + hex[hi + 1];
        throw new Error('hex string expected, got non-hex character "' + char + '" at index ' + hi);
      }
      array[ai] = n1 * 16 + n2;
    }
    return array;
  }
  function utf8ToBytes(str) {
    if (typeof str !== "string")
      throw new Error("string expected");
    return new Uint8Array(new TextEncoder().encode(str));
  }
  function toBytes(data) {
    if (typeof data === "string")
      data = utf8ToBytes(data);
    abytes(data);
    return data;
  }
  function concatBytes(...arrays) {
    let sum = 0;
    for (let i = 0; i < arrays.length; i++) {
      const a = arrays[i];
      abytes(a);
      sum += a.length;
    }
    const res = new Uint8Array(sum);
    for (let i = 0, pad = 0; i < arrays.length; i++) {
      const a = arrays[i];
      res.set(a, pad);
      pad += a.length;
    }
    return res;
  }
  function createHasher(hashCons) {
    const hashC = (msg) => hashCons().update(toBytes(msg)).digest();
    const tmp = hashCons();
    hashC.outputLen = tmp.outputLen;
    hashC.blockLen = tmp.blockLen;
    hashC.create = () => hashCons();
    return hashC;
  }
  function randomBytes(bytesLength = 32) {
    if (crypto2 && typeof crypto2.getRandomValues === "function") {
      return crypto2.getRandomValues(new Uint8Array(bytesLength));
    }
    if (crypto2 && typeof crypto2.randomBytes === "function") {
      return Uint8Array.from(crypto2.randomBytes(bytesLength));
    }
    throw new Error("crypto.getRandomValues must be defined");
  }
  function abool(title, value) {
    if (typeof value !== "boolean")
      throw new Error(title + " boolean expected, got " + value);
  }
  function numberToHexUnpadded(num) {
    const hex = num.toString(16);
    return hex.length & 1 ? "0" + hex : hex;
  }
  function hexToNumber(hex) {
    if (typeof hex !== "string")
      throw new Error("hex string expected, got " + typeof hex);
    return hex === "" ? _0n$3 : BigInt("0x" + hex);
  }
  function bytesToNumberBE(bytes) {
    return hexToNumber(bytesToHex(bytes));
  }
  function bytesToNumberLE(bytes) {
    abytes(bytes);
    return hexToNumber(bytesToHex(Uint8Array.from(bytes).reverse()));
  }
  function numberToBytesBE(n, len) {
    return hexToBytes(n.toString(16).padStart(len * 2, "0"));
  }
  function numberToBytesLE(n, len) {
    return numberToBytesBE(n, len).reverse();
  }
  function ensureBytes(title, hex, expectedLength) {
    let res;
    if (typeof hex === "string") {
      try {
        res = hexToBytes(hex);
      } catch (e) {
        throw new Error(title + " must be hex string or Uint8Array, cause: " + e);
      }
    } else if (isBytes(hex)) {
      res = Uint8Array.from(hex);
    } else {
      throw new Error(title + " must be hex string or Uint8Array");
    }
    res.length;
    return res;
  }
  function inRange(n, min, max) {
    return isPosBig(n) && isPosBig(min) && isPosBig(max) && min <= n && n < max;
  }
  function aInRange(title, n, min, max) {
    if (!inRange(n, min, max))
      throw new Error("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n);
  }
  function bitLen(n) {
    let len;
    for (len = 0; n > _0n$3; n >>= _1n$3, len += 1)
      ;
    return len;
  }
  function createHmacDrbg(hashLen, qByteLen, hmacFn) {
    if (typeof hashLen !== "number" || hashLen < 2)
      throw new Error("hashLen must be a number");
    if (typeof qByteLen !== "number" || qByteLen < 2)
      throw new Error("qByteLen must be a number");
    if (typeof hmacFn !== "function")
      throw new Error("hmacFn must be a function");
    const u8n = (len) => new Uint8Array(len);
    const u8of = (byte) => Uint8Array.of(byte);
    let v = u8n(hashLen);
    let k = u8n(hashLen);
    let i = 0;
    const reset = () => {
      v.fill(1);
      k.fill(0);
      i = 0;
    };
    const h = (...b) => hmacFn(k, v, ...b);
    const reseed = (seed = u8n(0)) => {
      k = h(u8of(0), seed);
      v = h();
      if (seed.length === 0)
        return;
      k = h(u8of(1), seed);
      v = h();
    };
    const gen = () => {
      if (i++ >= 1e3)
        throw new Error("drbg: tried 1000 values");
      let len = 0;
      const out = [];
      while (len < qByteLen) {
        v = h();
        const sl = v.slice();
        out.push(sl);
        len += v.length;
      }
      return concatBytes(...out);
    };
    const genUntil = (seed, pred) => {
      reset();
      reseed(seed);
      let res = void 0;
      while (!(res = pred(gen())))
        reseed();
      reset();
      return res;
    };
    return genUntil;
  }
  function _validateObject(object, fields, optFields = {}) {
    if (!object || typeof object !== "object")
      throw new Error("expected valid options object");
    function checkField(fieldName, expectedType, isOpt) {
      const val = object[fieldName];
      if (isOpt && val === void 0)
        return;
      const current = typeof val;
      if (current !== expectedType || val === null)
        throw new Error(`param "${fieldName}" is invalid: expected ${expectedType}, got ${current}`);
    }
    Object.entries(fields).forEach(([k, v]) => checkField(k, v, false));
    Object.entries(optFields).forEach(([k, v]) => checkField(k, v, true));
  }
  function memoized(fn) {
    const map = /* @__PURE__ */ new WeakMap();
    return (arg, ...args) => {
      const val = map.get(arg);
      if (val !== void 0)
        return val;
      const computed = fn(arg, ...args);
      map.set(arg, computed);
      return computed;
    };
  }
  function mod(a, b) {
    const result = a % b;
    return result >= _0n$2 ? result : b + result;
  }
  function invert(number, modulo) {
    if (number === _0n$2)
      throw new Error("invert: expected non-zero number");
    if (modulo <= _0n$2)
      throw new Error("invert: expected positive modulus, got " + modulo);
    let a = mod(number, modulo);
    let b = modulo;
    let x = _0n$2, u = _1n$2;
    while (a !== _0n$2) {
      const q = b / a;
      const r = b % a;
      const m = x - u * q;
      b = a, a = r, x = u, u = m;
    }
    const gcd = b;
    if (gcd !== _1n$2)
      throw new Error("invert: does not exist");
    return mod(x, modulo);
  }
  function assertIsSquare(Fp, root, n) {
    if (!Fp.eql(Fp.sqr(root), n))
      throw new Error("Cannot find square root");
  }
  function sqrt3mod4(Fp, n) {
    const p1div4 = (Fp.ORDER + _1n$2) / _4n$1;
    const root = Fp.pow(n, p1div4);
    assertIsSquare(Fp, root, n);
    return root;
  }
  function sqrt5mod8(Fp, n) {
    const p5div8 = (Fp.ORDER - _5n) / _8n;
    const n2 = Fp.mul(n, _2n$1);
    const v = Fp.pow(n2, p5div8);
    const nv = Fp.mul(n, v);
    const i = Fp.mul(Fp.mul(nv, _2n$1), v);
    const root = Fp.mul(nv, Fp.sub(i, Fp.ONE));
    assertIsSquare(Fp, root, n);
    return root;
  }
  function sqrt9mod16(P) {
    const Fp_ = Field(P);
    const tn = tonelliShanks(P);
    const c1 = tn(Fp_, Fp_.neg(Fp_.ONE));
    const c2 = tn(Fp_, c1);
    const c3 = tn(Fp_, Fp_.neg(c1));
    const c4 = (P + _7n) / _16n;
    return (Fp, n) => {
      let tv1 = Fp.pow(n, c4);
      let tv2 = Fp.mul(tv1, c1);
      const tv3 = Fp.mul(tv1, c2);
      const tv4 = Fp.mul(tv1, c3);
      const e1 = Fp.eql(Fp.sqr(tv2), n);
      const e2 = Fp.eql(Fp.sqr(tv3), n);
      tv1 = Fp.cmov(tv1, tv2, e1);
      tv2 = Fp.cmov(tv4, tv3, e2);
      const e3 = Fp.eql(Fp.sqr(tv2), n);
      const root = Fp.cmov(tv1, tv2, e3);
      assertIsSquare(Fp, root, n);
      return root;
    };
  }
  function tonelliShanks(P) {
    if (P < _3n$1)
      throw new Error("sqrt is not defined for small field");
    let Q = P - _1n$2;
    let S = 0;
    while (Q % _2n$1 === _0n$2) {
      Q /= _2n$1;
      S++;
    }
    let Z = _2n$1;
    const _Fp = Field(P);
    while (FpLegendre(_Fp, Z) === 1) {
      if (Z++ > 1e3)
        throw new Error("Cannot find square root: probably non-prime P");
    }
    if (S === 1)
      return sqrt3mod4;
    let cc = _Fp.pow(Z, Q);
    const Q1div2 = (Q + _1n$2) / _2n$1;
    return function tonelliSlow(Fp, n) {
      if (Fp.is0(n))
        return n;
      if (FpLegendre(Fp, n) !== 1)
        throw new Error("Cannot find square root");
      let M = S;
      let c = Fp.mul(Fp.ONE, cc);
      let t = Fp.pow(n, Q);
      let R = Fp.pow(n, Q1div2);
      while (!Fp.eql(t, Fp.ONE)) {
        if (Fp.is0(t))
          return Fp.ZERO;
        let i = 1;
        let t_tmp = Fp.sqr(t);
        while (!Fp.eql(t_tmp, Fp.ONE)) {
          i++;
          t_tmp = Fp.sqr(t_tmp);
          if (i === M)
            throw new Error("Cannot find square root");
        }
        const exponent = _1n$2 << BigInt(M - i - 1);
        const b = Fp.pow(c, exponent);
        M = i;
        c = Fp.sqr(b);
        t = Fp.mul(t, c);
        R = Fp.mul(R, b);
      }
      return R;
    };
  }
  function FpSqrt(P) {
    if (P % _4n$1 === _3n$1)
      return sqrt3mod4;
    if (P % _8n === _5n)
      return sqrt5mod8;
    if (P % _16n === _9n)
      return sqrt9mod16(P);
    return tonelliShanks(P);
  }
  function validateField(field) {
    const initial = {
      ORDER: "bigint",
      MASK: "bigint",
      BYTES: "number",
      BITS: "number"
    };
    const opts = FIELD_FIELDS.reduce((map, val) => {
      map[val] = "function";
      return map;
    }, initial);
    _validateObject(field, opts);
    return field;
  }
  function FpPow(Fp, num, power) {
    if (power < _0n$2)
      throw new Error("invalid exponent, negatives unsupported");
    if (power === _0n$2)
      return Fp.ONE;
    if (power === _1n$2)
      return num;
    let p = Fp.ONE;
    let d = num;
    while (power > _0n$2) {
      if (power & _1n$2)
        p = Fp.mul(p, d);
      d = Fp.sqr(d);
      power >>= _1n$2;
    }
    return p;
  }
  function FpInvertBatch(Fp, nums, passZero = false) {
    const inverted = new Array(nums.length).fill(passZero ? Fp.ZERO : void 0);
    const multipliedAcc = nums.reduce((acc, num, i) => {
      if (Fp.is0(num))
        return acc;
      inverted[i] = acc;
      return Fp.mul(acc, num);
    }, Fp.ONE);
    const invertedAcc = Fp.inv(multipliedAcc);
    nums.reduceRight((acc, num, i) => {
      if (Fp.is0(num))
        return acc;
      inverted[i] = Fp.mul(acc, inverted[i]);
      return Fp.mul(acc, num);
    }, invertedAcc);
    return inverted;
  }
  function FpLegendre(Fp, n) {
    const p1mod2 = (Fp.ORDER - _1n$2) / _2n$1;
    const powered = Fp.pow(n, p1mod2);
    const yes = Fp.eql(powered, Fp.ONE);
    const zero = Fp.eql(powered, Fp.ZERO);
    const no = Fp.eql(powered, Fp.neg(Fp.ONE));
    if (!yes && !zero && !no)
      throw new Error("invalid Legendre symbol result");
    return yes ? 1 : zero ? 0 : -1;
  }
  function nLength(n, nBitLength) {
    if (nBitLength !== void 0)
      anumber(nBitLength);
    const _nBitLength = nBitLength !== void 0 ? nBitLength : n.toString(2).length;
    const nByteLength = Math.ceil(_nBitLength / 8);
    return { nBitLength: _nBitLength, nByteLength };
  }
  function Field(ORDER, bitLenOrOpts, isLE = false, opts = {}) {
    if (ORDER <= _0n$2)
      throw new Error("invalid field: expected ORDER > 0, got " + ORDER);
    let _nbitLength = void 0;
    let _sqrt = void 0;
    let modOnDecode = false;
    let allowedLengths = void 0;
    if (typeof bitLenOrOpts === "object" && bitLenOrOpts != null) {
      if (opts.sqrt || isLE)
        throw new Error("cannot specify opts in two arguments");
      const _opts = bitLenOrOpts;
      if (_opts.BITS)
        _nbitLength = _opts.BITS;
      if (_opts.sqrt)
        _sqrt = _opts.sqrt;
      if (typeof _opts.isLE === "boolean")
        isLE = _opts.isLE;
      if (typeof _opts.modOnDecode === "boolean")
        modOnDecode = _opts.modOnDecode;
      allowedLengths = _opts.allowedLengths;
    } else {
      if (typeof bitLenOrOpts === "number")
        _nbitLength = bitLenOrOpts;
      if (opts.sqrt)
        _sqrt = opts.sqrt;
    }
    const { nBitLength: BITS, nByteLength: BYTES } = nLength(ORDER, _nbitLength);
    if (BYTES > 2048)
      throw new Error("invalid field: expected ORDER of <= 2048 bytes");
    let sqrtP;
    const f = Object.freeze({
      ORDER,
      isLE,
      BITS,
      BYTES,
      MASK: bitMask(BITS),
      ZERO: _0n$2,
      ONE: _1n$2,
      allowedLengths,
      create: (num) => mod(num, ORDER),
      isValid: (num) => {
        if (typeof num !== "bigint")
          throw new Error("invalid field element: expected bigint, got " + typeof num);
        return _0n$2 <= num && num < ORDER;
      },
      is0: (num) => num === _0n$2,
      // is valid and invertible
      isValidNot0: (num) => !f.is0(num) && f.isValid(num),
      isOdd: (num) => (num & _1n$2) === _1n$2,
      neg: (num) => mod(-num, ORDER),
      eql: (lhs, rhs) => lhs === rhs,
      sqr: (num) => mod(num * num, ORDER),
      add: (lhs, rhs) => mod(lhs + rhs, ORDER),
      sub: (lhs, rhs) => mod(lhs - rhs, ORDER),
      mul: (lhs, rhs) => mod(lhs * rhs, ORDER),
      pow: (num, power) => FpPow(f, num, power),
      div: (lhs, rhs) => mod(lhs * invert(rhs, ORDER), ORDER),
      // Same as above, but doesn't normalize
      sqrN: (num) => num * num,
      addN: (lhs, rhs) => lhs + rhs,
      subN: (lhs, rhs) => lhs - rhs,
      mulN: (lhs, rhs) => lhs * rhs,
      inv: (num) => invert(num, ORDER),
      sqrt: _sqrt || ((n) => {
        if (!sqrtP)
          sqrtP = FpSqrt(ORDER);
        return sqrtP(f, n);
      }),
      toBytes: (num) => isLE ? numberToBytesLE(num, BYTES) : numberToBytesBE(num, BYTES),
      fromBytes: (bytes, skipValidation = true) => {
        if (allowedLengths) {
          if (!allowedLengths.includes(bytes.length) || bytes.length > BYTES) {
            throw new Error("Field.fromBytes: expected " + allowedLengths + " bytes, got " + bytes.length);
          }
          const padded = new Uint8Array(BYTES);
          padded.set(bytes, isLE ? 0 : padded.length - bytes.length);
          bytes = padded;
        }
        if (bytes.length !== BYTES)
          throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
        let scalar = isLE ? bytesToNumberLE(bytes) : bytesToNumberBE(bytes);
        if (modOnDecode)
          scalar = mod(scalar, ORDER);
        if (!skipValidation) {
          if (!f.isValid(scalar))
            throw new Error("invalid field element: outside of range 0..ORDER");
        }
        return scalar;
      },
      // TODO: we don't need it here, move out to separate fn
      invertBatch: (lst) => FpInvertBatch(f, lst),
      // We can't move this out because Fp6, Fp12 implement it
      // and it's unclear what to return in there.
      cmov: (a, b, c) => c ? b : a
    });
    return Object.freeze(f);
  }
  function getFieldBytesLength(fieldOrder) {
    if (typeof fieldOrder !== "bigint")
      throw new Error("field order must be bigint");
    const bitLength = fieldOrder.toString(2).length;
    return Math.ceil(bitLength / 8);
  }
  function getMinHashLength(fieldOrder) {
    const length = getFieldBytesLength(fieldOrder);
    return length + Math.ceil(length / 2);
  }
  function mapHashToField(key, fieldOrder, isLE = false) {
    const len = key.length;
    const fieldLen = getFieldBytesLength(fieldOrder);
    const minLen = getMinHashLength(fieldOrder);
    if (len < 16 || len < minLen || len > 1024)
      throw new Error("expected " + minLen + "-1024 bytes of input, got " + len);
    const num = isLE ? bytesToNumberLE(key) : bytesToNumberBE(key);
    const reduced = mod(num, fieldOrder - _1n$2) + _1n$2;
    return isLE ? numberToBytesLE(reduced, fieldLen) : numberToBytesBE(reduced, fieldLen);
  }
  function setBigUint64(view, byteOffset, value, isLE) {
    if (typeof view.setBigUint64 === "function")
      return view.setBigUint64(byteOffset, value, isLE);
    const _32n2 = BigInt(32);
    const _u32_max = BigInt(4294967295);
    const wh = Number(value >> _32n2 & _u32_max);
    const wl = Number(value & _u32_max);
    const h = isLE ? 4 : 0;
    const l = isLE ? 0 : 4;
    view.setUint32(byteOffset + h, wh, isLE);
    view.setUint32(byteOffset + l, wl, isLE);
  }
  function Chi(a, b, c) {
    return a & b ^ ~a & c;
  }
  function Maj(a, b, c) {
    return a & b ^ a & c ^ b & c;
  }
  function fromBig(n, le = false) {
    if (le)
      return { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) };
    return { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
  }
  function split(lst, le = false) {
    const len = lst.length;
    let Ah = new Uint32Array(len);
    let Al = new Uint32Array(len);
    for (let i = 0; i < len; i++) {
      const { h, l } = fromBig(lst[i], le);
      [Ah[i], Al[i]] = [h, l];
    }
    return [Ah, Al];
  }
  function add(Ah, Al, Bh, Bl) {
    const l = (Al >>> 0) + (Bl >>> 0);
    return { h: Ah + Bh + (l / 2 ** 32 | 0) | 0, l: l | 0 };
  }
  function negateCt(condition, item) {
    const neg = item.negate();
    return condition ? neg : item;
  }
  function normalizeZ(c, points) {
    const invertedZs = FpInvertBatch(c.Fp, points.map((p) => p.Z));
    return points.map((p, i) => c.fromAffine(p.toAffine(invertedZs[i])));
  }
  function validateW(W, bits) {
    if (!Number.isSafeInteger(W) || W <= 0 || W > bits)
      throw new Error("invalid window size, expected [1.." + bits + "], got W=" + W);
  }
  function calcWOpts(W, scalarBits) {
    validateW(W, scalarBits);
    const windows = Math.ceil(scalarBits / W) + 1;
    const windowSize = 2 ** (W - 1);
    const maxNumber = 2 ** W;
    const mask = bitMask(W);
    const shiftBy = BigInt(W);
    return { windows, windowSize, mask, maxNumber, shiftBy };
  }
  function calcOffsets(n, window2, wOpts) {
    const { windowSize, mask, maxNumber, shiftBy } = wOpts;
    let wbits = Number(n & mask);
    let nextN = n >> shiftBy;
    if (wbits > windowSize) {
      wbits -= maxNumber;
      nextN += _1n$1;
    }
    const offsetStart = window2 * windowSize;
    const offset = offsetStart + Math.abs(wbits) - 1;
    const isZero = wbits === 0;
    const isNeg = wbits < 0;
    const isNegF = window2 % 2 !== 0;
    const offsetF = offsetStart;
    return { nextN, offset, isZero, isNeg, isNegF, offsetF };
  }
  function validateMSMPoints(points, c) {
    if (!Array.isArray(points))
      throw new Error("array expected");
    points.forEach((p, i) => {
      if (!(p instanceof c))
        throw new Error("invalid point at index " + i);
    });
  }
  function validateMSMScalars(scalars, field) {
    if (!Array.isArray(scalars))
      throw new Error("array of scalars expected");
    scalars.forEach((s, i) => {
      if (!field.isValid(s))
        throw new Error("invalid scalar at index " + i);
    });
  }
  function getW(P) {
    return pointWindowSizes.get(P) || 1;
  }
  function assert0(n) {
    if (n !== _0n$1)
      throw new Error("invalid wNAF");
  }
  function mulEndoUnsafe(Point, point, k1, k2) {
    let acc = point;
    let p1 = Point.ZERO;
    let p2 = Point.ZERO;
    while (k1 > _0n$1 || k2 > _0n$1) {
      if (k1 & _1n$1)
        p1 = p1.add(acc);
      if (k2 & _1n$1)
        p2 = p2.add(acc);
      acc = acc.double();
      k1 >>= _1n$1;
      k2 >>= _1n$1;
    }
    return { p1, p2 };
  }
  function pippenger(c, fieldN, points, scalars) {
    validateMSMPoints(points, c);
    validateMSMScalars(scalars, fieldN);
    const plength = points.length;
    const slength = scalars.length;
    if (plength !== slength)
      throw new Error("arrays of points and scalars must have equal length");
    const zero = c.ZERO;
    const wbits = bitLen(BigInt(plength));
    let windowSize = 1;
    if (wbits > 12)
      windowSize = wbits - 3;
    else if (wbits > 4)
      windowSize = wbits - 2;
    else if (wbits > 0)
      windowSize = 2;
    const MASK = bitMask(windowSize);
    const buckets = new Array(Number(MASK) + 1).fill(zero);
    const lastBits = Math.floor((fieldN.BITS - 1) / windowSize) * windowSize;
    let sum = zero;
    for (let i = lastBits; i >= 0; i -= windowSize) {
      buckets.fill(zero);
      for (let j = 0; j < slength; j++) {
        const scalar = scalars[j];
        const wbits2 = Number(scalar >> BigInt(i) & MASK);
        buckets[wbits2] = buckets[wbits2].add(points[j]);
      }
      let resI = zero;
      for (let j = buckets.length - 1, sumI = zero; j > 0; j--) {
        sumI = sumI.add(buckets[j]);
        resI = resI.add(sumI);
      }
      sum = sum.add(resI);
      if (i !== 0)
        for (let j = 0; j < windowSize; j++)
          sum = sum.double();
    }
    return sum;
  }
  function createField(order, field) {
    if (field) {
      if (field.ORDER !== order)
        throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
      validateField(field);
      return field;
    } else {
      return Field(order);
    }
  }
  function _createCurveFields(type, CURVE, curveOpts = {}) {
    if (!CURVE || typeof CURVE !== "object")
      throw new Error(`expected valid ${type} CURVE object`);
    for (const p of ["p", "n", "h"]) {
      const val = CURVE[p];
      if (!(typeof val === "bigint" && val > _0n$1))
        throw new Error(`CURVE.${p} must be positive bigint`);
    }
    const Fp = createField(CURVE.p, curveOpts.Fp);
    const Fn = createField(CURVE.n, curveOpts.Fn);
    const _b = "b";
    const params = ["Gx", "Gy", "a", _b];
    for (const p of params) {
      if (!Fp.isValid(CURVE[p]))
        throw new Error(`CURVE.${p} must be valid field element of CURVE.Fp`);
    }
    return { Fp, Fn };
  }
  function _splitEndoScalar(k, basis, n) {
    const [[a1, b1], [a2, b2]] = basis;
    const c1 = divNearest(b2 * k, n);
    const c2 = divNearest(-b1 * k, n);
    let k1 = k - c1 * a1 - c2 * a2;
    let k2 = -c1 * b1 - c2 * b2;
    const k1neg = k1 < _0n;
    const k2neg = k2 < _0n;
    if (k1neg)
      k1 = -k1;
    if (k2neg)
      k2 = -k2;
    const MAX_NUM = bitMask(Math.ceil(bitLen(n) / 2)) + _1n;
    if (k1 < _0n || k1 >= MAX_NUM || k2 < _0n || k2 >= MAX_NUM) {
      throw new Error("splitScalar (endomorphism): failed, k=" + k);
    }
    return { k1neg, k1, k2neg, k2 };
  }
  function validateSigVerOpts(opts) {
    if (opts.lowS !== void 0)
      abool("lowS", opts.lowS);
    if (opts.prehash !== void 0)
      abool("prehash", opts.prehash);
  }
  function _legacyHelperEquat(Fp, a, b) {
    function weierstrassEquation(x) {
      const x2 = Fp.sqr(x);
      const x3 = Fp.mul(x2, x);
      return Fp.add(Fp.add(x3, Fp.mul(x, a)), b);
    }
    return weierstrassEquation;
  }
  function _normFnElement(Fn, key) {
    const { BYTES: expected } = Fn;
    let num;
    if (typeof key === "bigint") {
      num = key;
    } else {
      let bytes = ensureBytes("private key", key);
      try {
        num = Fn.fromBytes(bytes);
      } catch (error) {
        throw new Error(`invalid private key: expected ui8a of size ${expected}, got ${typeof key}`);
      }
    }
    if (!Fn.isValidNot0(num))
      throw new Error("invalid private key: out of range [1..N-1]");
    return num;
  }
  function weierstrassN(CURVE, curveOpts = {}) {
    const { Fp, Fn } = _createCurveFields("weierstrass", CURVE, curveOpts);
    const { h: cofactor, n: CURVE_ORDER } = CURVE;
    _validateObject(curveOpts, {}, {
      allowInfinityPoint: "boolean",
      clearCofactor: "function",
      isTorsionFree: "function",
      fromBytes: "function",
      toBytes: "function",
      endo: "object",
      wrapPrivateKey: "boolean"
    });
    const { endo } = curveOpts;
    if (endo) {
      if (!Fp.is0(CURVE.a) || typeof endo.beta !== "bigint" || !Array.isArray(endo.basises)) {
        throw new Error('invalid endo: expected "beta": bigint and "basises": array');
      }
    }
    function assertCompressionIsSupported() {
      if (!Fp.isOdd)
        throw new Error("compression is not supported: Field does not have .isOdd()");
    }
    function pointToBytes(_c, point, isCompressed) {
      const { x, y } = point.toAffine();
      const bx = Fp.toBytes(x);
      abool("isCompressed", isCompressed);
      if (isCompressed) {
        assertCompressionIsSupported();
        const hasEvenY = !Fp.isOdd(y);
        return concatBytes(pprefix(hasEvenY), bx);
      } else {
        return concatBytes(Uint8Array.of(4), bx, Fp.toBytes(y));
      }
    }
    function pointFromBytes(bytes) {
      abytes(bytes);
      const L = Fp.BYTES;
      const LC = L + 1;
      const LU = 2 * L + 1;
      const length = bytes.length;
      const head = bytes[0];
      const tail = bytes.subarray(1);
      if (length === LC && (head === 2 || head === 3)) {
        const x = Fp.fromBytes(tail);
        if (!Fp.isValid(x))
          throw new Error("bad point: is not on curve, wrong x");
        const y2 = weierstrassEquation(x);
        let y;
        try {
          y = Fp.sqrt(y2);
        } catch (sqrtError) {
          const err = sqrtError instanceof Error ? ": " + sqrtError.message : "";
          throw new Error("bad point: is not on curve, sqrt error" + err);
        }
        assertCompressionIsSupported();
        const isYOdd = Fp.isOdd(y);
        const isHeadOdd = (head & 1) === 1;
        if (isHeadOdd !== isYOdd)
          y = Fp.neg(y);
        return { x, y };
      } else if (length === LU && head === 4) {
        const x = Fp.fromBytes(tail.subarray(L * 0, L * 1));
        const y = Fp.fromBytes(tail.subarray(L * 1, L * 2));
        if (!isValidXY(x, y))
          throw new Error("bad point: is not on curve");
        return { x, y };
      } else {
        throw new Error(`bad point: got length ${length}, expected compressed=${LC} or uncompressed=${LU}`);
      }
    }
    const toBytes2 = curveOpts.toBytes || pointToBytes;
    const fromBytes = curveOpts.fromBytes || pointFromBytes;
    const weierstrassEquation = _legacyHelperEquat(Fp, CURVE.a, CURVE.b);
    function isValidXY(x, y) {
      const left = Fp.sqr(y);
      const right = weierstrassEquation(x);
      return Fp.eql(left, right);
    }
    if (!isValidXY(CURVE.Gx, CURVE.Gy))
      throw new Error("bad curve params: generator point");
    const _4a3 = Fp.mul(Fp.pow(CURVE.a, _3n), _4n);
    const _27b2 = Fp.mul(Fp.sqr(CURVE.b), BigInt(27));
    if (Fp.is0(Fp.add(_4a3, _27b2)))
      throw new Error("bad curve params: a or b");
    function acoord(title, n, banZero = false) {
      if (!Fp.isValid(n) || banZero && Fp.is0(n))
        throw new Error(`bad point coordinate ${title}`);
      return n;
    }
    function aprjpoint(other) {
      if (!(other instanceof Point))
        throw new Error("ProjectivePoint expected");
    }
    function splitEndoScalarN(k) {
      if (!endo || !endo.basises)
        throw new Error("no endo");
      return _splitEndoScalar(k, endo.basises, Fn.ORDER);
    }
    const toAffineMemo = memoized((p, iz) => {
      const { X, Y, Z } = p;
      if (Fp.eql(Z, Fp.ONE))
        return { x: X, y: Y };
      const is0 = p.is0();
      if (iz == null)
        iz = is0 ? Fp.ONE : Fp.inv(Z);
      const x = Fp.mul(X, iz);
      const y = Fp.mul(Y, iz);
      const zz = Fp.mul(Z, iz);
      if (is0)
        return { x: Fp.ZERO, y: Fp.ZERO };
      if (!Fp.eql(zz, Fp.ONE))
        throw new Error("invZ was invalid");
      return { x, y };
    });
    const assertValidMemo = memoized((p) => {
      if (p.is0()) {
        if (curveOpts.allowInfinityPoint && !Fp.is0(p.Y))
          return;
        throw new Error("bad point: ZERO");
      }
      const { x, y } = p.toAffine();
      if (!Fp.isValid(x) || !Fp.isValid(y))
        throw new Error("bad point: x or y not field elements");
      if (!isValidXY(x, y))
        throw new Error("bad point: equation left != right");
      if (!p.isTorsionFree())
        throw new Error("bad point: not in prime-order subgroup");
      return true;
    });
    function finishEndo(endoBeta, k1p, k2p, k1neg, k2neg) {
      k2p = new Point(Fp.mul(k2p.X, endoBeta), k2p.Y, k2p.Z);
      k1p = negateCt(k1neg, k1p);
      k2p = negateCt(k2neg, k2p);
      return k1p.add(k2p);
    }
    class Point {
      /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
      constructor(X, Y, Z) {
        this.X = acoord("x", X);
        this.Y = acoord("y", Y, true);
        this.Z = acoord("z", Z);
        Object.freeze(this);
      }
      /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
      static fromAffine(p) {
        const { x, y } = p || {};
        if (!p || !Fp.isValid(x) || !Fp.isValid(y))
          throw new Error("invalid affine point");
        if (p instanceof Point)
          throw new Error("projective point not allowed");
        if (Fp.is0(x) && Fp.is0(y))
          return Point.ZERO;
        return new Point(x, y, Fp.ONE);
      }
      get x() {
        return this.toAffine().x;
      }
      get y() {
        return this.toAffine().y;
      }
      // TODO: remove
      get px() {
        return this.X;
      }
      get py() {
        return this.X;
      }
      get pz() {
        return this.Z;
      }
      static normalizeZ(points) {
        return normalizeZ(Point, points);
      }
      static fromBytes(bytes) {
        abytes(bytes);
        return Point.fromHex(bytes);
      }
      /** Converts hash string or Uint8Array to Point. */
      static fromHex(hex) {
        const P = Point.fromAffine(fromBytes(ensureBytes("pointHex", hex)));
        P.assertValidity();
        return P;
      }
      /** Multiplies generator point by privateKey. */
      static fromPrivateKey(privateKey) {
        return Point.BASE.multiply(_normFnElement(Fn, privateKey));
      }
      // TODO: remove
      static msm(points, scalars) {
        return pippenger(Point, Fn, points, scalars);
      }
      _setWindowSize(windowSize) {
        this.precompute(windowSize);
      }
      /**
       *
       * @param windowSize
       * @param isLazy true will defer table computation until the first multiplication
       * @returns
       */
      precompute(windowSize = 8, isLazy = true) {
        wnaf.createCache(this, windowSize);
        if (!isLazy)
          this.multiply(_3n);
        return this;
      }
      // TODO: return `this`
      /** A point on curve is valid if it conforms to equation. */
      assertValidity() {
        assertValidMemo(this);
      }
      hasEvenY() {
        const { y } = this.toAffine();
        if (!Fp.isOdd)
          throw new Error("Field doesn't support isOdd");
        return !Fp.isOdd(y);
      }
      /** Compare one point to another. */
      equals(other) {
        aprjpoint(other);
        const { X: X1, Y: Y1, Z: Z1 } = this;
        const { X: X2, Y: Y2, Z: Z2 } = other;
        const U1 = Fp.eql(Fp.mul(X1, Z2), Fp.mul(X2, Z1));
        const U2 = Fp.eql(Fp.mul(Y1, Z2), Fp.mul(Y2, Z1));
        return U1 && U2;
      }
      /** Flips point to one corresponding to (x, -y) in Affine coordinates. */
      negate() {
        return new Point(this.X, Fp.neg(this.Y), this.Z);
      }
      // Renes-Costello-Batina exception-free doubling formula.
      // There is 30% faster Jacobian formula, but it is not complete.
      // https://eprint.iacr.org/2015/1060, algorithm 3
      // Cost: 8M + 3S + 3*a + 2*b3 + 15add.
      double() {
        const { a, b } = CURVE;
        const b3 = Fp.mul(b, _3n);
        const { X: X1, Y: Y1, Z: Z1 } = this;
        let X3 = Fp.ZERO, Y3 = Fp.ZERO, Z3 = Fp.ZERO;
        let t0 = Fp.mul(X1, X1);
        let t1 = Fp.mul(Y1, Y1);
        let t2 = Fp.mul(Z1, Z1);
        let t3 = Fp.mul(X1, Y1);
        t3 = Fp.add(t3, t3);
        Z3 = Fp.mul(X1, Z1);
        Z3 = Fp.add(Z3, Z3);
        X3 = Fp.mul(a, Z3);
        Y3 = Fp.mul(b3, t2);
        Y3 = Fp.add(X3, Y3);
        X3 = Fp.sub(t1, Y3);
        Y3 = Fp.add(t1, Y3);
        Y3 = Fp.mul(X3, Y3);
        X3 = Fp.mul(t3, X3);
        Z3 = Fp.mul(b3, Z3);
        t2 = Fp.mul(a, t2);
        t3 = Fp.sub(t0, t2);
        t3 = Fp.mul(a, t3);
        t3 = Fp.add(t3, Z3);
        Z3 = Fp.add(t0, t0);
        t0 = Fp.add(Z3, t0);
        t0 = Fp.add(t0, t2);
        t0 = Fp.mul(t0, t3);
        Y3 = Fp.add(Y3, t0);
        t2 = Fp.mul(Y1, Z1);
        t2 = Fp.add(t2, t2);
        t0 = Fp.mul(t2, t3);
        X3 = Fp.sub(X3, t0);
        Z3 = Fp.mul(t2, t1);
        Z3 = Fp.add(Z3, Z3);
        Z3 = Fp.add(Z3, Z3);
        return new Point(X3, Y3, Z3);
      }
      // Renes-Costello-Batina exception-free addition formula.
      // There is 30% faster Jacobian formula, but it is not complete.
      // https://eprint.iacr.org/2015/1060, algorithm 1
      // Cost: 12M + 0S + 3*a + 3*b3 + 23add.
      add(other) {
        aprjpoint(other);
        const { X: X1, Y: Y1, Z: Z1 } = this;
        const { X: X2, Y: Y2, Z: Z2 } = other;
        let X3 = Fp.ZERO, Y3 = Fp.ZERO, Z3 = Fp.ZERO;
        const a = CURVE.a;
        const b3 = Fp.mul(CURVE.b, _3n);
        let t0 = Fp.mul(X1, X2);
        let t1 = Fp.mul(Y1, Y2);
        let t2 = Fp.mul(Z1, Z2);
        let t3 = Fp.add(X1, Y1);
        let t4 = Fp.add(X2, Y2);
        t3 = Fp.mul(t3, t4);
        t4 = Fp.add(t0, t1);
        t3 = Fp.sub(t3, t4);
        t4 = Fp.add(X1, Z1);
        let t5 = Fp.add(X2, Z2);
        t4 = Fp.mul(t4, t5);
        t5 = Fp.add(t0, t2);
        t4 = Fp.sub(t4, t5);
        t5 = Fp.add(Y1, Z1);
        X3 = Fp.add(Y2, Z2);
        t5 = Fp.mul(t5, X3);
        X3 = Fp.add(t1, t2);
        t5 = Fp.sub(t5, X3);
        Z3 = Fp.mul(a, t4);
        X3 = Fp.mul(b3, t2);
        Z3 = Fp.add(X3, Z3);
        X3 = Fp.sub(t1, Z3);
        Z3 = Fp.add(t1, Z3);
        Y3 = Fp.mul(X3, Z3);
        t1 = Fp.add(t0, t0);
        t1 = Fp.add(t1, t0);
        t2 = Fp.mul(a, t2);
        t4 = Fp.mul(b3, t4);
        t1 = Fp.add(t1, t2);
        t2 = Fp.sub(t0, t2);
        t2 = Fp.mul(a, t2);
        t4 = Fp.add(t4, t2);
        t0 = Fp.mul(t1, t4);
        Y3 = Fp.add(Y3, t0);
        t0 = Fp.mul(t5, t4);
        X3 = Fp.mul(t3, X3);
        X3 = Fp.sub(X3, t0);
        t0 = Fp.mul(t3, t1);
        Z3 = Fp.mul(t5, Z3);
        Z3 = Fp.add(Z3, t0);
        return new Point(X3, Y3, Z3);
      }
      subtract(other) {
        return this.add(other.negate());
      }
      is0() {
        return this.equals(Point.ZERO);
      }
      /**
       * Constant time multiplication.
       * Uses wNAF method. Windowed method may be 10% faster,
       * but takes 2x longer to generate and consumes 2x memory.
       * Uses precomputes when available.
       * Uses endomorphism for Koblitz curves.
       * @param scalar by which the point would be multiplied
       * @returns New point
       */
      multiply(scalar) {
        const { endo: endo2 } = curveOpts;
        if (!Fn.isValidNot0(scalar))
          throw new Error("invalid scalar: out of range");
        let point, fake;
        const mul = (n) => wnaf.cached(this, n, (p) => normalizeZ(Point, p));
        if (endo2) {
          const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(scalar);
          const { p: k1p, f: k1f } = mul(k1);
          const { p: k2p, f: k2f } = mul(k2);
          fake = k1f.add(k2f);
          point = finishEndo(endo2.beta, k1p, k2p, k1neg, k2neg);
        } else {
          const { p, f } = mul(scalar);
          point = p;
          fake = f;
        }
        return normalizeZ(Point, [point, fake])[0];
      }
      /**
       * Non-constant-time multiplication. Uses double-and-add algorithm.
       * It's faster, but should only be used when you don't care about
       * an exposed secret key e.g. sig verification, which works over *public* keys.
       */
      multiplyUnsafe(sc) {
        const { endo: endo2 } = curveOpts;
        const p = this;
        if (!Fn.isValid(sc))
          throw new Error("invalid scalar: out of range");
        if (sc === _0n || p.is0())
          return Point.ZERO;
        if (sc === _1n)
          return p;
        if (wnaf.hasCache(this))
          return this.multiply(sc);
        if (endo2) {
          const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(sc);
          const { p1, p2 } = mulEndoUnsafe(Point, p, k1, k2);
          return finishEndo(endo2.beta, p1, p2, k1neg, k2neg);
        } else {
          return wnaf.unsafe(p, sc);
        }
      }
      multiplyAndAddUnsafe(Q, a, b) {
        const sum = this.multiplyUnsafe(a).add(Q.multiplyUnsafe(b));
        return sum.is0() ? void 0 : sum;
      }
      /**
       * Converts Projective point to affine (x, y) coordinates.
       * @param invertedZ Z^-1 (inverted zero) - optional, precomputation is useful for invertBatch
       */
      toAffine(invertedZ) {
        return toAffineMemo(this, invertedZ);
      }
      /**
       * Checks whether Point is free of torsion elements (is in prime subgroup).
       * Always torsion-free for cofactor=1 curves.
       */
      isTorsionFree() {
        const { isTorsionFree } = curveOpts;
        if (cofactor === _1n)
          return true;
        if (isTorsionFree)
          return isTorsionFree(Point, this);
        return wnaf.unsafe(this, CURVE_ORDER).is0();
      }
      clearCofactor() {
        const { clearCofactor } = curveOpts;
        if (cofactor === _1n)
          return this;
        if (clearCofactor)
          return clearCofactor(Point, this);
        return this.multiplyUnsafe(cofactor);
      }
      isSmallOrder() {
        return this.multiplyUnsafe(cofactor).is0();
      }
      toBytes(isCompressed = true) {
        abool("isCompressed", isCompressed);
        this.assertValidity();
        return toBytes2(Point, this, isCompressed);
      }
      /** @deprecated use `toBytes` */
      toRawBytes(isCompressed = true) {
        return this.toBytes(isCompressed);
      }
      toHex(isCompressed = true) {
        return bytesToHex(this.toBytes(isCompressed));
      }
      toString() {
        return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
      }
    }
    Point.BASE = new Point(CURVE.Gx, CURVE.Gy, Fp.ONE);
    Point.ZERO = new Point(Fp.ZERO, Fp.ONE, Fp.ZERO);
    Point.Fp = Fp;
    Point.Fn = Fn;
    const bits = Fn.BITS;
    const wnaf = new wNAF(Point, curveOpts.endo ? Math.ceil(bits / 2) : bits);
    return Point;
  }
  function pprefix(hasEvenY) {
    return Uint8Array.of(hasEvenY ? 2 : 3);
  }
  function ecdsa(Point, hash, ecdsaOpts = {}) {
    ahash(hash);
    _validateObject(ecdsaOpts, {}, {
      hmac: "function",
      lowS: "boolean",
      randomBytes: "function",
      bits2int: "function",
      bits2int_modN: "function"
    });
    const randomBytes_ = ecdsaOpts.randomBytes || randomBytes;
    const hmac_ = ecdsaOpts.hmac || ((key, ...msgs) => hmac(hash, key, concatBytes(...msgs)));
    const { Fp, Fn } = Point;
    const { ORDER: CURVE_ORDER, BITS: fnBits } = Fn;
    const seedLen = getMinHashLength(CURVE_ORDER);
    const lengths = {
      secret: Fn.BYTES,
      public: 1 + Fp.BYTES,
      publicUncompressed: 1 + 2 * Fp.BYTES,
      signature: 2 * Fn.BYTES,
      seed: seedLen
    };
    function isBiggerThanHalfOrder(number) {
      const HALF = CURVE_ORDER >> _1n;
      return number > HALF;
    }
    function normalizeS(s) {
      return isBiggerThanHalfOrder(s) ? Fn.neg(s) : s;
    }
    function aValidRS(title, num) {
      if (!Fn.isValidNot0(num))
        throw new Error(`invalid signature ${title}: out of range 1..CURVE.n`);
    }
    class Signature {
      constructor(r, s, recovery) {
        aValidRS("r", r);
        aValidRS("s", s);
        this.r = r;
        this.s = s;
        if (recovery != null)
          this.recovery = recovery;
        Object.freeze(this);
      }
      static fromBytes(bytes, format = "compact") {
        if (format === "compact") {
          const L = Fn.BYTES;
          abytes(bytes, L * 2);
          const r = bytes.subarray(0, L);
          const s = bytes.subarray(L, L * 2);
          return new Signature(Fn.fromBytes(r), Fn.fromBytes(s));
        }
        if (format === "der") {
          abytes(bytes);
          const { r, s } = DER.toSig(bytes);
          return new Signature(r, s);
        }
        throw new Error("invalid format");
      }
      static fromHex(hex, format) {
        return this.fromBytes(hexToBytes(hex), format);
      }
      addRecoveryBit(recovery) {
        return new Signature(this.r, this.s, recovery);
      }
      // ProjPointType<bigint>
      recoverPublicKey(msgHash) {
        const FIELD_ORDER = Fp.ORDER;
        const { r, s, recovery: rec } = this;
        if (rec == null || ![0, 1, 2, 3].includes(rec))
          throw new Error("recovery id invalid");
        const hasCofactor = CURVE_ORDER * _2n < FIELD_ORDER;
        if (hasCofactor && rec > 1)
          throw new Error("recovery id is ambiguous for h>1 curve");
        const radj = rec === 2 || rec === 3 ? r + CURVE_ORDER : r;
        if (!Fp.isValid(radj))
          throw new Error("recovery id 2 or 3 invalid");
        const x = Fp.toBytes(radj);
        const R = Point.fromHex(concatBytes(pprefix((rec & 1) === 0), x));
        const ir = Fn.inv(radj);
        const h = bits2int_modN(ensureBytes("msgHash", msgHash));
        const u1 = Fn.create(-h * ir);
        const u2 = Fn.create(s * ir);
        const Q = Point.BASE.multiplyUnsafe(u1).add(R.multiplyUnsafe(u2));
        if (Q.is0())
          throw new Error("point at infinify");
        Q.assertValidity();
        return Q;
      }
      // Signatures should be low-s, to prevent malleability.
      hasHighS() {
        return isBiggerThanHalfOrder(this.s);
      }
      normalizeS() {
        return this.hasHighS() ? new Signature(this.r, Fn.neg(this.s), this.recovery) : this;
      }
      toBytes(format = "compact") {
        if (format === "compact")
          return concatBytes(Fn.toBytes(this.r), Fn.toBytes(this.s));
        if (format === "der")
          return hexToBytes(DER.hexFromSig(this));
        throw new Error("invalid format");
      }
      toHex(format) {
        return bytesToHex(this.toBytes(format));
      }
      // TODO: remove
      assertValidity() {
      }
      static fromCompact(hex) {
        return Signature.fromBytes(ensureBytes("sig", hex), "compact");
      }
      static fromDER(hex) {
        return Signature.fromBytes(ensureBytes("sig", hex), "der");
      }
      toDERRawBytes() {
        return this.toBytes("der");
      }
      toDERHex() {
        return bytesToHex(this.toBytes("der"));
      }
      toCompactRawBytes() {
        return this.toBytes("compact");
      }
      toCompactHex() {
        return bytesToHex(this.toBytes("compact"));
      }
    }
    function isValidSecretKey(privateKey) {
      try {
        return !!_normFnElement(Fn, privateKey);
      } catch (error) {
        return false;
      }
    }
    function isValidPublicKey(publicKey, isCompressed) {
      try {
        const l = publicKey.length;
        if (isCompressed === true && l !== lengths.public)
          return false;
        if (isCompressed === false && l !== lengths.publicUncompressed)
          return false;
        return !!Point.fromBytes(publicKey);
      } catch (error) {
        return false;
      }
    }
    function randomSecretKey(seed = randomBytes_(seedLen)) {
      return mapHashToField(seed, CURVE_ORDER);
    }
    const utils = {
      isValidSecretKey,
      isValidPublicKey,
      randomSecretKey,
      // TODO: remove
      isValidPrivateKey: isValidSecretKey,
      randomPrivateKey: randomSecretKey,
      normPrivateKeyToScalar: (key) => _normFnElement(Fn, key),
      precompute(windowSize = 8, point = Point.BASE) {
        return point.precompute(windowSize, false);
      }
    };
    function getPublicKey(secretKey, isCompressed = true) {
      return Point.BASE.multiply(_normFnElement(Fn, secretKey)).toBytes(isCompressed);
    }
    function isProbPub(item) {
      if (typeof item === "bigint")
        return false;
      if (item instanceof Point)
        return true;
      if (Fn.allowedLengths || lengths.secret === lengths.public)
        return void 0;
      const l = ensureBytes("key", item).length;
      return l === lengths.public || l === lengths.publicUncompressed;
    }
    function getSharedSecret(secretKeyA, publicKeyB, isCompressed = true) {
      if (isProbPub(secretKeyA) === true)
        throw new Error("first arg must be private key");
      if (isProbPub(publicKeyB) === false)
        throw new Error("second arg must be public key");
      const s = _normFnElement(Fn, secretKeyA);
      const b = Point.fromHex(publicKeyB);
      return b.multiply(s).toBytes(isCompressed);
    }
    const bits2int = ecdsaOpts.bits2int || function(bytes) {
      if (bytes.length > 8192)
        throw new Error("input is too large");
      const num = bytesToNumberBE(bytes);
      const delta = bytes.length * 8 - fnBits;
      return delta > 0 ? num >> BigInt(delta) : num;
    };
    const bits2int_modN = ecdsaOpts.bits2int_modN || function(bytes) {
      return Fn.create(bits2int(bytes));
    };
    const ORDER_MASK = bitMask(fnBits);
    function int2octets(num) {
      aInRange("num < 2^" + fnBits, num, _0n, ORDER_MASK);
      return Fn.toBytes(num);
    }
    function prepSig(msgHash, privateKey, opts = defaultSigOpts) {
      if (["recovered", "canonical"].some((k) => k in opts))
        throw new Error("sign() legacy options not supported");
      let { lowS, prehash, extraEntropy: ent } = opts;
      if (lowS == null)
        lowS = true;
      msgHash = ensureBytes("msgHash", msgHash);
      validateSigVerOpts(opts);
      if (prehash)
        msgHash = ensureBytes("prehashed msgHash", hash(msgHash));
      const h1int = bits2int_modN(msgHash);
      const d = _normFnElement(Fn, privateKey);
      const seedArgs = [int2octets(d), int2octets(h1int)];
      if (ent != null && ent !== false) {
        const e = ent === true ? randomBytes_(lengths.secret) : ent;
        seedArgs.push(ensureBytes("extraEntropy", e));
      }
      const seed = concatBytes(...seedArgs);
      const m = h1int;
      function k2sig(kBytes) {
        const k = bits2int(kBytes);
        if (!Fn.isValidNot0(k))
          return;
        const ik = Fn.inv(k);
        const q = Point.BASE.multiply(k).toAffine();
        const r = Fn.create(q.x);
        if (r === _0n)
          return;
        const s = Fn.create(ik * Fn.create(m + r * d));
        if (s === _0n)
          return;
        let recovery = (q.x === r ? 0 : 2) | Number(q.y & _1n);
        let normS = s;
        if (lowS && isBiggerThanHalfOrder(s)) {
          normS = normalizeS(s);
          recovery ^= 1;
        }
        return new Signature(r, normS, recovery);
      }
      return { seed, k2sig };
    }
    const defaultSigOpts = { lowS: ecdsaOpts.lowS, prehash: false };
    const defaultVerOpts = { lowS: ecdsaOpts.lowS, prehash: false };
    function sign(msgHash, secretKey, opts = defaultSigOpts) {
      const { seed, k2sig } = prepSig(msgHash, secretKey, opts);
      const drbg = createHmacDrbg(hash.outputLen, Fn.BYTES, hmac_);
      return drbg(seed, k2sig);
    }
    Point.BASE.precompute(8);
    function verify(signature, msgHash, publicKey, opts = defaultVerOpts) {
      const sg = signature;
      msgHash = ensureBytes("msgHash", msgHash);
      publicKey = ensureBytes("publicKey", publicKey);
      validateSigVerOpts(opts);
      const { lowS, prehash, format } = opts;
      if ("strict" in opts)
        throw new Error("options.strict was renamed to lowS");
      let _sig = void 0;
      let P;
      if (format === void 0) {
        const isHex = typeof sg === "string" || isBytes(sg);
        const isObj = !isHex && sg !== null && typeof sg === "object" && typeof sg.r === "bigint" && typeof sg.s === "bigint";
        if (!isHex && !isObj)
          throw new Error("invalid signature, expected Uint8Array, hex string or Signature instance");
        if (isObj) {
          _sig = new Signature(sg.r, sg.s);
        } else if (isHex) {
          try {
            _sig = Signature.fromDER(sg);
          } catch (derError) {
            if (!(derError instanceof DER.Err))
              throw derError;
          }
          if (!_sig) {
            try {
              _sig = Signature.fromCompact(sg);
            } catch (error) {
              return false;
            }
          }
        }
      } else {
        if (format === "compact" || format === "der") {
          if (typeof sg !== "string" && !isBytes(sg))
            throw new Error('"der" / "compact" format expects Uint8Array signature');
          _sig = Signature.fromBytes(ensureBytes("sig", sg), format);
        } else if (format === "js") {
          if (!(sg instanceof Signature))
            throw new Error('"js" format expects Signature instance');
          _sig = sg;
        } else {
          throw new Error('format must be "compact", "der" or "js"');
        }
      }
      if (!_sig)
        return false;
      try {
        P = Point.fromHex(publicKey);
        if (lowS && _sig.hasHighS())
          return false;
        if (prehash)
          msgHash = hash(msgHash);
        const { r, s } = _sig;
        const h = bits2int_modN(msgHash);
        const is = Fn.inv(s);
        const u1 = Fn.create(h * is);
        const u2 = Fn.create(r * is);
        const R = Point.BASE.multiplyUnsafe(u1).add(P.multiplyUnsafe(u2));
        if (R.is0())
          return false;
        const v = Fn.create(R.x);
        return v === r;
      } catch (e) {
        return false;
      }
    }
    function keygen(seed) {
      const secretKey = utils.randomSecretKey(seed);
      return { secretKey, publicKey: getPublicKey(secretKey) };
    }
    return Object.freeze({
      keygen,
      getPublicKey,
      sign,
      verify,
      getSharedSecret,
      utils,
      Point,
      Signature,
      info: { type: "weierstrass", lengths, publicKeyHasPrefix: true }
    });
  }
  function _weierstrass_legacy_opts_to_new(c) {
    const CURVE = {
      a: c.a,
      b: c.b,
      p: c.Fp.ORDER,
      n: c.n,
      h: c.h,
      Gx: c.Gx,
      Gy: c.Gy
    };
    const Fp = c.Fp;
    let allowedLengths = c.allowedPrivateKeyLengths ? Array.from(new Set(c.allowedPrivateKeyLengths.map((l) => Math.ceil(l / 2)))) : void 0;
    const Fn = Field(CURVE.n, {
      BITS: c.nBitLength,
      allowedLengths,
      modOnDecode: c.wrapPrivateKey
    });
    const curveOpts = {
      Fp,
      Fn,
      allowInfinityPoint: c.allowInfinityPoint,
      endo: c.endo,
      isTorsionFree: c.isTorsionFree,
      clearCofactor: c.clearCofactor,
      fromBytes: c.fromBytes,
      toBytes: c.toBytes
    };
    return { CURVE, curveOpts };
  }
  function _ecdsa_legacy_opts_to_new(c) {
    const { CURVE, curveOpts } = _weierstrass_legacy_opts_to_new(c);
    const ecdsaOpts = {
      hmac: c.hmac,
      randomBytes: c.randomBytes,
      lowS: c.lowS,
      bits2int: c.bits2int,
      bits2int_modN: c.bits2int_modN
    };
    return { CURVE, curveOpts, hash: c.hash, ecdsaOpts };
  }
  function _ecdsa_new_output_to_legacy(c, ecdsa2) {
    return Object.assign({}, ecdsa2, {
      ProjectivePoint: ecdsa2.Point,
      CURVE: c
    });
  }
  function weierstrass(c) {
    const { CURVE, curveOpts, hash, ecdsaOpts } = _ecdsa_legacy_opts_to_new(c);
    const Point = weierstrassN(CURVE, curveOpts);
    const signs = ecdsa(Point, hash, ecdsaOpts);
    return _ecdsa_new_output_to_legacy(c, signs);
  }
  function createCurve(curveDef, defHash) {
    const create = (hash) => weierstrass({ ...curveDef, hash });
    return { ...create(defHash), create };
  }
  function promisifyRequest(request) {
    return new Promise((resolve, reject) => {
      request.oncomplete = request.onsuccess = () => resolve(request.result);
      request.onabort = request.onerror = () => reject(request.error);
    });
  }
  function createStore(dbName, storeName) {
    let dbp;
    const getDB = () => {
      if (dbp)
        return dbp;
      const request = indexedDB.open(dbName);
      request.onupgradeneeded = () => request.result.createObjectStore(storeName);
      dbp = promisifyRequest(request);
      dbp.then((db) => {
        db.onclose = () => dbp = void 0;
      }, () => {
      });
      return dbp;
    };
    return (txMode, callback) => getDB().then((db) => callback(db.transaction(storeName, txMode).objectStore(storeName)));
  }
  function defaultGetStore() {
    if (!defaultGetStoreFunc) {
      defaultGetStoreFunc = createStore("keyval-store", "keyval");
    }
    return defaultGetStoreFunc;
  }
  function get(key, customStore = defaultGetStore()) {
    return customStore("readonly", (store) => promisifyRequest(store.get(key)));
  }
  function set(key, value, customStore = defaultGetStore()) {
    return customStore("readwrite", (store) => {
      store.put(value, key);
      return promisifyRequest(store.transaction);
    });
  }
  function del(key, customStore = defaultGetStore()) {
    return customStore("readwrite", (store) => {
      store.delete(key);
      return promisifyRequest(store.transaction);
    });
  }
  function getSubtle() {
    if (_subtle) return _subtle;
    if (isBrowser && window.crypto?.subtle) {
      _subtle = window.crypto.subtle;
    } else if (typeof globalThis !== "undefined" && globalThis.crypto?.subtle) {
      _subtle = globalThis.crypto.subtle;
    } else {
      if (typeof __require !== "undefined") {
        try {
          const { webcrypto } = __require("crypto");
          _subtle = webcrypto.subtle;
        } catch (e) {
          throw new Error("WebCrypto not available in this environment");
        }
      } else {
        throw new Error("WebCrypto not available - ensure you are using Node.js 16+ or a modern browser");
      }
    }
    return _subtle;
  }
  function getRandomValues(array) {
    if (isBrowser && window.crypto) {
      return window.crypto.getRandomValues(array);
    } else if (typeof globalThis !== "undefined" && globalThis.crypto) {
      return globalThis.crypto.getRandomValues(array);
    } else {
      if (typeof __require !== "undefined") {
        try {
          const { webcrypto } = __require("crypto");
          return webcrypto.getRandomValues(array);
        } catch (e) {
          throw new Error("Crypto random values not available in this environment");
        }
      } else {
        throw new Error("Crypto random values not available - ensure you are using Node.js 16+ or a modern browser");
      }
    }
  }
  function normalize(s) {
    if (typeof s !== "string") {
      throw new Error("Input must be a string");
    }
    return s.normalize("NFC").trim();
  }
  function validatePrivateKey(privB64) {
    if (typeof privB64 !== "string") {
      throw new Error("Private key must be a string");
    }
    try {
      const key = b64UrlToBuf(privB64);
      if (key.length !== 32) {
        throw new Error("Invalid private key length for P-256 (expected 32 bytes)");
      }
      return key;
    } catch (error) {
      throw new Error(`Invalid private key format: ${error.message}`);
    }
  }
  function validatePublicKey(pubJwk) {
    if (typeof pubJwk !== "string") {
      throw new Error("Public key must be a string");
    }
    if (!pubJwk.includes(".")) {
      throw new Error("Public key must be in JWK format (x.y)");
    }
    try {
      const [x, y] = pubJwk.split(".");
      if (!x || !y) {
        throw new Error("Invalid JWK format: missing x or y component");
      }
      const xBuf = b64UrlToBuf(x);
      const yBuf = b64UrlToBuf(y);
      if (xBuf.length !== 32 || yBuf.length !== 32) {
        throw new Error("Invalid public key coordinates length for P-256");
      }
      return { x: xBuf, y: yBuf };
    } catch (error) {
      throw new Error(`Invalid public key format: ${error.message}`);
    }
  }
  function constantTimeEqual(a, b) {
    if (a.length !== b.length) {
      return false;
    }
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a[i] ^ b[i];
    }
    return result === 0;
  }
  function bufToB64Url(buf) {
    const bin = String.fromCharCode(...new Uint8Array(buf));
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64UrlToBuf(b64url) {
    const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
    const bin = atob(b64);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }
  function keyToJWK(pubBuf) {
    if (pubBuf[0] !== 4) throw new Error("Expected uncompressed key");
    const x = pubBuf.slice(1, 33);
    const y = pubBuf.slice(33, 65);
    return `${bufToB64Url(x)}.${bufToB64Url(y)}`;
  }
  function jwkToKey(jwk) {
    const [x, y] = jwk.split(".");
    return new Uint8Array([4, ...b64UrlToBuf(x), ...b64UrlToBuf(y)]);
  }
  async function generateRandomPair() {
    const signingPriv = p256.utils.randomPrivateKey();
    const encryptionPriv = p256.utils.randomPrivateKey();
    const pub = p256.getPublicKey(signingPriv, false);
    const epub = p256.getPublicKey(encryptionPriv, false);
    return {
      pub: keyToJWK(pub),
      priv: bufToB64Url(signingPriv),
      epub: keyToJWK(epub),
      epriv: bufToB64Url(encryptionPriv)
    };
  }
  async function signMessage(msg, privB64) {
    const subtle = getSubtle();
    const msgBuf = TEXT_ENCODER.encode(normalize(msg));
    const hash = await subtle.digest("SHA-256", msgBuf);
    const priv = validatePrivateKey(privB64);
    const sig = p256.sign(new Uint8Array(hash), priv);
    return bufToB64Url(sig.toCompactRawBytes());
  }
  async function verifyMessage(msg, sigB64, pubJwk) {
    if (typeof sigB64 !== "string") {
      throw new Error("Signature must be a string");
    }
    const subtle = getSubtle();
    const msgBuf = TEXT_ENCODER.encode(normalize(msg));
    const hash = await subtle.digest("SHA-256", msgBuf);
    validatePublicKey(pubJwk);
    const pub = jwkToKey(pubJwk);
    try {
      const sig = b64UrlToBuf(sigB64);
      return p256.verify(sig, new Uint8Array(hash), pub);
    } catch (error) {
      return false;
    }
  }
  async function encryptMessageWithMeta(msg, recipient) {
    if (!recipient || typeof recipient !== "object") {
      throw new Error("Recipient must be a key object with epub property");
    }
    if (!recipient.epub) {
      throw new Error("Recipient must have an encryption public key (epub)");
    }
    const subtle = getSubtle();
    validatePublicKey(recipient.epub);
    const pub = jwkToKey(recipient.epub);
    const ephPriv = p256.utils.randomPrivateKey();
    const ephPub = p256.getPublicKey(ephPriv, false);
    const shared = p256.getSharedSecret(ephPriv, pub).slice(1);
    const keyMat = await subtle.digest("SHA-256", shared);
    const iv = getRandomValues(new Uint8Array(12));
    const key = await subtle.importKey("raw", keyMat, { name: "AES-GCM" }, false, ["encrypt"]);
    const msgBuf = TEXT_ENCODER.encode(normalize(msg));
    const ct = await subtle.encrypt({ name: "AES-GCM", iv }, key, msgBuf);
    return {
      ciphertext: bufToB64Url(ct),
      iv: bufToB64Url(iv),
      sender: keyToJWK(ephPub),
      timestamp: Date.now()
    };
  }
  async function decryptMessageWithMeta(payload, privB64) {
    if (!payload || typeof payload !== "object") {
      throw new Error("Payload must be an encrypted message object");
    }
    if (!payload.ciphertext || !payload.iv || !payload.sender) {
      throw new Error("Payload must contain ciphertext, iv, and sender");
    }
    const subtle = getSubtle();
    validatePublicKey(payload.sender);
    const ephPub = jwkToKey(payload.sender);
    const priv = validatePrivateKey(privB64);
    const shared = p256.getSharedSecret(priv, ephPub).slice(1);
    const keyMat = await subtle.digest("SHA-256", shared);
    const key = await subtle.importKey("raw", keyMat, { name: "AES-GCM" }, false, ["decrypt"]);
    try {
      const iv = b64UrlToBuf(payload.iv);
      const ct = b64UrlToBuf(payload.ciphertext);
      const pt = await subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
      return TEXT_DECODER.decode(pt);
    } catch (error) {
      throw new Error(`Decryption failed: ${error.message}`);
    }
  }
  async function exportToJWK(privB64) {
    const priv = b64UrlToBuf(privB64);
    if (priv.length !== 32) {
      throw new Error("Invalid private key length for P-256");
    }
    return {
      kty: "EC",
      crv: "P-256",
      d: bufToB64Url(priv),
      use: "sig",
      key_ops: ["sign"]
    };
  }
  async function importFromJWK(jwk) {
    if (jwk.kty !== "EC") {
      throw new Error("JWK must be an EC key");
    }
    if (jwk.crv !== "P-256") {
      throw new Error("JWK must use P-256 curve");
    }
    if (!jwk.d) {
      throw new Error("JWK must contain private key component (d)");
    }
    return jwk.d;
  }
  async function exportToPEM(privB64) {
    const raw = b64UrlToBuf(privB64);
    if (raw.length !== 32) {
      throw new Error("Invalid private key length for P-256");
    }
    const pkcs8Header = new Uint8Array([
      48,
      129,
      135,
      // SEQUENCE (135 bytes)
      2,
      1,
      0,
      // INTEGER version (0)
      48,
      19,
      // SEQUENCE AlgorithmIdentifier
      6,
      7,
      42,
      134,
      72,
      206,
      61,
      2,
      1,
      // OID ecPublicKey
      6,
      8,
      42,
      134,
      72,
      206,
      61,
      3,
      1,
      7,
      // OID secp256r1
      4,
      109,
      // OCTET STRING (109 bytes)
      48,
      107,
      // SEQUENCE ECPrivateKey
      2,
      1,
      1,
      // INTEGER version (1)
      4,
      32
      // OCTET STRING privateKey (32 bytes)
    ]);
    const pkcs8Suffix = new Uint8Array([
      161,
      68,
      3,
      66,
      0,
      4
      // publicKey context tag + BIT STRING + uncompressed point indicator
    ]);
    const pubKey = p256.getPublicKey(raw, false);
    const pkcs8Data = new Uint8Array(pkcs8Header.length + raw.length + pkcs8Suffix.length + pubKey.length);
    pkcs8Data.set(pkcs8Header, 0);
    pkcs8Data.set(raw, pkcs8Header.length);
    pkcs8Data.set(pkcs8Suffix, pkcs8Header.length + raw.length);
    pkcs8Data.set(pubKey, pkcs8Header.length + raw.length + pkcs8Suffix.length);
    const b64 = btoa(String.fromCharCode(...pkcs8Data));
    return `-----BEGIN PRIVATE KEY-----
${b64.match(/.{1,64}/g).join("\n")}
-----END PRIVATE KEY-----`;
  }
  async function importFromPEM(pem) {
    if (!pem.includes("-----BEGIN PRIVATE KEY-----")) {
      throw new Error("Invalid PEM format: must contain BEGIN PRIVATE KEY header");
    }
    const b64 = pem.replace(/-----.*?-----/g, "").replace(/\s+/g, "");
    if (!b64) {
      throw new Error("Invalid PEM format: no data found");
    }
    try {
      const bin = atob(b64);
      const data = Uint8Array.from([...bin].map((c) => c.charCodeAt(0)));
      for (let i = 0; i < data.length - 34; i++) {
        if (data[i] === 4 && data[i + 1] === 32) {
          const privateKey = data.slice(i + 2, i + 34);
          if (privateKey.length === 32) {
            return bufToB64Url(privateKey);
          }
        }
      }
      throw new Error("Could not extract private key from PKCS#8 structure");
    } catch (error) {
      throw new Error(`Failed to parse PEM: ${error.message}`);
    }
  }
  async function deriveStorageKey(password, salt) {
    const subtle = getSubtle();
    const encoder = new TextEncoder();
    const keyMaterial = await subtle.importKey(
      "raw",
      encoder.encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveKey"]
    );
    return subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: 1e5,
        hash: "SHA-256"
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }
  async function saveKeys(name, keys, password = null) {
    if (!password) {
      console.warn("\u26A0\uFE0F WARNING: Keys are being stored unencrypted. Consider providing a password for better security.");
      return set(name, { encrypted: false, data: keys });
    }
    try {
      const subtle = getSubtle();
      const salt = getRandomValues(new Uint8Array(16));
      const iv = getRandomValues(new Uint8Array(12));
      const storageKey = await deriveStorageKey(password, salt);
      const keyData = TEXT_ENCODER.encode(JSON.stringify(keys));
      const encryptedData = await subtle.encrypt({ name: "AES-GCM", iv }, storageKey, keyData);
      return set(name, {
        encrypted: true,
        salt: bufToB64Url(salt),
        iv: bufToB64Url(iv),
        data: bufToB64Url(encryptedData)
      });
    } catch (error) {
      throw new Error(`Failed to encrypt and save keys: ${error.message}`);
    }
  }
  async function loadKeys(name, password = null) {
    const stored = await get(name);
    if (!stored) {
      return void 0;
    }
    if (!stored.encrypted) {
      return stored.data;
    }
    if (!password) {
      throw new Error("Password required to decrypt stored keys");
    }
    try {
      const subtle = getSubtle();
      const salt = b64UrlToBuf(stored.salt);
      const iv = b64UrlToBuf(stored.iv);
      const encryptedData = b64UrlToBuf(stored.data);
      const storageKey = await deriveStorageKey(password, salt);
      const decryptedData = await subtle.decrypt({ name: "AES-GCM", iv }, storageKey, encryptedData);
      const keyData = TEXT_DECODER.decode(decryptedData);
      return JSON.parse(keyData);
    } catch (error) {
      throw new Error(`Failed to decrypt keys: ${error.message}`);
    }
  }
  async function clearKeys(name) {
    return del(name);
  }
  async function generateWork(data, difficulty = 4, maxIterations = 1e6) {
    const subtle = getSubtle();
    const target = "0".repeat(difficulty);
    const dataStr = typeof data === "string" ? data : JSON.stringify(data);
    let nonce = 0;
    let hash;
    let hashHex;
    const startTime = Date.now();
    while (nonce < maxIterations) {
      const payload = `${dataStr}:${nonce}`;
      const payloadBuf = TEXT_ENCODER.encode(payload);
      const hashBuf = await subtle.digest("SHA-256", payloadBuf);
      const hashArray = new Uint8Array(hashBuf);
      hashHex = Array.from(hashArray).map((b) => b.toString(16).padStart(2, "0")).join("");
      if (hashHex.startsWith(target)) {
        hash = bufToB64Url(hashBuf);
        break;
      }
      nonce++;
    }
    const endTime = Date.now();
    const duration = endTime - startTime;
    if (nonce >= maxIterations) {
      throw new Error(`Failed to find proof of work within ${maxIterations} iterations`);
    }
    return {
      data: dataStr,
      nonce,
      hash,
      hashHex,
      difficulty,
      timestamp: endTime,
      duration,
      hashRate: Math.round(nonce / (duration / 1e3))
    };
  }
  async function verifyWork(proof) {
    if (!proof || typeof proof !== "object") {
      throw new Error("Proof must be an object");
    }
    if (typeof proof.data !== "string" || typeof proof.nonce !== "number" || typeof proof.difficulty !== "number" || !proof.hash || !proof.hashHex) {
      throw new Error("Proof must contain data, nonce, difficulty, hash, and hashHex");
    }
    const subtle = getSubtle();
    const target = "0".repeat(proof.difficulty);
    const payload = `${proof.data}:${proof.nonce}`;
    const payloadBuf = TEXT_ENCODER.encode(payload);
    const hashBuf = await subtle.digest("SHA-256", payloadBuf);
    const hashArray = new Uint8Array(hashBuf);
    const hashHex = Array.from(hashArray).map((b) => b.toString(16).padStart(2, "0")).join("");
    const hashB64 = bufToB64Url(hashBuf);
    const expectedHashB64 = TEXT_ENCODER.encode(proof.hash);
    const computedHashB64 = TEXT_ENCODER.encode(hashB64);
    const expectedHashHex = TEXT_ENCODER.encode(proof.hashHex);
    const computedHashHex = TEXT_ENCODER.encode(hashHex);
    const validHashB64 = constantTimeEqual(expectedHashB64, computedHashB64);
    const validHashHex = constantTimeEqual(expectedHashHex, computedHashHex);
    const validHash = validHashB64 && validHashHex;
    const validDifficulty = hashHex.startsWith(target);
    return {
      valid: validHash && validDifficulty,
      hashMatches: validHash,
      difficultyMatches: validDifficulty,
      computedHash: hashB64,
      computedHashHex: hashHex,
      expectedDifficulty: target
    };
  }
  async function generateSignedWork(data, privKey, difficulty = 4, maxIterations = 1e6) {
    const work = await generateWork(data, difficulty, maxIterations);
    const workPayload = JSON.stringify({
      data: work.data,
      nonce: work.nonce,
      hash: work.hash,
      difficulty: work.difficulty,
      timestamp: work.timestamp
    });
    const signature = await signMessage(workPayload, privKey);
    return {
      ...work,
      signature,
      signedPayload: workPayload
    };
  }
  async function verifySignedWork(signedWork, pubKey) {
    const workVerification = await verifyWork(signedWork);
    if (!workVerification.valid) {
      return {
        valid: false,
        workValid: false,
        signatureValid: false,
        reason: "Invalid proof of work"
      };
    }
    const signatureValid = await verifyMessage(
      signedWork.signedPayload,
      signedWork.signature,
      pubKey
    );
    return {
      valid: workVerification.valid && signatureValid,
      workValid: workVerification.valid,
      signatureValid,
      workVerification
    };
  }
  function getSecurityInfo() {
    return {
      version: "1.1.2",
      securityEnhancements: [
        "Bundled dependencies with static imports",
        "Proper PKCS#8 PEM encoding/decoding",
        "Encrypted key storage with PBKDF2",
        "Input validation and sanitization",
        "Constant-time comparisons",
        "Enhanced error handling",
        "Multiple output formats for compatibility"
      ],
      algorithms: {
        signing: "ECDSA with P-256 and SHA-256",
        encryption: "ECDH + AES-GCM",
        keyDerivation: "PBKDF2 with SHA-256",
        proofOfWork: "SHA-256 based mining"
      },
      warnings: [
        "Keys stored without password are unencrypted",
        "PEM format uses simplified PKCS#8 structure",
        "Proof of work verification uses constant-time comparison for hashes only",
        "Dependencies are bundled at build time - verify bundle integrity"
      ]
    };
  }
  var crypto2, hasHexBuiltin, hexes, asciis, Hash, _0n$3, _1n$3, isPosBig, bitMask, _0n$2, _1n$2, _2n$1, _3n$1, _4n$1, _5n, _7n, _8n, _9n, _16n, FIELD_FIELDS, HashMD, SHA256_IV, SHA384_IV, SHA512_IV, U32_MASK64, _32n, shrSH, shrSL, rotrSH, rotrSL, rotrBH, rotrBL, add3L, add3H, add4L, add4H, add5L, add5H, SHA256_K, SHA256_W, SHA256, K512, SHA512_Kh, SHA512_Kl, SHA512_W_H, SHA512_W_L, SHA512, SHA384, sha256, sha512, sha384, HMAC, hmac, _0n$1, _1n$1, pointPrecomputes, pointWindowSizes, wNAF, divNearest, DERErr, DER, _0n, _1n, _2n, _3n, _4n, p256_CURVE, p384_CURVE, p521_CURVE, Fp256, Fp384, Fp521, p256$1, p256, defaultGetStoreFunc, isBrowser, _subtle, TEXT_ENCODER, TEXT_DECODER, SECURITY_CONFIG;
  var init_unsea = __esm({
    "node_modules/unsea/dist/unsea.mjs"() {
      crypto2 = typeof globalThis === "object" && "crypto" in globalThis ? globalThis.crypto : void 0;
      hasHexBuiltin = /* @__PURE__ */ (() => (
        // @ts-ignore
        typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function"
      ))();
      hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
      asciis = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
      Hash = class {
      };
      _0n$3 = /* @__PURE__ */ BigInt(0);
      _1n$3 = /* @__PURE__ */ BigInt(1);
      isPosBig = (n) => typeof n === "bigint" && _0n$3 <= n;
      bitMask = (n) => (_1n$3 << BigInt(n)) - _1n$3;
      _0n$2 = BigInt(0);
      _1n$2 = BigInt(1);
      _2n$1 = /* @__PURE__ */ BigInt(2);
      _3n$1 = /* @__PURE__ */ BigInt(3);
      _4n$1 = /* @__PURE__ */ BigInt(4);
      _5n = /* @__PURE__ */ BigInt(5);
      _7n = /* @__PURE__ */ BigInt(7);
      _8n = /* @__PURE__ */ BigInt(8);
      _9n = /* @__PURE__ */ BigInt(9);
      _16n = /* @__PURE__ */ BigInt(16);
      FIELD_FIELDS = [
        "create",
        "isValid",
        "is0",
        "neg",
        "inv",
        "sqrt",
        "sqr",
        "eql",
        "add",
        "sub",
        "mul",
        "pow",
        "div",
        "addN",
        "subN",
        "mulN",
        "sqrN"
      ];
      HashMD = class extends Hash {
        constructor(blockLen, outputLen, padOffset, isLE) {
          super();
          this.finished = false;
          this.length = 0;
          this.pos = 0;
          this.destroyed = false;
          this.blockLen = blockLen;
          this.outputLen = outputLen;
          this.padOffset = padOffset;
          this.isLE = isLE;
          this.buffer = new Uint8Array(blockLen);
          this.view = createView(this.buffer);
        }
        update(data) {
          aexists(this);
          data = toBytes(data);
          abytes(data);
          const { view, buffer, blockLen } = this;
          const len = data.length;
          for (let pos = 0; pos < len; ) {
            const take = Math.min(blockLen - this.pos, len - pos);
            if (take === blockLen) {
              const dataView = createView(data);
              for (; blockLen <= len - pos; pos += blockLen)
                this.process(dataView, pos);
              continue;
            }
            buffer.set(data.subarray(pos, pos + take), this.pos);
            this.pos += take;
            pos += take;
            if (this.pos === blockLen) {
              this.process(view, 0);
              this.pos = 0;
            }
          }
          this.length += data.length;
          this.roundClean();
          return this;
        }
        digestInto(out) {
          aexists(this);
          aoutput(out, this);
          this.finished = true;
          const { buffer, view, blockLen, isLE } = this;
          let { pos } = this;
          buffer[pos++] = 128;
          clean(this.buffer.subarray(pos));
          if (this.padOffset > blockLen - pos) {
            this.process(view, 0);
            pos = 0;
          }
          for (let i = pos; i < blockLen; i++)
            buffer[i] = 0;
          setBigUint64(view, blockLen - 8, BigInt(this.length * 8), isLE);
          this.process(view, 0);
          const oview = createView(out);
          const len = this.outputLen;
          if (len % 4)
            throw new Error("_sha2: outputLen should be aligned to 32bit");
          const outLen = len / 4;
          const state = this.get();
          if (outLen > state.length)
            throw new Error("_sha2: outputLen bigger than state");
          for (let i = 0; i < outLen; i++)
            oview.setUint32(4 * i, state[i], isLE);
        }
        digest() {
          const { buffer, outputLen } = this;
          this.digestInto(buffer);
          const res = buffer.slice(0, outputLen);
          this.destroy();
          return res;
        }
        _cloneInto(to) {
          to || (to = new this.constructor());
          to.set(...this.get());
          const { blockLen, buffer, length, finished, destroyed, pos } = this;
          to.destroyed = destroyed;
          to.finished = finished;
          to.length = length;
          to.pos = pos;
          if (length % blockLen)
            to.buffer.set(buffer);
          return to;
        }
        clone() {
          return this._cloneInto();
        }
      };
      SHA256_IV = /* @__PURE__ */ Uint32Array.from([
        1779033703,
        3144134277,
        1013904242,
        2773480762,
        1359893119,
        2600822924,
        528734635,
        1541459225
      ]);
      SHA384_IV = /* @__PURE__ */ Uint32Array.from([
        3418070365,
        3238371032,
        1654270250,
        914150663,
        2438529370,
        812702999,
        355462360,
        4144912697,
        1731405415,
        4290775857,
        2394180231,
        1750603025,
        3675008525,
        1694076839,
        1203062813,
        3204075428
      ]);
      SHA512_IV = /* @__PURE__ */ Uint32Array.from([
        1779033703,
        4089235720,
        3144134277,
        2227873595,
        1013904242,
        4271175723,
        2773480762,
        1595750129,
        1359893119,
        2917565137,
        2600822924,
        725511199,
        528734635,
        4215389547,
        1541459225,
        327033209
      ]);
      U32_MASK64 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
      _32n = /* @__PURE__ */ BigInt(32);
      shrSH = (h, _l, s) => h >>> s;
      shrSL = (h, l, s) => h << 32 - s | l >>> s;
      rotrSH = (h, l, s) => h >>> s | l << 32 - s;
      rotrSL = (h, l, s) => h << 32 - s | l >>> s;
      rotrBH = (h, l, s) => h << 64 - s | l >>> s - 32;
      rotrBL = (h, l, s) => h >>> s - 32 | l << 64 - s;
      add3L = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
      add3H = (low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0;
      add4L = (Al, Bl, Cl, Dl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0);
      add4H = (low, Ah, Bh, Ch, Dh) => Ah + Bh + Ch + Dh + (low / 2 ** 32 | 0) | 0;
      add5L = (Al, Bl, Cl, Dl, El) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0);
      add5H = (low, Ah, Bh, Ch, Dh, Eh) => Ah + Bh + Ch + Dh + Eh + (low / 2 ** 32 | 0) | 0;
      SHA256_K = /* @__PURE__ */ Uint32Array.from([
        1116352408,
        1899447441,
        3049323471,
        3921009573,
        961987163,
        1508970993,
        2453635748,
        2870763221,
        3624381080,
        310598401,
        607225278,
        1426881987,
        1925078388,
        2162078206,
        2614888103,
        3248222580,
        3835390401,
        4022224774,
        264347078,
        604807628,
        770255983,
        1249150122,
        1555081692,
        1996064986,
        2554220882,
        2821834349,
        2952996808,
        3210313671,
        3336571891,
        3584528711,
        113926993,
        338241895,
        666307205,
        773529912,
        1294757372,
        1396182291,
        1695183700,
        1986661051,
        2177026350,
        2456956037,
        2730485921,
        2820302411,
        3259730800,
        3345764771,
        3516065817,
        3600352804,
        4094571909,
        275423344,
        430227734,
        506948616,
        659060556,
        883997877,
        958139571,
        1322822218,
        1537002063,
        1747873779,
        1955562222,
        2024104815,
        2227730452,
        2361852424,
        2428436474,
        2756734187,
        3204031479,
        3329325298
      ]);
      SHA256_W = /* @__PURE__ */ new Uint32Array(64);
      SHA256 = class extends HashMD {
        constructor(outputLen = 32) {
          super(64, outputLen, 8, false);
          this.A = SHA256_IV[0] | 0;
          this.B = SHA256_IV[1] | 0;
          this.C = SHA256_IV[2] | 0;
          this.D = SHA256_IV[3] | 0;
          this.E = SHA256_IV[4] | 0;
          this.F = SHA256_IV[5] | 0;
          this.G = SHA256_IV[6] | 0;
          this.H = SHA256_IV[7] | 0;
        }
        get() {
          const { A, B, C, D, E, F, G, H } = this;
          return [A, B, C, D, E, F, G, H];
        }
        // prettier-ignore
        set(A, B, C, D, E, F, G, H) {
          this.A = A | 0;
          this.B = B | 0;
          this.C = C | 0;
          this.D = D | 0;
          this.E = E | 0;
          this.F = F | 0;
          this.G = G | 0;
          this.H = H | 0;
        }
        process(view, offset) {
          for (let i = 0; i < 16; i++, offset += 4)
            SHA256_W[i] = view.getUint32(offset, false);
          for (let i = 16; i < 64; i++) {
            const W15 = SHA256_W[i - 15];
            const W2 = SHA256_W[i - 2];
            const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
            const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
            SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
          }
          let { A, B, C, D, E, F, G, H } = this;
          for (let i = 0; i < 64; i++) {
            const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
            const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
            const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
            const T2 = sigma0 + Maj(A, B, C) | 0;
            H = G;
            G = F;
            F = E;
            E = D + T1 | 0;
            D = C;
            C = B;
            B = A;
            A = T1 + T2 | 0;
          }
          A = A + this.A | 0;
          B = B + this.B | 0;
          C = C + this.C | 0;
          D = D + this.D | 0;
          E = E + this.E | 0;
          F = F + this.F | 0;
          G = G + this.G | 0;
          H = H + this.H | 0;
          this.set(A, B, C, D, E, F, G, H);
        }
        roundClean() {
          clean(SHA256_W);
        }
        destroy() {
          this.set(0, 0, 0, 0, 0, 0, 0, 0);
          clean(this.buffer);
        }
      };
      K512 = /* @__PURE__ */ (() => split([
        "0x428a2f98d728ae22",
        "0x7137449123ef65cd",
        "0xb5c0fbcfec4d3b2f",
        "0xe9b5dba58189dbbc",
        "0x3956c25bf348b538",
        "0x59f111f1b605d019",
        "0x923f82a4af194f9b",
        "0xab1c5ed5da6d8118",
        "0xd807aa98a3030242",
        "0x12835b0145706fbe",
        "0x243185be4ee4b28c",
        "0x550c7dc3d5ffb4e2",
        "0x72be5d74f27b896f",
        "0x80deb1fe3b1696b1",
        "0x9bdc06a725c71235",
        "0xc19bf174cf692694",
        "0xe49b69c19ef14ad2",
        "0xefbe4786384f25e3",
        "0x0fc19dc68b8cd5b5",
        "0x240ca1cc77ac9c65",
        "0x2de92c6f592b0275",
        "0x4a7484aa6ea6e483",
        "0x5cb0a9dcbd41fbd4",
        "0x76f988da831153b5",
        "0x983e5152ee66dfab",
        "0xa831c66d2db43210",
        "0xb00327c898fb213f",
        "0xbf597fc7beef0ee4",
        "0xc6e00bf33da88fc2",
        "0xd5a79147930aa725",
        "0x06ca6351e003826f",
        "0x142929670a0e6e70",
        "0x27b70a8546d22ffc",
        "0x2e1b21385c26c926",
        "0x4d2c6dfc5ac42aed",
        "0x53380d139d95b3df",
        "0x650a73548baf63de",
        "0x766a0abb3c77b2a8",
        "0x81c2c92e47edaee6",
        "0x92722c851482353b",
        "0xa2bfe8a14cf10364",
        "0xa81a664bbc423001",
        "0xc24b8b70d0f89791",
        "0xc76c51a30654be30",
        "0xd192e819d6ef5218",
        "0xd69906245565a910",
        "0xf40e35855771202a",
        "0x106aa07032bbd1b8",
        "0x19a4c116b8d2d0c8",
        "0x1e376c085141ab53",
        "0x2748774cdf8eeb99",
        "0x34b0bcb5e19b48a8",
        "0x391c0cb3c5c95a63",
        "0x4ed8aa4ae3418acb",
        "0x5b9cca4f7763e373",
        "0x682e6ff3d6b2b8a3",
        "0x748f82ee5defb2fc",
        "0x78a5636f43172f60",
        "0x84c87814a1f0ab72",
        "0x8cc702081a6439ec",
        "0x90befffa23631e28",
        "0xa4506cebde82bde9",
        "0xbef9a3f7b2c67915",
        "0xc67178f2e372532b",
        "0xca273eceea26619c",
        "0xd186b8c721c0c207",
        "0xeada7dd6cde0eb1e",
        "0xf57d4f7fee6ed178",
        "0x06f067aa72176fba",
        "0x0a637dc5a2c898a6",
        "0x113f9804bef90dae",
        "0x1b710b35131c471b",
        "0x28db77f523047d84",
        "0x32caab7b40c72493",
        "0x3c9ebe0a15c9bebc",
        "0x431d67c49c100d4c",
        "0x4cc5d4becb3e42b6",
        "0x597f299cfc657e2a",
        "0x5fcb6fab3ad6faec",
        "0x6c44198c4a475817"
      ].map((n) => BigInt(n))))();
      SHA512_Kh = /* @__PURE__ */ (() => K512[0])();
      SHA512_Kl = /* @__PURE__ */ (() => K512[1])();
      SHA512_W_H = /* @__PURE__ */ new Uint32Array(80);
      SHA512_W_L = /* @__PURE__ */ new Uint32Array(80);
      SHA512 = class extends HashMD {
        constructor(outputLen = 64) {
          super(128, outputLen, 16, false);
          this.Ah = SHA512_IV[0] | 0;
          this.Al = SHA512_IV[1] | 0;
          this.Bh = SHA512_IV[2] | 0;
          this.Bl = SHA512_IV[3] | 0;
          this.Ch = SHA512_IV[4] | 0;
          this.Cl = SHA512_IV[5] | 0;
          this.Dh = SHA512_IV[6] | 0;
          this.Dl = SHA512_IV[7] | 0;
          this.Eh = SHA512_IV[8] | 0;
          this.El = SHA512_IV[9] | 0;
          this.Fh = SHA512_IV[10] | 0;
          this.Fl = SHA512_IV[11] | 0;
          this.Gh = SHA512_IV[12] | 0;
          this.Gl = SHA512_IV[13] | 0;
          this.Hh = SHA512_IV[14] | 0;
          this.Hl = SHA512_IV[15] | 0;
        }
        // prettier-ignore
        get() {
          const { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
          return [Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl];
        }
        // prettier-ignore
        set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl) {
          this.Ah = Ah | 0;
          this.Al = Al | 0;
          this.Bh = Bh | 0;
          this.Bl = Bl | 0;
          this.Ch = Ch | 0;
          this.Cl = Cl | 0;
          this.Dh = Dh | 0;
          this.Dl = Dl | 0;
          this.Eh = Eh | 0;
          this.El = El | 0;
          this.Fh = Fh | 0;
          this.Fl = Fl | 0;
          this.Gh = Gh | 0;
          this.Gl = Gl | 0;
          this.Hh = Hh | 0;
          this.Hl = Hl | 0;
        }
        process(view, offset) {
          for (let i = 0; i < 16; i++, offset += 4) {
            SHA512_W_H[i] = view.getUint32(offset);
            SHA512_W_L[i] = view.getUint32(offset += 4);
          }
          for (let i = 16; i < 80; i++) {
            const W15h = SHA512_W_H[i - 15] | 0;
            const W15l = SHA512_W_L[i - 15] | 0;
            const s0h = rotrSH(W15h, W15l, 1) ^ rotrSH(W15h, W15l, 8) ^ shrSH(W15h, W15l, 7);
            const s0l = rotrSL(W15h, W15l, 1) ^ rotrSL(W15h, W15l, 8) ^ shrSL(W15h, W15l, 7);
            const W2h = SHA512_W_H[i - 2] | 0;
            const W2l = SHA512_W_L[i - 2] | 0;
            const s1h = rotrSH(W2h, W2l, 19) ^ rotrBH(W2h, W2l, 61) ^ shrSH(W2h, W2l, 6);
            const s1l = rotrSL(W2h, W2l, 19) ^ rotrBL(W2h, W2l, 61) ^ shrSL(W2h, W2l, 6);
            const SUMl = add4L(s0l, s1l, SHA512_W_L[i - 7], SHA512_W_L[i - 16]);
            const SUMh = add4H(SUMl, s0h, s1h, SHA512_W_H[i - 7], SHA512_W_H[i - 16]);
            SHA512_W_H[i] = SUMh | 0;
            SHA512_W_L[i] = SUMl | 0;
          }
          let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
          for (let i = 0; i < 80; i++) {
            const sigma1h = rotrSH(Eh, El, 14) ^ rotrSH(Eh, El, 18) ^ rotrBH(Eh, El, 41);
            const sigma1l = rotrSL(Eh, El, 14) ^ rotrSL(Eh, El, 18) ^ rotrBL(Eh, El, 41);
            const CHIh = Eh & Fh ^ ~Eh & Gh;
            const CHIl = El & Fl ^ ~El & Gl;
            const T1ll = add5L(Hl, sigma1l, CHIl, SHA512_Kl[i], SHA512_W_L[i]);
            const T1h = add5H(T1ll, Hh, sigma1h, CHIh, SHA512_Kh[i], SHA512_W_H[i]);
            const T1l = T1ll | 0;
            const sigma0h = rotrSH(Ah, Al, 28) ^ rotrBH(Ah, Al, 34) ^ rotrBH(Ah, Al, 39);
            const sigma0l = rotrSL(Ah, Al, 28) ^ rotrBL(Ah, Al, 34) ^ rotrBL(Ah, Al, 39);
            const MAJh = Ah & Bh ^ Ah & Ch ^ Bh & Ch;
            const MAJl = Al & Bl ^ Al & Cl ^ Bl & Cl;
            Hh = Gh | 0;
            Hl = Gl | 0;
            Gh = Fh | 0;
            Gl = Fl | 0;
            Fh = Eh | 0;
            Fl = El | 0;
            ({ h: Eh, l: El } = add(Dh | 0, Dl | 0, T1h | 0, T1l | 0));
            Dh = Ch | 0;
            Dl = Cl | 0;
            Ch = Bh | 0;
            Cl = Bl | 0;
            Bh = Ah | 0;
            Bl = Al | 0;
            const All = add3L(T1l, sigma0l, MAJl);
            Ah = add3H(All, T1h, sigma0h, MAJh);
            Al = All | 0;
          }
          ({ h: Ah, l: Al } = add(this.Ah | 0, this.Al | 0, Ah | 0, Al | 0));
          ({ h: Bh, l: Bl } = add(this.Bh | 0, this.Bl | 0, Bh | 0, Bl | 0));
          ({ h: Ch, l: Cl } = add(this.Ch | 0, this.Cl | 0, Ch | 0, Cl | 0));
          ({ h: Dh, l: Dl } = add(this.Dh | 0, this.Dl | 0, Dh | 0, Dl | 0));
          ({ h: Eh, l: El } = add(this.Eh | 0, this.El | 0, Eh | 0, El | 0));
          ({ h: Fh, l: Fl } = add(this.Fh | 0, this.Fl | 0, Fh | 0, Fl | 0));
          ({ h: Gh, l: Gl } = add(this.Gh | 0, this.Gl | 0, Gh | 0, Gl | 0));
          ({ h: Hh, l: Hl } = add(this.Hh | 0, this.Hl | 0, Hh | 0, Hl | 0));
          this.set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl);
        }
        roundClean() {
          clean(SHA512_W_H, SHA512_W_L);
        }
        destroy() {
          clean(this.buffer);
          this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        }
      };
      SHA384 = class extends SHA512 {
        constructor() {
          super(48);
          this.Ah = SHA384_IV[0] | 0;
          this.Al = SHA384_IV[1] | 0;
          this.Bh = SHA384_IV[2] | 0;
          this.Bl = SHA384_IV[3] | 0;
          this.Ch = SHA384_IV[4] | 0;
          this.Cl = SHA384_IV[5] | 0;
          this.Dh = SHA384_IV[6] | 0;
          this.Dl = SHA384_IV[7] | 0;
          this.Eh = SHA384_IV[8] | 0;
          this.El = SHA384_IV[9] | 0;
          this.Fh = SHA384_IV[10] | 0;
          this.Fl = SHA384_IV[11] | 0;
          this.Gh = SHA384_IV[12] | 0;
          this.Gl = SHA384_IV[13] | 0;
          this.Hh = SHA384_IV[14] | 0;
          this.Hl = SHA384_IV[15] | 0;
        }
      };
      sha256 = /* @__PURE__ */ createHasher(() => new SHA256());
      sha512 = /* @__PURE__ */ createHasher(() => new SHA512());
      sha384 = /* @__PURE__ */ createHasher(() => new SHA384());
      HMAC = class extends Hash {
        constructor(hash, _key) {
          super();
          this.finished = false;
          this.destroyed = false;
          ahash(hash);
          const key = toBytes(_key);
          this.iHash = hash.create();
          if (typeof this.iHash.update !== "function")
            throw new Error("Expected instance of class which extends utils.Hash");
          this.blockLen = this.iHash.blockLen;
          this.outputLen = this.iHash.outputLen;
          const blockLen = this.blockLen;
          const pad = new Uint8Array(blockLen);
          pad.set(key.length > blockLen ? hash.create().update(key).digest() : key);
          for (let i = 0; i < pad.length; i++)
            pad[i] ^= 54;
          this.iHash.update(pad);
          this.oHash = hash.create();
          for (let i = 0; i < pad.length; i++)
            pad[i] ^= 54 ^ 92;
          this.oHash.update(pad);
          clean(pad);
        }
        update(buf) {
          aexists(this);
          this.iHash.update(buf);
          return this;
        }
        digestInto(out) {
          aexists(this);
          abytes(out, this.outputLen);
          this.finished = true;
          this.iHash.digestInto(out);
          this.oHash.update(out);
          this.oHash.digestInto(out);
          this.destroy();
        }
        digest() {
          const out = new Uint8Array(this.oHash.outputLen);
          this.digestInto(out);
          return out;
        }
        _cloneInto(to) {
          to || (to = Object.create(Object.getPrototypeOf(this), {}));
          const { oHash, iHash, finished, destroyed, blockLen, outputLen } = this;
          to = to;
          to.finished = finished;
          to.destroyed = destroyed;
          to.blockLen = blockLen;
          to.outputLen = outputLen;
          to.oHash = oHash._cloneInto(to.oHash);
          to.iHash = iHash._cloneInto(to.iHash);
          return to;
        }
        clone() {
          return this._cloneInto();
        }
        destroy() {
          this.destroyed = true;
          this.oHash.destroy();
          this.iHash.destroy();
        }
      };
      hmac = (hash, key, message) => new HMAC(hash, key).update(message).digest();
      hmac.create = (hash, key) => new HMAC(hash, key);
      _0n$1 = BigInt(0);
      _1n$1 = BigInt(1);
      pointPrecomputes = /* @__PURE__ */ new WeakMap();
      pointWindowSizes = /* @__PURE__ */ new WeakMap();
      wNAF = class {
        // Parametrized with a given Point class (not individual point)
        constructor(Point, bits) {
          this.BASE = Point.BASE;
          this.ZERO = Point.ZERO;
          this.Fn = Point.Fn;
          this.bits = bits;
        }
        // non-const time multiplication ladder
        _unsafeLadder(elm, n, p = this.ZERO) {
          let d = elm;
          while (n > _0n$1) {
            if (n & _1n$1)
              p = p.add(d);
            d = d.double();
            n >>= _1n$1;
          }
          return p;
        }
        /**
         * Creates a wNAF precomputation window. Used for caching.
         * Default window size is set by `utils.precompute()` and is equal to 8.
         * Number of precomputed points depends on the curve size:
         * 2^(𝑊−1) * (Math.ceil(𝑛 / 𝑊) + 1), where:
         * - 𝑊 is the window size
         * - 𝑛 is the bitlength of the curve order.
         * For a 256-bit curve and window size 8, the number of precomputed points is 128 * 33 = 4224.
         * @param point Point instance
         * @param W window size
         * @returns precomputed point tables flattened to a single array
         */
        precomputeWindow(point, W) {
          const { windows, windowSize } = calcWOpts(W, this.bits);
          const points = [];
          let p = point;
          let base = p;
          for (let window2 = 0; window2 < windows; window2++) {
            base = p;
            points.push(base);
            for (let i = 1; i < windowSize; i++) {
              base = base.add(p);
              points.push(base);
            }
            p = base.double();
          }
          return points;
        }
        /**
         * Implements ec multiplication using precomputed tables and w-ary non-adjacent form.
         * More compact implementation:
         * https://github.com/paulmillr/noble-secp256k1/blob/47cb1669b6e506ad66b35fe7d76132ae97465da2/index.ts#L502-L541
         * @returns real and fake (for const-time) points
         */
        wNAF(W, precomputes, n) {
          if (!this.Fn.isValid(n))
            throw new Error("invalid scalar");
          let p = this.ZERO;
          let f = this.BASE;
          const wo = calcWOpts(W, this.bits);
          for (let window2 = 0; window2 < wo.windows; window2++) {
            const { nextN, offset, isZero, isNeg, isNegF, offsetF } = calcOffsets(n, window2, wo);
            n = nextN;
            if (isZero) {
              f = f.add(negateCt(isNegF, precomputes[offsetF]));
            } else {
              p = p.add(negateCt(isNeg, precomputes[offset]));
            }
          }
          assert0(n);
          return { p, f };
        }
        /**
         * Implements ec unsafe (non const-time) multiplication using precomputed tables and w-ary non-adjacent form.
         * @param acc accumulator point to add result of multiplication
         * @returns point
         */
        wNAFUnsafe(W, precomputes, n, acc = this.ZERO) {
          const wo = calcWOpts(W, this.bits);
          for (let window2 = 0; window2 < wo.windows; window2++) {
            if (n === _0n$1)
              break;
            const { nextN, offset, isZero, isNeg } = calcOffsets(n, window2, wo);
            n = nextN;
            if (isZero) {
              continue;
            } else {
              const item = precomputes[offset];
              acc = acc.add(isNeg ? item.negate() : item);
            }
          }
          assert0(n);
          return acc;
        }
        getPrecomputes(W, point, transform) {
          let comp = pointPrecomputes.get(point);
          if (!comp) {
            comp = this.precomputeWindow(point, W);
            if (W !== 1) {
              if (typeof transform === "function")
                comp = transform(comp);
              pointPrecomputes.set(point, comp);
            }
          }
          return comp;
        }
        cached(point, scalar, transform) {
          const W = getW(point);
          return this.wNAF(W, this.getPrecomputes(W, point, transform), scalar);
        }
        unsafe(point, scalar, transform, prev) {
          const W = getW(point);
          if (W === 1)
            return this._unsafeLadder(point, scalar, prev);
          return this.wNAFUnsafe(W, this.getPrecomputes(W, point, transform), scalar, prev);
        }
        // We calculate precomputes for elliptic curve point multiplication
        // using windowed method. This specifies window size and
        // stores precomputed values. Usually only base point would be precomputed.
        createCache(P, W) {
          validateW(W, this.bits);
          pointWindowSizes.set(P, W);
          pointPrecomputes.delete(P);
        }
        hasCache(elm) {
          return getW(elm) !== 1;
        }
      };
      divNearest = (num, den) => (num + (num >= 0 ? den : -den) / _2n) / den;
      DERErr = class extends Error {
        constructor(m = "") {
          super(m);
        }
      };
      DER = {
        // asn.1 DER encoding utils
        Err: DERErr,
        // Basic building block is TLV (Tag-Length-Value)
        _tlv: {
          encode: (tag, data) => {
            const { Err: E } = DER;
            if (tag < 0 || tag > 256)
              throw new E("tlv.encode: wrong tag");
            if (data.length & 1)
              throw new E("tlv.encode: unpadded data");
            const dataLen = data.length / 2;
            const len = numberToHexUnpadded(dataLen);
            if (len.length / 2 & 128)
              throw new E("tlv.encode: long form length too big");
            const lenLen = dataLen > 127 ? numberToHexUnpadded(len.length / 2 | 128) : "";
            const t = numberToHexUnpadded(tag);
            return t + lenLen + len + data;
          },
          // v - value, l - left bytes (unparsed)
          decode(tag, data) {
            const { Err: E } = DER;
            let pos = 0;
            if (tag < 0 || tag > 256)
              throw new E("tlv.encode: wrong tag");
            if (data.length < 2 || data[pos++] !== tag)
              throw new E("tlv.decode: wrong tlv");
            const first = data[pos++];
            const isLong = !!(first & 128);
            let length = 0;
            if (!isLong)
              length = first;
            else {
              const lenLen = first & 127;
              if (!lenLen)
                throw new E("tlv.decode(long): indefinite length not supported");
              if (lenLen > 4)
                throw new E("tlv.decode(long): byte length is too big");
              const lengthBytes = data.subarray(pos, pos + lenLen);
              if (lengthBytes.length !== lenLen)
                throw new E("tlv.decode: length bytes not complete");
              if (lengthBytes[0] === 0)
                throw new E("tlv.decode(long): zero leftmost byte");
              for (const b of lengthBytes)
                length = length << 8 | b;
              pos += lenLen;
              if (length < 128)
                throw new E("tlv.decode(long): not minimal encoding");
            }
            const v = data.subarray(pos, pos + length);
            if (v.length !== length)
              throw new E("tlv.decode: wrong value length");
            return { v, l: data.subarray(pos + length) };
          }
        },
        // https://crypto.stackexchange.com/a/57734 Leftmost bit of first byte is 'negative' flag,
        // since we always use positive integers here. It must always be empty:
        // - add zero byte if exists
        // - if next byte doesn't have a flag, leading zero is not allowed (minimal encoding)
        _int: {
          encode(num) {
            const { Err: E } = DER;
            if (num < _0n)
              throw new E("integer: negative integers are not allowed");
            let hex = numberToHexUnpadded(num);
            if (Number.parseInt(hex[0], 16) & 8)
              hex = "00" + hex;
            if (hex.length & 1)
              throw new E("unexpected DER parsing assertion: unpadded hex");
            return hex;
          },
          decode(data) {
            const { Err: E } = DER;
            if (data[0] & 128)
              throw new E("invalid signature integer: negative");
            if (data[0] === 0 && !(data[1] & 128))
              throw new E("invalid signature integer: unnecessary leading zero");
            return bytesToNumberBE(data);
          }
        },
        toSig(hex) {
          const { Err: E, _int: int, _tlv: tlv } = DER;
          const data = ensureBytes("signature", hex);
          const { v: seqBytes, l: seqLeftBytes } = tlv.decode(48, data);
          if (seqLeftBytes.length)
            throw new E("invalid signature: left bytes after parsing");
          const { v: rBytes, l: rLeftBytes } = tlv.decode(2, seqBytes);
          const { v: sBytes, l: sLeftBytes } = tlv.decode(2, rLeftBytes);
          if (sLeftBytes.length)
            throw new E("invalid signature: left bytes after parsing");
          return { r: int.decode(rBytes), s: int.decode(sBytes) };
        },
        hexFromSig(sig) {
          const { _tlv: tlv, _int: int } = DER;
          const rs = tlv.encode(2, int.encode(sig.r));
          const ss = tlv.encode(2, int.encode(sig.s));
          const seq = rs + ss;
          return tlv.encode(48, seq);
        }
      };
      _0n = BigInt(0);
      _1n = BigInt(1);
      _2n = BigInt(2);
      _3n = BigInt(3);
      _4n = BigInt(4);
      p256_CURVE = {
        p: BigInt("0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff"),
        n: BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"),
        h: BigInt(1),
        a: BigInt("0xffffffff00000001000000000000000000000000fffffffffffffffffffffffc"),
        b: BigInt("0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b"),
        Gx: BigInt("0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296"),
        Gy: BigInt("0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5")
      };
      p384_CURVE = {
        p: BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffff0000000000000000ffffffff"),
        n: BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffc7634d81f4372ddf581a0db248b0a77aecec196accc52973"),
        h: BigInt(1),
        a: BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffff0000000000000000fffffffc"),
        b: BigInt("0xb3312fa7e23ee7e4988e056be3f82d19181d9c6efe8141120314088f5013875ac656398d8a2ed19d2a85c8edd3ec2aef"),
        Gx: BigInt("0xaa87ca22be8b05378eb1c71ef320ad746e1d3b628ba79b9859f741e082542a385502f25dbf55296c3a545e3872760ab7"),
        Gy: BigInt("0x3617de4a96262c6f5d9e98bf9292dc29f8f41dbd289a147ce9da3113b5f0b8c00a60b1ce1d7e819d7a431d7c90ea0e5f")
      };
      p521_CURVE = {
        p: BigInt("0x1ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"),
        n: BigInt("0x01fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffa51868783bf2f966b7fcc0148f709a5d03bb5c9b8899c47aebb6fb71e91386409"),
        h: BigInt(1),
        a: BigInt("0x1fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc"),
        b: BigInt("0x0051953eb9618e1c9a1f929a21a0b68540eea2da725b99b315f3b8b489918ef109e156193951ec7e937b1652c0bd3bb1bf073573df883d2c34f1ef451fd46b503f00"),
        Gx: BigInt("0x00c6858e06b70404e9cd9e3ecb662395b4429c648139053fb521f828af606b4d3dbaa14b5e77efe75928fe1dc127a2ffa8de3348b3c1856a429bf97e7e31c2e5bd66"),
        Gy: BigInt("0x011839296a789a3bc0045c8a5fb42c7d1bd998f54449579b446817afbd17273e662c97ee72995ef42640c550b9013fad0761353c7086a272c24088be94769fd16650")
      };
      Fp256 = Field(p256_CURVE.p);
      Fp384 = Field(p384_CURVE.p);
      Fp521 = Field(p521_CURVE.p);
      p256$1 = createCurve({ ...p256_CURVE, Fp: Fp256, lowS: false }, sha256);
      createCurve({ ...p384_CURVE, Fp: Fp384, lowS: false }, sha384);
      createCurve({ ...p521_CURVE, Fp: Fp521, lowS: false, allowedPrivateKeyLengths: [130, 131, 132] }, sha512);
      p256 = p256$1;
      isBrowser = typeof window !== "undefined" && typeof document !== "undefined";
      TEXT_ENCODER = new TextEncoder();
      TEXT_DECODER = new TextDecoder();
      SECURITY_CONFIG = {
        PBKDF2_ITERATIONS: 1e5,
        AES_KEY_LENGTH: 256,
        CURVE: "P-256",
        HASH_ALGORITHM: "SHA-256",
        SUPPORTED_FORMATS: ["JWK", "PEM"],
        MIN_POW_DIFFICULTY: 1,
        MAX_POW_DIFFICULTY: 8
      };
    }
  });

  // node_modules/ws/browser.js
  var require_browser = __commonJS({
    "node_modules/ws/browser.js"(exports, module) {
      "use strict";
      module.exports = function() {
        throw new Error(
          "ws does not work in the browser. Browser clients must use the native WebSocket object"
        );
      };
    }
  });

  // src/browser-entry.js
  var browser_entry_exports = {};
  __export(browser_entry_exports, {
    DebugLogger: () => DebugLogger_default,
    DistributedStorageManager: () => DistributedStorageManager,
    EnvironmentDetector: () => EnvironmentDetector,
    PeerConnection: () => PeerConnection,
    PeerPigeonMesh: () => PeerPigeonMesh,
    SignalingClient: () => SignalingClient,
    WebDHT: () => WebDHT,
    environmentDetector: () => environmentDetector,
    getEnvironmentReport: () => getEnvironmentReport,
    hasWebRTC: () => hasWebRTC,
    hasWebSocket: () => hasWebSocket,
    initWebRTCAsync: () => initWebRTCAsync,
    isBrowser: () => isBrowser2,
    isNodeJS: () => isNodeJS,
    isWorker: () => isWorker
  });
  init_unsea();

  // src/PigeonRTC-browser.js
  var RTCAdapter = class {
    getRTCPeerConnection() {
      throw new Error("getRTCPeerConnection must be implemented by adapter");
    }
    getRTCSessionDescription() {
      throw new Error("getRTCSessionDescription must be implemented by adapter");
    }
    getRTCIceCandidate() {
      throw new Error("getRTCIceCandidate must be implemented by adapter");
    }
    getMediaStream() {
      return null;
    }
    isSupported() {
      throw new Error("isSupported must be implemented by adapter");
    }
    getName() {
      throw new Error("getName must be implemented by adapter");
    }
    async initialize() {
    }
    async getUserMedia(_constraints) {
      throw new Error("getUserMedia not supported by this adapter");
    }
    async getDisplayMedia(_constraints) {
      throw new Error("getDisplayMedia not supported by this adapter");
    }
  };
  var BrowserRTCAdapter = class extends RTCAdapter {
    constructor() {
      super();
      this._checkSupport();
    }
    _checkSupport() {
      if (typeof window === "undefined" || typeof navigator === "undefined") {
        return;
      }
      this.hasRTCPeerConnection = !!(window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection);
      this.hasGetUserMedia = !!(navigator.mediaDevices?.getUserMedia || navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia);
      this.hasGetDisplayMedia = !!navigator.mediaDevices?.getDisplayMedia;
    }
    getRTCPeerConnection() {
      if (typeof window === "undefined") {
        throw new Error("BrowserRTCAdapter requires a browser environment");
      }
      return window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
    }
    getRTCSessionDescription() {
      if (typeof window === "undefined") {
        throw new Error("BrowserRTCAdapter requires a browser environment");
      }
      return window.RTCSessionDescription || window.mozRTCSessionDescription;
    }
    getRTCIceCandidate() {
      if (typeof window === "undefined") {
        throw new Error("BrowserRTCAdapter requires a browser environment");
      }
      return window.RTCIceCandidate || window.mozRTCIceCandidate;
    }
    getMediaStream() {
      if (typeof window === "undefined") {
        return null;
      }
      return window.MediaStream || window.webkitMediaStream;
    }
    isSupported() {
      return typeof window !== "undefined" && this.hasRTCPeerConnection;
    }
    getName() {
      return "BrowserRTCAdapter";
    }
    async getUserMedia(constraints) {
      if (typeof navigator === "undefined") {
        throw new Error("getUserMedia requires a browser environment");
      }
      if (navigator.mediaDevices?.getUserMedia) {
        return await navigator.mediaDevices.getUserMedia(constraints);
      }
      const getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
      if (!getUserMedia) {
        throw new Error("getUserMedia is not supported in this browser");
      }
      return new Promise((resolve, reject) => {
        getUserMedia.call(navigator, constraints, resolve, reject);
      });
    }
    async getDisplayMedia(constraints) {
      if (typeof navigator === "undefined") {
        throw new Error("getDisplayMedia requires a browser environment");
      }
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error("getDisplayMedia is not supported in this browser");
      }
      return await navigator.mediaDevices.getDisplayMedia(constraints);
    }
  };
  var PigeonRTC = class {
    constructor(options = {}) {
      this.adapter = options.adapter || null;
      this.initialized = false;
    }
    async initialize(options = {}) {
      if (this.initialized) {
        return;
      }
      if (options.adapter) {
        this.adapter = options.adapter;
      }
      if (!this.adapter) {
        this.adapter = new BrowserRTCAdapter();
      }
      await this.adapter.initialize();
      this.initialized = true;
    }
    _ensureInitialized() {
      if (!this.initialized || !this.adapter) {
        throw new Error("PigeonRTC not initialized. Call initialize() first.");
      }
    }
    getRTCPeerConnection() {
      this._ensureInitialized();
      return this.adapter.getRTCPeerConnection();
    }
    getRTCSessionDescription() {
      this._ensureInitialized();
      return this.adapter.getRTCSessionDescription();
    }
    getRTCIceCandidate() {
      this._ensureInitialized();
      return this.adapter.getRTCIceCandidate();
    }
    getMediaStream() {
      this._ensureInitialized();
      return this.adapter.getMediaStream();
    }
    createPeerConnection(config) {
      this._ensureInitialized();
      const RTCPeerConnection2 = this.adapter.getRTCPeerConnection();
      return new RTCPeerConnection2(config);
    }
    createSessionDescription(init) {
      this._ensureInitialized();
      const RTCSessionDescription = this.adapter.getRTCSessionDescription();
      return new RTCSessionDescription(init);
    }
    createIceCandidate(init) {
      this._ensureInitialized();
      const RTCIceCandidate = this.adapter.getRTCIceCandidate();
      return new RTCIceCandidate(init);
    }
    async getUserMedia(constraints) {
      this._ensureInitialized();
      return await this.adapter.getUserMedia(constraints);
    }
    async getDisplayMedia(constraints) {
      this._ensureInitialized();
      return await this.adapter.getDisplayMedia(constraints);
    }
    isSupported() {
      return this.adapter ? this.adapter.isSupported() : false;
    }
    getAdapterName() {
      return this.adapter ? this.adapter.getName() : "None";
    }
  };
  async function createPigeonRTC(options = {}) {
    const rtc = new PigeonRTC(options);
    await rtc.initialize(options);
    return rtc;
  }

  // src/EventEmitter.js
  var EventEmitter = class {
    constructor() {
      this.eventListeners = {};
    }
    addEventListener(event, callback) {
      if (!this.eventListeners[event]) {
        this.eventListeners[event] = [];
      }
      this.eventListeners[event].push(callback);
    }
    removeEventListener(event, callback) {
      if (this.eventListeners[event]) {
        const index = this.eventListeners[event].indexOf(callback);
        if (index > -1) {
          this.eventListeners[event].splice(index, 1);
        }
      }
    }
    emit(event, data) {
      if (this.eventListeners[event]) {
        this.eventListeners[event].forEach((callback) => callback(data));
      }
    }
    // Standard Node.js EventEmitter compatible methods
    /**
     * Add event listener (alias for addEventListener)
     * @param {string} event - Event name
     * @param {Function} callback - Event handler
     * @returns {EventEmitter} Returns this for chaining
     */
    on(event, callback) {
      this.addEventListener(event, callback);
      return this;
    }
    /**
     * Remove event listener (alias for removeEventListener)
     * @param {string} event - Event name
     * @param {Function} callback - Event handler to remove
     * @returns {EventEmitter} Returns this for chaining
     */
    off(event, callback) {
      this.removeEventListener(event, callback);
      return this;
    }
    /**
     * Add one-time event listener
     * @param {string} event - Event name
     * @param {Function} callback - Event handler
     * @returns {EventEmitter} Returns this for chaining
     */
    once(event, callback) {
      const onceWrapper = (data) => {
        callback(data);
        this.removeEventListener(event, onceWrapper);
      };
      this.addEventListener(event, onceWrapper);
      return this;
    }
    /**
     * Remove all listeners for an event, or all listeners if no event specified
     * @param {string} [event] - Event name (optional)
     * @returns {EventEmitter} Returns this for chaining
     */
    removeAllListeners(event) {
      if (event) {
        delete this.eventListeners[event];
      } else {
        this.eventListeners = {};
      }
      return this;
    }
    /**
     * Get array of listeners for an event
     * @param {string} event - Event name
     * @returns {Function[]} Array of listeners
     */
    listeners(event) {
      return this.eventListeners[event] ? [...this.eventListeners[event]] : [];
    }
    /**
     * Get count of listeners for an event
     * @param {string} event - Event name
     * @returns {number} Number of listeners
     */
    listenerCount(event) {
      return this.eventListeners[event] ? this.eventListeners[event].length : 0;
    }
    /**
     * Get array of event names that have listeners
     * @returns {string[]} Array of event names
     */
    eventNames() {
      return Object.keys(this.eventListeners);
    }
  };

  // src/EnvironmentDetector.js
  var EnvironmentDetector = class _EnvironmentDetector {
    constructor() {
      this._cache = /* @__PURE__ */ new Map();
      this._pigeonRTC = null;
      this._init();
    }
    _init() {
      this._cache.set("isBrowser", this._detectBrowser());
      this._cache.set("isNodeJS", this._detectNodeJS());
      this._cache.set("isWorker", this._detectWorker());
      this._cache.set("isServiceWorker", this._detectServiceWorker());
      this._cache.set("isWebWorker", this._detectWebWorker());
      this._cache.set("isSharedWorker", this._detectSharedWorker());
      this._cache.set("isDeno", this._detectDeno());
      this._cache.set("isBun", this._detectBun());
      this._cache.set("isNativeScript", this._detectNativeScript());
      this._initPigeonRTC();
    }
    /**
     * Initialize PigeonRTC for cross-platform WebRTC support
     * PigeonRTC provides a unified WebRTC interface across browser and Node.js
     * @private
     */
    _initPigeonRTC() {
      try {
        this._webrtcPolyfilled = false;
      } catch (error) {
      }
    }
    /**
     * Get the PigeonRTC instance
     * @returns {PigeonRTC|null} The PigeonRTC instance or null if not initialized
     */
    getPigeonRTC() {
      return this._pigeonRTC;
    }
    // Primary environment detection
    _detectBrowser() {
      return typeof window !== "undefined" && typeof document !== "undefined" && typeof navigator !== "undefined";
    }
    _detectNodeJS() {
      return typeof process !== "undefined" && process.versions != null && process.versions.node != null;
    }
    _detectDeno() {
      return typeof Deno !== "undefined";
    }
    _detectBun() {
      return typeof Bun !== "undefined";
    }
    _detectNativeScript() {
      return typeof globalThis !== "undefined" && (typeof globalThis.NativeScriptGlobals !== "undefined" || typeof globalThis.__ANDROID__ !== "undefined" || typeof globalThis.__IOS__ !== "undefined" || typeof globalThis.__VISIONOS__ !== "undefined" || typeof globalThis.loadModule === "function" && typeof globalThis.registerModule === "function");
    }
    _detectWorker() {
      return typeof importScripts !== "undefined" || this._detectServiceWorker() || this._detectWebWorker() || this._detectSharedWorker();
    }
    _detectServiceWorker() {
      return typeof globalThis.ServiceWorkerGlobalScope !== "undefined" && typeof self !== "undefined" && self instanceof globalThis.ServiceWorkerGlobalScope;
    }
    _detectWebWorker() {
      return typeof globalThis.DedicatedWorkerGlobalScope !== "undefined" && typeof self !== "undefined" && self instanceof globalThis.DedicatedWorkerGlobalScope;
    }
    _detectSharedWorker() {
      return typeof globalThis.SharedWorkerGlobalScope !== "undefined" && typeof self !== "undefined" && self instanceof globalThis.SharedWorkerGlobalScope;
    }
    // Public getters
    get isBrowser() {
      return this._cache.get("isBrowser");
    }
    get isNodeJS() {
      return this._cache.get("isNodeJS");
    }
    get isWorker() {
      return this._cache.get("isWorker");
    }
    get isServiceWorker() {
      return this._cache.get("isServiceWorker");
    }
    get isWebWorker() {
      return this._cache.get("isWebWorker");
    }
    get isSharedWorker() {
      return this._cache.get("isSharedWorker");
    }
    get isDeno() {
      return this._cache.get("isDeno");
    }
    get isBun() {
      return this._cache.get("isBun");
    }
    get isNativeScript() {
      return this._cache.get("isNativeScript");
    }
    get isServer() {
      return this.isNodeJS || this.isDeno || this.isBun;
    }
    get isClient() {
      return this.isBrowser || this.isWorker || this.isNativeScript;
    }
    // WebRTC capability detection
    get hasWebRTC() {
      if (this._pigeonRTC) {
        return this._pigeonRTC.isSupported();
      }
      if (this.isBrowser) {
        return typeof RTCPeerConnection !== "undefined" || typeof webkitRTCPeerConnection !== "undefined" || typeof mozRTCPeerConnection !== "undefined";
      }
      if (this.isNodeJS) {
        return typeof globalThis !== "undefined" && typeof globalThis.RTCPeerConnection !== "undefined" || typeof RTCPeerConnection !== "undefined" || this._webrtcPolyfilled === true;
      }
      if (this.isNativeScript) {
        return typeof globalThis !== "undefined" && typeof globalThis.RTCPeerConnection !== "undefined" || typeof RTCPeerConnection !== "undefined";
      }
      return false;
    }
    get hasDataChannel() {
      return this.hasWebRTC && (this.isBrowser || this.isNativeScript);
    }
    get hasGetUserMedia() {
      if (!this.isBrowser && !this.isNativeScript) return false;
      return !!(navigator && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) || !!(navigator && (navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia));
    }
    // WebSocket capability detection
    get hasWebSocket() {
      if (this.isBrowser || this.isWorker) {
        return typeof WebSocket !== "undefined";
      }
      if (this.isNodeJS) {
        if (typeof globalThis !== "undefined" && typeof globalThis.WebSocket !== "undefined") {
          return true;
        }
        if (typeof WebSocket !== "undefined") {
          return true;
        }
        try {
          if (typeof __require !== "undefined") {
            __require.resolve("ws");
            return true;
          } else {
            return false;
          }
        } catch (e) {
          return false;
        }
      }
      if (this.isNativeScript) {
        return typeof WebSocket !== "undefined" || typeof globalThis !== "undefined" && typeof globalThis.WebSocket !== "undefined";
      }
      return false;
    }
    // Storage capability detection
    get hasLocalStorage() {
      if (!this.isBrowser && !this.isNativeScript) return false;
      try {
        const test = "__storage_test__";
        localStorage.setItem(test, test);
        localStorage.removeItem(test);
        return true;
      } catch (e) {
        return false;
      }
    }
    get hasSessionStorage() {
      if (!this.isBrowser && !this.isNativeScript) return false;
      try {
        const test = "__storage_test__";
        sessionStorage.setItem(test, test);
        sessionStorage.removeItem(test);
        return true;
      } catch (e) {
        return false;
      }
    }
    get hasIndexedDB() {
      if (!this.isBrowser) return false;
      return typeof indexedDB !== "undefined";
    }
    get hasCookies() {
      if (!this.isBrowser) return false;
      return typeof document !== "undefined" && typeof document.cookie === "string";
    }
    // Network and connectivity detection
    get hasNetworkInformation() {
      if (!this.isBrowser) return false;
      return typeof navigator !== "undefined" && "connection" in navigator;
    }
    get isOnline() {
      if (this.isBrowser) {
        return typeof navigator !== "undefined" ? navigator.onLine : true;
      }
      return true;
    }
    get networkType() {
      if (this.hasNetworkInformation) {
        return navigator.connection.effectiveType || "unknown";
      }
      return "unknown";
    }
    // Crypto capabilities
    get hasCrypto() {
      if (this.isBrowser || this.isWorker) {
        return typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined";
      }
      if (this.isNodeJS) {
        try {
          if (typeof __require !== "undefined") {
            __require("crypto");
            return true;
          } else {
            return typeof process !== "undefined" && process.versions.node;
          }
        } catch (e) {
          return false;
        }
      }
      if (this.isNativeScript) {
        return typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined" || typeof globalThis !== "undefined" && typeof globalThis.crypto !== "undefined";
      }
      return false;
    }
    get hasRandomValues() {
      if (this.isBrowser || this.isWorker) {
        return typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function";
      }
      if (this.isNodeJS) {
        try {
          if (typeof __require !== "undefined") {
            const crypto3 = __require("crypto");
            return typeof crypto3.randomBytes === "function";
          } else {
            return typeof process !== "undefined" && process.versions.node;
          }
        } catch (e) {
          return false;
        }
      }
      if (this.isNativeScript) {
        return typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function" || typeof globalThis !== "undefined" && typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.getRandomValues === "function";
      }
      return false;
    }
    // Performance and timing
    get hasPerformanceNow() {
      return typeof performance !== "undefined" && typeof performance.now === "function";
    }
    get hasHighResolutionTime() {
      if (this.isNodeJS) {
        return typeof process.hrtime === "function" || typeof process.hrtime.bigint === "function";
      }
      return this.hasPerformanceNow;
    }
    // Browser-specific detection
    getBrowserInfo() {
      if (!this.isBrowser) return null;
      const userAgent = navigator.userAgent;
      const browsers = {
        chrome: /Chrome\/(\d+)/.exec(userAgent),
        firefox: /Firefox\/(\d+)/.exec(userAgent),
        safari: /Safari\/(\d+)/.exec(userAgent) && !/Chrome/.test(userAgent),
        edge: /Edge\/(\d+)/.exec(userAgent),
        ie: /MSIE (\d+)/.exec(userAgent) || /Trident.*rv:(\d+)/.exec(userAgent)
      };
      for (const [browser, match] of Object.entries(browsers)) {
        if (match) {
          return {
            name: browser,
            version: match[1] || "unknown"
          };
        }
      }
      return { name: "unknown", version: "unknown" };
    }
    // Node.js-specific detection
    getNodeInfo() {
      if (!this.isNodeJS) return null;
      return {
        version: process.version,
        platform: process.platform,
        arch: process.arch,
        versions: process.versions
      };
    }
    // NativeScript-specific detection
    getNativeScriptInfo() {
      if (!this.isNativeScript) return null;
      const info = {
        runtime: "nativescript"
      };
      if (typeof globalThis !== "undefined") {
        if (globalThis.__ANDROID__) {
          info.platform = "android";
        } else if (globalThis.__IOS__) {
          info.platform = "ios";
        } else if (globalThis.__VISIONOS__) {
          info.platform = "visionos";
        }
        if (globalThis.NativeScriptGlobals) {
          info.launched = globalThis.NativeScriptGlobals.launched;
          info.appInstanceReady = globalThis.NativeScriptGlobals.appInstanceReady;
        }
      }
      return info;
    }
    // Device and platform detection
    getPlatformInfo() {
      if (this.isBrowser) {
        return {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          language: navigator.language,
          languages: navigator.languages || [navigator.language],
          cookieEnabled: navigator.cookieEnabled,
          onLine: navigator.onLine,
          hardwareConcurrency: navigator.hardwareConcurrency || 1
        };
      }
      if (this.isNodeJS) {
        return this.getNodeInfo();
      }
      if (this.isNativeScript) {
        return this.getNativeScriptInfo();
      }
      return null;
    }
    // Feature detection for specific APIs
    hasFeature(feature) {
      const features = {
        // WebRTC
        webrtc: () => this.hasWebRTC,
        datachannel: () => this.hasDataChannel,
        getusermedia: () => this.hasGetUserMedia,
        // WebSocket
        websocket: () => this.hasWebSocket,
        // Storage
        localstorage: () => this.hasLocalStorage,
        sessionstorage: () => this.hasSessionStorage,
        indexeddb: () => this.hasIndexedDB,
        cookies: () => this.hasCookies,
        // Crypto
        crypto: () => this.hasCrypto,
        randomvalues: () => this.hasRandomValues,
        // Performance
        performance: () => this.hasPerformanceNow,
        hrtime: () => this.hasHighResolutionTime,
        // Network
        networkinfo: () => this.hasNetworkInformation,
        online: () => this.isOnline,
        // Workers
        webworker: () => typeof Worker !== "undefined",
        serviceworker: () => typeof navigator !== "undefined" && "serviceWorker" in navigator,
        sharedworker: () => typeof SharedWorker !== "undefined"
      };
      const featureCheck = features[feature.toLowerCase()];
      return featureCheck ? featureCheck() : false;
    }
    // Get comprehensive environment report
    getEnvironmentReport() {
      return {
        runtime: {
          isBrowser: this.isBrowser,
          isNodeJS: this.isNodeJS,
          isWorker: this.isWorker,
          isServiceWorker: this.isServiceWorker,
          isWebWorker: this.isWebWorker,
          isSharedWorker: this.isSharedWorker,
          isDeno: this.isDeno,
          isBun: this.isBun,
          isNativeScript: this.isNativeScript,
          isServer: this.isServer,
          isClient: this.isClient
        },
        capabilities: {
          webrtc: this.hasWebRTC,
          dataChannel: this.hasDataChannel,
          getUserMedia: this.hasGetUserMedia,
          webSocket: this.hasWebSocket,
          localStorage: this.hasLocalStorage,
          sessionStorage: this.hasSessionStorage,
          indexedDB: this.hasIndexedDB,
          cookies: this.hasCookies,
          crypto: this.hasCrypto,
          randomValues: this.hasRandomValues,
          performance: this.hasPerformanceNow,
          networkInfo: this.hasNetworkInformation
        },
        platform: this.getPlatformInfo(),
        browser: this.getBrowserInfo(),
        node: this.getNodeInfo(),
        nativescript: this.getNativeScriptInfo(),
        network: {
          online: this.isOnline,
          type: this.networkType
        }
      };
    }
    /**
     * Asynchronously initialize WebRTC using PigeonRTC
     * This method initializes PigeonRTC for cross-platform WebRTC support
     * @returns {Promise<boolean>} True if WebRTC was successfully initialized
     */
    async initWebRTCAsync() {
      try {
        if (this._pigeonRTC) {
          return true;
        }
        let createPigeonRTC2;
        if (typeof globalThis !== "undefined" && globalThis.__PEERPIGEON_PIGEONRTC__) {
          createPigeonRTC2 = globalThis.__PEERPIGEON_PIGEONRTC__.createPigeonRTC || globalThis.__PEERPIGEON_PIGEONRTC__.default;
        } else if (typeof window !== "undefined" && window.__PEERPIGEON_PIGEONRTC__) {
          createPigeonRTC2 = window.__PEERPIGEON_PIGEONRTC__.createPigeonRTC || window.__PEERPIGEON_PIGEONRTC__.default;
        }
        if (!createPigeonRTC2 && this.isNodeJS) {
          try {
            const pigeonRTCModule = await import("pigeonrtc");
            createPigeonRTC2 = pigeonRTCModule.createPigeonRTC || pigeonRTCModule.default;
          } catch (error) {
            console.error("Failed to dynamically import PigeonRTC:", error);
          }
        }
        if (!createPigeonRTC2) {
          throw new Error("PigeonRTC createPigeonRTC function not found");
        }
        this._pigeonRTC = await createPigeonRTC2();
        this._webrtcPolyfilled = true;
        return this._pigeonRTC.isSupported();
      } catch (error) {
        console.error("Failed to initialize PigeonRTC:", error);
        return false;
      }
    }
    // Static method for quick environment check
    static detect() {
      return new _EnvironmentDetector();
    }
    // Static method for single feature check
    static hasFeature(feature) {
      const detector = new _EnvironmentDetector();
      return detector.hasFeature(feature);
    }
  };
  var environmentDetector = new EnvironmentDetector();
  var isBrowser2 = () => environmentDetector.isBrowser;
  var isNodeJS = () => environmentDetector.isNodeJS;
  var isWorker = () => environmentDetector.isWorker;
  var hasWebRTC = () => environmentDetector.hasWebRTC;
  var hasWebSocket = () => environmentDetector.hasWebSocket;
  var getEnvironmentReport = () => environmentDetector.getEnvironmentReport();
  var initWebRTCAsync = () => environmentDetector.initWebRTCAsync();

  // src/DebugLogger.js
  var DebugLogger = class {
    // Default is disabled
    /**
     * Create a debug logger for a specific module
     * @param {string} moduleName - Name of the module (e.g., 'GossipManager', 'PeerConnection')
     * @returns {Object} Debug logger with log/warn/error methods
     */
    static create(moduleName) {
      if (!this.moduleStates.has(moduleName)) {
        this.moduleStates.set(moduleName, this.defaultEnabled);
      }
      return {
        /**
         * Debug log - for general debugging information
         * @param {...any} args - Arguments to log
         */
        log: (...args) => {
          if (this.isEnabled(moduleName)) {
            console.log(`[${moduleName}]`, ...args);
          }
        },
        /**
         * Debug warn - for warnings
         * @param {...any} args - Arguments to log
         */
        warn: (...args) => {
          if (this.isEnabled(moduleName)) {
            console.warn(`[${moduleName}]`, ...args);
          }
        },
        /**
         * Debug error - for errors
         * @param {...any} args - Arguments to log
         */
        error: (...args) => {
          if (this.isEnabled(moduleName)) {
            console.error(`[${moduleName}]`, ...args);
          }
        },
        /**
         * Debug info - alias for log
         * @param {...any} args - Arguments to log
         */
        info: (...args) => {
          if (this.isEnabled(moduleName)) {
            console.info(`[${moduleName}]`, ...args);
          }
        },
        /**
         * Debug debug - alias for log
         * @param {...any} args - Arguments to log
         */
        debug: (...args) => {
          if (this.isEnabled(moduleName)) {
            console.debug(`[${moduleName}]`, ...args);
          }
        }
      };
    }
    /**
     * Check if debugging is enabled for a module
     * @param {string} moduleName - Module name to check
     * @returns {boolean} True if enabled
     */
    static isEnabled(moduleName) {
      if (this.globalEnabled) return true;
      return this.moduleStates.get(moduleName) || false;
    }
    /**
     * Enable debugging for a specific module
     * @param {string} moduleName - Module name to enable
     */
    static enable(moduleName) {
      this.moduleStates.set(moduleName, true);
    }
    /**
     * Disable debugging for a specific module
     * @param {string} moduleName - Module name to disable
     */
    static disable(moduleName) {
      this.moduleStates.set(moduleName, false);
    }
    /**
     * Enable debugging for all modules
     */
    static enableAll() {
      this.globalEnabled = true;
    }
    /**
     * Disable debugging for all modules
     */
    static disableAll() {
      this.globalEnabled = false;
      for (const [moduleName] of this.moduleStates) {
        this.moduleStates.set(moduleName, false);
      }
    }
    /**
     * Enable debugging for multiple modules
     * @param {string[]} moduleNames - Array of module names to enable
     */
    static enableModules(moduleNames) {
      for (const moduleName of moduleNames) {
        this.enable(moduleName);
      }
    }
    /**
     * Disable debugging for multiple modules
     * @param {string[]} moduleNames - Array of module names to disable
     */
    static disableModules(moduleNames) {
      for (const moduleName of moduleNames) {
        this.disable(moduleName);
      }
    }
    /**
     * Get the current state of all modules
     * @returns {Object} Object with module names as keys and enabled state as values
     */
    static getState() {
      const state = {};
      for (const [moduleName, enabled] of this.moduleStates) {
        state[moduleName] = enabled;
      }
      return {
        globalEnabled: this.globalEnabled,
        modules: state
      };
    }
    /**
     * Configure debugging from an options object
     * @param {Object} options - Configuration options
     * @param {boolean} [options.enableAll] - Enable all modules
     * @param {boolean} [options.disableAll] - Disable all modules
     * @param {string[]} [options.enable] - Array of module names to enable
     * @param {string[]} [options.disable] - Array of module names to disable
     */
    static configure(options = {}) {
      if (options.disableAll) {
        this.disableAll();
      }
      if (options.enableAll) {
        this.enableAll();
      }
      if (options.enable && Array.isArray(options.enable)) {
        this.enableModules(options.enable);
      }
      if (options.disable && Array.isArray(options.disable)) {
        this.disableModules(options.disable);
      }
    }
    /**
     * Get list of all known modules
     * @returns {string[]} Array of module names
     */
    static getModules() {
      return Array.from(this.moduleStates.keys()).sort();
    }
  };
  __publicField(DebugLogger, "moduleStates", /* @__PURE__ */ new Map());
  __publicField(DebugLogger, "globalEnabled", false);
  __publicField(DebugLogger, "defaultEnabled", false);
  var DebugLogger_default = DebugLogger;

  // src/SignalingClient.js
  var SignalingClient = class extends EventEmitter {
    constructor(peerId, maxPeers = 10, mesh = null) {
      super();
      this.debug = DebugLogger_default.create("SignalingClient");
      this.peerId = peerId;
      this.maxPeers = maxPeers;
      this.mesh = mesh;
      this.signalingUrl = null;
      this.connected = false;
      this.websocket = null;
      this.reconnectDelay = 1e3;
      this.maxReconnectDelay = 3e4;
      this.reconnectAttempts = 0;
      this.maxReconnectAttempts = 10;
      this.connectionPromise = null;
      this.reconnectTimeout = null;
      this.isReconnecting = false;
      this.deliberateDisconnect = false;
    }
    setConnectionType(type) {
      this.debug.log(`WebSocket-only implementation - connection type setting ignored: ${type}`);
    }
    createWebSocket(url) {
      if (environmentDetector.isNodeJS) {
        if (typeof globalThis !== "undefined" && typeof globalThis.WebSocket !== "undefined") {
          return new globalThis.WebSocket(url);
        }
        if (typeof WebSocket !== "undefined") {
          return new WebSocket(url);
        }
        try {
          if (typeof __require !== "undefined") {
            const WebSocket2 = require_browser();
            return new WebSocket2(url);
          } else {
            this.debug.warn('WebSocket package detection not available in ES modules. Ensure "ws" is installed.');
            throw new Error('WebSocket not available in Node.js ES modules. Install the "ws" package and import it manually.');
          }
        } catch (error) {
          this.debug.warn("ws package not found in Node.js environment. Install with: npm install ws");
          throw new Error('WebSocket not available in Node.js. Install the "ws" package.');
        }
      } else if (environmentDetector.isBrowser || environmentDetector.isWorker || environmentDetector.isNativeScript) {
        return new WebSocket(url);
      } else {
        throw new Error("WebSocket not supported in this environment");
      }
    }
    async sendSignalingMessage(message) {
      if (!this.isConnected()) {
        this.debug.log("WebSocket not connected, attempting to reconnect...");
        if (!this.isReconnecting) {
          this.attemptReconnect();
        }
        throw new Error("WebSocket not connected");
      }
      const payload = {
        type: message.type,
        data: message.data,
        maxPeers: this.maxPeers,
        networkName: this.mesh ? this.mesh.networkName : "global",
        // Include network namespace
        ...message.targetPeerId && { targetPeerId: message.targetPeerId }
      };
      try {
        this.websocket.send(JSON.stringify(payload));
        this.debug.log(`Sent WebSocket message: ${payload.type} (network: ${payload.networkName})`);
        return { success: true };
      } catch (error) {
        this.debug.error("Failed to send WebSocket message:", error);
        if (!this.isReconnecting) {
          this.attemptReconnect();
        }
        throw error;
      }
    }
    isConnected() {
      return this.websocket && this.websocket.readyState === WebSocket.OPEN && this.connected;
    }
    async connect(websocketUrl) {
      if (!environmentDetector.hasWebSocket) {
        const error = new Error("WebSocket not supported in this environment");
        this.emit("statusChanged", { type: "error", message: error.message });
        throw error;
      }
      if (this.connectionPromise) {
        this.debug.log("Connection already in progress, waiting for completion...");
        return this.connectionPromise;
      }
      if (websocketUrl.startsWith("http://")) {
        websocketUrl = websocketUrl.replace("http://", "ws://");
      } else if (websocketUrl.startsWith("https://")) {
        websocketUrl = websocketUrl.replace("https://", "wss://");
      }
      if (!websocketUrl.startsWith("ws://") && !websocketUrl.startsWith("wss://")) {
        throw new Error("Invalid WebSocket URL format");
      }
      this.signalingUrl = websocketUrl;
      const url = new URL(websocketUrl);
      url.searchParams.set("peerId", this.peerId);
      this.emit("statusChanged", { type: "connecting", message: "Connecting to WebSocket..." });
      this.connectionPromise = new Promise((resolve, reject) => {
        try {
          this.websocket = this.createWebSocket(url.toString());
          const connectTimeout = setTimeout(() => {
            if (this.websocket.readyState === WebSocket.CONNECTING) {
              this.websocket.close();
              reject(new Error("WebSocket connection timeout"));
            }
          }, 1e4);
          this.websocket.onopen = () => {
            clearTimeout(connectTimeout);
            this.connected = true;
            this.reconnectAttempts = 0;
            this.reconnectDelay = 1e3;
            this.isReconnecting = false;
            this.connectionPromise = null;
            this.debug.log("WebSocket connected");
            this.emit("statusChanged", { type: "info", message: "WebSocket connected" });
            this.sendSignalingMessage({
              type: "announce",
              data: { peerId: this.peerId }
            }).then(() => {
              this.emit("connected");
              resolve();
            }).catch((error) => {
              this.debug.error("Failed to send announce message:", error);
              this.emit("connected");
              resolve();
            });
          };
          this.websocket.onmessage = (event) => {
            try {
              const message = JSON.parse(event.data);
              this.debug.log(`Received WebSocket message: ${message.type} (network: ${message.networkName || "unknown"})`);
              if (message.type === "connected") {
                this.debug.log("WebSocket connection confirmed by server");
              } else {
                const currentNetwork = this.mesh ? this.mesh.networkName : "global";
                const messageNetwork = message.networkName || "global";
                if (messageNetwork === currentNetwork) {
                  this.emit("signalingMessage", message);
                } else {
                  this.debug.log(`Filtered message from different network: ${messageNetwork} (current: ${currentNetwork})`);
                }
              }
            } catch (error) {
              this.debug.error("Failed to parse WebSocket message:", error);
            }
          };
          this.websocket.onclose = (event) => {
            clearTimeout(connectTimeout);
            const wasConnected = this.connected;
            this.connected = false;
            this.connectionPromise = null;
            this.isReconnecting = false;
            this.debug.log("WebSocket closed:", event.code, event.reason);
            if (wasConnected) {
              this.emit("disconnected");
            }
            if (!this.deliberateDisconnect) {
              this.attemptReconnect();
            } else {
              this.deliberateDisconnect = false;
            }
          };
          this.websocket.onerror = (error) => {
            clearTimeout(connectTimeout);
            this.debug.error("WebSocket error:", error);
            if (this.websocket.readyState === WebSocket.CONNECTING) {
              this.connectionPromise = null;
              reject(new Error("WebSocket connection failed"));
            } else {
              this.emit("statusChanged", { type: "error", message: "WebSocket error occurred" });
              if (!this.isReconnecting) {
                this.attemptReconnect();
              }
            }
          };
        } catch (error) {
          this.connectionPromise = null;
          reject(error);
        }
      });
      return this.connectionPromise;
    }
    attemptReconnect() {
      if (this.isReconnecting) {
        this.debug.log("Reconnection already in progress");
        return;
      }
      const hasHealthyPeers = this.mesh && this.mesh.connectionManager && this.mesh.connectionManager.getConnectedPeerCount() > 0;
      if (hasHealthyPeers) {
        this.debug.log("Have healthy peer connections, reducing reconnection urgency");
      }
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        this.debug.log("Max reconnection attempts reached, using exponential backoff");
        const baseExtendedDelay = hasHealthyPeers ? 6e5 : this.maxReconnectDelay * 2;
        const extendedDelay = Math.min(baseExtendedDelay, 6e5);
        this.emit("statusChanged", {
          type: "reconnecting",
          message: `Max attempts reached. Retrying in ${Math.round(extendedDelay / 1e3)}s...`,
          delay: extendedDelay,
          attempt: this.reconnectAttempts,
          maxAttempts: this.maxReconnectAttempts,
          extendedBackoff: true
        });
        this.reconnectTimeout = setTimeout(() => {
          this.reconnectAttempts = Math.floor(this.maxReconnectAttempts / 2);
          this.attemptReconnect();
        }, extendedDelay);
        return;
      }
      this.isReconnecting = true;
      this.reconnectAttempts++;
      const baseDelay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
      const delayMultiplier = hasHealthyPeers ? 3 : 1;
      const delay = Math.min(baseDelay * delayMultiplier, hasHealthyPeers ? 3e5 : this.maxReconnectDelay);
      this.debug.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}, healthy peers: ${hasHealthyPeers})`);
      this.emit("statusChanged", {
        type: "reconnecting",
        message: `Reconnecting in ${Math.round(delay / 1e3)}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`,
        delay,
        attempt: this.reconnectAttempts,
        maxAttempts: this.maxReconnectAttempts
      });
      this.reconnectTimeout = setTimeout(async () => {
        if (!this.connected && this.signalingUrl) {
          try {
            await this.connect(this.signalingUrl);
            this.emit("statusChanged", { type: "info", message: "WebSocket reconnected successfully" });
          } catch (error) {
            this.debug.error("Reconnection attempt failed:", error);
          }
        }
      }, delay);
    }
    disconnect() {
      this.deliberateDisconnect = true;
      this.isReconnecting = false;
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }
      this.connected = false;
      this.connectionPromise = null;
      if (this.websocket) {
        this.websocket.onopen = null;
        this.websocket.onmessage = null;
        this.websocket.onclose = null;
        this.websocket.onerror = null;
        this.websocket.close(1e3, "Client disconnect");
        this.websocket = null;
      }
      this.emit("disconnected");
    }
    sendGoodbyeMessage() {
      if (!this.connected) return;
      try {
        this.debug.log("Sending goodbye message");
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
          this.websocket.send(JSON.stringify({
            type: "goodbye",
            data: {
              peerId: this.peerId,
              timestamp: Date.now(),
              reason: "peer_disconnect"
            }
          }));
        }
      } catch (error) {
        this.debug.error("Failed to send goodbye message:", error);
      }
    }
    async sendCleanupMessage(targetPeerId) {
      if (!this.connected) return;
      try {
        await this.sendSignalingMessage({
          type: "cleanup",
          data: {
            peerId: this.peerId,
            targetPeerId,
            timestamp: Date.now(),
            reason: "peer_disconnect"
          },
          targetPeerId
        });
      } catch (error) {
        this.debug.log(`Cleanup message failed for ${targetPeerId}:`, error.message);
      }
    }
    getConnectionStats() {
      return {
        connected: this.connected,
        isReconnecting: this.isReconnecting,
        reconnectAttempts: this.reconnectAttempts,
        websocketState: this.websocket ? this.websocket.readyState : "not created"
      };
    }
  };

  // src/PeerDiscovery.js
  var PeerDiscovery = class extends EventEmitter {
    constructor(peerId, options = {}) {
      super();
      this.debug = DebugLogger_default.create("PeerDiscovery");
      this.peerId = peerId;
      this.discoveredPeers = /* @__PURE__ */ new Map();
      this.connectionAttempts = /* @__PURE__ */ new Map();
      this.cleanupInterval = null;
      this.meshOptimizationTimeout = null;
      this.autoDiscovery = options.autoDiscovery ?? true;
      this.evictionStrategy = options.evictionStrategy ?? true;
      this.xorRouting = options.xorRouting ?? true;
      this.minPeers = options.minPeers ?? 0;
      this.maxPeers = options.maxPeers ?? 10;
    }
    start() {
      this.startCleanupInterval();
    }
    stop() {
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = null;
      }
      if (this.meshOptimizationTimeout) {
        clearTimeout(this.meshOptimizationTimeout);
        this.meshOptimizationTimeout = null;
      }
    }
    // Full cleanup method for deliberate disconnects
    cleanup() {
      this.stop();
      this.discoveredPeers.clear();
      this.connectionAttempts.clear();
    }
    addDiscoveredPeer(peerId) {
      if (this.discoveredPeers.has(peerId)) {
        this.discoveredPeers.set(peerId, Date.now());
        return;
      }
      this.discoveredPeers.set(peerId, Date.now());
      this.emit("peerDiscovered", { peerId });
      this.debug.log(`Discovered peer ${peerId.substring(0, 8)}...`);
      const shouldInitiate = this.shouldInitiateConnection(peerId);
      const alreadyAttempting = this.connectionAttempts.has(peerId);
      this.debug.log(`\u{1F50D} Connection decision for ${peerId.substring(0, 8)}...: autoDiscovery=${this.autoDiscovery}, shouldInitiate=${shouldInitiate}, alreadyAttempting=${alreadyAttempting}`);
      if (this.autoDiscovery && shouldInitiate && !alreadyAttempting) {
        this.debug.log(`Considering connection to ${peerId.substring(0, 8)}...`);
        const canAccept = this.canAcceptMorePeers();
        this.debug.log(`Can accept more peers: ${canAccept}`);
        if (canAccept) {
          this.debug.log(`\u{1F680} Connecting to ${peerId.substring(0, 8)}...`);
          this.emit("connectToPeer", { peerId });
        } else {
          this.debug.log(`\u274C Cannot accept more peers (at capacity)`);
        }
      } else {
        if (!this.autoDiscovery) {
          this.debug.log(`\u274C Auto-discovery disabled, not connecting to ${peerId.substring(0, 8)}...`);
        } else if (!shouldInitiate) {
          this.debug.log(`\u23F8\uFE0F  Not initiating to ${peerId.substring(0, 8)}... (they should initiate to us)`);
        } else if (alreadyAttempting) {
          this.debug.log(`\u23F8\uFE0F  Already attempting connection to ${peerId.substring(0, 8)}...`);
        }
      }
      this.scheduleMeshOptimization();
    }
    // Update connection attempts tracking (no complex isolation logic needed)
    onConnectionEstablished() {
      this.debug.log("Connection established");
    }
    removeDiscoveredPeer(peerId) {
      this.discoveredPeers.delete(peerId);
      this.connectionAttempts.delete(peerId);
    }
    trackConnectionAttempt(peerId) {
      this.connectionAttempts.set(peerId, Date.now());
    }
    clearConnectionAttempt(peerId) {
      this.connectionAttempts.delete(peerId);
    }
    calculateXorDistance(peerId1, peerId2) {
      let distance = 0n;
      for (let i = 0; i < Math.min(peerId1.length, peerId2.length); i += 2) {
        const byte1 = parseInt(peerId1.substr(i, 2), 16);
        const byte2 = parseInt(peerId2.substr(i, 2), 16);
        const xor = byte1 ^ byte2;
        distance = distance << 8n | BigInt(xor);
      }
      return distance;
    }
    shouldInitiateConnection(targetPeerId) {
      if (this.connectionAttempts.has(targetPeerId)) {
        return false;
      }
      this.emit("checkCapacity");
      const currentConnectionCount = this._currentConnectionCount || 0;
      const lexicographicShouldInitiate = this.peerId > targetPeerId;
      if (currentConnectionCount === 0 && this.discoveredPeers.size > 0) {
        const discoveredPeers = Array.from(this.discoveredPeers.keys());
        const naturalInitiators = discoveredPeers.filter((peerId) => this.peerId > peerId);
        if (naturalInitiators.length > 0 && naturalInitiators.includes(targetPeerId)) {
          this.debug.log(`shouldInitiateConnection: Isolation override (natural) - ${this.peerId.substring(0, 8)}... will initiate to ${targetPeerId.substring(0, 8)}...`);
          return true;
        }
        if (naturalInitiators.length === 0) {
          const sortedByDistance = discoveredPeers.sort((a, b) => {
            const distA = this.calculateXorDistance(this.peerId, a);
            const distB = this.calculateXorDistance(this.peerId, b);
            return distA < distB ? -1 : 1;
          });
          const closestPeers = sortedByDistance.slice(0, Math.min(3, sortedByDistance.length));
          if (closestPeers.includes(targetPeerId)) {
            const index = closestPeers.indexOf(targetPeerId);
            this.debug.log(`shouldInitiateConnection: Isolation override (closest ${index + 1}) - ${this.peerId.substring(0, 8)}... will initiate to ${targetPeerId.substring(0, 8)}...`);
            return true;
          }
        }
        const attemptedConnections = this.connectionAttempts.size;
        if (attemptedConnections >= 2 && discoveredPeers.includes(targetPeerId)) {
          this.debug.log(`shouldInitiateConnection: Isolation override (desperate) - ${this.peerId.substring(0, 8)}... will initiate to ${targetPeerId.substring(0, 8)}... (${attemptedConnections} attempts failed)`);
          return true;
        }
      }
      this.debug.log(`shouldInitiateConnection: ${this.peerId.substring(0, 8)}... > ${targetPeerId.substring(0, 8)}... = ${lexicographicShouldInitiate}`);
      return lexicographicShouldInitiate;
    }
    isAttemptingConnection(peerId) {
      return this.connectionAttempts.has(peerId);
    }
    shouldEvictForPeer(newPeerId) {
      if (!this.evictionStrategy || !this.xorRouting) {
        return null;
      }
      this.emit("checkEviction", { newPeerId });
      return this._shouldEvictForPeer ?? null;
    }
    canAcceptMorePeers() {
      this.emit("checkCapacity");
      return this._canAcceptMorePeers ?? true;
    }
    optimizeMeshConnections(currentPeers) {
      if (!this.autoDiscovery) return;
      this.debug.log("Optimizing mesh connections...");
      const unconnectedPeers = Array.from(this.discoveredPeers.keys()).filter((peerId) => {
        const notConnected = !currentPeers.has(peerId);
        const notConnecting = !this.connectionAttempts.has(peerId);
        const shouldInitiate = this.shouldInitiateConnection(peerId);
        return notConnected && notConnecting && shouldInitiate;
      });
      if (unconnectedPeers.length === 0) {
        this.debug.log("No unconnected peers to optimize");
        return;
      }
      if (this.xorRouting) {
        unconnectedPeers.sort((a, b) => {
          const distA = this.calculateXorDistance(this.peerId, a);
          const distB = this.calculateXorDistance(this.peerId, b);
          return distA < distB ? -1 : 1;
        });
      }
      this.emit("optimizeConnections", { unconnectedPeers });
    }
    scheduleMeshOptimization() {
      if (this.meshOptimizationTimeout) {
        clearTimeout(this.meshOptimizationTimeout);
      }
      const delay = 1e4 + Math.random() * 5e3;
      this.meshOptimizationTimeout = setTimeout(() => {
        this.emit("optimizeMesh");
      }, delay);
    }
    startCleanupInterval() {
      if (environmentDetector.isBrowser) {
        this.cleanupInterval = window.setInterval(() => {
          this.cleanupStaleDiscoveredPeers();
        }, 3e4);
      } else {
        this.cleanupInterval = setInterval(() => {
          this.cleanupStaleDiscoveredPeers();
        }, 3e4);
      }
    }
    cleanupStaleDiscoveredPeers() {
      const now = Date.now();
      const staleThreshold = 5 * 60 * 1e3;
      let removedCount = 0;
      this.discoveredPeers.forEach((timestamp, peerId) => {
        if (now - timestamp > staleThreshold) {
          this.discoveredPeers.delete(peerId);
          this.connectionAttempts.delete(peerId);
          removedCount++;
          this.debug.log("Removed stale peer:", peerId.substring(0, 8));
        }
      });
      if (removedCount > 0) {
        this.emit("peersUpdated", { removedCount });
      }
    }
    getDiscoveredPeers() {
      return Array.from(this.discoveredPeers.entries()).map(([peerId, timestamp]) => ({
        peerId,
        timestamp,
        distance: this.calculateXorDistance(this.peerId, peerId),
        isConnecting: this.connectionAttempts.has(peerId),
        isConnected: false
        // Will be set by the mesh when it has peer info
      }));
    }
    hasPeer(peerId) {
      return this.discoveredPeers.has(peerId);
    }
    setSettings(settings) {
      if (settings.autoDiscovery !== void 0) {
        this.autoDiscovery = settings.autoDiscovery;
      }
      if (settings.evictionStrategy !== void 0) {
        this.evictionStrategy = settings.evictionStrategy;
      }
      if (settings.xorRouting !== void 0) {
        this.xorRouting = settings.xorRouting;
      }
      if (settings.minPeers !== void 0) {
        this.minPeers = settings.minPeers;
      }
      if (settings.maxPeers !== void 0) {
        this.maxPeers = settings.maxPeers;
      }
    }
    updateDiscoveryTimestamp(peerId) {
      if (this.discoveredPeers.has(peerId)) {
        this.discoveredPeers.set(peerId, Date.now());
      }
    }
    debugCurrentState() {
      const discoveredPeerIds = Array.from(this.discoveredPeers.keys()).map((p) => p.substring(0, 8));
      const connectionAttempts = Array.from(this.connectionAttempts.keys()).map((p) => p.substring(0, 8));
      this.debug.log("=== PEER DISCOVERY DEBUG ===");
      this.debug.log(`Our peer ID: ${this.peerId.substring(0, 8)}...`);
      this.debug.log(`Discovered peers (${discoveredPeerIds.length}): ${discoveredPeerIds.join(", ")}`);
      this.debug.log(`Connection attempts (${connectionAttempts.length}): ${connectionAttempts.join(", ")}`);
      discoveredPeerIds.forEach((peerId) => {
        const fullPeerId = Array.from(this.discoveredPeers.keys()).find((p) => p.startsWith(peerId));
        const shouldInitiate = this.shouldInitiateConnection(fullPeerId);
        const comparison = this.peerId > fullPeerId;
        this.debug.log(`  ${peerId}...: should initiate = ${shouldInitiate} (${this.peerId.substring(0, 8)}... > ${peerId}... = ${comparison})`);
      });
      this.debug.log("=== END DEBUG ===");
    }
  };

  // src/PeerConnection.js
  var PeerConnection = class extends EventEmitter {
    constructor(peerId, isInitiator = false, options = {}) {
      super();
      this.peerId = peerId;
      this.debug = DebugLogger_default.create("PeerConnection");
      this.isInitiator = isInitiator;
      this.connection = null;
      this.dataChannel = null;
      this.remoteDescriptionSet = false;
      this.dataChannelReady = false;
      this.connectionStartTime = Date.now();
      this.pendingIceCandidates = [];
      this.isClosing = false;
      this.iceTimeoutId = null;
      this._forcedStatus = null;
      this._pendingBinaryPayloads = [];
      this._activeStreams = /* @__PURE__ */ new Map();
      this._streamChunks = /* @__PURE__ */ new Map();
      this._streamMetadata = /* @__PURE__ */ new Map();
      this.localStream = options.localStream || null;
      this.remoteStream = null;
      this.enableVideo = options.enableVideo || false;
      this.enableAudio = options.enableAudio || false;
      this.audioTransceiver = null;
      this.videoTransceiver = null;
      this.allowRemoteStreams = options.allowRemoteStreams === true;
      this.pendingRemoteStreams = [];
    }
    /**
       * Force this connection into a terminal state (e.g., failed/timeout)
       */
    markAsFailed(reason = "failed") {
      this._forcedStatus = reason;
      try {
        this.close();
      } catch (e) {
      }
    }
    async createConnection() {
      if (!environmentDetector.hasWebRTC) {
        const error = new Error("WebRTC not supported in this environment");
        this.emit("connectionFailed", { peerId: this.peerId, reason: error.message });
        throw error;
      }
      const pigeonRTC = environmentDetector.getPigeonRTC();
      if (!pigeonRTC) {
        const error = new Error("PigeonRTC not initialized - call initWebRTCAsync() first");
        this.emit("connectionFailed", { peerId: this.peerId, reason: error.message });
        throw error;
      }
      const testMode = typeof window !== "undefined" && window.AUTOMATED_TEST === true || typeof globalThis !== "undefined" && globalThis.AUTOMATED_TEST === true;
      const iceServers = testMode ? [
        // Single STUN server (or none) is sufficient for localhost; fewer servers reduces Firefox slowdown warnings
        { urls: "stun:stun.l.google.com:19302" }
      ] : [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" }
      ];
      this.debug.log(`\u{1F9EA} Automated test mode: ${testMode} (iceServers before create = ${iceServers.length})`);
      this.connection = pigeonRTC.createPeerConnection({
        iceServers,
        iceCandidatePoolSize: testMode ? 4 : 10,
        bundlePolicy: "max-bundle",
        rtcpMuxPolicy: "require"
      });
      this.setupConnectionHandlers();
      this.debug.log("\u{1F504} Using addTrack() approach for proper ontrack event firing");
      if (this.localStream) {
        this.debug.log("Adding local stream tracks using addTrack() method");
        await this.addLocalStreamWithAddTrack(this.localStream);
      }
      if (this.isInitiator) {
        this.debug.log(`\u{1F680} INITIATOR: Creating data channel for ${this.peerId.substring(0, 8)}... (WE are initiator)`);
        this.dataChannel = this.connection.createDataChannel("messages", {
          ordered: true
        });
        this.setupDataChannel();
      } else {
        this.debug.log(`\u{1F465} RECEIVER: Waiting for data channel from ${this.peerId.substring(0, 8)}... (THEY are initiator)`);
        this.connection.ondatachannel = (event) => {
          this.debug.log(`\u{1F4E8} RECEIVED: Data channel received from ${this.peerId.substring(0, 8)}...`);
          this.dataChannel = event.channel;
          this.setupDataChannel();
        };
      }
    }
    setupConnectionHandlers() {
      this.connection.onicecandidate = (event) => {
        if (event.candidate) {
          this.debug.log(`\u{1F9CA} Generated ICE candidate for ${this.peerId.substring(0, 8)}...`, {
            type: event.candidate.type,
            protocol: event.candidate.protocol,
            address: event.candidate.address?.substring(0, 10) + "..." || "unknown"
          });
          this.emit("iceCandidate", { peerId: this.peerId, candidate: event.candidate });
        } else {
          this.debug.log(`\u{1F9CA} ICE gathering complete for ${this.peerId.substring(0, 8)}...`);
        }
      };
      this.connection.ontrack = (event) => {
        this.debug.log("\u{1F3B5} Received remote media stream from", this.peerId);
        const stream = event.streams[0];
        const track = event.track;
        this.debug.log(`\u{1F3B5} Track received: kind=${track.kind}, id=${track.id}, enabled=${track.enabled}, readyState=${track.readyState}`);
        this.debug.log("\u{1F50D} ONTRACK DEBUG: Starting stream validation...");
        if (!this.validateRemoteStream(stream, track)) {
          this.debug.error("\u274C ONTRACK DEBUG: Stream validation FAILED - rejecting remote stream");
          return;
        }
        this.debug.log("\u2705 ONTRACK DEBUG: Stream validation PASSED - processing remote stream");
        if (stream) {
          this.remoteStream = stream;
          const audioTracks = stream.getAudioTracks();
          const videoTracks = stream.getVideoTracks();
          this.debug.log(`\u{1F3B5} Remote stream tracks: ${audioTracks.length} audio, ${videoTracks.length} video`);
          this.debug.log(`\u{1F3B5} Remote stream ID: ${stream.id} (vs local: ${this.localStream?.id || "none"})`);
          this.markStreamAsRemote(stream);
          audioTracks.forEach((audioTrack, index) => {
            this.debug.log(`\u{1F3B5} Audio track ${index}: enabled=${audioTrack.enabled}, readyState=${audioTrack.readyState}, muted=${audioTrack.muted}, id=${audioTrack.id}`);
            this.setupAudioDataMonitoring(audioTrack, index);
          });
          this.debug.log("\u{1F6A8} ONTRACK DEBUG: About to emit remoteStream event");
          if (this.allowRemoteStreams) {
            this.emit("remoteStream", { peerId: this.peerId, stream: this.remoteStream });
            this.debug.log("\u2705 ONTRACK DEBUG: remoteStream event emitted successfully");
          } else {
            this.debug.log("\u{1F512} ONTRACK DEBUG: Buffering remote stream until crypto verification");
            this.pendingRemoteStreams.push({ peerId: this.peerId, stream: this.remoteStream });
          }
        } else {
          this.debug.error("\u274C ONTRACK DEBUG: No stream in ontrack event - this should not happen");
        }
      };
      this.connection.onconnectionstatechange = () => {
        this.debug.log(`\u{1F517} Connection state with ${this.peerId}: ${this.connection.connectionState} (previous signaling: ${this.connection.signalingState})`);
        try {
          const transceivers = this.connection.getTransceivers();
          const audioSending = this.audioTransceiver && this.audioTransceiver.sender && this.audioTransceiver.sender.track;
          const videoSending = this.videoTransceiver && this.videoTransceiver.sender && this.videoTransceiver.sender.track;
          this.debug.log(`\u{1F517} Media context: Audio sending=${!!audioSending}, Video sending=${!!videoSending}, Transceivers=${transceivers.length}`);
        } catch (error) {
          this.debug.log(`\u{1F517} Media context: Unable to access transceiver details (${error.message})`);
        }
        if (this.connection.connectionState === "connected") {
          this.debug.log(`\u2705 Connection established with ${this.peerId}`);
          this.emit("connected", { peerId: this.peerId });
        } else if (this.connection.connectionState === "connecting") {
          this.debug.log(`\u{1F504} Connection to ${this.peerId} is connecting...`);
        } else if (this.connection.connectionState === "disconnected") {
          this.debug.log(`\u26A0\uFE0F WebRTC connection disconnected for ${this.peerId}, waiting for potential recovery...`);
          const recoveryTime = 12e3;
          setTimeout(() => {
            if (this.connection && this.connection.connectionState === "disconnected" && !this.isClosing) {
              this.debug.log(`\u274C WebRTC connection remained disconnected for ${this.peerId} after ${recoveryTime}ms, treating as failed`);
              this.emit("disconnected", { peerId: this.peerId, reason: "connection disconnected" });
            }
          }, recoveryTime);
        } else if (this.connection.connectionState === "failed") {
          if (!this.isClosing) {
            this.debug.log(`\u274C Connection failed for ${this.peerId}`);
            this.emit("disconnected", { peerId: this.peerId, reason: "connection failed" });
          }
        } else if (this.connection.connectionState === "closed") {
          if (!this.isClosing) {
            this.debug.log(`\u274C Connection closed for ${this.peerId}`);
            this.emit("disconnected", { peerId: this.peerId, reason: "connection closed" });
          }
        }
      };
      this.connection.oniceconnectionstatechange = () => {
        this.debug.log(`\u{1F9CA} ICE connection state with ${this.peerId}: ${this.connection.iceConnectionState}`);
        if (this.connection.iceConnectionState === "connected") {
          this.debug.log(`\u2705 ICE connection established with ${this.peerId}`);
          if (this.iceTimeoutId) {
            clearTimeout(this.iceTimeoutId);
            this.iceTimeoutId = null;
          }
        } else if (this.connection.iceConnectionState === "checking") {
          this.debug.log(`\u{1F504} ICE checking for ${this.peerId}...`);
          if (this.iceTimeoutId) {
            clearTimeout(this.iceTimeoutId);
          }
          this.iceTimeoutId = setTimeout(() => {
            if (this.connection && this.connection.iceConnectionState === "checking" && !this.isClosing) {
              this.debug.error(`\u274C ICE negotiation timeout for ${this.peerId} - connection stuck in checking state`);
              this.emit("disconnected", { peerId: this.peerId, reason: "ICE negotiation timeout" });
            }
          }, 3e4);
        } else if (this.connection.iceConnectionState === "failed") {
          const hasSignaling = this.mesh && this.mesh.signalingClient && this.mesh.signalingClient.isConnected();
          const hasMeshConnectivity = this.mesh && this.mesh.connected && this.mesh.connectionManager.getConnectedPeerCount() > 0;
          if (hasSignaling || hasMeshConnectivity) {
            this.debug.log(`\u274C ICE connection failed for ${this.peerId}, attempting restart (signaling: ${hasSignaling}, mesh: ${hasMeshConnectivity})`);
            try {
              this.restartIceViaSignaling().catch((error) => {
                this.debug.error("Failed to restart ICE after failure:", error);
                this.emit("disconnected", { peerId: this.peerId, reason: "ICE failed" });
              });
            } catch (error) {
              this.debug.error("Failed to restart ICE after failure:", error);
              this.emit("disconnected", { peerId: this.peerId, reason: "ICE failed" });
            }
          } else {
            this.debug.log(`\u274C ICE connection failed for ${this.peerId}, disconnecting`);
            this.emit("disconnected", { peerId: this.peerId, reason: "ICE failed" });
          }
        } else if (this.connection.iceConnectionState === "disconnected") {
          this.debug.log(`\u26A0\uFE0F ICE connection disconnected for ${this.peerId}, waiting for potential reconnection...`);
          setTimeout(() => {
            if (this.connection && this.connection.iceConnectionState === "disconnected" && !this.isClosing) {
              const hasSignaling = this.mesh && this.mesh.signalingClient && this.mesh.signalingClient.isConnected();
              const hasMeshConnectivity = this.mesh && this.mesh.connected && this.mesh.connectionManager.getConnectedPeerCount() > 0;
              if (hasSignaling || hasMeshConnectivity) {
                this.debug.log(`\u274C ICE remained disconnected for ${this.peerId}, attempting restart (signaling: ${hasSignaling}, mesh: ${hasMeshConnectivity})`);
                try {
                  this.restartIceViaSignaling().catch((error) => {
                    this.debug.error("Failed to restart ICE after disconnection:", error);
                    this.emit("disconnected", { peerId: this.peerId, reason: "ICE disconnected" });
                  });
                } catch (error) {
                  this.debug.error("Failed to restart ICE after disconnection:", error);
                  this.emit("disconnected", { peerId: this.peerId, reason: "ICE disconnected" });
                }
              } else {
                this.debug.log(`\u274C ICE remained disconnected for ${this.peerId}, disconnecting`);
                this.emit("disconnected", { peerId: this.peerId, reason: "ICE disconnected" });
              }
            }
          }, 5e3);
        }
      };
      this.connection.onnegotiationneeded = () => {
        this.debug.log(`\u{1F504} Negotiation needed for ${this.peerId} (WebRTC detected track changes)`);
        this.debug.log("\u2705 RENEGOTIATION: Track changes detected - triggering renegotiation as expected");
        try {
          const transceivers = this.connection.getTransceivers();
          this.debug.log("\u{1F504} Transceivers state during renegotiation:", transceivers.map((t) => ({
            kind: t.receiver?.track?.kind || "unknown",
            direction: t.direction,
            hasTrack: !!t.sender?.track,
            mid: t.mid
          })));
        } catch (error) {
          this.debug.log("\u{1F504} Cannot inspect transceivers (Node.js WebRTC limitation):", error.message);
        }
        this.emit("renegotiationNeeded", { peerId: this.peerId });
      };
      this.connection.onsignalingstatechange = () => {
        this.debug.log(`\u{1F504} Signaling state changed for ${this.peerId}: ${this.connection.signalingState}`);
        if (this.connection.signalingState === "stable") {
          this.debug.log("\u{1F50D} Signaling stable - checking for new remote tracks...");
          this.checkForNewRemoteTracks();
        }
      };
    }
    setupDataChannel() {
      if (!this.dataChannel) {
        this.debug.error("setupDataChannel called without data channel instance");
        return;
      }
      this.dataChannel.binaryType = "arraybuffer";
      this.dataChannel.onopen = () => {
        this.debug.log(`Data channel opened with ${this.peerId}`);
        this.dataChannelReady = true;
        this.emit("dataChannelOpen", { peerId: this.peerId });
      };
      this.dataChannel.onclose = () => {
        this.debug.log(`Data channel closed with ${this.peerId}`);
        this.dataChannelReady = false;
        this._pendingBinaryPayloads.length = 0;
        if (!this.isClosing) {
          this.emit("disconnected", { peerId: this.peerId, reason: "data channel closed" });
        }
      };
      this.dataChannel.onmessage = (event) => {
        const handleBinaryPayload = (buffer) => {
          if (!buffer) return;
          if (this._pendingBinaryPayloads.length === 0) {
            this.debug.warn("Received unexpected binary payload without metadata");
            return;
          }
          const payload = this._pendingBinaryPayloads.shift();
          const uint8Array = new Uint8Array(buffer);
          if (payload.type === "binaryMessage") {
            if (payload.size && payload.size !== uint8Array.byteLength) {
              this.debug.warn(`Binary message size mismatch: expected ${payload.size}, got ${uint8Array.byteLength}`);
            }
            this.debug.log(`\u{1F4E6} Received binary message (${uint8Array.byteLength} bytes) from ${this.peerId.substring(0, 8)}...`);
            this.emit("message", {
              peerId: this.peerId,
              message: {
                type: "binary",
                data: uint8Array,
                size: uint8Array.byteLength
              }
            });
            return;
          }
          if (payload.type === "streamChunk") {
            this._handleStreamChunkBinary(payload.header, uint8Array);
            return;
          }
          this.debug.warn(`Received binary payload with unknown handler type: ${payload.type}`);
        };
        if (event.data instanceof ArrayBuffer) {
          handleBinaryPayload(event.data);
          return;
        }
        if (typeof Blob !== "undefined" && event.data instanceof Blob) {
          event.data.arrayBuffer().then(handleBinaryPayload).catch((error) => this.debug.error("Failed to read binary payload:", error));
          return;
        }
        try {
          const message = JSON.parse(event.data);
          if (message.type === "__BINARY__") {
            this._pendingBinaryPayloads.push({ type: "binaryMessage", size: message.size });
            this.debug.log(`\u{1F4E6} Binary message header received, expecting ${message.size} bytes`);
            return;
          }
          if (message.type && message.type.startsWith("__STREAM_")) {
            this._handleStreamMessage(message);
            return;
          }
          this.emit("message", { peerId: this.peerId, message });
        } catch (error) {
          this.debug.error("Failed to parse message:", error);
          this.emit("message", { peerId: this.peerId, message: { content: event.data } });
        }
      };
      this.dataChannel.onerror = (error) => {
        this.debug.error(`Data channel error with ${this.peerId}:`, error);
        this.dataChannelReady = false;
        this._pendingBinaryPayloads.length = 0;
        if (!this.isClosing) {
          this.emit("disconnected", { peerId: this.peerId, reason: "data channel error" });
        }
      };
    }
    // CRITICAL: Check and force data channel state after answer processing
    checkDataChannelState() {
      if (this.dataChannel) {
        this.debug.log(`\u{1F50D} DATA CHANNEL CHECK: State for ${this.peerId.substring(0, 8)}... is ${this.dataChannel.readyState}`);
        if (this.dataChannel.readyState === "open" && !this.dataChannelReady) {
          this.debug.log(`\u{1F680} FORCE OPEN: Triggering data channel open for ${this.peerId.substring(0, 8)}...`);
          this.dataChannelReady = true;
          this.emit("dataChannelOpen", { peerId: this.peerId });
        } else if (this.dataChannel.readyState === "connecting") {
          this.debug.log(`\u23F3 CONNECTING: Data channel connecting for ${this.peerId.substring(0, 8)}..., setting up backup check`);
          setTimeout(() => {
            if (this.dataChannel && this.dataChannel.readyState === "open" && !this.dataChannelReady) {
              this.debug.log(`\u{1F680} BACKUP OPEN: Backup trigger for data channel open for ${this.peerId.substring(0, 8)}...`);
              this.dataChannelReady = true;
              this.emit("dataChannelOpen", { peerId: this.peerId });
            }
          }, 100);
        } else {
          this.debug.log(`\u274C DATA CHANNEL CHECK: No data channel found for ${this.peerId.substring(0, 8)}...`);
        }
      }
    }
    async createOffer() {
      try {
        const offer = await Promise.race([
          this.connection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true,
            iceRestart: false
            // Don't restart ICE unless necessary
          }),
          new Promise(
            (resolve, reject) => setTimeout(() => reject(new Error("createOffer timeout")), 1e4)
          )
        ]);
        await Promise.race([
          this.connection.setLocalDescription(offer),
          new Promise(
            (resolve, reject) => setTimeout(() => reject(new Error("setLocalDescription timeout")), 1e4)
          )
        ]);
        return offer;
      } catch (error) {
        this.debug.error(`\u274C Failed to create offer for ${this.peerId}:`, error);
        throw error;
      }
    }
    async handleOffer(offer) {
      if (!offer || typeof offer !== "object") {
        this.debug.error(`Invalid offer from ${this.peerId} - not an object:`, offer);
        throw new Error("Invalid offer: not an object");
      }
      if (!offer.type || offer.type !== "offer") {
        this.debug.error(`Invalid offer from ${this.peerId} - wrong type:`, offer.type);
        throw new Error(`Invalid offer: expected type 'offer', got '${offer.type}'`);
      }
      if (!offer.sdp || typeof offer.sdp !== "string") {
        this.debug.error(`Invalid offer from ${this.peerId} - missing or invalid SDP:`, typeof offer.sdp);
        throw new Error("Invalid offer: missing or invalid SDP");
      }
      if (offer.sdp.length < 10 || !offer.sdp.includes("v=0")) {
        this.debug.error(`Invalid offer SDP from ${this.peerId} - malformed:`, offer.sdp.substring(0, 100) + "...");
        throw new Error("Invalid offer: malformed SDP");
      }
      this.debug.log(`\u{1F504} OFFER DEBUG: Processing offer from ${this.peerId.substring(0, 8)}...`);
      this.debug.log(`\u{1F504} OFFER DEBUG: Current signaling state: ${this.connection.signalingState}`);
      this.debug.log(`\u{1F504} OFFER DEBUG: Current connection state: ${this.connection.connectionState}`);
      this.debug.log(`\u{1F504} OFFER DEBUG: Current ICE state: ${this.connection.iceConnectionState}`);
      this.debug.log(`\u{1F504} OFFER DEBUG: Offer SDP length: ${offer.sdp.length}`);
      if (this.connection.signalingState !== "stable") {
        this.debug.log(`\u274C OFFER DEBUG: Cannot handle offer from ${this.peerId} - connection state is ${this.connection.signalingState} (expected: stable)`);
        throw new Error(`Cannot handle offer in state: ${this.connection.signalingState}`);
      }
      this.debug.log(`\u{1F504} OFFER DEBUG: State validation passed, processing offer from ${this.peerId.substring(0, 8)}... SDP length: ${offer.sdp.length}`);
      try {
        await Promise.race([
          this.connection.setRemoteDescription(offer),
          new Promise(
            (resolve, reject) => setTimeout(() => reject(new Error("setRemoteDescription timeout")), 1e4)
          )
        ]);
        this.remoteDescriptionSet = true;
        this.debug.log(`\u2705 OFFER DEBUG: Offer processed successfully from ${this.peerId.substring(0, 8)}...`);
        this.debug.log(`\u2705 OFFER DEBUG: New signaling state after offer: ${this.connection.signalingState}`);
        await this.processPendingIceCandidates();
        const answer = await Promise.race([
          this.connection.createAnswer(),
          new Promise(
            (resolve, reject) => setTimeout(() => reject(new Error("createAnswer timeout")), 1e4)
          )
        ]);
        await Promise.race([
          this.connection.setLocalDescription(answer),
          new Promise(
            (resolve, reject) => setTimeout(() => reject(new Error("setLocalDescription timeout")), 1e4)
          )
        ]);
        this.debug.log(`\u2705 OFFER DEBUG: Answer created for offer from ${this.peerId.substring(0, 8)}...`);
        this.debug.log(`\u2705 OFFER DEBUG: Final signaling state after answer: ${this.connection.signalingState}`);
        this.checkDataChannelState();
        return answer;
      } catch (error) {
        this.debug.error(`\u274C OFFER DEBUG: Failed to process offer from ${this.peerId}:`, error);
        this.debug.error("OFFER DEBUG: Offer SDP that failed:", offer.sdp);
        this.debug.error("OFFER DEBUG: Current connection state:", this.connection.signalingState);
        this.debug.error("OFFER DEBUG: Current ICE state:", this.connection.iceConnectionState);
        throw error;
      }
    }
    async handleAnswer(answer) {
      if (!answer || typeof answer !== "object") {
        this.debug.error(`Invalid answer from ${this.peerId} - not an object:`, answer);
        throw new Error("Invalid answer: not an object");
      }
      if (!answer.type || answer.type !== "answer") {
        this.debug.error(`Invalid answer from ${this.peerId} - wrong type:`, answer.type);
        throw new Error(`Invalid answer: expected type 'answer', got '${answer.type}'`);
      }
      if (!answer.sdp || typeof answer.sdp !== "string") {
        this.debug.error(`Invalid answer from ${this.peerId} - missing or invalid SDP:`, typeof answer.sdp);
        throw new Error("Invalid answer: missing or invalid SDP");
      }
      if (answer.sdp.length < 10 || !answer.sdp.includes("v=0")) {
        this.debug.error(`Invalid answer SDP from ${this.peerId} - malformed:`, answer.sdp.substring(0, 100) + "...");
        throw new Error("Invalid answer: malformed SDP");
      }
      this.debug.log(`\u{1F504} ANSWER DEBUG: Processing answer from ${this.peerId.substring(0, 8)}...`);
      this.debug.log(`\u{1F504} ANSWER DEBUG: Current signaling state: ${this.connection.signalingState}`);
      this.debug.log(`\u{1F504} ANSWER DEBUG: Current connection state: ${this.connection.connectionState}`);
      this.debug.log(`\u{1F504} ANSWER DEBUG: Current ICE state: ${this.connection.iceConnectionState}`);
      this.debug.log(`\u{1F504} ANSWER DEBUG: Answer SDP length: ${answer.sdp.length}`);
      if (this.connection.signalingState !== "have-local-offer") {
        this.debug.log(`\u274C ANSWER DEBUG: Cannot handle answer from ${this.peerId} - connection state is ${this.connection.signalingState} (expected: have-local-offer)`);
        if (this.connection.signalingState === "stable") {
          this.debug.log("\u2705 ANSWER DEBUG: Connection already stable, answer not needed");
          return;
        }
        throw new Error(`Cannot handle answer in state: ${this.connection.signalingState}`);
      }
      this.debug.log(`\u{1F504} ANSWER DEBUG: State validation passed, processing answer from ${this.peerId.substring(0, 8)}... SDP length: ${answer.sdp.length}`);
      try {
        await Promise.race([
          this.connection.setRemoteDescription(answer),
          new Promise(
            (resolve, reject) => setTimeout(() => reject(new Error("setRemoteDescription timeout")), 1e4)
          )
        ]);
        this.remoteDescriptionSet = true;
        this.debug.log(`\u2705 ANSWER DEBUG: Answer processed successfully from ${this.peerId.substring(0, 8)}...`);
        this.debug.log(`\u2705 ANSWER DEBUG: New signaling state: ${this.connection.signalingState}`);
        this.debug.log(`\u2705 ANSWER DEBUG: New connection state: ${this.connection.connectionState}`);
        await this.processPendingIceCandidates();
        this.checkDataChannelState();
      } catch (error) {
        this.debug.error(`\u274C ANSWER DEBUG: Failed to set remote description for answer from ${this.peerId}:`, error);
        this.debug.error("ANSWER DEBUG: Answer SDP that failed:", answer.sdp);
        this.debug.error("ANSWER DEBUG: Current connection state:", this.connection.signalingState);
        this.debug.error("ANSWER DEBUG: Current ICE state:", this.connection.iceConnectionState);
        throw error;
      }
    }
    async handleIceCandidate(candidate) {
      if (!candidate || typeof candidate !== "object") {
        this.debug.error(`Invalid ICE candidate from ${this.peerId} - not an object:`, candidate);
        throw new Error("Invalid ICE candidate: not an object");
      }
      if (!candidate.candidate || typeof candidate.candidate !== "string" || candidate.candidate.trim() === "") {
        this.debug.log(`\u{1F9CA} Received end-of-candidates signal for ${this.peerId.substring(0, 8)}...`);
        return;
      }
      this.debug.log(`\u{1F9CA} Received ICE candidate for ${this.peerId.substring(0, 8)}...`, {
        type: candidate.type,
        protocol: candidate.protocol,
        candidateLength: candidate.candidate?.length || 0
      });
      if (!this.remoteDescriptionSet) {
        this.debug.log(`\u{1F9CA} Buffering ICE candidate for ${this.peerId.substring(0, 8)}... (remote description not set yet)`);
        this.pendingIceCandidates.push(candidate);
        return;
      }
      try {
        await Promise.race([
          this.connection.addIceCandidate(candidate),
          new Promise(
            (resolve, reject) => setTimeout(() => reject(new Error("addIceCandidate timeout")), 5e3)
          )
        ]);
        this.debug.log(`\u{1F9CA} Successfully added ICE candidate for ${this.peerId.substring(0, 8)}...`);
      } catch (error) {
        this.debug.error(`\u{1F9CA} Failed to add ICE candidate for ${this.peerId.substring(0, 8)}...:`, error);
        this.debug.error("ICE candidate that failed:", candidate);
        this.debug.error("Current connection state:", this.connection.connectionState);
        this.debug.error("Current ICE state:", this.connection.iceConnectionState);
      }
    }
    async processPendingIceCandidates() {
      if (this.pendingIceCandidates.length > 0) {
        this.debug.log(`\u{1F9CA} Processing ${this.pendingIceCandidates.length} buffered ICE candidates for ${this.peerId.substring(0, 8)}...`);
        for (const candidate of this.pendingIceCandidates) {
          try {
            await Promise.race([
              this.connection.addIceCandidate(candidate),
              new Promise(
                (resolve, reject) => setTimeout(() => reject(new Error("addIceCandidate timeout")), 5e3)
              )
            ]);
            this.debug.log(`\u{1F9CA} Successfully added buffered ICE candidate (${candidate.type}) for ${this.peerId.substring(0, 8)}...`);
          } catch (error) {
            this.debug.error(`\u{1F9CA} Failed to add buffered ICE candidate for ${this.peerId.substring(0, 8)}...:`, error);
          }
        }
        this.pendingIceCandidates = [];
        this.debug.log(`\u{1F9CA} Finished processing buffered ICE candidates for ${this.peerId.substring(0, 8)}...`);
      }
    }
    sendMessage(message) {
      if (this.dataChannel && this.dataChannel.readyState === "open") {
        try {
          if (message instanceof ArrayBuffer || ArrayBuffer.isView(message)) {
            this.debug.log(`\u{1F4E6} Sending binary message (${message.byteLength || message.buffer.byteLength} bytes) to ${this.peerId.substring(0, 8)}...`);
            const buffer = ArrayBuffer.isView(message) ? message.buffer : message;
            const header = JSON.stringify({ type: "__BINARY__", size: buffer.byteLength });
            this.dataChannel.send(header);
            this.dataChannel.send(buffer);
            return true;
          } else {
            this.dataChannel.send(JSON.stringify(message));
            return true;
          }
        } catch (error) {
          this.debug.error(`Failed to send message to ${this.peerId}:`, error);
          return false;
        }
      }
      return false;
    }
    /**
     * Create a WritableStream for sending data to this peer
     * @param {object} options - Stream options
     * @returns {WritableStream} A writable stream for sending data
     */
    createWritableStream(options = {}) {
      const streamId = options.streamId || this._generateStreamId();
      const metadata = {
        streamId,
        type: options.type || "binary",
        filename: options.filename,
        mimeType: options.mimeType,
        totalSize: options.totalSize,
        chunkSize: options.chunkSize,
        timestamp: Date.now()
      };
      this.debug.log(`\u{1F4E4} Creating writable stream ${streamId} to ${this.peerId.substring(0, 8)}...`);
      const configuredChunkSize = typeof metadata.chunkSize === "number" && Number.isFinite(metadata.chunkSize) ? metadata.chunkSize : 16384;
      const chunkSize = Math.max(4096, Math.min(configuredChunkSize, 65536));
      metadata.chunkSize = chunkSize;
      const highWaterMark = chunkSize * 32;
      const lowWaterMark = chunkSize * 8;
      const ensureChannelOpen = () => {
        if (!this.dataChannel || this.dataChannel.readyState !== "open") {
          throw new Error("Data channel not open");
        }
      };
      const waitForBufferDrain = () => {
        if (!this.dataChannel || this.dataChannel.readyState !== "open") {
          return Promise.resolve();
        }
        if (this.dataChannel.bufferedAmount <= lowWaterMark) {
          return Promise.resolve();
        }
        return new Promise((resolve) => {
          const checkBuffer = () => {
            if (!this.dataChannel || this.dataChannel.readyState !== "open") {
              resolve();
              return;
            }
            if (this.dataChannel.bufferedAmount <= lowWaterMark) {
              resolve();
            } else {
              setTimeout(checkBuffer, 20);
            }
          };
          checkBuffer();
        });
      };
      this.sendMessage({
        type: "__STREAM_INIT__",
        streamId,
        metadata
      });
      let chunkIndex = 0;
      const self2 = this;
      return new WritableStream({
        async write(chunk) {
          ensureChannelOpen();
          const data = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
          let offset = 0;
          while (offset < data.byteLength) {
            ensureChannelOpen();
            const sliceEnd = Math.min(offset + chunkSize, data.byteLength);
            const slice = data.subarray(offset, sliceEnd);
            const sliceBuffer = slice.byteOffset === 0 && slice.byteLength === slice.buffer.byteLength ? slice.buffer : slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength);
            const chunkMessage = {
              type: "__STREAM_CHUNK__",
              streamId,
              chunkIndex: chunkIndex++,
              size: slice.byteLength,
              encoding: "binary"
            };
            try {
              self2.dataChannel.send(JSON.stringify(chunkMessage));
              self2.dataChannel.send(sliceBuffer);
            } catch (error) {
              throw error;
            }
            offset = sliceEnd;
            if (self2.dataChannel && self2.dataChannel.bufferedAmount > highWaterMark) {
              await waitForBufferDrain();
            }
          }
        },
        async close() {
          if (self2.dataChannel && self2.dataChannel.readyState === "open") {
            await waitForBufferDrain();
            self2.sendMessage({
              type: "__STREAM_END__",
              streamId,
              totalChunks: chunkIndex
            });
          }
          self2._activeStreams.delete(streamId);
          self2.debug.log(`\u{1F4E4} Closed writable stream ${streamId}`);
        },
        async abort(reason) {
          if (self2.dataChannel && self2.dataChannel.readyState === "open") {
            self2.sendMessage({
              type: "__STREAM_ABORT__",
              streamId,
              reason: reason?.message || "Stream aborted"
            });
          }
          self2._activeStreams.delete(streamId);
          self2.debug.log(`\u274C Aborted writable stream ${streamId}: ${reason}`);
        }
      });
    }
    /**
     * Handle incoming stream messages and create ReadableStream
     * @private
     */
    _handleStreamMessage(message) {
      const { type } = message;
      switch (type) {
        case "__STREAM_INIT__":
          this._handleStreamInit(message);
          break;
        case "__STREAM_CHUNK__":
          if (message.encoding === "binary") {
            this._pendingBinaryPayloads.push({
              type: "streamChunk",
              header: message
            });
          } else {
            this._handleStreamChunkLegacy(message);
          }
          break;
        case "__STREAM_END__":
          this._handleStreamEnd(message);
          break;
        case "__STREAM_ABORT__":
          this._handleStreamAbort(message);
          break;
      }
    }
    _handleStreamInit(message) {
      const { streamId, metadata } = message;
      this.debug.log(`\u{1F4E5} Receiving stream ${streamId} from ${this.peerId.substring(0, 8)}...`);
      this._streamMetadata.set(streamId, metadata);
      this._streamChunks.set(streamId, []);
      const chunks = this._streamChunks.get(streamId);
      let controller;
      const readable = new ReadableStream({
        start(ctrl) {
          controller = ctrl;
        },
        cancel: (reason) => {
          this.debug.log(`\u{1F4E5} Stream ${streamId} cancelled: ${reason}`);
        }
      });
      this._activeStreams.set(streamId, {
        type: "readable",
        stream: readable,
        controller,
        metadata,
        chunks
      });
      this.emit("streamReceived", {
        peerId: this.peerId,
        streamId,
        stream: readable,
        metadata
      });
    }
    _handleStreamChunkLegacy(message) {
      const { streamId, chunkIndex, data } = message;
      const streamData = this._activeStreams.get(streamId);
      if (!streamData) {
        this.debug.warn(`Received chunk for unknown stream ${streamId}`);
        return;
      }
      const chunk = new Uint8Array(data);
      if (streamData.controller) {
        streamData.controller.enqueue(chunk);
      }
      if (Array.isArray(streamData.chunks)) {
        streamData.chunks.push(chunk);
      }
      this.debug.log(`\u{1F4E5} Received chunk ${chunkIndex} for stream ${streamId} (${chunk.length} bytes)`);
    }
    _handleStreamChunkBinary(header, chunk) {
      const { streamId, chunkIndex, size } = header;
      const streamData = this._activeStreams.get(streamId);
      if (!streamData) {
        this.debug.warn(`Received binary chunk for unknown stream ${streamId}`);
        return;
      }
      if (size && size !== chunk.byteLength) {
        this.debug.warn(`Stream ${streamId} chunk ${chunkIndex} size mismatch: expected ${size}, got ${chunk.byteLength}`);
      }
      if (streamData.controller) {
        streamData.controller.enqueue(chunk);
      }
      if (Array.isArray(streamData.chunks)) {
        streamData.chunks.push(chunk);
      }
      this.debug.log(`\u{1F4E5} Received chunk ${chunkIndex} for stream ${streamId} (${chunk.byteLength} bytes)`);
    }
    _handleStreamEnd(message) {
      const { streamId, totalChunks } = message;
      const streamData = this._activeStreams.get(streamId);
      if (!streamData) {
        this.debug.warn(`Received end for unknown stream ${streamId}`);
        return;
      }
      if (streamData.controller) {
        streamData.controller.close();
      }
      this.debug.log(`\u{1F4E5} Stream ${streamId} completed (${totalChunks} chunks)`);
      this._activeStreams.delete(streamId);
      this._streamChunks.delete(streamId);
      this._streamMetadata.delete(streamId);
      this.emit("streamCompleted", {
        peerId: this.peerId,
        streamId,
        totalChunks
      });
    }
    _handleStreamAbort(message) {
      const { streamId, reason } = message;
      const streamData = this._activeStreams.get(streamId);
      if (streamData && streamData.controller) {
        streamData.controller.error(new Error(reason));
      }
      this.debug.log(`\u274C Stream ${streamId} aborted: ${reason}`);
      this._activeStreams.delete(streamId);
      this._streamChunks.delete(streamId);
      this._streamMetadata.delete(streamId);
      this.emit("streamAborted", {
        peerId: this.peerId,
        streamId,
        reason
      });
    }
    _generateStreamId() {
      return `stream-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }
    /**
     * CRITICAL FIX: Manually check for new remote tracks after renegotiation
     * This is needed because replaceTrack() doesn't trigger ontrack events
     */
    checkForNewRemoteTracks() {
      this.debug.log(`\u{1F50D} TRACK CHECK: Checking transceivers for new remote tracks from ${this.peerId.substring(0, 8)}...`);
      try {
        const transceivers = this.connection.getTransceivers();
        let foundNewTracks = false;
        transceivers.forEach((transceiver, index) => {
          const track = transceiver.receiver.track;
          if (track && track.readyState === "live") {
            this.debug.log(`\u{1F50D} TRACK CHECK: Transceiver ${index} has live ${track.kind} track: ${track.id.substring(0, 8)}...`);
            const isNewTrack = !this.processedTrackIds || !this.processedTrackIds.has(track.id);
            if (isNewTrack) {
              this.debug.log(`\u{1F3B5} NEW TRACK FOUND: Processing new ${track.kind} track from ${this.peerId.substring(0, 8)}...`);
              const stream = new MediaStream([track]);
              if (this.validateRemoteStream(stream, track)) {
                this.remoteStream = stream;
                this.markStreamAsRemote(stream);
                if (!this.processedTrackIds) this.processedTrackIds = /* @__PURE__ */ new Set();
                this.processedTrackIds.add(track.id);
                this.debug.log("\u{1F6A8} TRACK CHECK: Emitting remoteStream event for new track");
                if (this.allowRemoteStreams) {
                  this.emit("remoteStream", { peerId: this.peerId, stream: this.remoteStream });
                } else {
                  this.debug.log("\u{1F512} TRACK CHECK: Buffering remote stream until crypto verification");
                  this.pendingRemoteStreams.push({ peerId: this.peerId, stream: this.remoteStream });
                }
                foundNewTracks = true;
              }
            }
          }
        });
        if (!foundNewTracks) {
          this.debug.log("\u{1F50D} TRACK CHECK: No new remote tracks found");
        }
      } catch (error) {
        this.debug.error("\u274C TRACK CHECK: Failed to check for remote tracks:", error);
      }
    }
    /**
       * Enhanced validation to ensure received stream is genuinely remote
       */
    validateRemoteStream(stream, track) {
      this.debug.log("\u{1F50D} VALIDATION: Starting remote stream validation...");
      if (!stream) {
        this.debug.error("\u274C VALIDATION: Stream is null or undefined");
        return false;
      }
      if (!track) {
        this.debug.error("\u274C VALIDATION: Track is null or undefined");
        return false;
      }
      if (this.localStream && stream.id === this.localStream.id) {
        this.debug.error("\u274C LOOPBACK DETECTED: Received our own local stream as remote!");
        this.debug.error("Local stream ID:", this.localStream.id);
        this.debug.error("Received stream ID:", stream.id);
        return false;
      }
      this.debug.log("\u2705 VALIDATION: Stream ID check passed");
      if (this.localStream) {
        const localTracks = this.localStream.getTracks();
        const isOwnTrack = localTracks.some((localTrack) => localTrack.id === track.id);
        if (isOwnTrack) {
          this.debug.error("\u274C TRACK LOOPBACK: This track is our own local track!");
          this.debug.error("Local track ID:", track.id);
          return false;
        }
      }
      this.debug.log("\u2705 VALIDATION: Track ID check passed");
      if (this.connection) {
        const transceivers = this.connection.getTransceivers();
        this.debug.log(`\u{1F50D} VALIDATION: Checking ${transceivers.length} transceivers for track ${track.id.substring(0, 8)}...`);
        const sourceTransceiver = transceivers.find((t) => t.receiver.track === track);
        if (!sourceTransceiver) {
          this.debug.warn("\u26A0\uFE0F VALIDATION: Track not found in any transceiver - may be invalid");
          this.debug.warn("Available transceivers:", transceivers.map((t) => ({
            kind: t.receiver?.track?.kind || "no-track",
            direction: t.direction,
            trackId: t.receiver?.track?.id?.substring(0, 8) || "none"
          })));
          this.debug.log("\u26A0\uFE0F VALIDATION: Allowing track despite transceiver lookup failure (temporary fix)");
        } else {
          if (sourceTransceiver.direction === "sendonly") {
            this.debug.error("\u274C Invalid direction: Receiving track from sendonly transceiver");
            return false;
          }
          this.debug.log(`\u2705 VALIDATION: Transceiver check passed (direction: ${sourceTransceiver.direction})`);
        }
      }
      if (stream && stream._peerPigeonOrigin === "local") {
        this.debug.error("\u274C Stream marked as local origin - preventing synchronization loop");
        return false;
      }
      this.debug.log("\u2705 VALIDATION: Local origin check passed");
      this.debug.log("\u2705 Remote stream validation passed for peer", this.peerId.substring(0, 8));
      return true;
    }
    /**
       * Mark a stream as genuinely remote to prevent future confusion
       */
    markStreamAsRemote(stream) {
      Object.defineProperty(stream, "_peerPigeonOrigin", {
        value: "remote",
        writable: false,
        enumerable: false,
        configurable: false
      });
      Object.defineProperty(stream, "_peerPigeonSourcePeerId", {
        value: this.peerId,
        writable: false,
        enumerable: false,
        configurable: false
      });
      this.debug.log(`\u{1F512} Stream ${stream.id} marked as remote from peer ${this.peerId.substring(0, 8)}`);
    }
    /**
       * Mark local stream to prevent it from being treated as remote
       */
    markStreamAsLocal(stream) {
      if (!stream) return;
      Object.defineProperty(stream, "_peerPigeonOrigin", {
        value: "local",
        writable: false,
        enumerable: false,
        configurable: false
      });
      this.debug.log(`\u{1F512} Stream ${stream.id} marked as local origin`);
    }
    /**
     * Add local stream using addTrack() method to trigger ontrack events
     */
    async addLocalStreamWithAddTrack(stream) {
      if (!stream || !this.connection) return;
      this.debug.log("\u{1F3A5} Adding local stream using addTrack() for proper ontrack events");
      const audioTracks = stream.getAudioTracks();
      const videoTracks = stream.getVideoTracks();
      this.markStreamAsLocal(stream);
      audioTracks.forEach((audioTrack, index) => {
        this.debug.log(`\u{1F3A4} Adding audio track ${index} using addTrack()`);
        try {
          const audioSender = this.connection.addTrack(audioTrack, stream);
          this.audioTransceiver = this.connection.getTransceivers().find((t) => t.sender === audioSender);
          this.setupAudioSendingMonitoring(audioTrack);
          this.debug.log(`\u{1F3A4} SENDING AUDIO to peer ${this.peerId.substring(0, 8)} - track enabled: ${audioTrack.enabled}`);
        } catch (error) {
          this.debug.error(`\u274C Failed to add audio track ${index}:`, error);
        }
      });
      videoTracks.forEach((videoTrack, index) => {
        this.debug.log(`\u{1F3A5} Adding video track ${index} using addTrack()`);
        try {
          const videoSender = this.connection.addTrack(videoTrack, stream);
          this.videoTransceiver = this.connection.getTransceivers().find((t) => t.sender === videoSender);
          this.debug.log(`\u{1F3A5} SENDING VIDEO to peer ${this.peerId.substring(0, 8)} - track enabled: ${videoTrack.enabled}`);
        } catch (error) {
          this.debug.error(`\u274C Failed to add video track ${index}:`, error);
        }
      });
      this.localStream = stream;
      this.debug.log("\u2705 Local stream added using addTrack() method");
      const transceivers = this.connection.getTransceivers();
      this.debug.log("\u{1F50D} Transceivers after addTrack():", transceivers.map((t) => ({
        kind: t.receiver?.track?.kind || "unknown",
        direction: t.direction,
        hasTrack: !!t.sender?.track,
        trackId: t.sender?.track?.id?.substring(0, 8) || "none",
        mid: t.mid
      })));
    }
    /**
       * Add or replace local media stream
       */
    async setLocalStream(stream) {
      if (!this.connection) {
        throw new Error("Connection not initialized");
      }
      this.debug.log(`Setting local stream for ${this.peerId}, current state: ${this.connection.connectionState}, signaling: ${this.connection.signalingState}`);
      const senders = this.connection.getSenders();
      for (const sender of senders) {
        if (sender.track) {
          this.debug.log("\uFFFD\uFE0F Removing existing track:", sender.track.kind);
          this.connection.removeTrack(sender);
        }
      }
      this.audioTransceiver = null;
      this.videoTransceiver = null;
      if (stream) {
        this.debug.log("\u{1F3A5} Adding new stream using addTrack() method");
        await this.addLocalStreamWithAddTrack(stream);
      } else {
        this.localStream = null;
        this.debug.log("\u2705 All tracks removed");
      }
      this.debug.log("Updated local media stream for", this.peerId);
      this.debug.log("\u2705 Stream updated - forcing renegotiation for media changes");
      this.debug.log(`   Current state: connectionState=${this.connection.connectionState}, signalingState=${this.connection.signalingState}`);
      if (stream) {
        setTimeout(() => {
          this.debug.log("\u{1F504} Forcing renegotiation for media stream changes");
          this.emit("renegotiationNeeded", { peerId: this.peerId });
        }, 200);
      }
    }
    /**
     * Force connection recovery for stuck connections
     */
    async forceConnectionRecovery() {
      this.debug.log(`\u{1F198} FORCE RECOVERY: Attempting emergency recovery for ${this.peerId.substring(0, 8)}...`);
      try {
        const offer = await Promise.race([
          this.connection.createOffer({ iceRestart: true }),
          new Promise(
            (resolve, reject) => setTimeout(() => reject(new Error("forceConnectionRecovery createOffer timeout")), 1e4)
          )
        ]);
        await Promise.race([
          this.connection.setLocalDescription(offer),
          new Promise(
            (resolve, reject) => setTimeout(() => reject(new Error("forceConnectionRecovery setLocalDescription timeout")), 1e4)
          )
        ]);
        if (this.mesh && this.mesh.sendSignalingMessage) {
          await this.mesh.sendSignalingMessage({
            type: "recovery-offer",
            data: offer,
            emergency: true
          }, this.peerId);
          this.debug.log(`\u2705 RECOVERY: Emergency offer sent for ${this.peerId.substring(0, 8)}...`);
        } else {
          this.debug.error(`\u274C RECOVERY: No mesh signaling available for ${this.peerId.substring(0, 8)}...`);
        }
      } catch (error) {
        this.debug.error(`\u274C RECOVERY: Emergency recovery failed for ${this.peerId.substring(0, 8)}...`, error);
        throw error;
      }
    }
    /**
       * Setup audio data monitoring for received audio tracks
       */
    setupAudioDataMonitoring(audioTrack, trackIndex) {
      this.debug.log(`\u{1F3B5} Setting up audio data monitoring for track ${trackIndex} from peer ${this.peerId.substring(0, 8)}`);
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) {
          this.debug.warn("\u{1F3B5} AudioContext not available - cannot monitor audio data");
          return;
        }
        const trackStream = new MediaStream([audioTrack]);
        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(trackStream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        source.connect(analyser);
        let lastLogTime = 0;
        let totalSamples = 0;
        let samplesWithAudio = 0;
        let maxLevel = 0;
        const monitorAudio = () => {
          if (audioTrack.readyState === "ended") {
            this.debug.log(`\u{1F3B5} Audio track ${trackIndex} ended, stopping monitoring for peer ${this.peerId.substring(0, 8)}`);
            audioContext.close();
            return;
          }
          analyser.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((sum, value) => sum + value, 0) / bufferLength;
          const currentTime = Date.now();
          totalSamples++;
          if (average > 5) {
            samplesWithAudio++;
            maxLevel = Math.max(maxLevel, average);
          }
          if (currentTime - lastLogTime > 5e3) {
            const audioActivity = totalSamples > 0 ? samplesWithAudio / totalSamples * 100 : 0;
            this.debug.log(`\u{1F3B5} Audio data from peer ${this.peerId.substring(0, 8)} track ${trackIndex}:`, {
              enabled: audioTrack.enabled,
              readyState: audioTrack.readyState,
              muted: audioTrack.muted,
              currentLevel: Math.round(average),
              maxLevel: Math.round(maxLevel),
              activityPercent: Math.round(audioActivity),
              samplesAnalyzed: totalSamples,
              hasAudioData: samplesWithAudio > 0
            });
            lastLogTime = currentTime;
            totalSamples = 0;
            samplesWithAudio = 0;
            maxLevel = 0;
          }
          if (audioTrack.readyState === "live") {
            requestAnimationFrame(monitorAudio);
          }
        };
        requestAnimationFrame(monitorAudio);
        audioTrack.addEventListener("ended", () => {
          this.debug.log(`\u{1F3B5} Audio track ${trackIndex} from peer ${this.peerId.substring(0, 8)} ended`);
          audioContext.close();
        });
        audioTrack.addEventListener("mute", () => {
          this.debug.log(`\u{1F3B5} Audio track ${trackIndex} from peer ${this.peerId.substring(0, 8)} muted`);
        });
        audioTrack.addEventListener("unmute", () => {
          this.debug.log(`\u{1F3B5} Audio track ${trackIndex} from peer ${this.peerId.substring(0, 8)} unmuted`);
        });
        this.debug.log(`\u{1F3B5} Audio monitoring started for track ${trackIndex} from peer ${this.peerId.substring(0, 8)}`);
      } catch (error) {
        this.debug.error(`\u{1F3B5} Failed to setup audio monitoring for track ${trackIndex}:`, error);
      }
    }
    /**
       * Setup audio sending monitoring for outgoing audio tracks
       */
    setupAudioSendingMonitoring(audioTrack) {
      this.debug.log(`\u{1F3A4} Setting up audio SENDING monitoring to peer ${this.peerId.substring(0, 8)}`);
      try {
        audioTrack.addEventListener("ended", () => {
          this.debug.log(`\u{1F3A4} Audio SENDING track ended to peer ${this.peerId.substring(0, 8)}`);
        });
        audioTrack.addEventListener("mute", () => {
          this.debug.log(`\u{1F3A4} Audio SENDING track muted to peer ${this.peerId.substring(0, 8)}`);
        });
        audioTrack.addEventListener("unmute", () => {
          this.debug.log(`\u{1F3A4} Audio SENDING track unmuted to peer ${this.peerId.substring(0, 8)}`);
        });
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) {
          this.debug.warn("\u{1F3A4} AudioContext not available - basic sending monitoring only");
          return;
        }
        const trackStream = new MediaStream([audioTrack]);
        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(trackStream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        source.connect(analyser);
        let lastLogTime = 0;
        let totalSamples = 0;
        let activeSamples = 0;
        let maxSendLevel = 0;
        const monitorSending = () => {
          if (audioTrack.readyState === "ended") {
            this.debug.log(`\u{1F3A4} Audio sending track ended, stopping monitoring to peer ${this.peerId.substring(0, 8)}`);
            audioContext.close();
            return;
          }
          analyser.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((sum, value) => sum + value, 0) / bufferLength;
          const currentTime = Date.now();
          totalSamples++;
          if (average > 5) {
            activeSamples++;
            maxSendLevel = Math.max(maxSendLevel, average);
          }
          if (currentTime - lastLogTime > 5e3) {
            const sendingActivity = totalSamples > 0 ? activeSamples / totalSamples * 100 : 0;
            this.debug.log(`\u{1F3A4} Audio SENDING to peer ${this.peerId.substring(0, 8)}:`, {
              trackEnabled: audioTrack.enabled,
              trackReadyState: audioTrack.readyState,
              trackMuted: audioTrack.muted,
              currentSendLevel: Math.round(average),
              maxSendLevel: Math.round(maxSendLevel),
              sendingActivityPercent: Math.round(sendingActivity),
              samplesAnalyzed: totalSamples,
              audioBeingSent: activeSamples > 0
            });
            lastLogTime = currentTime;
            totalSamples = 0;
            activeSamples = 0;
            maxSendLevel = 0;
          }
          if (audioTrack.readyState === "live") {
            requestAnimationFrame(monitorSending);
          }
        };
        requestAnimationFrame(monitorSending);
        this.debug.log(`\u{1F3A4} Audio sending monitoring started to peer ${this.peerId.substring(0, 8)}`);
      } catch (error) {
        this.debug.error(`\u{1F3A4} Failed to setup audio sending monitoring to peer ${this.peerId.substring(0, 8)}:`, error);
      }
    }
    /**
       * Get remote media stream
       */
    getRemoteStream() {
      return this.remoteStream;
    }
    /**
       * Get local media stream
       */
    getLocalStream() {
      return this.localStream;
    }
    /**
     * Allow remote streams to be emitted (called after crypto verification)
     */
    allowRemoteStreamEmission() {
      this.debug.log(`\u{1F513} CRYPTO: Allowing remote stream emission for ${this.peerId.substring(0, 8)}...`);
      this.allowRemoteStreams = true;
      while (this.pendingRemoteStreams.length > 0) {
        const streamEvent = this.pendingRemoteStreams.shift();
        this.debug.log(`\u{1F513} CRYPTO: Emitting buffered remote stream from ${streamEvent.peerId.substring(0, 8)}...`);
        this.emit("remoteStream", streamEvent);
      }
    }
    /**
     * Block remote streams (called when crypto is required but not verified)
     */
    blockRemoteStreamEmission() {
      if (typeof window !== "undefined" && window.DISABLE_CRYPTO_BLOCKING) {
        this.debug.log(`\u{1F513} CRYPTO: Video test mode - NOT blocking remote stream emission for ${this.peerId.substring(0, 8)}...`);
        return;
      }
      this.debug.log(`\u{1F512} CRYPTO: Blocking remote stream emission for ${this.peerId.substring(0, 8)}...`);
      this.allowRemoteStreams = false;
    }
    /**
       * Check if connection has video/audio capabilities
       */
    getMediaCapabilities() {
      const capabilities = {
        hasLocalVideo: false,
        hasLocalAudio: false,
        hasRemoteVideo: false,
        hasRemoteAudio: false
      };
      if (this.localStream) {
        capabilities.hasLocalVideo = this.localStream.getVideoTracks().length > 0;
        capabilities.hasLocalAudio = this.localStream.getAudioTracks().length > 0;
      }
      if (this.remoteStream) {
        capabilities.hasRemoteVideo = this.remoteStream.getVideoTracks().length > 0;
        capabilities.hasRemoteAudio = this.remoteStream.getAudioTracks().length > 0;
      }
      return capabilities;
    }
    getStatus() {
      if (this._forcedStatus) {
        return this._forcedStatus;
      }
      if (this.dataChannel && this.dataChannel.readyState === "closed") {
        return "disconnected";
      }
      if (this.connection) {
        const connectionState = this.connection.connectionState;
        if (connectionState === "connected") {
          if (this.dataChannel && this.dataChannel.readyState === "open" && this.dataChannelReady) {
            return "connected";
          } else if (this.dataChannel && this.dataChannel.readyState === "open") {
            return "connected";
          } else if (this.dataChannel && this.dataChannel.readyState === "connecting") {
            return "channel-connecting";
          } else {
            return "connected";
          }
        } else if (connectionState === "connecting") {
          if (this.dataChannel && this.dataChannel.readyState === "connecting") {
            return "channel-connecting";
          } else {
            return "connecting";
          }
        } else if (connectionState === "new") {
          return "connecting";
        } else {
          return connectionState;
        }
      }
      if (this.dataChannel) {
        if (this.dataChannel.readyState === "connecting") {
          return "channel-connecting";
        } else if (this.dataChannel.readyState === "closed") {
          return "disconnected";
        }
      }
      return "connecting";
    }
    getDetailedStatus() {
      const status = {
        connectionState: this.connection ? this.connection.connectionState : "no-connection",
        iceConnectionState: this.connection ? this.connection.iceConnectionState : "no-connection",
        dataChannelState: this.dataChannel ? this.dataChannel.readyState : "no-channel",
        dataChannelReady: this.dataChannelReady,
        isClosing: this.isClosing,
        overallStatus: this.getStatus()
      };
      if (this.remoteStream || this.localStream) {
        status.audioTracks = {
          remote: this.remoteStream ? this.remoteStream.getAudioTracks().length : 0,
          local: this.localStream ? this.localStream.getAudioTracks().length : 0
        };
        status.videoTracks = {
          remote: this.remoteStream ? this.remoteStream.getVideoTracks().length : 0,
          local: this.localStream ? this.localStream.getVideoTracks().length : 0
        };
      }
      return status;
    }
    /**
     * Restart ICE using signaling coordination (WebSocket or mesh)
     * This allows ICE restart to work even when the signaling server is down
     * by using the mesh for coordination
     */
    async restartIceViaSignaling() {
      if (!this.connection) {
        throw new Error("No connection to restart ICE for");
      }
      this.debug.log(`\u{1F504} Restarting ICE via signaling for ${this.peerId}`);
      try {
        this.connection.restartIce();
        const offer = await Promise.race([
          this.connection.createOffer({ iceRestart: true }),
          new Promise(
            (resolve, reject) => setTimeout(() => reject(new Error("ICE restart createOffer timeout")), 1e4)
          )
        ]);
        await Promise.race([
          this.connection.setLocalDescription(offer),
          new Promise(
            (resolve, reject) => setTimeout(() => reject(new Error("ICE restart setLocalDescription timeout")), 1e4)
          )
        ]);
        if (this.mesh && this.mesh.sendSignalingMessage) {
          await this.mesh.sendSignalingMessage({
            type: "ice-restart-offer",
            data: { offer }
          }, this.peerId);
          this.debug.log(`\u2705 ICE restart offer sent for ${this.peerId}`);
        } else {
          throw new Error("No signaling method available for ICE restart");
        }
      } catch (error) {
        this.debug.error(`Failed to restart ICE for ${this.peerId}:`, error);
        throw error;
      }
    }
    /**
     * Handle incoming ICE restart offers
     */
    async handleIceRestartOffer(offer) {
      if (!this.connection) {
        this.debug.error("Cannot handle ICE restart offer - no connection");
        return;
      }
      this.debug.log(`\u{1F504} Handling ICE restart offer from ${this.peerId}`);
      try {
        await Promise.race([
          this.connection.setRemoteDescription(offer),
          new Promise(
            (resolve, reject) => setTimeout(() => reject(new Error("ICE restart setRemoteDescription timeout")), 1e4)
          )
        ]);
        const answer = await Promise.race([
          this.connection.createAnswer(),
          new Promise(
            (resolve, reject) => setTimeout(() => reject(new Error("ICE restart createAnswer timeout")), 1e4)
          )
        ]);
        await Promise.race([
          this.connection.setLocalDescription(answer),
          new Promise(
            (resolve, reject) => setTimeout(() => reject(new Error("ICE restart setLocalDescription timeout")), 1e4)
          )
        ]);
        if (this.mesh && this.mesh.sendSignalingMessage) {
          await this.mesh.sendSignalingMessage({
            type: "ice-restart-answer",
            data: { answer }
          }, this.peerId);
          this.debug.log(`\u2705 ICE restart answer sent for ${this.peerId}`);
        }
      } catch (error) {
        this.debug.error(`Failed to handle ICE restart offer from ${this.peerId}:`, error);
        throw error;
      }
    }
    /**
     * Handle incoming ICE restart answers
     */
    async handleIceRestartAnswer(answer) {
      if (!this.connection) {
        this.debug.error("Cannot handle ICE restart answer - no connection");
        return;
      }
      this.debug.log(`\u{1F504} Handling ICE restart answer from ${this.peerId}`);
      try {
        await Promise.race([
          this.connection.setRemoteDescription(answer),
          new Promise(
            (resolve, reject) => setTimeout(() => reject(new Error("ICE restart setRemoteDescription timeout")), 1e4)
          )
        ]);
        this.debug.log(`\u2705 ICE restart completed for ${this.peerId}`);
      } catch (error) {
        this.debug.error(`Failed to handle ICE restart answer from ${this.peerId}:`, error);
        throw error;
      }
    }
    close() {
      this.isClosing = true;
      if (this.iceTimeoutId) {
        clearTimeout(this.iceTimeoutId);
        this.iceTimeoutId = null;
      }
      if (this.connection) {
        this.connection.close();
      }
    }
  };

  // src/ConnectionManager.js
  var ConnectionManager = class extends EventEmitter {
    constructor(mesh) {
      super();
      this.mesh = mesh;
      this.debug = DebugLogger_default.create("ConnectionManager");
      this.peers = /* @__PURE__ */ new Map();
      this.connectionAttempts = /* @__PURE__ */ new Map();
      this.pendingIceCandidates = /* @__PURE__ */ new Map();
      this.disconnectionInProgress = /* @__PURE__ */ new Set();
      this.cleanupInProgress = /* @__PURE__ */ new Set();
      this.lastConnectionAttempt = /* @__PURE__ */ new Map();
      this.activeRenegotiations = /* @__PURE__ */ new Set();
      this.renegotiationQueue = /* @__PURE__ */ new Map();
      this.maxConcurrentRenegotiations = 1;
      this.maxConnectionAttempts = 3;
      this.retryDelay = 500;
      this.startPeriodicCleanup();
      this.startStuckConnectionMonitoring();
      this.setupMeshEventListeners();
    }
    /**
     * Set up event listeners for mesh-level events
     */
    setupMeshEventListeners() {
      this.mesh.addEventListener("peerKeyAdded", (event) => {
        this.handlePeerKeyAdded(event.peerId);
      });
    }
    /**
     * Handle when a peer's crypto key is successfully added
     * @param {string} peerId - The peer ID whose key was added
     */
    async handlePeerKeyAdded(peerId) {
      this.debug.log(`\u{1F510} Key added for ${peerId.substring(0, 8)}... - crypto verification complete`);
      this.debug.log(`\u{1F510} Crypto verified for ${peerId.substring(0, 8)}... - user must manually invoke media to enable streams`);
    }
    async connectToPeer(targetPeerId) {
      this.debug.log(`connectToPeer called for ${targetPeerId.substring(0, 8)}...`);
      if (this.peers.has(targetPeerId)) {
        this.debug.log(`Already connected to ${targetPeerId.substring(0, 8)}...`);
        return;
      }
      if (this.mesh.peerDiscovery.isAttemptingConnection(targetPeerId)) {
        this.debug.log(`Already attempting connection to ${targetPeerId.substring(0, 8)}... via PeerDiscovery`);
        return;
      }
      const shouldBeInitiator = this.mesh.peerId > targetPeerId;
      if (!shouldBeInitiator) {
        const connectedCount = this.getConnectedPeerCount();
        const floor = this.mesh.connectivityFloor || 0;
        if (connectedCount < floor) {
          this.debug.log(`\u{1F504} INITIATOR OVERRIDE: Forcing initiation to ${targetPeerId.substring(0, 8)}... (connected ${connectedCount} < floor ${floor})`);
        } else {
          this.debug.log(`\u{1F504} INITIATOR LOGIC: Not becoming initiator for ${targetPeerId.substring(0, 8)}... (our ID smaller, connected ${connectedCount} >= floor ${floor})`);
          return;
        }
      }
      this.debug.log(`\u{1F504} INITIATOR LOGIC: Becoming initiator for ${targetPeerId.substring(0, 8)}... (our ID: ${this.mesh.peerId.substring(0, 8)}... is greater)`);
      if (!this.mesh.canAcceptMorePeers()) {
        this.debug.log(`Cannot connect to ${targetPeerId.substring(0, 8)}... (max peers reached: ${this.mesh.maxPeers})`);
        return;
      }
      const now = Date.now();
      const attempts = this.connectionAttempts.get(targetPeerId) || 0;
      if (attempts > 0) {
        const lastAttempt = this.lastConnectionAttempt.get(targetPeerId) || 0;
        const connectedCount = this.getConnectedPeerCount();
        const retryDelay = connectedCount === 0 ? 200 : this.retryDelay;
        if (now - lastAttempt < retryDelay) {
          const remaining = retryDelay - (now - lastAttempt);
          this.debug.log(`Connection to ${targetPeerId.substring(0, 8)}... on cooldown (${Math.round(remaining / 1e3)}s remaining, isolated: ${connectedCount === 0})`);
          return;
        }
      }
      if (attempts >= this.maxConnectionAttempts) {
        this.mesh.emit("statusChanged", { type: "warning", message: `Max connection attempts reached for ${targetPeerId.substring(0, 8)}...` });
        this.mesh.peerDiscovery.removeDiscoveredPeer(targetPeerId);
        return;
      }
      this.debug.log(`Starting connection to ${targetPeerId.substring(0, 8)}... (attempt ${attempts + 1})`);
      this.connectionAttempts.set(targetPeerId, attempts + 1);
      this.lastConnectionAttempt.set(targetPeerId, now);
      this.mesh.peerDiscovery.trackConnectionAttempt(targetPeerId);
      try {
        this.debug.log(`Creating PeerConnection for ${targetPeerId.substring(0, 8)}...`);
        const options = {
          localStream: null,
          // Always null - media must be manually added later
          // ALWAYS enable both audio and video transceivers for maximum compatibility
          // This allows peers to receive media even if they don't have media when connecting
          enableAudio: true,
          enableVideo: true
          // allowRemoteStreams defaults to false - streams only invoked when user clicks "Start Media"
        };
        this.debug.log(`\u{1F504} INITIATOR SETUP: Creating PeerConnection(${targetPeerId.substring(0, 8)}..., isInitiator=true)`);
        const peerConnection = new PeerConnection(targetPeerId, true, options);
        this.setupPeerConnectionHandlers(peerConnection);
        this.peers.set(targetPeerId, peerConnection);
        this.debug.log(`Creating WebRTC connection for ${targetPeerId.substring(0, 8)}...`);
        await peerConnection.createConnection();
        this.debug.log(`Creating offer for ${targetPeerId.substring(0, 8)}...`);
        const offer = await peerConnection.createOffer();
        this.debug.log(`Offer created for ${targetPeerId.substring(0, 8)}...`, {
          type: offer.type,
          sdpLength: offer.sdp?.length || 0,
          hasAudio: offer.sdp?.includes("m=audio") || false,
          hasVideo: offer.sdp?.includes("m=video") || false
        });
        this.debug.log(`Sending offer to ${targetPeerId.substring(0, 8)}...`);
        await this.mesh.sendSignalingMessage({
          type: "offer",
          data: offer
        }, targetPeerId);
        this.mesh.emit("statusChanged", { type: "info", message: `Offer sent to ${targetPeerId.substring(0, 8)}...` });
      } catch (error) {
        this.debug.error("Failed to connect to peer:", error);
        const isConnectionTimeout = error.message?.includes("timeout");
        if (!isConnectionTimeout) {
          this.mesh.emit("statusChanged", {
            type: "error",
            message: `Failed to connect to ${targetPeerId.substring(0, 8)}...: ${error.message}`
          });
        }
        this.cleanupFailedConnection(targetPeerId);
      }
    }
    /**
     * Force connection attempt ignoring standard initiator lexicographic rule (used for connectivity floor).
     */
    async connectToPeerOverride(targetPeerId) {
      if (this.peers.has(targetPeerId)) return;
      const connectedCount = this.getConnectedPeerCount();
      const floor = this.mesh.connectivityFloor || 0;
      if (connectedCount >= floor) return;
      this.debug.log(`\u26A1 OVERRIDE CONNECT: initiating to ${targetPeerId.substring(0, 8)}... (connected ${connectedCount} < floor ${floor})`);
      this.mesh.peerDiscovery.clearConnectionAttempt(targetPeerId);
      const options = {
        localStream: null,
        enableAudio: true,
        enableVideo: true
      };
      const peerConnection = new PeerConnection(targetPeerId, true, options);
      this.setupPeerConnectionHandlers(peerConnection);
      this.peers.set(targetPeerId, peerConnection);
      try {
        await peerConnection.createConnection();
        const offer = await peerConnection.createOffer();
        await this.mesh.sendSignalingMessage({ type: "offer", data: offer }, targetPeerId);
      } catch (e) {
        this.debug.warn(`Override connection failed to ${targetPeerId.substring(0, 8)}...: ${e.message}`);
        this.mesh.peerDiscovery.removeDiscoveredPeer(targetPeerId);
        this.peers.delete(targetPeerId);
      }
    }
    cleanupFailedConnection(peerId) {
      this.debug.log(`Cleaning up failed connection for ${peerId.substring(0, 8)}...`);
      let peerRemoved = false;
      if (this.peers.has(peerId)) {
        const peer = this.peers.get(peerId);
        const status = peer.getStatus();
        this.debug.log(`Removing peer ${peerId.substring(0, 8)}... with status: ${status}`);
        try {
          if (typeof peer.markAsFailed === "function") {
            peer.markAsFailed("failed");
          }
          peer.close();
        } catch (error) {
          this.debug.error("Error closing failed connection:", error);
        }
        this.peers.delete(peerId);
        peerRemoved = true;
        this.debug.log(`Successfully removed peer ${peerId.substring(0, 8)}... from peers Map`);
      } else {
        this.debug.log(`Peer ${peerId.substring(0, 8)}... was not in peers Map`);
      }
      this.mesh.peerDiscovery.clearConnectionAttempt(peerId);
      this.pendingIceCandidates.delete(peerId);
      if (peerRemoved) {
        this.debug.log(`Emitting peersUpdated after removing ${peerId.substring(0, 8)}...`);
        this.emit("peersUpdated");
      }
    }
    cleanupRaceCondition(peerId) {
      if (this.peers.has(peerId)) {
        const peer = this.peers.get(peerId);
        try {
          peer.close();
        } catch (error) {
          this.debug.error("Error closing race condition connection:", error);
        }
        this.peers.delete(peerId);
      }
      this.pendingIceCandidates.delete(peerId);
      this.emit("peersUpdated");
    }
    setupPeerConnectionHandlers(peerConnection) {
      peerConnection.addEventListener("iceCandidate", async (event) => {
        try {
          this.debug.log("Sending ICE candidate to", event.peerId);
          await this.mesh.sendSignalingMessage({
            type: "ice-candidate",
            data: event.candidate
          }, event.peerId);
        } catch (error) {
          this.debug.error("Failed to send ICE candidate:", error);
        }
      });
      peerConnection.addEventListener("connected", (event) => {
        this.debug.log(`[EVENT] Connected event received from ${event.peerId.substring(0, 8)}...`);
        this.connectionAttempts.delete(event.peerId);
        this.mesh.emit("statusChanged", { type: "info", message: `WebRTC connected to ${event.peerId.substring(0, 8)}...` });
        this.mesh.peerDiscovery.clearConnectionAttempt(event.peerId);
        this.mesh.peerDiscovery.updateDiscoveryTimestamp(event.peerId);
        this.emit("peersUpdated");
      });
      peerConnection.addEventListener("disconnected", (event) => {
        this.mesh.emit("statusChanged", { type: "info", message: `Disconnected from ${event.peerId.substring(0, 8)}...` });
        this.handlePeerDisconnection(event.peerId, event.reason);
      });
      peerConnection.addEventListener("dataChannelOpen", (event) => {
        this.debug.log(`[EVENT] DataChannelOpen event received from ${event.peerId.substring(0, 8)}...`);
        this.mesh.emit("statusChanged", { type: "info", message: `Data channel ready with ${event.peerId.substring(0, 8)}...` });
        this.emit("peersUpdated");
        if (this.mesh.peerDiscovery) {
          this.mesh.peerDiscovery.onConnectionEstablished();
        }
        if (this.mesh.cryptoManager) {
          const hasExistingKey = this.mesh.cryptoManager.peerKeys.has(event.peerId);
          if (!hasExistingKey) {
            this.debug.log(`\u{1F510} Automatically exchanging keys with newly connected peer ${event.peerId.substring(0, 8)}...`);
            setTimeout(() => {
              this.mesh.exchangeKeysWithPeer(event.peerId).catch((error) => {
                this.debug.error(`\u{1F510} Failed to exchange keys with ${event.peerId.substring(0, 8)}:`, error);
              });
            }, 0);
          } else {
            this.debug.log(`\u{1F510} Skipping key exchange with ${event.peerId.substring(0, 8)}... - key already exists`);
          }
        }
        this.mesh.emit("peerConnected", { peerId: event.peerId });
      });
      peerConnection.addEventListener("message", (event) => {
        this.handleIncomingMessage(event.message, event.peerId);
      });
      peerConnection.addEventListener("remoteStream", (event) => {
        this.debug.log(`[EVENT] Remote stream received from ${event.peerId.substring(0, 8)}...`);
        this.emit("remoteStream", event);
        this.debug.log("\u{1F504} MEDIA FORWARDING: Disabled to prevent renegotiation conflicts with 3+ peers");
      });
      peerConnection.addEventListener("streamReceived", (event) => {
        this.debug.log(`[EVENT] Data stream received from ${event.peerId.substring(0, 8)}...`);
        this.mesh.emit("streamReceived", event);
      });
      peerConnection.addEventListener("streamCompleted", (event) => {
        this.debug.log(`[EVENT] Data stream completed from ${event.peerId.substring(0, 8)}...`);
        this.mesh.emit("streamCompleted", event);
      });
      peerConnection.addEventListener("streamAborted", (event) => {
        this.debug.log(`[EVENT] Data stream aborted from ${event.peerId.substring(0, 8)}...`);
        this.mesh.emit("streamAborted", event);
      });
      peerConnection.addEventListener("renegotiationNeeded", async (event) => {
        this.debug.log(`\u{1F504} Renegotiation needed for ${event.peerId.substring(0, 8)}...`);
        if (this.activeRenegotiations.size >= this.maxConcurrentRenegotiations) {
          this.debug.log(`\u{1F504} QUEUE: Renegotiation for ${event.peerId.substring(0, 8)}... queued (${this.activeRenegotiations.size} active)`);
          this.renegotiationQueue.set(event.peerId, event);
          return;
        }
        await this._performRenegotiation(peerConnection, event);
      });
    }
    handlePeerDisconnection(peerId, reason) {
      if (this.disconnectionInProgress.has(peerId)) {
        this.debug.log(`Disconnection already in progress for ${peerId.substring(0, 8)}..., skipping duplicate`);
        return;
      }
      this.debug.log(`Handling peer disconnection: ${peerId.substring(0, 8)}... (${reason})`);
      this.disconnectionInProgress.add(peerId);
      try {
        if (this.peers.has(peerId)) {
          const peerConnection = this.peers.get(peerId);
          try {
            peerConnection.close();
          } catch (error) {
            this.debug.error("Error closing peer connection:", error);
          }
          this.peers.delete(peerId);
        }
        this.mesh.peerDiscovery.clearConnectionAttempt(peerId);
        this.pendingIceCandidates.delete(peerId);
        this.mesh.evictionManager.clearEvictionTracking(peerId);
        if (reason === "left network" || reason === "manually removed") {
          this.mesh.peerDiscovery.removeDiscoveredPeer(peerId);
          this.connectionAttempts.delete(peerId);
        } else if (reason === "connection failed" || reason === "connection disconnected" || reason === "ICE connection closed") {
          this.connectionAttempts.delete(peerId);
          this.debug.log(`Cleared connection attempt for ${peerId.substring(0, 8)}... due to ${reason} - will retry later`);
        }
        this.mesh.emit("peerDisconnected", { peerId, reason });
        this.emit("peersUpdated");
        const connectedCount = this.getConnectedPeerCount();
        const needsOptimization = connectedCount === 0;
        if (needsOptimization && this.mesh.autoDiscovery && this.mesh.peerDiscovery.getDiscoveredPeers().length > 0) {
          this.debug.log(`Completely disconnected (${connectedCount}/${this.mesh.maxPeers}), scheduling mesh optimization`);
          setTimeout(() => {
            const currentCount = this.getConnectedPeerCount();
            if (currentCount === 0) {
              this.debug.log(`Still completely disconnected (${currentCount}/${this.mesh.maxPeers}), attempting optimization`);
              this.mesh.peerDiscovery.optimizeMeshConnections(this.peers);
            } else {
              this.debug.log(`Connection recovered (${currentCount}/${this.mesh.maxPeers}), skipping optimization`);
            }
          }, 500);
        } else {
          this.debug.log(`Peer count appropriate at ${connectedCount}/${this.mesh.maxPeers}, no optimization needed`);
        }
      } finally {
        this.disconnectionInProgress.delete(peerId);
      }
    }
    disconnectAllPeers() {
      this.peers.forEach((peerConnection, peerId) => {
        peerConnection.close();
        this.mesh.emit("peerDisconnected", { peerId, reason: "mesh disconnected" });
      });
    }
    disconnectPeer(peerId, reason) {
      this.handlePeerDisconnection(peerId, reason);
    }
    removePeer(peerId) {
      this.mesh.peerDiscovery.removeDiscoveredPeer(peerId);
      this.mesh.peerDiscovery.clearConnectionAttempt(peerId);
      this.connectionAttempts.delete(peerId);
      if (this.peers.has(peerId)) {
        const peer = this.peers.get(peerId);
        if (peer.connection) {
          peer.connection.close();
        }
        this.peers.delete(peerId);
        this.mesh.emit("peerDisconnected", { peerId, reason: "manually removed" });
      }
      this.emit("peersUpdated");
    }
    canAcceptMorePeers() {
      const connectedCount = this.getConnectedPeerCount();
      const totalPeerCount = this.peers.size;
      if (connectedCount >= this.mesh.maxPeers) {
        this.debug.log(`At or over capacity: ${connectedCount}/${this.mesh.maxPeers} connected, rejecting new connections`);
        return false;
      }
      if (totalPeerCount >= this.mesh.maxPeers) {
        this.debug.log(`Total peer count at capacity: ${totalPeerCount}/${this.mesh.maxPeers}, rejecting new connections`);
        return false;
      }
      return true;
      this.debug.log(`Cannot accept more peers: ${connectedCount}/${this.mesh.maxPeers} connected, ${totalPeerCount} total peers in Map`);
      return false;
    }
    /**
       * Count peers that are in stale/non-viable states
       */
    getStalePeerCount() {
      const now = Date.now();
      const STALE_THRESHOLD = 45e3;
      return Array.from(this.peers.values()).filter((peerConnection) => {
        const status = peerConnection.getStatus();
        const connectionAge = now - peerConnection.connectionStartTime;
        return connectionAge > STALE_THRESHOLD && (status === "failed" || status === "disconnected" || status === "closed");
      }).length;
    }
    getConnectedPeerCount() {
      return Array.from(this.peers.values()).filter(
        (peerConnection) => peerConnection.getStatus() === "connected"
      ).length;
    }
    getConnectedPeers() {
      return Array.from(this.peers.values()).filter(
        (peerConnection) => peerConnection.getStatus() === "connected"
      );
    }
    getPeers() {
      return Array.from(this.peers.entries()).map(([peerId, peerConnection]) => ({
        peerId,
        status: peerConnection.getStatus(),
        isInitiator: peerConnection.isInitiator,
        connectionStartTime: peerConnection.connectionStartTime
      }));
    }
    hasPeer(peerId) {
      return this.peers.has(peerId);
    }
    getPeer(peerId) {
      return this.peers.get(peerId);
    }
    sendMessage(content) {
      if (!content || typeof content !== "string") {
        this.debug.error("Invalid message content:", content);
        return 0;
      }
      this.debug.log(`Broadcasting message via gossip protocol: "${content}"`);
      const messageId = this.mesh.gossipManager.broadcastMessage(content, "chat");
      if (messageId) {
        const connectedCount = this.getConnectedPeerCount();
        this.debug.log(`Message broadcasted via gossip to ${connectedCount} directly connected peer(s), will propagate to entire network`);
        return connectedCount;
      } else {
        this.debug.error("Failed to broadcast message via gossip protocol");
        return 0;
      }
    }
    /**
       * Send a message directly to a specific peer via data channel
       * @param {string} peerId - The peer ID to send to
       * @param {Object} message - The message object to send
       * @returns {boolean} - True if message was sent successfully
       */
    sendDirectMessage(peerId, message) {
      const peerConnection = this.peers.get(peerId);
      if (!peerConnection) {
        this.debug.warn(`Cannot send direct message to ${peerId?.substring(0, 8)}: peer not connected`);
        return false;
      }
      try {
        this.debug.log(`\u{1F4E4} Sending direct message to ${peerId?.substring(0, 8)}:`, message);
        peerConnection.sendMessage(message);
        return true;
      } catch (error) {
        this.debug.error(`Failed to send direct message to ${peerId?.substring(0, 8)}:`, error);
        return false;
      }
    }
    async handleIceCandidate(candidate, fromPeerId) {
      this.debug.log("Handling ICE candidate from", fromPeerId);
      const peerConnection = this.peers.get(fromPeerId);
      if (peerConnection) {
        try {
          await peerConnection.handleIceCandidate(candidate);
        } catch (error) {
          this.debug.error("Failed to add ICE candidate:", error);
        }
      } else {
        this.debug.log("Buffering ICE candidate for", fromPeerId, "(no peer connection yet)");
        if (!this.pendingIceCandidates.has(fromPeerId)) {
          this.pendingIceCandidates.set(fromPeerId, []);
        }
        this.pendingIceCandidates.get(fromPeerId).push(candidate);
      }
    }
    async processPendingIceCandidates(peerId) {
      const candidates = this.pendingIceCandidates.get(peerId);
      if (candidates && candidates.length > 0) {
        this.debug.log(`Processing ${candidates.length} buffered ICE candidates for`, peerId);
        const peerConnection = this.peers.get(peerId);
        if (peerConnection) {
          for (const candidate of candidates) {
            try {
              await peerConnection.handleIceCandidate(candidate);
            } catch (error) {
              this.debug.error("Failed to add buffered ICE candidate:", error);
            }
          }
          this.pendingIceCandidates.delete(peerId);
        }
      }
    }
    cleanup() {
      this.stopPeriodicCleanup();
      this.peers.clear();
      this.connectionAttempts.clear();
      this.pendingIceCandidates.clear();
      this.disconnectionInProgress.clear();
      this.cleanupInProgress.clear();
      this.lastConnectionAttempt.clear();
    }
    /**
       * Start periodic cleanup of stale peer connections
       */
    startPeriodicCleanup() {
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
      }
      if (environmentDetector.isBrowser) {
        this.cleanupInterval = window.setInterval(() => {
          this.cleanupStalePeers();
        }, 3e4);
      } else {
        this.cleanupInterval = setInterval(() => {
          this.cleanupStalePeers();
        }, 3e4);
      }
    }
    /**
       * Stop periodic cleanup
       */
    stopPeriodicCleanup() {
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = null;
      }
    }
    /**
       * Clean up peers that are in non-viable states for too long
       */
    cleanupStalePeers() {
      const now = Date.now();
      const STALE_THRESHOLD = 6e4;
      const DISCONNECTED_THRESHOLD = 5e3;
      const peersToCleanup = [];
      this.peers.forEach((peerConnection, peerId) => {
        const status = peerConnection.getStatus();
        const connectionAge = now - peerConnection.connectionStartTime;
        if (status === "disconnected" && connectionAge > DISCONNECTED_THRESHOLD) {
          this.debug.log(`Disconnected peer detected: ${peerId.substring(0, 8)}... (status: ${status}, age: ${Math.round(connectionAge / 1e3)}s)`);
          peersToCleanup.push(peerId);
        } else if (connectionAge > STALE_THRESHOLD) {
          if (status === "connecting" || status === "channel-connecting" || status === "failed" || status === "closed") {
            this.debug.log(`Stale peer detected: ${peerId.substring(0, 8)}... (status: ${status}, age: ${Math.round(connectionAge / 1e3)}s)`);
            peersToCleanup.push(peerId);
          }
        }
      });
      if (peersToCleanup.length > 0) {
        this.debug.log(`Cleaning up ${peersToCleanup.length} stale peer(s)`);
        peersToCleanup.forEach((peerId) => {
          this.cleanupFailedConnection(peerId);
        });
      }
    }
    /**
       * Force cleanup of peers that are not in connected state (for debugging)
       */
    forceCleanupInvalidPeers() {
      this.debug.log("Force cleaning up peers not in connected state...");
      const peersToRemove = [];
      this.peers.forEach((peerConnection, peerId) => {
        const status = peerConnection.getStatus();
        if (status !== "connected") {
          this.debug.log(`Found peer ${peerId.substring(0, 8)}... in invalid state: ${status}`);
          peersToRemove.push(peerId);
        }
      });
      peersToRemove.forEach((peerId) => {
        this.debug.log(`Force removing peer ${peerId.substring(0, 8)}...`);
        this.cleanupFailedConnection(peerId);
      });
      if (peersToRemove.length > 0) {
        this.debug.log(`Force cleaned up ${peersToRemove.length} invalid peers`);
        this.emit("peersUpdated");
      }
      return peersToRemove.length;
    }
    /**
       * Get a summary of all peer states for debugging
       */
    getPeerStateSummary() {
      const summary = {
        total: this.peers.size,
        connected: 0,
        connecting: 0,
        channelConnecting: 0,
        failed: 0,
        disconnected: 0,
        closed: 0,
        other: 0,
        stale: this.getStalePeerCount()
      };
      this.peers.forEach((peerConnection) => {
        const status = peerConnection.getStatus();
        switch (status) {
          case "connected":
            summary.connected++;
            break;
          case "connecting":
            summary.connecting++;
            break;
          case "channel-connecting":
            summary.channelConnecting++;
            break;
          case "failed":
            summary.failed++;
            break;
          case "disconnected":
            summary.disconnected++;
            break;
          case "closed":
            summary.closed++;
            break;
          default:
            summary.other++;
        }
      });
      return summary;
    }
    getDetailedPeerStatus() {
      const peerStatuses = {};
      this.peers.forEach((peerConnection, peerId) => {
        peerStatuses[peerId.substring(0, 8) + "..."] = {
          status: peerConnection.getStatus(),
          isInitiator: peerConnection.isInitiator,
          dataChannelReady: peerConnection.dataChannelReady,
          connectionStartTime: peerConnection.connectionStartTime,
          connectionState: peerConnection.connection?.connectionState,
          iceConnectionState: peerConnection.connection?.iceConnectionState
        };
      });
      return peerStatuses;
    }
    // Get all peer connections
    getAllConnections() {
      return Array.from(this.peers.values());
    }
    /**
       * Route incoming messages based on their type
       */
    handleIncomingMessage(message, fromPeerId) {
      if (!message || typeof message !== "object") {
        this.debug.warn("Received invalid message from", fromPeerId?.substring(0, 8));
        return;
      }
      if (message.type === "binary" && message.data instanceof Uint8Array) {
        this.debug.log(`\u{1F4E6} Received binary message (${message.size} bytes) from ${fromPeerId.substring(0, 8)}...`);
        this.mesh.emit("binaryMessageReceived", {
          from: fromPeerId,
          data: message.data,
          size: message.size,
          timestamp: Date.now()
        });
        return;
      }
      const filteredMessageTypes = /* @__PURE__ */ new Set([
        "signaling-relay",
        "peer-announce-relay",
        "bootstrap-keepalive",
        "client-peer-announcement",
        "cross-bootstrap-signaling"
      ]);
      const isFilteredMessage = filteredMessageTypes.has(message.type);
      if (isFilteredMessage) {
        this.debug.log(`\u{1F507} FILTER: Processing filtered message type '${message.type}' from ${fromPeerId?.substring(0, 8)} (not emitted to UI)`);
      }
      switch (message.type) {
        case "gossip":
          this.mesh.gossipManager.handleGossipMessage(message, fromPeerId).catch((error) => {
            this.debug.error("Error handling gossip message:", error);
          });
          break;
        case "eviction":
          this.handleEvictionMessage(message, fromPeerId);
          break;
        case "dht":
          if (this.mesh.webDHT) {
            this.mesh.webDHT.handleMessage(message, fromPeerId);
          }
          break;
        case "renegotiation-offer":
          this.handleRenegotiationOffer(message, fromPeerId);
          break;
        case "renegotiation-answer":
          this.handleRenegotiationAnswer(message, fromPeerId);
          break;
        case "signaling":
          this.debug.log(`\u{1F504} MESH SIGNALING: Received ${message.data?.type} from ${fromPeerId?.substring(0, 8)}...`);
          if (message.data && message.data.type) {
            const signalingMessage = {
              type: message.data.type,
              data: message.data.data,
              fromPeerId: message.fromPeerId || fromPeerId,
              targetPeerId: this.mesh.peerId,
              timestamp: message.timestamp
            };
            this.mesh.signalingHandler.handleSignalingMessage(signalingMessage);
          }
          break;
        case "signaling-relay":
          this.debug.log(`\u{1F507} FILTER: Processing signaling-relay from ${fromPeerId?.substring(0, 8)} (filtered from UI)`);
          if (message.data && message.targetPeerId === this.mesh.peerId) {
            this.mesh.signalingHandler.handleSignalingMessage({
              type: message.data.type,
              data: message.data.data,
              fromPeerId: message.fromPeerId || fromPeerId,
              targetPeerId: message.targetPeerId,
              timestamp: message.timestamp
            });
          }
          return;
        // Early return to prevent fallback to gossip handler
        case "peer-announce-relay":
          this.debug.log(`\u{1F507} FILTER: Processing peer-announce-relay from ${fromPeerId?.substring(0, 8)} (filtered from UI)`);
          if (message.data && this.mesh.signalingHandler) {
            this.mesh.signalingHandler.handlePeerAnnouncement(message.data, fromPeerId);
          }
          return;
        // Early return to prevent fallback to gossip handler
        case "bootstrap-keepalive":
          this.debug.log(`\u{1F507} FILTER: Processing bootstrap-keepalive from ${fromPeerId?.substring(0, 8)} (filtered from UI)`);
          if (this.mesh.peerDiscovery) {
            this.mesh.peerDiscovery.updateDiscoveryTimestamp(fromPeerId);
          }
          return;
        // Early return to prevent fallback to gossip handler
        case "client-peer-announcement":
          this.debug.log(`\u{1F507} FILTER: Processing client-peer-announcement from ${fromPeerId?.substring(0, 8)} (filtered from UI)`);
          if (message.clientPeerId && this.mesh.signalingHandler) {
            this.mesh.signalingHandler.handlePeerAnnouncement(message.clientPeerId);
          }
          return;
        // Early return to prevent fallback to gossip handler
        case "cross-bootstrap-signaling":
          this.debug.log(`\u{1F507} FILTER: Processing cross-bootstrap-signaling from ${fromPeerId?.substring(0, 8)} (filtered from UI)`);
          if (message.originalMessage && message.targetPeerId === this.mesh.peerId && this.mesh.signalingHandler) {
            this.mesh.signalingHandler.handleSignalingMessage({
              type: message.originalMessage.type,
              data: message.originalMessage.data,
              fromPeerId: message.originalMessage.fromPeerId || fromPeerId,
              targetPeerId: message.targetPeerId,
              timestamp: message.originalMessage.timestamp || message.timestamp
            });
          }
          return;
        // Early return to prevent fallback to gossip handler
        default:
          if (!isFilteredMessage) {
            this.debug.warn(`Unknown message type '${message.type}' from ${fromPeerId?.substring(0, 8)}, trying gossip handler`);
            this.mesh.gossipManager.handleGossipMessage(message, fromPeerId).catch((error) => {
              this.debug.error("Error handling unknown message as gossip:", error);
            });
          } else {
            this.debug.log(`\u{1F507} FILTER: Filtered message type '${message.type}' processed but not emitted`);
          }
          break;
      }
    }
    /**
       * Handle eviction messages
       */
    handleEvictionMessage(message, fromPeerId) {
      this.debug.log(`Received eviction notice from ${fromPeerId?.substring(0, 8)}: ${message.reason}`);
      this.mesh.emit("peerEvicted", {
        peerId: fromPeerId,
        reason: message.reason,
        initiatedByPeer: true
      });
      const peerConnection = this.peers.get(fromPeerId);
      if (peerConnection) {
        peerConnection.close();
        this.peers.delete(fromPeerId);
      }
    }
    /**
     * Perform a single renegotiation with conflict prevention
     * @private
     */
    async _performRenegotiation(peerConnection, event) {
      const peerId = event.peerId;
      this.activeRenegotiations.add(peerId);
      try {
        this.debug.log(`\u{1F504} ACTIVE: Starting renegotiation for ${peerId.substring(0, 8)}... (${this.activeRenegotiations.size} active)`);
        const signalingState = peerConnection.connection.signalingState;
        if (signalingState !== "stable" && signalingState !== "have-local-offer") {
          this.debug.log(`Skipping renegotiation for ${peerId.substring(0, 8)}... - connection in unsupported state (${signalingState})`);
          return;
        }
        if (peerConnection.connection.connectionState !== "connected") {
          this.debug.log(`Skipping renegotiation for ${peerId.substring(0, 8)}... - not connected (${peerConnection.connection.connectionState})`);
          return;
        }
        this.debug.log(`\u{1F504} Creating renegotiation offer for ${peerId.substring(0, 8)}... (signaling state: ${signalingState})`);
        const offer = await peerConnection.connection.createOffer();
        this.debug.log("\u{1F50D} RENEGOTIATION OFFER SDP DEBUG:");
        this.debug.log(`   SDP length: ${offer.sdp.length}`);
        this.debug.log(`   Contains video: ${offer.sdp.includes("m=video")}`);
        this.debug.log(`   Contains audio: ${offer.sdp.includes("m=audio")}`);
        await peerConnection.connection.setLocalDescription(offer);
        await this.mesh.sendSignalingMessage({
          type: "renegotiation-offer",
          data: offer
        }, peerId);
        this.debug.log(`\u2705 ACTIVE: Sent renegotiation offer to ${peerId.substring(0, 8)}...`);
      } catch (error) {
        this.debug.error(`\u274C ACTIVE: Failed to renegotiate with ${peerId.substring(0, 8)}...`, error);
      } finally {
        this.activeRenegotiations.delete(peerId);
        this.debug.log(`\u{1F504} ACTIVE: Completed renegotiation for ${peerId.substring(0, 8)}... (${this.activeRenegotiations.size} active)`);
        this._processRenegotiationQueue();
      }
    }
    /**
     * Process the next renegotiation in the queue
     * @private
     */
    _processRenegotiationQueue() {
      if (this.activeRenegotiations.size >= this.maxConcurrentRenegotiations || this.renegotiationQueue.size === 0) {
        return;
      }
      const [nextPeerId, nextEvent] = this.renegotiationQueue.entries().next().value;
      this.renegotiationQueue.delete(nextPeerId);
      const peerConnection = this.peers.get(nextPeerId);
      if (peerConnection) {
        this.debug.log(`\u{1F504} QUEUE: Processing queued renegotiation for ${nextPeerId.substring(0, 8)}...`);
        this._performRenegotiation(peerConnection, nextEvent);
      }
    }
    /**
     * Handle renegotiation offers from peers
     */
    async handleRenegotiationOffer(message, fromPeerId) {
      this.debug.log(`\u{1F504} Handling renegotiation offer via mesh from ${fromPeerId.substring(0, 8)}...`);
      const peerConnection = this.peers.get(fromPeerId);
      if (!peerConnection) {
        this.debug.error(`No peer connection found for renegotiation from ${fromPeerId.substring(0, 8)}...`);
        return;
      }
      try {
        const answer = await peerConnection.handleOffer(message.data);
        this.debug.log(`\u2705 Renegotiation offer processed, sending answer to ${fromPeerId.substring(0, 8)}...`);
        await this.mesh.sendSignalingMessage({
          type: "renegotiation-answer",
          data: answer
        }, fromPeerId);
        this.debug.log(`\u2705 Renegotiation completed via mesh with ${fromPeerId.substring(0, 8)}...`);
      } catch (error) {
        this.debug.error(`\u274C Failed to handle renegotiation offer via mesh from ${fromPeerId.substring(0, 8)}...`, error);
      }
    }
    async handleRenegotiationAnswer(message, fromPeerId) {
      this.debug.log(`\u{1F504} Handling renegotiation answer via mesh from ${fromPeerId.substring(0, 8)}...`);
      const peerConnection = this.peers.get(fromPeerId);
      if (!peerConnection) {
        this.debug.error(`No peer connection found for renegotiation answer from ${fromPeerId.substring(0, 8)}...`);
        return;
      }
      try {
        await peerConnection.handleAnswer(message.data);
        this.debug.log(`\u2705 Renegotiation answer processed from ${fromPeerId.substring(0, 8)}... - renegotiation complete`);
      } catch (error) {
        this.debug.error(`\u274C Failed to handle renegotiation answer via mesh from ${fromPeerId.substring(0, 8)}...`, error);
      }
    }
    /**
     * Monitor and fix stuck connections that remain in "have-local-offer" state
     * This is called periodically to detect and fix connections that get stuck
     */
    monitorAndFixStuckConnections() {
      if (!this.mesh.connected) return;
      const stuckConnections = [];
      for (const [peerId, peerConnection] of this.peers) {
        if (peerConnection.connection?.signalingState === "have-local-offer") {
          const connectionAge = Date.now() - peerConnection.connectionStartTime;
          if (connectionAge > 1e4) {
            stuckConnections.push(peerId);
          }
        }
      }
      if (stuckConnections.length > 0) {
        this.debug.log(`\u{1F6A8} STUCK MONITOR: Found ${stuckConnections.length} stuck connections - forcing recovery`);
        if (typeof window !== "undefined" && window.location?.hostname === "localhost") {
          console.warn("\u26A0\uFE0F LOCAL TESTING: WebRTC connections on localhost require media permissions!");
          console.warn('   Go to the Media tab and click "Start Media" to grant permissions.');
          console.warn("   See docs/LOCAL_TESTING.md for details.");
        }
        for (const peerId of stuckConnections) {
          this.forceConnectionRecovery(peerId).catch((error) => {
            this.debug.error(`Failed to recover stuck connection for ${peerId}:`, error);
          });
        }
      }
    }
    /**
     * Force recovery of a stuck connection by completely recreating it
     */
    async forceConnectionRecovery(peerId) {
      const peerConnection = this.getPeer(peerId);
      if (!peerConnection) {
        this.debug.error(`Cannot recover - peer ${peerId} not found`);
        return null;
      }
      this.debug.log(`\u{1F504} FORCE RECOVERY: Completely recreating connection for ${peerId.substring(0, 8)}...`);
      try {
        const currentLocalStream = peerConnection.getLocalStream();
        peerConnection.close();
        this.peers.delete(peerId);
        const freshConnection = await this.connectToPeer(peerId, false, {
          localStream: currentLocalStream
        });
        if (freshConnection && currentLocalStream) {
          await freshConnection.setLocalStream(currentLocalStream);
          this.debug.log(`\u2705 FORCE RECOVERY: Fresh connection created with media for ${peerId.substring(0, 8)}...`);
        }
        return freshConnection;
      } catch (error) {
        this.debug.error(`\u274C FORCE RECOVERY: Failed to recreate connection for ${peerId.substring(0, 8)}...`, error);
        throw error;
      }
    }
    /**
     * Start monitoring for stuck connections
     */
    startStuckConnectionMonitoring() {
      setInterval(() => {
        this.monitorAndFixStuckConnections();
      }, 2e3);
      this.debug.log("\u{1F50D} Started stuck connection monitoring");
    }
    /**
     * Forward a received stream to all other connected peers (except the sender)
     * This implements media forwarding through the mesh topology
     * @param {MediaStream} stream - The stream to forward
     * @param {string} sourcePeerId - The peer ID that sent the stream (don't forward back to them)
     * @private
     */
    async _forwardStreamToOtherPeers(stream, sourcePeerId) {
      if (!stream || !sourcePeerId) {
        this.debug.warn("Cannot forward stream - invalid parameters");
        return;
      }
      this.debug.log(`\u{1F504} FORWARD STREAM: Forwarding stream from ${sourcePeerId.substring(0, 8)}... to other connected peers`);
      const originalSourcePeerId = stream._peerPigeonSourcePeerId || sourcePeerId;
      let forwardCount = 0;
      for (const [peerId, connection] of this.peers) {
        if (peerId === sourcePeerId) {
          this.debug.log(`\u{1F504} FORWARD STREAM: Skipping source peer ${peerId.substring(0, 8)}...`);
          continue;
        }
        if (peerId === originalSourcePeerId) {
          this.debug.log(`\u{1F504} FORWARD STREAM: Skipping original stream creator ${peerId.substring(0, 8)}...`);
          continue;
        }
        if (connection.getStatus() !== "connected") {
          this.debug.log(`\u{1F504} FORWARD STREAM: Skipping disconnected peer ${peerId.substring(0, 8)}...`);
          continue;
        }
        try {
          this.debug.log(`\u{1F504} FORWARD STREAM: Setting forwarded stream for peer ${peerId.substring(0, 8)}...`);
          const forwardedStream = stream.clone();
          Object.defineProperty(forwardedStream, "_peerPigeonSourcePeerId", {
            value: originalSourcePeerId,
            writable: false,
            enumerable: false,
            configurable: false
          });
          Object.defineProperty(forwardedStream, "_peerPigeonOrigin", {
            value: "forwarded",
            writable: false,
            enumerable: false,
            configurable: false
          });
          await connection.setLocalStream(forwardedStream);
          forwardCount++;
          this.debug.log(`\u2705 FORWARD STREAM: Successfully forwarded stream to peer ${peerId.substring(0, 8)}...`);
        } catch (error) {
          this.debug.error(`\u274C FORWARD STREAM: Failed to forward stream to peer ${peerId.substring(0, 8)}...`, error);
        }
      }
      this.debug.log(`\u{1F504} FORWARD STREAM: Forwarded stream from ${sourcePeerId.substring(0, 8)}... to ${forwardCount} peer(s)`);
    }
  };

  // src/SignalingHandler.js
  var SignalingHandler = class extends EventEmitter {
    constructor(mesh, connectionManager) {
      super();
      this.debug = DebugLogger_default.create("SignalingHandler");
      this.mesh = mesh;
      this.connectionManager = connectionManager;
    }
    async handleSignalingMessage(message) {
      const { type, data, fromPeerId, targetPeerId } = message;
      if (type === "answer" || type === "renegotiation-answer") {
        console.log("\u{1F6A8} SIGNALING CRITICAL:", type, "from", fromPeerId?.substring(0, 8), "to", this.mesh.peerId?.substring(0, 8));
        this.debug.log("\u{1F50D} SIGNALING DEBUG: Received answer message:", {
          type,
          fromPeerId: fromPeerId?.substring(0, 8) + "...",
          targetPeerId: targetPeerId?.substring(0, 8) + "...",
          ourPeerId: this.mesh.peerId?.substring(0, 8) + "...",
          hasData: !!data,
          dataType: data?.type
        });
      }
      if (fromPeerId === this.mesh.peerId) {
        if (type === "answer" || type === "renegotiation-answer") {
          console.log("\u{1F6A8} REJECTING:", type, "- from our own peer ID");
          this.debug.log("\u{1F50D} SIGNALING DEBUG: Rejecting answer - from our own peer ID");
        }
        return;
      }
      if (targetPeerId && targetPeerId !== this.mesh.peerId) {
        if (type === "answer" || type === "renegotiation-answer") {
          console.log("\u{1F6A8} REJECTING:", type, "- target mismatch, target:", targetPeerId?.substring(0, 8), "us:", this.mesh.peerId?.substring(0, 8));
          this.debug.log("\u{1F50D} SIGNALING DEBUG: Rejecting answer - target mismatch:", {
            targetPeerId: targetPeerId?.substring(0, 8) + "...",
            ourPeerId: this.mesh.peerId?.substring(0, 8) + "..."
          });
        }
        return;
      }
      if (type === "cleanup" || type === "cleanup-all") {
        this.debug.log("Ignoring cleanup message:", { type, fromPeerId });
        return;
      }
      this.debug.log("Processing signaling message:", { type, fromPeerId, targetPeerId });
      switch (type) {
        case "announce":
          this.handlePeerAnnouncement(fromPeerId);
          break;
        case "peer-discovered":
          if (data && data.peerId) {
            this.handlePeerAnnouncement(data.peerId);
          }
          break;
        case "goodbye":
          this.handlePeerGoodbye(fromPeerId);
          break;
        case "offer":
          await this.handleOffer(data, fromPeerId);
          break;
        case "renegotiation-offer":
          await this.handleRenegotiationOffer(data, fromPeerId);
          break;
        case "answer":
          console.log("\u{1F6A8} SWITCH: Reached answer case for", fromPeerId?.substring(0, 8));
          this.debug.log("\u{1F50D} SIGNALING DEBUG: Reached answer case in switch statement");
          await this.handleAnswer(data, fromPeerId);
          break;
        case "renegotiation-answer":
          console.log("\u{1F6A8} SWITCH: Reached renegotiation-answer case for", fromPeerId?.substring(0, 8));
          await this.handleRenegotiationAnswer(data, fromPeerId);
          break;
        case "ice-restart-offer":
          await this.handleIceRestartOffer(data, fromPeerId);
          break;
        case "ice-restart-answer":
          await this.handleIceRestartAnswer(data, fromPeerId);
          break;
        case "ice-candidate":
          await this.connectionManager.handleIceCandidate(data, fromPeerId);
          break;
        case "connection-rejected":
          this.handleConnectionRejected(data, fromPeerId);
          break;
      }
    }
    handlePeerAnnouncement(fromPeerId) {
      if (this.mesh.peerDiscovery.hasPeer(fromPeerId)) {
        this.debug.log(`Peer ${fromPeerId.substring(0, 8)}... already known, skipping announcement`);
        return;
      }
      this.mesh.emit("statusChanged", { type: "info", message: `Peer ${fromPeerId.substring(0, 8)}... announced` });
      this.debug.log(`Adding discovered peer: ${fromPeerId.substring(0, 8)}... to PeerDiscovery`);
      this.debug.log(`Current peer count: ${this.connectionManager.getConnectedPeerCount()}/${this.mesh.maxPeers}`);
      this.debug.log(`All discovered peers: ${Array.from(this.mesh.peerDiscovery.discoveredPeers.keys()).map((p) => p.substring(0, 8)).join(", ")}`);
      this.mesh.peerDiscovery.addDiscoveredPeer(fromPeerId);
    }
    handlePeerGoodbye(fromPeerId) {
      this.mesh.emit("statusChanged", { type: "info", message: `Peer ${fromPeerId.substring(0, 8)}... left the network` });
      this.mesh.peerDiscovery.removeDiscoveredPeer(fromPeerId);
      this.connectionManager.disconnectPeer(fromPeerId, "left network");
    }
    async handleOffer(offer, fromPeerId) {
      this.debug.log("Handling offer from", fromPeerId);
      if (!offer || typeof offer !== "object") {
        this.debug.error(`Invalid offer data from ${fromPeerId}:`, offer);
        this.mesh.emit("statusChanged", { type: "error", message: `Invalid offer data from ${fromPeerId.substring(0, 8)}...` });
        return;
      }
      if (!offer.type || offer.type !== "offer") {
        this.debug.error(`Invalid offer type from ${fromPeerId}:`, offer.type);
        this.mesh.emit("statusChanged", { type: "error", message: `Invalid offer type from ${fromPeerId.substring(0, 8)}...` });
        return;
      }
      if (!offer.sdp || typeof offer.sdp !== "string" || offer.sdp.length < 10) {
        this.debug.error(`Invalid offer SDP from ${fromPeerId}:`, offer.sdp?.substring(0, 100) || "undefined");
        this.mesh.emit("statusChanged", { type: "error", message: `Invalid offer SDP from ${fromPeerId.substring(0, 8)}...` });
        return;
      }
      const shouldWeInitiate = this.mesh.peerId > fromPeerId;
      if (shouldWeInitiate) {
        this.debug.log(`\u{1F504} INITIATOR LOGIC: Rejecting offer from ${fromPeerId.substring(0, 8)}... because we should be the initiator (our ID: ${this.mesh.peerId.substring(0, 8)}... > their ID)`);
        try {
          await this.mesh.sendSignalingMessage({
            type: "connection-rejected",
            data: {
              reason: "initiator_role_conflict",
              details: "Peer should wait for us to initiate based on peer ID comparison",
              shouldInitiate: false
            }
          }, fromPeerId);
        } catch (error) {
          this.debug.warn("Failed to send initiator rejection:", error);
        }
        return;
      }
      this.debug.log(`\u{1F504} INITIATOR LOGIC: Accepting offer from ${fromPeerId.substring(0, 8)}... because they should be the initiator (their ID: ${fromPeerId.substring(0, 8)}... > our ID: ${this.mesh.peerId.substring(0, 8)}...)`);
      if (this.connectionManager.hasPeer(fromPeerId)) {
        const existingPeer = this.connectionManager.getPeer(fromPeerId);
        const existingStatus = existingPeer.getStatus();
        if (existingStatus === "connected") {
          this.debug.log(`Connection already established with ${fromPeerId}, ignoring duplicate offer`);
          return;
        }
        const weShouldInitiate = this.mesh.peerId > fromPeerId;
        this.debug.log(`\u{1F504} INITIATOR LOGIC: ${this.mesh.peerId.substring(0, 8)}... vs ${fromPeerId.substring(0, 8)}... \u2192 weShouldInitiate: ${weShouldInitiate}`);
        this.debug.log(`\u{1F504} EXISTING PEER: isInitiator: ${existingPeer.isInitiator}, status: ${existingStatus}`);
        if (weShouldInitiate && existingPeer.isInitiator) {
          this.debug.log(`\u{1F504} RACE CONDITION: Both peers trying to initiate! We should initiate (${this.mesh.peerId.substring(0, 8)}... > ${fromPeerId.substring(0, 8)}...) but received offer.`);
          const ourSignalingState = existingPeer.connection?.signalingState;
          if (ourSignalingState === "have-local-offer") {
            this.debug.log(`\u2705 RACE RESOLUTION: Our connection stuck in "${ourSignalingState}" - accepting their offer to complete handshake`);
            this.connectionManager.cleanupRaceCondition(fromPeerId);
          } else {
            this.debug.log(`\u274C RACE RESOLUTION: Our connection in "${ourSignalingState}" - ignoring their offer as we should initiate`);
            return;
          }
        } else if (!weShouldInitiate && existingPeer.isInitiator) {
          this.debug.log(`\u{1F504} INITIATOR CORRECTION: We incorrectly initiated to ${fromPeerId.substring(0, 8)}..., backing down for their offer`);
          if (existingStatus === "connecting" || existingStatus === "new") {
            this.debug.log(`\u2705 Cleaning up our incorrect connection attempt to ${fromPeerId.substring(0, 8)}...`);
            this.connectionManager.cleanupRaceCondition(fromPeerId);
          } else {
            this.debug.log("Connection in progress, not cleaning up");
            return;
          }
        } else {
          this.debug.log("Already processing incoming connection from", fromPeerId);
          return;
        }
      }
      if (this.connectionManager.connectionAttempts.has(fromPeerId)) {
        this.debug.log("Already attempting connection to", fromPeerId, "accepting incoming offer");
        this.connectionManager.connectionAttempts.delete(fromPeerId);
      }
      const currentCount = this.connectionManager.getConnectedPeerCount();
      const totalPeerCount = this.connectionManager.peers.size;
      let canAccept = this.mesh.canAcceptMorePeers();
      let evictPeerId = null;
      this.debug.log(`Capacity check for ${fromPeerId.substring(0, 8)}...: ${currentCount}/${this.mesh.maxPeers} connected, ${totalPeerCount} total peers, canAccept: ${canAccept}`);
      if (!canAccept) {
        this.debug.log(`At capacity (${currentCount}/${this.mesh.maxPeers} connected, ${totalPeerCount} total) - checking eviction and cleanup options`);
        if (this.mesh.evictionStrategy) {
          evictPeerId = this.mesh.evictionManager.shouldEvictForPeer(fromPeerId);
          if (evictPeerId) {
            this.debug.log(`Will evict ${evictPeerId.substring(0, 8)}... for incoming connection from ${fromPeerId.substring(0, 8)}...`);
            canAccept = true;
          } else {
            this.debug.log(`No suitable peer found for eviction for ${fromPeerId.substring(0, 8)}...`);
          }
        } else {
          this.debug.log(`Eviction strategy disabled - cannot evict for ${fromPeerId.substring(0, 8)}...`);
        }
        if (!canAccept) {
          const stalePeerCount = this.connectionManager.getStalePeerCount();
          if (stalePeerCount > 0) {
            this.debug.log(`No eviction candidate, attempting to clean up ${stalePeerCount} stale peer(s) to make room for ${fromPeerId.substring(0, 8)}...`);
            this.connectionManager.cleanupStalePeers();
            canAccept = this.mesh.canAcceptMorePeers();
            if (canAccept) {
              this.debug.log(`Successfully made room after cleanup for ${fromPeerId.substring(0, 8)}...`);
            }
          }
        }
        if (!canAccept) {
          const reason = `max_peers_reached (${currentCount}/${this.mesh.maxPeers} connected, ${this.connectionManager.peers.size} total, no eviction candidate)`;
          this.debug.log(`Rejecting offer from ${fromPeerId.substring(0, 8)}...: ${reason}`);
          try {
            await this.mesh.sendSignalingMessage({
              type: "connection-rejected",
              data: {
                reason: "max_peers_reached",
                details: reason,
                currentCount,
                maxPeers: this.mesh.maxPeers
              }
            }, fromPeerId);
            this.debug.log(`Sent connection rejection to ${fromPeerId.substring(0, 8)}...`);
          } catch (error) {
            this.debug.error("Failed to send connection rejection:", error);
          }
          return;
        }
      }
      if (evictPeerId) {
        this.mesh.emit("statusChanged", { type: "info", message: `Evicting ${evictPeerId.substring(0, 8)}... for incoming connection from ${fromPeerId.substring(0, 8)}...` });
        await this.mesh.evictionManager.evictPeer(evictPeerId, "incoming closer peer");
      }
      try {
        const options = {
          localStream: null,
          // Always null - media must be manually added later
          // ALWAYS enable both audio and video transceivers for maximum compatibility
          // This allows peers to receive media even if they don't have media when connecting
          enableAudio: true,
          enableVideo: true
          // allowRemoteStreams defaults to false - streams only invoked when user explicitly enables them
        };
        this.debug.log(`Creating answer connection for ${fromPeerId.substring(0, 8)}... (no automatic media sharing)`);
        this.debug.log(`\u{1F504} RECEIVER SETUP: Creating PeerConnection(${fromPeerId.substring(0, 8)}..., isInitiator=false)`);
        const peerConnection = new PeerConnection(fromPeerId, false, options);
        this.connectionManager.setupPeerConnectionHandlers(peerConnection);
        this.connectionManager.peers.set(fromPeerId, peerConnection);
        await peerConnection.createConnection();
        this.debug.log(`Processing offer from ${fromPeerId.substring(0, 8)}...`, {
          type: offer.type,
          sdpLength: offer.sdp?.length || 0,
          hasAudio: offer.sdp?.includes("m=audio") || false,
          hasVideo: offer.sdp?.includes("m=video") || false
        });
        const answer = await peerConnection.handleOffer(offer);
        this.debug.log(`Answer created for ${fromPeerId.substring(0, 8)}...`, {
          type: answer.type,
          sdpLength: answer.sdp?.length || 0,
          hasAudio: answer.sdp?.includes("m=audio") || false,
          hasVideo: answer.sdp?.includes("m=video") || false
        });
        this.debug.log("Sending answer to", fromPeerId);
        this.debug.log(`\u{1F504} ANSWER SEND DEBUG: Sending answer to ${fromPeerId.substring(0, 8)}...`);
        this.debug.log(`\u{1F504} ANSWER SEND DEBUG: Answer type: ${answer.type}`);
        this.debug.log(`\u{1F504} ANSWER SEND DEBUG: Answer SDP length: ${answer.sdp?.length}`);
        this.debug.log(`\u{1F504} ANSWER SEND DEBUG: Target peer ID: ${fromPeerId}`);
        await this.mesh.sendSignalingMessage({
          type: "answer",
          data: answer,
          timestamp: Date.now()
        }, fromPeerId);
        this.debug.log(`\u2705 ANSWER SEND DEBUG: Answer successfully sent to ${fromPeerId.substring(0, 8)}...`);
        this.mesh.emit("statusChanged", { type: "info", message: `Answer sent to ${fromPeerId.substring(0, 8)}...` });
        this.mesh.peerDiscovery.clearConnectionAttempt(fromPeerId);
      } catch (error) {
        this.debug.error("Failed to handle offer from", fromPeerId, ":", error);
        if (error.message.includes("state:")) {
          this.debug.log(`Offer ignored for ${fromPeerId.substring(0, 8)}... - connection state issue (likely race condition)`);
          this.mesh.emit("statusChanged", { type: "info", message: `Offer skipped for ${fromPeerId.substring(0, 8)}... (connection state conflict)` });
        } else {
          this.mesh.emit("statusChanged", { type: "error", message: `Failed to handle offer from ${fromPeerId.substring(0, 8)}...: ${error.message}` });
          this.connectionManager.cleanupFailedConnection(fromPeerId);
        }
      }
    }
    async handleRenegotiationOffer(offer, fromPeerId) {
      this.debug.log(`\u{1F504} Handling renegotiation offer via signaling from ${fromPeerId.substring(0, 8)}...`);
      const peerConnection = this.connectionManager.getPeer(fromPeerId);
      if (!peerConnection) {
        this.debug.error(`No peer connection found for renegotiation from ${fromPeerId.substring(0, 8)}...`);
        return;
      }
      try {
        const answer = await peerConnection.handleOffer(offer);
        await this.mesh.sendSignalingMessage({
          type: "renegotiation-answer",
          data: answer,
          timestamp: Date.now()
        }, fromPeerId);
        this.debug.log(`\u2705 Renegotiation completed via signaling with ${fromPeerId.substring(0, 8)}...`);
      } catch (error) {
        this.debug.error(`\u274C Failed to handle renegotiation offer via signaling from ${fromPeerId.substring(0, 8)}...`, error);
      }
    }
    async handleAnswer(answer, fromPeerId) {
      this.debug.log("\u{1F504} ANSWER RECEIVE DEBUG: Handling answer from", fromPeerId);
      this.debug.log(`\u{1F504} ANSWER RECEIVE DEBUG: Our peer ID: ${this.mesh.peerId.substring(0, 8)}...`);
      this.debug.log(`\u{1F504} ANSWER RECEIVE DEBUG: Answer from: ${fromPeerId.substring(0, 8)}...`);
      if (!answer || typeof answer !== "object") {
        this.debug.error(`Invalid answer data from ${fromPeerId}:`, answer);
        this.mesh.emit("statusChanged", { type: "error", message: `Invalid answer data from ${fromPeerId.substring(0, 8)}...` });
        return;
      }
      if (!answer.type || answer.type !== "answer") {
        this.debug.error(`Invalid answer type from ${fromPeerId}:`, answer.type);
        this.mesh.emit("statusChanged", { type: "error", message: `Invalid answer type from ${fromPeerId.substring(0, 8)}...` });
        return;
      }
      if (!answer.sdp || typeof answer.sdp !== "string" || answer.sdp.length < 10) {
        this.debug.error(`Invalid answer SDP from ${fromPeerId}:`, answer.sdp?.substring(0, 100) || "undefined");
        this.mesh.emit("statusChanged", { type: "error", message: `Invalid answer SDP from ${fromPeerId.substring(0, 8)}...` });
        return;
      }
      const peerConnection = this.connectionManager.getPeer(fromPeerId);
      this.debug.log(`\u{1F504} ANSWER RECEIVE DEBUG: Found peer connection: ${!!peerConnection}`);
      const allPeerIds = Array.from(this.connectionManager.peers.keys());
      this.debug.log(`\u{1F504} ANSWER RECEIVE DEBUG: All current peers (${allPeerIds.length}): ${allPeerIds.map((p) => p.substring(0, 8)).join(", ")}`);
      if (peerConnection) {
        this.debug.log(`\u{1F504} ANSWER RECEIVE DEBUG: Peer connection state: ${peerConnection.connection?.signalingState}`);
        this.debug.log(`\u{1F504} ANSWER RECEIVE DEBUG: Is initiator: ${peerConnection.isInitiator}`);
        this.debug.log(`\u{1F504} ANSWER RECEIVE DEBUG: Connection age: ${Date.now() - peerConnection.connectionStartTime}ms`);
      } else {
        this.debug.error(`\u{1F504} ANSWER RECEIVE DEBUG: NO PEER CONNECTION - Was expecting peer ${fromPeerId.substring(0, 8)}...`);
        this.debug.error(`\u{1F504} ANSWER RECEIVE DEBUG: This means the peer connection was cleaned up or never created!`);
      }
      if (peerConnection) {
        try {
          this.debug.log(`\u{1F504} ANSWER RECEIVE DEBUG: Processing answer from ${fromPeerId.substring(0, 8)}...`);
          await peerConnection.handleAnswer(answer);
          this.debug.log(`\u2705 ANSWER RECEIVE DEBUG: Answer processed successfully from ${fromPeerId.substring(0, 8)}...`);
          this.mesh.emit("statusChanged", { type: "info", message: `Answer processed from ${fromPeerId.substring(0, 8)}...` });
        } catch (error) {
          this.debug.error("\u274C ANSWER RECEIVE DEBUG: Failed to handle answer:", error);
          if (error.message.includes("state:") || error.message.includes("stable")) {
            this.debug.log(`Answer ignored for ${fromPeerId.substring(0, 8)}... - connection state issue (likely race condition resolved)`);
            this.mesh.emit("statusChanged", { type: "info", message: `Answer skipped for ${fromPeerId.substring(0, 8)}... (connection already stable)` });
          } else {
            this.mesh.emit("statusChanged", { type: "error", message: `Failed to handle answer from ${fromPeerId.substring(0, 8)}...: ${error.message}` });
          }
        }
      } else {
        this.debug.error("\u274C ANSWER RECEIVE DEBUG: No peer connection found for answer from", fromPeerId);
        this.debug.error("\u274C ANSWER RECEIVE DEBUG: Peer connection may have been cleaned up prematurely - check connection timeout/cleanup logic");
      }
    }
    handleConnectionRejected(data, fromPeerId) {
      this.debug.log(`Connection rejected by ${fromPeerId.substring(0, 8)}...: ${data.reason} (${data.details})`);
      this.mesh.emit("statusChanged", {
        type: "info",
        message: `Connection rejected by ${fromPeerId.substring(0, 8)}... (${data.reason})`
      });
      this.connectionManager.connectionAttempts.delete(fromPeerId);
      const peerConnection = this.connectionManager.getPeer(fromPeerId);
      if (peerConnection && peerConnection.getStatus() !== "connected") {
        peerConnection.close();
        this.connectionManager.peers.delete(fromPeerId);
      }
      this.mesh.peerDiscovery.clearConnectionAttempt(fromPeerId);
      const connectedCount = this.connectionManager.getConnectedPeerCount();
      if (connectedCount === 0) {
        this.debug.log(`Connection rejected and peer is isolated (${connectedCount} connections) - trying alternative peers immediately`);
        const discoveredPeers = Array.from(this.mesh.peerDiscovery.getDiscoveredPeers());
        const availablePeers = discoveredPeers.filter(
          (peer) => peer.peerId !== fromPeerId && !this.connectionManager.hasPeer(peer.peerId) && !this.mesh.peerDiscovery.isAttemptingConnection(peer.peerId)
        );
        if (availablePeers.length > 0) {
          const sortedByDistance = availablePeers.sort((a, b) => {
            const distA = this.mesh.peerDiscovery.calculateXorDistance(this.mesh.peerId, a.peerId);
            const distB = this.mesh.peerDiscovery.calculateXorDistance(this.mesh.peerId, b.peerId);
            return distA < distB ? -1 : 1;
          });
          const nextPeer = sortedByDistance[0];
          this.debug.log(`Immediately attempting connection to next closest peer: ${nextPeer.peerId.substring(0, 8)}...`);
          this.connectionManager.connectToPeer(nextPeer.peerId);
        }
      } else {
        setTimeout(() => {
          this.mesh.peerDiscovery.optimizeMeshConnections(this.connectionManager.peers);
        }, 1e3);
      }
    }
    async handleRenegotiationAnswer(answer, fromPeerId) {
      console.log("\u{1F6A8} RENEGOTIATION ANSWER: IMMEDIATE PROCESSING from", fromPeerId?.substring(0, 8), "to", this.mesh.peerId?.substring(0, 8));
      this.debug.log(`\u{1F504} CRITICAL FIX: IMMEDIATE renegotiation answer from ${fromPeerId.substring(0, 8)}...`);
      const peerConnection = this.connectionManager.getPeer(fromPeerId);
      if (!peerConnection) {
        this.debug.error(`\u274C CRITICAL: No peer connection for answer from ${fromPeerId.substring(0, 8)}... - CONNECTION LOST`);
        return;
      }
      const currentState = peerConnection.connection?.signalingState;
      this.debug.log(`\uFFFD CRITICAL: Connection state before answer: ${currentState}`);
      if (currentState !== "have-local-offer") {
        this.debug.log(`\u26A0\uFE0F CRITICAL: Connection not waiting for answer (state: ${currentState}) - applying anyway`);
      }
      try {
        this.debug.log(`\u{1F504} CRITICAL: APPLYING ANSWER IMMEDIATELY from ${fromPeerId.substring(0, 8)}...`);
        await peerConnection.handleAnswer(answer);
        const newState = peerConnection.connection?.signalingState;
        this.debug.log(`\u2705 CRITICAL: Answer applied - state changed from ${currentState} to ${newState}`);
        if (newState === "stable") {
          this.debug.log(`\u{1F389} SUCCESS: Connection with ${fromPeerId.substring(0, 8)}... is now STABLE - media should work!`);
        } else {
          this.debug.error(`\u274C CRITICAL: Connection still not stable after answer - state: ${newState}`);
        }
      } catch (error) {
        this.debug.error(`\u274C CRITICAL: FAILED to apply renegotiation answer from ${fromPeerId.substring(0, 8)}...`, error);
        this.debug.log(`\u{1F198} EMERGENCY: Forcing connection recovery for ${fromPeerId.substring(0, 8)}...`);
        try {
          await this.connectionManager.connectToPeer(fromPeerId, false, { emergency: true });
        } catch (recoveryError) {
          this.debug.error(`\u274C EMERGENCY: Recovery failed for ${fromPeerId.substring(0, 8)}...`, recoveryError);
        }
      }
    }
    /**
     * Handle ICE restart offers sent over the mesh
     */
    async handleIceRestartOffer(data, fromPeerId) {
      this.debug.log(`Received ICE restart offer from ${fromPeerId.substring(0, 8)}...`);
      const peerConnection = this.connectionManager.peers.get(fromPeerId);
      if (!peerConnection) {
        this.debug.warn(`No peer connection found for ICE restart offer from ${fromPeerId.substring(0, 8)}...`);
        return;
      }
      try {
        await peerConnection.handleIceRestartOffer(data.offer);
        this.debug.log(`Successfully handled ICE restart offer from ${fromPeerId.substring(0, 8)}...`);
      } catch (error) {
        this.debug.error(`Failed to handle ICE restart offer from ${fromPeerId.substring(0, 8)}...:`, error);
      }
    }
    /**
     * Handle ICE restart answers sent over the mesh
     */
    async handleIceRestartAnswer(data, fromPeerId) {
      this.debug.log(`Received ICE restart answer from ${fromPeerId.substring(0, 8)}...`);
      const peerConnection = this.connectionManager.peers.get(fromPeerId);
      if (!peerConnection) {
        this.debug.warn(`No peer connection found for ICE restart answer from ${fromPeerId.substring(0, 8)}...`);
        return;
      }
      try {
        await peerConnection.handleIceRestartAnswer(data.answer);
        this.debug.log(`Successfully handled ICE restart answer from ${fromPeerId.substring(0, 8)}...`);
      } catch (error) {
        this.debug.error(`Failed to handle ICE restart answer from ${fromPeerId.substring(0, 8)}...:`, error);
      }
    }
  };

  // src/EvictionManager.js
  var EvictionManager = class extends EventEmitter {
    constructor(mesh, connectionManager) {
      super();
      this.debug = DebugLogger_default.create("EvictionManager");
      this.mesh = mesh;
      this.connectionManager = connectionManager;
    }
    shouldEvictForPeer(newPeerId) {
      if (!this.mesh.evictionStrategy) {
        this.debug.log("Eviction disabled - evictionStrategy is false");
        return null;
      }
      const totalPeerCount = this.connectionManager.peers.size;
      const connectedCount = this.connectionManager.getConnectedPeerCount();
      if (totalPeerCount < this.mesh.maxPeers) {
        this.debug.log(`No eviction needed: ${totalPeerCount}/${this.mesh.maxPeers} peers (connected: ${connectedCount})`);
        return null;
      }
      if (connectedCount === 0) {
        this.debug.log(`Isolated peer scenario: finding any peer to evict for ${newPeerId.substring(0, 8)}...`);
        const anyPeerId = Array.from(this.connectionManager.peers.keys())[0];
        if (anyPeerId) {
          this.debug.log(`Will evict any peer ${anyPeerId.substring(0, 8)}... to escape isolation for ${newPeerId.substring(0, 8)}...`);
          return anyPeerId;
        }
      }
      if (this.mesh.xorRouting) {
        const newPeerDistance = this.calculateXorDistance(this.mesh.peerId, newPeerId);
        const farthestPeerId = this.findFarthestPeer();
        if (!farthestPeerId) {
          this.debug.log("No eviction candidate found (no peers to evict)");
          return null;
        }
        const farthestDistance = this.calculateXorDistance(this.mesh.peerId, farthestPeerId);
        this.debug.log(`Eviction check: new peer ${newPeerId.substring(0, 8)}... (distance: ${newPeerDistance.toString(16).substring(0, 8)}) vs farthest ${farthestPeerId.substring(0, 8)}... (distance: ${farthestDistance.toString(16).substring(0, 8)})`);
        const shouldEvict = newPeerDistance < farthestDistance;
        if (shouldEvict) {
          this.debug.log(`Will evict ${farthestPeerId.substring(0, 8)}... for closer peer ${newPeerId.substring(0, 8)}... (${totalPeerCount}/${this.mesh.maxPeers} peers)`);
          return farthestPeerId;
        }
        this.debug.log(`Not evicting for ${newPeerId.substring(0, 8)}... - new peer is not closer (${totalPeerCount}/${this.mesh.maxPeers} peers)`);
        return null;
      } else {
        this.debug.log(`XOR routing disabled - using FIFO eviction for ${newPeerId.substring(0, 8)}...`);
        const oldestPeerId = this.findOldestPeer();
        if (oldestPeerId) {
          this.debug.log(`Will evict oldest peer ${oldestPeerId.substring(0, 8)}... for new peer ${newPeerId.substring(0, 8)}... (${totalPeerCount}/${this.mesh.maxPeers} peers)`);
          return oldestPeerId;
        }
        this.debug.log("No eviction candidate found (no peers to evict)");
        return null;
      }
    }
    async evictPeer(peerId, reason = "topology optimization") {
      const peerConnection = this.connectionManager.getPeer(peerId);
      if (!peerConnection) {
        this.debug.log(`Cannot evict ${peerId.substring(0, 8)}... - peer not found`);
        return;
      }
      this.debug.log(`Evicting ${peerId.substring(0, 8)}... (${reason})`);
      try {
        peerConnection.sendMessage({
          type: "eviction",
          reason,
          from: this.mesh.peerId
        });
      } catch (error) {
        this.debug.log("Failed to send eviction notice:", error.message);
      }
      peerConnection.close();
      this.connectionManager.peers.delete(peerId);
      this.mesh.peerDiscovery.clearConnectionAttempt(peerId);
      this.mesh.emit("peerDisconnected", { peerId, reason: `evicted: ${reason}` });
      this.connectionManager.emit("peersUpdated");
    }
    handleEvictionNotice(message, fromPeerId) {
      this.debug.log(`Evicted by ${fromPeerId.substring(0, 8)}... (${message.reason})`);
      this.connectionManager.peers.delete(fromPeerId);
      this.mesh.peerDiscovery.clearConnectionAttempt(fromPeerId);
      this.mesh.emit("peerEvicted", { fromPeerId, reason: message.reason });
      this.connectionManager.emit("peersUpdated");
    }
    calculateXorDistance(peerId1, peerId2) {
      let distance = 0n;
      for (let i = 0; i < Math.min(peerId1.length, peerId2.length); i += 2) {
        const byte1 = parseInt(peerId1.substr(i, 2), 16);
        const byte2 = parseInt(peerId2.substr(i, 2), 16);
        const xor = byte1 ^ byte2;
        distance = distance << 8n | BigInt(xor);
      }
      return distance;
    }
    findFarthestPeer() {
      if (this.connectionManager.peers.size === 0) {
        this.debug.log("No peers available for eviction");
        return null;
      }
      let farthestPeer = null;
      let maxDistance = 0n;
      let candidateCount = 0;
      this.connectionManager.peers.forEach((peerConnection, peerId) => {
        const status = peerConnection.getStatus();
        if (status === "connected" || status === "channel-connecting" || status === "connecting" || status === "channel-open") {
          candidateCount++;
          const distance = this.calculateXorDistance(this.mesh.peerId, peerId);
          if (distance > maxDistance) {
            maxDistance = distance;
            farthestPeer = peerId;
          }
        }
      });
      if (!farthestPeer && this.connectionManager.peers.size > 0) {
        this.debug.log("No eviction candidates with connected/connecting status, trying any peer...");
        this.connectionManager.peers.forEach((peerConnection, peerId) => {
          candidateCount++;
          const distance = this.calculateXorDistance(this.mesh.peerId, peerId);
          if (distance > maxDistance) {
            maxDistance = distance;
            farthestPeer = peerId;
          }
        });
      }
      if (farthestPeer) {
        this.debug.log(`Found farthest peer for eviction: ${farthestPeer.substring(0, 8)}... (distance: ${maxDistance.toString(16).substring(0, 8)}, ${candidateCount} candidate peers)`);
      } else {
        this.debug.log(`No peers available for eviction (${candidateCount} candidate peers)`);
      }
      return farthestPeer;
    }
    findOldestPeer() {
      if (this.connectionManager.peers.size === 0) {
        this.debug.log("No peers available for FIFO eviction");
        return null;
      }
      let oldestPeer = null;
      let oldestTime = Date.now();
      let candidateCount = 0;
      this.connectionManager.peers.forEach((peerConnection, peerId) => {
        const status = peerConnection.getStatus();
        if (status === "connected" || status === "channel-connecting" || status === "connecting" || status === "channel-open") {
          candidateCount++;
          const connectionTime = peerConnection.connectionStartTime || Date.now();
          if (connectionTime < oldestTime) {
            oldestTime = connectionTime;
            oldestPeer = peerId;
          }
        }
      });
      if (!oldestPeer && this.connectionManager.peers.size > 0) {
        this.debug.log("No FIFO eviction candidates with connected/connecting status, trying any peer...");
        this.connectionManager.peers.forEach((peerConnection, peerId) => {
          candidateCount++;
          const connectionTime = peerConnection.connectionStartTime || Date.now();
          if (connectionTime < oldestTime) {
            oldestTime = connectionTime;
            oldestPeer = peerId;
          }
        });
      }
      if (oldestPeer) {
        this.debug.log(`Found oldest peer for eviction: ${oldestPeer.substring(0, 8)}... (connected at: ${new Date(oldestTime).toLocaleTimeString()}, ${candidateCount} candidates)`);
      } else {
        this.debug.log(`No peers available for FIFO eviction (${candidateCount} candidates)`);
      }
      return oldestPeer;
    }
    disconnectExcessPeers() {
      if (this.connectionManager.peers.size <= this.mesh.maxPeers) return;
      const peerEntries = Array.from(this.connectionManager.peers.entries()).filter(([_, peerConnection]) => peerConnection.connectionStartTime).sort((a, b) => a[1].connectionStartTime - b[1].connectionStartTime);
      const toDisconnect = peerEntries.slice(0, this.connectionManager.peers.size - this.mesh.maxPeers);
      toDisconnect.forEach(([peerId, peerConnection]) => {
        this.debug.log(`Disconnecting ${peerId.substring(0, 8)}... (over max peers limit)`);
        peerConnection.close();
        this.connectionManager.peers.delete(peerId);
        this.mesh.peerDiscovery.clearConnectionAttempt(peerId);
        this.mesh.emit("peerDisconnected", { peerId, reason: "over max peers limit" });
      });
      this.connectionManager.emit("peersUpdated");
    }
    clearEvictionTracking(_peerId) {
    }
    cleanup() {
    }
  };

  // src/MeshOptimizer.js
  var MeshOptimizer = class extends EventEmitter {
    constructor(mesh, connectionManager, evictionManager) {
      super();
      this.debug = DebugLogger_default.create("MeshOptimizer");
      this.mesh = mesh;
      this.connectionManager = connectionManager;
      this.evictionManager = evictionManager;
    }
    handleOptimizeConnections(unconnectedPeers) {
      if (!this.mesh.autoDiscovery) return;
      const currentConnected = this.connectionManager.getConnectedPeerCount();
      const hasNoConnections = currentConnected === 0;
      const belowMinimum = currentConnected < this.mesh.minPeers;
      if (hasNoConnections && unconnectedPeers.length > 0) {
        this.debug.log(`Peer has no connections but found ${unconnectedPeers.length} unconnected peers - forcing connection attempt`);
        const sortedByDistance = unconnectedPeers.sort((a, b) => {
          const distA = this.calculateXorDistance(this.mesh.peerId, a);
          const distB = this.calculateXorDistance(this.mesh.peerId, b);
          return distA < distB ? -1 : 1;
        });
        const targetPeer = sortedByDistance[0];
        this.debug.log(`Forcing connection to closest peer: ${targetPeer.substring(0, 8)}... (no connections, mesh connectivity required)`);
        this.connectionManager.connectToPeer(targetPeer);
        return;
      }
      if (belowMinimum && unconnectedPeers.length > 0) {
        this.debug.log(`Below minimum peers (${currentConnected}/${this.mesh.minPeers}) - connecting to additional peers`);
        const needed = Math.min(this.mesh.minPeers - currentConnected, unconnectedPeers.length);
        const sortedByDistance = unconnectedPeers.sort((a, b) => {
          const distA = this.calculateXorDistance(this.mesh.peerId, a);
          const distB = this.calculateXorDistance(this.mesh.peerId, b);
          return distA < distB ? -1 : 1;
        });
        for (let i = 0; i < needed; i++) {
          const targetPeer = sortedByDistance[i];
          this.debug.log(`Connecting to reach minimum: ${targetPeer.substring(0, 8)}...`);
          this.connectionManager.connectToPeer(targetPeer);
        }
        return;
      }
      if (this.mesh.maxPeers <= 3) {
        if (currentConnected >= this.mesh.maxPeers) {
          this.debug.log(`Skipping optimization - already at max capacity ${currentConnected}/${this.mesh.maxPeers}`);
          return;
        }
      } else {
        const targetThreshold = Math.floor(this.mesh.maxPeers * 0.7);
        if (currentConnected >= targetThreshold) {
          this.debug.log(`Skipping optimization - ${currentConnected}/${this.mesh.maxPeers} peers connected (threshold: ${targetThreshold})`);
          return;
        }
      }
      const availableSlots = this.mesh.maxPeers - currentConnected;
      const peersToConnect = unconnectedPeers.slice(0, Math.min(availableSlots, 1));
      this.debug.log(`Optimizing connections carefully: ${availableSlots} slots available, connecting to ${peersToConnect.length} peer(s)`);
      peersToConnect.forEach((peerId, _index) => {
        if (this.mesh.peerDiscovery.shouldInitiateConnection(peerId)) {
          this.debug.log(`Initiating immediate connection to ${peerId.substring(0, 8)}... in optimization`);
          if (this.connectionManager.canAcceptMorePeers() && !this.connectionManager.hasPeer(peerId) && !this.mesh.peerDiscovery.isAttemptingConnection(peerId)) {
            this.connectionManager.connectToPeer(peerId);
          } else {
            this.debug.log(`Skipping connection to ${peerId.substring(0, 8)}... - conditions changed`);
          }
        } else {
          this.debug.log(`Not initiating connection to ${peerId.substring(0, 8)}... (should not initiate)`);
        }
      });
    }
    calculateXorDistance(peerId1, peerId2) {
      let distance = 0n;
      for (let i = 0; i < Math.min(peerId1.length, peerId2.length); i += 2) {
        const byte1 = parseInt(peerId1.substr(i, 2), 16);
        const byte2 = parseInt(peerId2.substr(i, 2), 16);
        const xor = byte1 ^ byte2;
        distance = distance << 8n | BigInt(xor);
      }
      return distance;
    }
    // Method to force connection attempts to all discovered peers
    forceConnectToAllPeers() {
      const discoveredPeers = this.mesh.getDiscoveredPeers();
      let connectionAttempts = 0;
      this.debug.log(`Forcing connections to ${discoveredPeers.length} discovered peers...`);
      discoveredPeers.forEach((peer) => {
        if (!this.connectionManager.hasPeer(peer.peerId) && this.connectionManager.canAcceptMorePeers()) {
          this.debug.log(`Force connecting to ${peer.peerId.substring(0, 8)}...`);
          this.connectionManager.connectToPeer(peer.peerId);
          connectionAttempts++;
        }
      });
      this.debug.log(`Initiated ${connectionAttempts} forced connection attempts`);
      return connectionAttempts;
    }
    // Debug method to help diagnose connectivity issues
    debugConnectivity() {
      const connectedPeers = this.connectionManager.getConnectedPeerCount();
      const discoveredPeers = this.mesh.getDiscoveredPeers();
      const totalPeers = this.connectionManager.peers.size;
      this.debug.log("=== CONNECTIVITY DEBUG ===");
      this.debug.log(`My Peer ID: ${this.mesh.peerId}`);
      this.debug.log(`Connected Peers: ${connectedPeers}/${this.mesh.maxPeers}`);
      this.debug.log(`Total Peer Objects: ${totalPeers}`);
      this.debug.log(`Discovered Peers: ${discoveredPeers.length}`);
      this.debug.log("\nPeer Details:");
      this.connectionManager.peers.forEach((peerConnection, peerId) => {
        const status = peerConnection.getStatus();
        const dataChannelReady = peerConnection.dataChannelReady;
        const connectionState = peerConnection.connection?.connectionState || "unknown";
        const dataChannelState = peerConnection.dataChannel?.readyState || "unknown";
        this.debug.log(`  ${peerId.substring(0, 8)}... - Status: ${status}, WebRTC: ${connectionState}, DataChannel: ${dataChannelState}, Ready: ${dataChannelReady}`);
      });
      this.debug.log("\nDiscovered Peers:");
      discoveredPeers.forEach((peer) => {
        const shouldInitiate = this.mesh.peerId < peer.peerId;
        const isConnected = this.connectionManager.hasPeer(peer.peerId);
        this.debug.log(`  ${peer.peerId.substring(0, 8)}... - ShouldInitiate: ${shouldInitiate}, IsConnected: ${isConnected}`);
      });
      this.debug.log("\nConnection Attempts:");
      this.connectionManager.connectionAttempts.forEach((attempts, peerId) => {
        this.debug.log(`  ${peerId.substring(0, 8)}... - Attempts: ${attempts}/${this.connectionManager.maxConnectionAttempts}`);
      });
      this.debug.log("\nEviction Status:");
      this.debug.log(`  Eviction Strategy: ${this.mesh.evictionStrategy ? "enabled" : "disabled"}`);
      this.debug.log(`  XOR Routing: ${this.mesh.xorRouting ? "enabled" : "disabled"}`);
      this.debug.log("=== END DEBUG ===\n");
      return {
        connectedPeers,
        totalPeers,
        discoveredPeers: discoveredPeers.length,
        evictionEnabled: this.mesh.evictionStrategy,
        xorRouting: this.mesh.xorRouting,
        peerStatuses: Array.from(this.connectionManager.peers.entries()).map(([peerId, conn]) => ({
          peerId: peerId.substring(0, 8),
          status: conn.getStatus(),
          dataChannelReady: conn.dataChannelReady
        }))
      };
    }
  };

  // src/CleanupManager.js
  var CleanupManager = class extends EventEmitter {
    constructor(mesh) {
      super();
      this.debug = DebugLogger_default.create("CleanupManager");
      this.mesh = mesh;
      this.cleanupInProgress = /* @__PURE__ */ new Set();
    }
    async cleanupSignalingData(peerId) {
      if (this.cleanupInProgress.has(peerId)) {
        this.debug.log("Cleanup already in progress for", peerId);
        return;
      }
      this.cleanupInProgress.add(peerId);
      try {
        this.debug.log("Cleaning up signaling data for", peerId);
        const response = await this.mesh.signalingClient.sendSignalingMessage({
          type: "cleanup",
          data: {
            peerId: this.mesh.peerId,
            targetPeerId: peerId,
            timestamp: Date.now(),
            reason: "connection_established"
          },
          targetPeerId: peerId
        });
        if (response.cleaned && (response.cleaned.signaling > 0 || response.cleaned.discovery > 0)) {
          this.debug.log("Signaling cleanup completed for", peerId, response);
          this.mesh.emit("statusChanged", { type: "info", message: `Cleaned up signaling data with ${peerId.substring(0, 8)}...` });
        }
      } catch (error) {
        this.debug.error("Failed to cleanup signaling data for", peerId, error);
      } finally {
        this.cleanupInProgress.delete(peerId);
      }
    }
    async cleanupAllSignalingData() {
      if (this.mesh.signalingClient && this.mesh.peerId) {
        try {
          const response = await this.mesh.signalingClient.sendSignalingMessage({
            type: "cleanup-all",
            data: {
              peerId: this.mesh.peerId,
              timestamp: Date.now(),
              reason: "peer_cleanup"
            }
          });
          if (response.cleaned > 0) {
            this.debug.log(`Cleaned up ${response.cleaned} stale signaling items`);
          }
        } catch (error) {
          this.debug.log("Failed to cleanup all signaling data:", error.message);
        }
      }
    }
    cleanupAllSignalingDataSync() {
      if (this.mesh.signalingClient && this.mesh.connected && this.mesh.peerId) {
        try {
          this.mesh.signalingClient.sendSignalingMessage({
            type: "cleanup-all",
            data: {
              peerId: this.mesh.peerId,
              timestamp: Date.now(),
              reason: "browser_unload"
            }
          }).catch((error) => {
            this.debug.log("Failed to send cleanup-all message:", error.message);
          });
          this.debug.log("Cleanup-all message sent via WebSocket");
        } catch (error) {
          this.debug.log("Failed to send cleanup-all message:", error.message);
        }
      }
    }
    // Manual cleanup method for already-connected mesh networks
    async cleanupStaleSignalingData() {
      if (!this.mesh.signalingClient || !this.mesh.connected) {
        this.debug.log("Cannot cleanup - not connected to signaling server");
        return;
      }
      this.debug.log("Manually cleaning up stale signaling data for all connected peers...");
      try {
        const cleanupPromises = [];
        if (this.mesh.connectionManager && this.mesh.connectionManager.peers) {
          const peerEntries = Array.from(this.mesh.connectionManager.peers.entries());
          for (const [peerId, peerConnection] of peerEntries) {
            try {
              if (peerConnection && peerConnection.getStatus && peerConnection.getStatus() === "connected") {
                cleanupPromises.push(this.cleanupSignalingData(peerId));
              }
            } catch (error) {
              this.debug.log(`Error checking peer ${peerId} status during cleanup:`, error.message);
            }
          }
        }
        if (cleanupPromises.length > 0) {
          await Promise.allSettled(cleanupPromises);
        }
        await this.cleanupAllSignalingData();
        this.debug.log("Manual cleanup completed for all connected peers");
        this.mesh.emit("statusChanged", { type: "info", message: "Cleaned up stale signaling data" });
      } catch (error) {
        this.debug.error("Manual cleanup failed:", error);
        this.mesh.emit("statusChanged", { type: "error", message: "Failed to cleanup signaling data" });
      }
    }
    sendGoodbyeMessageSync() {
      if (this.mesh.signalingClient && this.mesh.connected) {
        try {
          this.mesh.signalingClient.sendGoodbyeMessage();
          this.debug.log("Goodbye message sent via WebSocket");
        } catch (error) {
          this.debug.log("Failed to send goodbye message:", error.message);
        }
      }
    }
    async sendGoodbyeMessage() {
      if (this.mesh.signalingClient && this.mesh.connected) {
        try {
          await this.mesh.signalingClient.sendSignalingMessage({
            type: "goodbye",
            data: { peerId: this.mesh.peerId, timestamp: Date.now() }
          });
        } catch (error) {
          this.debug.log("Failed to send goodbye message:", error.message);
        }
      }
    }
    setupUnloadHandlers() {
      if (typeof window !== "undefined") {
        const handleUnload = () => {
          this.debug.log("Page unloading - cleaning up ALL peer data");
          this.sendGoodbyeMessageSync();
          this.cleanupAllSignalingDataSync();
        };
        window.addEventListener("beforeunload", handleUnload);
        window.addEventListener("unload", handleUnload);
        window.addEventListener("pagehide", handleUnload);
      }
    }
    cleanup() {
      this.cleanupInProgress.clear();
    }
  };

  // src/StorageManager.js
  var StorageManager = class extends EventEmitter {
    constructor(mesh) {
      super();
      this.debug = DebugLogger_default.create("StorageManager");
      this.mesh = mesh;
    }
    loadSignalingUrlFromStorage() {
      if (environmentDetector.hasLocalStorage) {
        const savedUrl = localStorage.getItem("pigon-signaling-url");
        if (savedUrl) {
          this.mesh.signalingUrl = savedUrl;
          this.mesh.emit("statusChanged", { type: "urlLoaded", signalingUrl: savedUrl });
          return savedUrl;
        }
      } else if (environmentDetector.isNodeJS) {
        this.debug.log("Local storage not available in Node.js environment");
      }
      return null;
    }
    saveSignalingUrlToStorage(url) {
      if (environmentDetector.hasLocalStorage && url) {
        localStorage.setItem("pigon-signaling-url", url);
      } else if (environmentDetector.isNodeJS) {
        this.debug.log("Storage not implemented for Node.js environment");
      }
    }
    loadSignalingUrlFromQuery() {
      if (!environmentDetector.isBrowser && !environmentDetector.isNativeScript) return this.loadSignalingUrlFromStorage();
      if (typeof URLSearchParams === "undefined" || environmentDetector.isBrowser && typeof window === "undefined" || environmentDetector.isBrowser && typeof window.location === "undefined") {
        return this.loadSignalingUrlFromStorage();
      }
      let searchParams;
      if (environmentDetector.isBrowser) {
        searchParams = new URLSearchParams(window.location.search);
      } else if (environmentDetector.isNativeScript) {
        return this.loadSignalingUrlFromStorage();
      }
      const signalingUrl = searchParams?.get("api") || searchParams?.get("url") || searchParams?.get("signaling");
      if (signalingUrl) {
        const currentUrl = this.mesh.signalingUrl;
        this.mesh.signalingUrl = signalingUrl;
        this.saveSignalingUrlToStorage(signalingUrl);
        if (currentUrl !== signalingUrl) {
          this.mesh.emit("statusChanged", { type: "urlLoaded", signalingUrl });
        }
        return signalingUrl;
      }
      return this.loadSignalingUrlFromStorage();
    }
    validatePeerId(peerId) {
      return typeof peerId === "string" && /^[a-fA-F0-9]{40}$/.test(peerId);
    }
    saveSettings(settings) {
      if (environmentDetector.hasLocalStorage) {
        localStorage.setItem("pigon-settings", JSON.stringify(settings));
      }
    }
    loadSettings() {
      if (environmentDetector.hasLocalStorage) {
        const saved = localStorage.getItem("pigon-settings");
        if (saved) {
          try {
            return JSON.parse(saved);
          } catch (error) {
            this.debug.error("Failed to parse saved settings:", error);
          }
        }
      }
      return {};
    }
    clearStorage() {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem("pigon-signaling-url");
        localStorage.removeItem("pigon-settings");
      }
    }
  };

  // src/GossipManager.js
  var GossipManager = class extends EventEmitter {
    constructor(mesh, connectionManager) {
      super();
      this.mesh = mesh;
      this.connectionManager = connectionManager;
      this.debug = DebugLogger_default.create("GossipManager");
      this.seenMessages = /* @__PURE__ */ new Map();
      this.messageHistory = /* @__PURE__ */ new Map();
      this.processedKeyExchanges = /* @__PURE__ */ new Map();
      this.maxTTL = 40;
      this.messageExpiryTime = 5 * 60 * 1e3;
      this.cleanupInterval = 60 * 1e3;
      this.cleanupTimer = null;
      this.startCleanupTimer();
    }
    /**
       * Broadcast a message to all peers in the network using gossip protocol
       */
    async broadcastMessage(content, messageType = "chat") {
      if (content === void 0 || content === null) {
        this.debug.error("Cannot broadcast message with undefined/null content");
        return null;
      }
      if (messageType === "chat" && (typeof content !== "string" || content.trim().length === 0)) {
        this.debug.error("Cannot broadcast empty chat message");
        return null;
      }
      if (messageType === "encrypted" && (typeof content !== "object" || !content.encrypted)) {
        this.debug.error("Cannot broadcast invalid encrypted message");
        return null;
      }
      const messageId = await this.generateMessageId();
      const message = {
        id: messageId,
        type: "gossip",
        subtype: messageType,
        content,
        from: this.mesh.peerId,
        networkName: this.mesh.networkName,
        // Include network namespace
        timestamp: Date.now(),
        ttl: this.maxTTL,
        path: [this.mesh.peerId]
        // Track propagation path
      };
      this.debug.log(`Broadcasting ${messageType} message: ${messageId.substring(0, 8)}... content: "${content}"`);
      this.seenMessages.set(messageId, {
        timestamp: Date.now(),
        ttl: this.maxTTL
      });
      this.messageHistory.set(messageId, message);
      this.propagateMessage(message);
      if (messageType === "chat" || messageType === "encrypted") {
        this.emit("messageReceived", {
          from: this.mesh.peerId,
          content,
          timestamp: message.timestamp,
          messageId,
          encrypted: messageType === "encrypted"
        });
      }
      return messageId;
    }
    /**
     * Attempt adaptive resend of recent broadcasts to peers that connected
     * after initial propagation window.
     */
    // (Rollback) attemptAdaptiveResends removed
    /**
       * Send a direct message to a specific peer using gossip routing (DM)
       * @param {string} targetPeerId - The destination peer's ID
       * @param {string|object} content - The message content
       * @param {string} subtype - Message subtype (default: 'dm')
       * @returns {string|null} The message ID if sent, or null on error
       */
    async sendDirectMessage(targetPeerId, content, subtype = "dm") {
      if (!targetPeerId || typeof targetPeerId !== "string") {
        this.debug.error("Invalid targetPeerId for direct message");
        return null;
      }
      if (!/^[a-fA-F0-9]{40}$/.test(targetPeerId)) {
        this.debug.error("Invalid peer ID format for direct message:", targetPeerId);
        return null;
      }
      const messageId = await this.generateMessageId();
      const message = {
        id: messageId,
        type: "gossip",
        subtype,
        content,
        from: this.mesh.peerId,
        to: targetPeerId,
        networkName: this.mesh.networkName,
        // Include network namespace
        timestamp: Date.now(),
        ttl: this.maxTTL,
        path: [this.mesh.peerId]
      };
      this.seenMessages.set(messageId, {
        timestamp: Date.now(),
        ttl: this.maxTTL
      });
      this.messageHistory.set(messageId, message);
      this.propagateMessage(message);
      return messageId;
    }
    /**
       * Handle incoming gossip message from a peer
       */
    async handleGossipMessage(message, fromPeerId) {
      this.debug.log(`\u{1F525}\u{1F525}\u{1F525} GOSSIP MESSAGE RECEIVED! From: ${fromPeerId?.substring(0, 8)}...`);
      this.debug.log("\u{1F525}\u{1F525}\u{1F525} Message:", message);
      const { id: messageId, ttl, from: originPeerId, subtype, content, timestamp, path, to, networkName } = message;
      if (!messageId || !originPeerId || !subtype || content === void 0) {
        this.debug.error("Invalid gossip message structure:", message);
        return;
      }
      const messageNetwork = networkName || "global";
      const currentNetwork = this.mesh.networkName;
      if (messageNetwork !== currentNetwork) {
        this.debug.log(`Filtering gossip message from different network: ${messageNetwork} (current: ${currentNetwork})`);
        return;
      }
      if (this.seenMessages.has(messageId)) {
        this.debug.log(`Ignoring duplicate message: ${messageId.substring(0, 8)}...`);
        return;
      }
      if (ttl <= 0) {
        this.debug.log(`Message expired: ${messageId.substring(0, 8)}...`);
        return;
      }
      if (path && path.includes(this.mesh.peerId)) {
        this.debug.log(`Preventing message loop: ${messageId.substring(0, 8)}...`);
        return;
      }
      this.debug.log(`Received gossip message: ${messageId.substring(0, 8)}... from ${fromPeerId.substring(0, 8)}... (TTL: ${ttl}, content: "${content}")`);
      this.seenMessages.set(messageId, {
        timestamp: Date.now(),
        ttl
      });
      this.messageHistory.set(messageId, message);
      if (this.mesh.enableCrypto && this.mesh.cryptoManager) {
        const handled = await this._handleCryptoMessage(message, fromPeerId, originPeerId);
        if (handled) {
          return;
        }
      }
      let processedContent = content;
      let isEncrypted = false;
      if (this.mesh.enableCrypto && this.mesh.cryptoManager && content && typeof content === "object" && content.encrypted) {
        try {
          processedContent = await this.mesh.decryptMessage(content);
          isEncrypted = true;
          this.debug.log(`\u{1F510} Decrypted message from ${originPeerId.substring(0, 8)}...`);
        } catch (error) {
          this.debug.error("Failed to decrypt message:", error);
          processedContent = content;
        }
      }
      if (subtype === "chat") {
        if (isEncrypted || typeof processedContent === "string" && processedContent.trim().length > 0) {
          this.emit("messageReceived", {
            from: originPeerId,
            content: processedContent,
            timestamp,
            messageId,
            hops: this.maxTTL - ttl,
            direct: false,
            // Flag to indicate this was a gossip message
            encrypted: isEncrypted
          });
        } else {
          this.debug.warn("Ignoring gossip chat message with invalid content:", processedContent);
          return;
        }
      } else if (subtype === "encrypted") {
        this.emit("messageReceived", {
          from: originPeerId,
          content: processedContent,
          timestamp,
          messageId,
          hops: this.maxTTL - ttl,
          direct: false,
          encrypted: true
        });
      } else if (subtype === "peer-announcement") {
        this.handlePeerAnnouncement(content, originPeerId);
      } else if (subtype === "mediaEvent") {
        this.handleMediaEvent(content, originPeerId);
      } else if (subtype === "stream-chunk") {
        this.emit("messageReceived", {
          from: originPeerId,
          message: {
            type: "stream-chunk",
            ...content
          },
          timestamp,
          messageId
        });
      } else if (subtype === "stream-control") {
        this.emit("messageReceived", {
          from: originPeerId,
          message: {
            type: "stream-control",
            ...content
          },
          timestamp,
          messageId
        });
      } else if (subtype === "dm") {
        if (typeof to === "string" && typeof this.mesh.peerId === "string" && to.trim().toLowerCase() === this.mesh.peerId.trim().toLowerCase()) {
          this.debug.log(`\u{1F50D} DM DEBUG: Received DM from ${originPeerId?.substring(0, 8)}, content type: ${typeof processedContent}`);
          if (typeof processedContent === "object" && processedContent) {
            this.debug.log(`\u{1F50D} DM DEBUG: Content object has type: ${processedContent.type}`);
          }
          const filteredMessageTypes = /* @__PURE__ */ new Set([
            "signaling-relay",
            "peer-announce-relay",
            "bootstrap-keepalive"
          ]);
          let messageType = null;
          let shouldFilter = false;
          if (typeof processedContent === "object" && processedContent && processedContent.type) {
            messageType = processedContent.type;
            shouldFilter = filteredMessageTypes.has(messageType);
          } else if (typeof processedContent === "string") {
            try {
              const parsedContent = JSON.parse(processedContent);
              messageType = parsedContent.type;
              shouldFilter = filteredMessageTypes.has(messageType);
            } catch (e) {
            }
          }
          this.debug.log(`\u{1F50D} DM DEBUG: messageType=${messageType}, shouldFilter=${shouldFilter}`);
          if (shouldFilter) {
            this.debug.log(`\u{1F507} FILTER: Processing filtered DM type '${messageType}' from ${originPeerId?.substring(0, 8)} (not emitted to UI)`);
            if (messageType === "signaling-relay" && typeof processedContent === "object") {
              if (processedContent.signalingMessage && this.mesh.signalingHandler) {
                this.mesh.signalingHandler.handleSignalingMessage({
                  type: processedContent.signalingMessage.type,
                  data: processedContent.signalingMessage.data,
                  fromPeerId: processedContent.signalingMessage.fromPeerId || originPeerId,
                  targetPeerId: processedContent.targetPeerId,
                  timestamp: processedContent.timestamp
                });
              }
            } else if (messageType === "peer-announce-relay" && typeof processedContent === "object") {
              if (processedContent.data && this.mesh.signalingHandler) {
                this.mesh.signalingHandler.handlePeerAnnouncement(processedContent.data, originPeerId);
              }
            } else if (messageType === "bootstrap-keepalive") {
              if (this.mesh.peerDiscovery) {
                const keepalivePeerId = typeof processedContent === "object" && processedContent.from ? processedContent.from : originPeerId;
                this.mesh.peerDiscovery.updateDiscoveryTimestamp(keepalivePeerId);
              }
            }
            return;
          }
          this.emit("messageReceived", {
            from: originPeerId,
            content: processedContent,
            timestamp,
            messageId,
            hops: this.maxTTL - ttl,
            direct: true,
            // Flag to indicate this was a direct message
            encrypted: isEncrypted
          });
          return;
        } else {
        }
      } else if (subtype === "dht-routing") {
        if (typeof to === "string" && typeof this.mesh.peerId === "string" && to.trim().toLowerCase() === this.mesh.peerId.trim().toLowerCase()) {
          this.debug.log(`DHT: Received routed message for us from ${originPeerId.substring(0, 8)}`);
          if (this.mesh.webDHT && content) {
            this.mesh.webDHT.handleMessage(content, originPeerId);
          }
          return;
        } else {
          this.debug.log(`DHT: Routing message for ${to?.substring(0, 8)} (not us)`);
        }
      }
      const updatedMessage = {
        ...message,
        ttl: ttl - 1,
        path: [...path || [], this.mesh.peerId]
      };
      this.propagateMessage(updatedMessage, fromPeerId);
    }
    /**
       * Handle peer announcements received via gossip
       */
    handlePeerAnnouncement(announcementData, originPeerId) {
      const { peerId: announcedPeerId } = announcementData;
      this.debug.log(`Gossip peer announcement: ${announcedPeerId.substring(0, 8)}... via ${originPeerId.substring(0, 8)}...`);
      if (!this.mesh.peerDiscovery.hasPeer(announcedPeerId) && announcedPeerId !== this.mesh.peerId) {
        this.mesh.emit("statusChanged", {
          type: "info",
          message: `Discovered peer ${announcedPeerId.substring(0, 8)}... via gossip`
        });
        this.mesh.peerDiscovery.addDiscoveredPeer(announcedPeerId);
      }
    }
    /**
     * Handle media streaming events received via gossip
     */
    handleMediaEvent(eventData, originPeerId) {
      const { event, peerId, hasVideo, hasAudio, timestamp } = eventData;
      this.debug.log(`Media event gossip: ${event} from ${peerId.substring(0, 8)}... via ${originPeerId.substring(0, 8)}...`);
      if (peerId === this.mesh.peerId) {
        return;
      }
      if (event === "streamStarted") {
        this.mesh.emit("remoteStreamAnnouncement", {
          peerId,
          hasVideo,
          hasAudio,
          timestamp,
          event: "started"
        });
      } else if (event === "streamStopped") {
        this.mesh.emit("remoteStreamAnnouncement", {
          peerId,
          timestamp,
          event: "stopped"
        });
      }
    }
    /**
       * Broadcast peer announcement via gossip when we connect
       */
    async announcePeer(peerId = this.mesh.peerId) {
      const announcementData = {
        peerId,
        timestamp: Date.now()
      };
      this.debug.log(`Gossiping peer announcement for: ${peerId.substring(0, 8)}...`);
      await this.broadcastMessage(announcementData, "peer-announcement");
    }
    /**
       * Propagate message to ALL peers that can receive messages - ignore connection states!
       */
    propagateMessage(message, excludePeerId = null) {
      if ((message.subtype === "dm" || message.subtype === "dht-routing") && message.to) {
        let xorDistance = function(a, b) {
          if (!a || !b) return Number.MAX_SAFE_INTEGER;
          let dist = 0n;
          for (let i = 0; i < 40; i += 8) {
            const aChunk = a.substring(i, i + 8);
            const bChunk = b.substring(i, i + 8);
            dist = (dist << 32n) + (BigInt("0x" + aChunk) ^ BigInt("0x" + bChunk));
          }
          return dist;
        };
        const targetId = message.to;
        const allPeers2 = Array.from(this.connectionManager.peers.values());
        const capablePeers2 = allPeers2.filter((peerConnection) => {
          return peerConnection.dataChannel && peerConnection.dataChannel.readyState === "open";
        });
        let minDist = null;
        let closestPeers = [];
        capablePeers2.forEach((peerConnection) => {
          if (peerConnection.peerId === excludePeerId || message.ttl <= 0) return;
          const dist = xorDistance(peerConnection.peerId, targetId);
          if (minDist === null || dist < minDist) {
            minDist = dist;
            closestPeers = [peerConnection];
          } else if (dist === minDist) {
            closestPeers.push(peerConnection);
          }
        });
        if (closestPeers.length > 0) {
          closestPeers.forEach((peer) => {
            try {
              peer.sendMessage(message);
              const routingType = message.subtype === "dht-routing" ? "DHT" : "DM";
              this.debug.log(`${routingType} routed to closest peer: ${peer.peerId.substring(0, 8)}...`);
            } catch (error) {
              this.debug.error(`${message.subtype} routing failed:`, error);
            }
          });
        } else {
          capablePeers2.forEach((peerConnection) => {
            if (peerConnection.peerId === excludePeerId || message.ttl <= 0) return;
            try {
              peerConnection.sendMessage(message);
              const routingType = message.subtype === "dht-routing" ? "DHT" : "DM";
              this.debug.log(`${routingType} fallback relay to: ${peerConnection.peerId.substring(0, 8)}...`);
            } catch (error) {
              this.debug.error(`${message.subtype} fallback relay failed:`, error);
            }
          });
        }
        return;
      }
      const allPeers = Array.from(this.connectionManager.peers.values());
      const capablePeers = allPeers.filter((peerConnection) => {
        return peerConnection.dataChannel && peerConnection.dataChannel.readyState === "open";
      });
      let propagatedTo = 0;
      this.debug.log(`\u{1F680} AGGRESSIVE GOSSIP: Found ${capablePeers.length}/${allPeers.length} peers with open data channels`);
      this.debug.log(`Message: ${message.id.substring(0, 8)}..., TTL: ${message.ttl}, Exclude: ${excludePeerId?.substring(0, 8) || "none"}`);
      allPeers.forEach((peerConnection) => {
        const status = peerConnection.getStatus();
        const dataChannelState = peerConnection.dataChannel?.readyState || "none";
        const canSend = peerConnection.dataChannel && peerConnection.dataChannel.readyState === "open";
        const isExcluded = peerConnection.peerId === excludePeerId;
        this.debug.log(`  ${peerConnection.peerId.substring(0, 8)}... - Status: ${status}, DataChannel: ${dataChannelState}, CanSend: ${canSend}, Excluded: ${isExcluded}`);
      });
      capablePeers.forEach((peerConnection) => {
        const peerId = peerConnection.peerId;
        if (peerId === excludePeerId || message.ttl <= 0) {
          return;
        }
        try {
          peerConnection.sendMessage(message);
          propagatedTo++;
          this.debug.log(`\u2705 GOSSIP SUCCESS: Sent to ${peerId.substring(0, 8)}...`);
        } catch (error) {
          this.debug.error(`\u274C GOSSIP FAILED: Could not send to ${peerId.substring(0, 8)}...`, error);
        }
      });
      this.debug.log(`\u{1F3AF} GOSSIP RESULT: Propagated to ${propagatedTo}/${capablePeers.length} capable peers`);
      if (propagatedTo === 0 && allPeers.length > 0) {
        this.debug.error(`\u{1F6A8} GOSSIP FAILURE: NO PROPAGATION! ${allPeers.length} total peers, ${capablePeers.length} with data channels`);
      }
    }
    /**
       * Get message statistics
       */
    getStats() {
      return {
        seenMessages: this.seenMessages.size,
        storedMessages: this.messageHistory.size,
        maxTTL: this.maxTTL,
        messageExpiryTime: this.messageExpiryTime
      };
    }
    /**
       * Generate unique message ID
       */
    async generateMessageId() {
      const array = new Uint8Array(16);
      if (typeof crypto !== "undefined" && crypto.getRandomValues) {
        crypto.getRandomValues(array);
      } else if (typeof process !== "undefined" && process.versions && process.versions.node) {
        try {
          const crypto3 = await import("crypto");
          const randomBytes2 = crypto3.randomBytes(16);
          array.set(randomBytes2);
        } catch (e) {
          console.warn("Could not use Node.js crypto, falling back to Math.random");
          for (let i = 0; i < array.length; i++) {
            array[i] = Math.floor(Math.random() * 256);
          }
        }
      } else {
        for (let i = 0; i < array.length; i++) {
          array[i] = Math.floor(Math.random() * 256);
        }
      }
      return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    /**
       * Clean up expired messages
       */
    startCleanupTimer() {
      if (this.cleanupTimer) {
        clearInterval(this.cleanupTimer);
      }
      if (environmentDetector.isBrowser) {
        this.cleanupTimer = window.setInterval(() => {
          this.cleanupExpiredMessages();
        }, this.cleanupInterval);
      } else {
        this.cleanupTimer = setInterval(() => {
          this.cleanupExpiredMessages();
        }, this.cleanupInterval);
      }
    }
    /**
       * Stop cleanup timer
       */
    stopCleanupTimer() {
      if (this.cleanupTimer) {
        clearInterval(this.cleanupTimer);
        this.cleanupTimer = null;
      }
    }
    cleanupExpiredMessages() {
      const now = Date.now();
      let cleaned = 0;
      let keyExchangesCleaned = 0;
      this.seenMessages.forEach((data, messageId) => {
        if (now - data.timestamp > this.messageExpiryTime) {
          this.seenMessages.delete(messageId);
          this.messageHistory.delete(messageId);
          cleaned++;
        }
      });
      this.processedKeyExchanges.forEach((timestamp, keyExchangeId) => {
        if (now - timestamp > 6e4) {
          this.processedKeyExchanges.delete(keyExchangeId);
          keyExchangesCleaned++;
        }
      });
      if (cleaned > 0) {
        this.debug.log(`Cleaned up ${cleaned} expired gossip messages`);
      }
      if (keyExchangesCleaned > 0) {
        this.debug.log(`Cleaned up ${keyExchangesCleaned} old key exchange tracking entries`);
      }
    }
    /**
       * Cleanup method
       */
    cleanup() {
      this.stopCleanupTimer();
      this.seenMessages.clear();
      this.messageHistory.clear();
      this.processedKeyExchanges.clear();
    }
    /**
       * Handle crypto-related messages (key exchange, etc.)
       * @private
       */
    async _handleCryptoMessage(message, fromPeerId, originPeerId) {
      const { subtype, content } = message;
      if (subtype === "key_exchange" || subtype === "key_exchange_response") {
        if (content && (content.type === "key_exchange" || content.type === "key_exchange_response") && content.publicKey) {
          const keyExchangeId = `${originPeerId}:${content.type}:${content.timestamp || Date.now()}`;
          if (this.processedKeyExchanges.has(keyExchangeId)) {
            this.debug.log(`\u{1F510} Ignoring duplicate ${content.type} from peer ${originPeerId.substring(0, 8)}... (already processed)`);
            return true;
          }
          const recentKeyExchangePattern = `${originPeerId}:${content.type}:`;
          const now = Date.now();
          let foundRecent = false;
          for (const [existingId, timestamp] of this.processedKeyExchanges.entries()) {
            if (existingId.startsWith(recentKeyExchangePattern) && now - timestamp < 5e3) {
              foundRecent = true;
              break;
            }
          }
          if (foundRecent) {
            this.debug.log(`\u{1F510} Ignoring recent duplicate ${content.type} from peer ${originPeerId.substring(0, 8)}... (processed recently)`);
            return true;
          }
          this.debug.log(`\u{1F510} Processing ${content.type} from peer ${originPeerId.substring(0, 8)}...`);
          this.processedKeyExchanges.set(keyExchangeId, now);
          this.mesh._handleKeyExchange(content, originPeerId);
          return true;
        }
      }
      return false;
    }
  };

  // src/MediaManager.js
  var MediaManager = class extends EventEmitter {
    constructor() {
      super();
      this.debug = DebugLogger_default.create("MediaManager");
      this.localStream = null;
      this.isVideoEnabled = false;
      this.isAudioEnabled = false;
      this.devices = {
        cameras: [],
        microphones: [],
        speakers: []
      };
      this.constraints = {
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      };
    }
    /**
       * Initialize media devices and permissions
       */
    async init() {
      if (!environmentDetector.hasGetUserMedia) {
        this.debug.warn("getUserMedia not available in this environment");
        this.emit("error", { type: "init", error: new Error("getUserMedia not supported") });
        return false;
      }
      try {
        await this.enumerateDevices();
        return true;
      } catch (error) {
        this.debug.error("Failed to initialize media manager:", error);
        this.emit("error", { type: "init", error });
        return false;
      }
    }
    /**
       * Get available media devices
       */
    async enumerateDevices() {
      if (!environmentDetector.isBrowser && !environmentDetector.isNativeScript || typeof navigator === "undefined" || typeof navigator.mediaDevices === "undefined") {
        this.debug.warn("Media device enumeration not available in this environment");
        return;
      }
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        this.devices.cameras = devices.filter((device) => device.kind === "videoinput");
        this.devices.microphones = devices.filter((device) => device.kind === "audioinput");
        this.devices.speakers = devices.filter((device) => device.kind === "audiooutput");
        this.emit("devicesUpdated", this.devices);
        return this.devices;
      } catch (error) {
        this.debug.error("Failed to enumerate devices:", error);
        this.emit("error", { type: "enumerate", error });
        throw error;
      }
    }
    /**
       * Start local media stream with specified constraints
       */
    async startLocalStream(options = {}) {
      const { video = false, audio = false, deviceIds = {} } = options;
      try {
        if (this.localStream) {
          this.stopLocalStream();
        }
        const constraints = {};
        if (video) {
          constraints.video = { ...this.constraints.video };
          if (deviceIds.camera) {
            constraints.video.deviceId = { exact: deviceIds.camera };
          }
        }
        if (audio) {
          constraints.audio = { ...this.constraints.audio };
          if (deviceIds.microphone) {
            constraints.audio.deviceId = { exact: deviceIds.microphone };
          }
        }
        if (!video && !audio) {
          throw new Error("At least one of video or audio must be enabled");
        }
        const pigeonRTC = environmentDetector.getPigeonRTC();
        if (pigeonRTC) {
          this.localStream = await pigeonRTC.getUserMedia(constraints);
        } else {
          this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
        }
        this.isVideoEnabled = video;
        this.isAudioEnabled = audio;
        this.markStreamAsLocal(this.localStream);
        this.debug.log("Local media stream started:", {
          video: this.isVideoEnabled,
          audio: this.isAudioEnabled,
          tracks: this.localStream.getTracks().map((track) => ({
            kind: track.kind,
            enabled: track.enabled,
            label: track.label
          }))
        });
        this.emit("localStreamStarted", {
          stream: this.localStream,
          video: this.isVideoEnabled,
          audio: this.isAudioEnabled
        });
        return this.localStream;
      } catch (error) {
        this.debug.error("Failed to start local media stream:", error);
        this.emit("error", { type: "getUserMedia", error });
        throw error;
      }
    }
    /**
       * Stop local media stream
       */
    stopLocalStream() {
      if (this.localStream) {
        this.debug.log("Stopping local media stream");
        this.localStream.getTracks().forEach((track) => {
          track.stop();
        });
        this.localStream = null;
        this.isVideoEnabled = false;
        this.isAudioEnabled = false;
        this.emit("localStreamStopped");
      }
    }
    /**
       * Toggle video track on/off
       */
    toggleVideo() {
      if (this.localStream) {
        const videoTrack = this.localStream.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.enabled = !videoTrack.enabled;
          this.emit("videoToggled", { enabled: videoTrack.enabled });
          return videoTrack.enabled;
        }
      }
      return false;
    }
    /**
       * Toggle audio track on/off
       */
    toggleAudio() {
      if (this.localStream) {
        const audioTrack = this.localStream.getAudioTracks()[0];
        if (audioTrack) {
          audioTrack.enabled = !audioTrack.enabled;
          this.emit("audioToggled", { enabled: audioTrack.enabled });
          return audioTrack.enabled;
        }
      }
      return false;
    }
    /**
       * Get current media state
       */
    getMediaState() {
      const state = {
        hasLocalStream: !!this.localStream,
        videoEnabled: false,
        audioEnabled: false,
        devices: this.devices
      };
      if (this.localStream) {
        const videoTrack = this.localStream.getVideoTracks()[0];
        const audioTrack = this.localStream.getAudioTracks()[0];
        state.videoEnabled = videoTrack ? videoTrack.enabled : false;
        state.audioEnabled = audioTrack ? audioTrack.enabled : false;
      }
      return state;
    }
    /**
       * Check if browser supports required APIs
       */
    static checkSupport() {
      const pigeonRTC = environmentDetector.getPigeonRTC();
      const support = {
        getUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
        enumerateDevices: !!(navigator.mediaDevices && navigator.mediaDevices.enumerateDevices),
        webRTC: pigeonRTC ? pigeonRTC.isSupported() : !!window.RTCPeerConnection
      };
      support.fullSupport = support.getUserMedia && support.enumerateDevices && support.webRTC;
      return support;
    }
    /**
       * Get media permissions status
       */
    async getPermissions() {
      try {
        const permissions = {};
        if (navigator.permissions) {
          permissions.camera = await navigator.permissions.query({ name: "camera" });
          permissions.microphone = await navigator.permissions.query({ name: "microphone" });
        }
        return permissions;
      } catch (error) {
        this.debug.warn("Could not check media permissions:", error);
        return {};
      }
    }
    /**
       * Mark stream as local origin to prevent confusion with remote streams
       */
    markStreamAsLocal(stream) {
      if (!stream) return;
      try {
        Object.defineProperty(stream, "_peerPigeonOrigin", {
          value: "local",
          writable: false,
          enumerable: false,
          configurable: false
        });
        this.debug.log(`\u{1F512} Stream ${stream.id} marked as local origin in MediaManager`);
      } catch (error) {
        this.debug.warn("Could not mark stream as local origin:", error);
      }
    }
  };

  // src/WebDHT.js
  var WebDHT = class extends EventEmitter {
    constructor(mesh) {
      super();
      this.debug = DebugLogger_default.create("SimpleWebDHT");
      this.mesh = mesh;
      this.peerId = mesh.peerId;
      this.storage = /* @__PURE__ */ new Map();
      this.closestPeers = /* @__PURE__ */ new Set();
      this.replicationFactor = 3;
      this.hashPosition = this.hashPeerId(this.peerId);
      this.debug.log(`SimpleWebDHT initialized for peer ${this.peerId.substring(0, 8)} at position ${this.hashPosition.toString(16).substring(0, 8)}`);
      this.setupMessageHandling();
      this.startMaintenance();
    }
    /**
     * Calculate replication factor based on storage space and network size
     * @param {string} space - Storage space type (private, public, frozen)
     * @param {number} totalPeers - Total number of connected peers
     * @returns {number} Appropriate replication factor
     */
    getReplicationFactor(space, totalPeers = null) {
      const peerCount = totalPeers || Array.from(this.mesh.connectionManager.peers.keys()).filter((peerId) => this.mesh.connectionManager.peers.get(peerId).getStatus() === "connected").length;
      if (peerCount === 0) return 0;
      switch (space) {
        case "private":
          return Math.min(3, peerCount);
        case "public":
          return Math.max(3, Math.min(Math.ceil(peerCount * 0.3), 7));
        case "frozen":
          return Math.max(5, Math.min(Math.ceil(peerCount * 0.5), 10));
        default:
          return Math.min(this.replicationFactor, peerCount);
      }
    }
    /**
     * Simple hash function for consistent hashing
     */
    async hash(data) {
      const encoder = new TextEncoder();
      const dataBuffer = encoder.encode(typeof data === "string" ? data : JSON.stringify(data));
      const hashBuffer = await crypto.subtle.digest("SHA-256", dataBuffer);
      const hashArray = new Uint8Array(hashBuffer);
      let hash = 0;
      for (let i = 0; i < 4; i++) {
        hash = hash * 256 + hashArray[i] >>> 0;
      }
      return hash;
    }
    /**
     * Hash peer ID to position on ring
     */
    hashPeerId(peerId) {
      let hash = 0;
      for (let i = 0; i < peerId.length; i++) {
        hash = (hash << 5) - hash + peerId.charCodeAt(i) >>> 0;
      }
      return hash;
    }
    /**
     * Calculate distance between two positions on hash ring
     */
    ringDistance(pos1, pos2) {
      const diff = Math.abs(pos1 - pos2);
      const maxUint32 = 4294967295;
      return Math.min(diff, maxUint32 - diff);
    }
    /**
     * Find closest peers to a hash position
     */
    findClosestPeers(targetHash, count = this.replicationFactor) {
      const connectedPeers = Array.from(this.mesh.connectionManager.peers.keys()).filter((peerId) => this.mesh.connectionManager.peers.get(peerId).getStatus() === "connected");
      if (connectedPeers.length === 0) {
        return [];
      }
      const peersWithDistance = connectedPeers.map((peerId) => ({
        peerId,
        distance: this.ringDistance(targetHash, this.hashPeerId(peerId))
      }));
      peersWithDistance.sort((a, b) => a.distance - b.distance);
      return peersWithDistance.slice(0, count).map((p) => p.peerId);
    }
    /**
     * Store key-value pair with network namespace support
     * @param {string} key - Storage key
     * @param {*} value - Value to store
     * @param {Object} options - Storage options
     * @param {string} options.space - Storage space (private, public, frozen) for replication strategy
     */
    async put(key, value, options = {}) {
      const namespacedKey = `${this.mesh.networkName}:${key}`;
      const keyHash = await this.hash(namespacedKey);
      const storeData = {
        key: namespacedKey,
        originalKey: key,
        // Store original key for retrieval
        value,
        networkName: this.mesh.networkName,
        timestamp: Date.now(),
        publisher: this.peerId,
        space: options.space
        // Track space for replication info
      };
      this.storage.set(namespacedKey, storeData);
      this.debug.log(`PUT: Stored ${key} locally in network ${this.mesh.networkName}`);
      const replicationFactor = options.space ? this.getReplicationFactor(options.space) : this.replicationFactor;
      const targetPeers = this.findClosestPeers(keyHash, replicationFactor);
      this.debug.log(`PUT: Replicating ${key} to ${targetPeers.length} peers`);
      const replicationPromises = targetPeers.map(async (peerId) => {
        if (peerId !== this.peerId) {
          try {
            this.sendMessage(peerId, "dht_store", storeData);
            await new Promise((resolve) => setTimeout(resolve, 50));
            return { peerId, success: true };
          } catch (error) {
            this.debug.warn(`Replication to ${peerId.substring(0, 8)} failed:`, error.message);
            return { peerId, success: false, error: error.message };
          }
        }
        return { peerId, success: true };
      });
      await Promise.allSettled(replicationPromises);
      const spaceInfo = options.space ? ` (${options.space} space, RF=${replicationFactor})` : "";
      this.debug.log(`PUT: ${key} replicated to ${targetPeers.length} peers in network ${this.mesh.networkName}${spaceInfo}`);
      return true;
    }
    /**
     * Retrieve value by key with network namespace support
     * @param {string} key - Storage key
     * @param {Object} options - Retrieval options
     * @param {boolean} options.forceRefresh - Force refresh from network
     * @param {string} options.space - Storage space for space-aware replication
     */
    async get(key, options = {}) {
      const forceRefresh = options.forceRefresh || false;
      const namespacedKey = `${this.mesh.networkName}:${key}`;
      if (!forceRefresh && this.storage.has(namespacedKey)) {
        const data = this.storage.get(namespacedKey);
        this.debug.log(`GET: Found ${key} locally in network ${this.mesh.networkName}`);
        return data.value;
      }
      const keyHash = await this.hash(namespacedKey);
      const replicationFactor = options.space ? this.getReplicationFactor(options.space) : this.replicationFactor;
      const targetPeers = this.findClosestPeers(keyHash, replicationFactor);
      this.debug.log(`GET: Querying ${targetPeers.length} peers for ${key} in network ${this.mesh.networkName}`);
      const queryPromises = targetPeers.map(async (peerId) => {
        if (peerId === this.peerId) return null;
        try {
          this.debug.log(`GET: Querying peer ${peerId.substring(0, 8)} for ${key}`);
          const result = await this.queryPeer(peerId, namespacedKey);
          this.debug.log(`GET: Peer ${peerId.substring(0, 8)} response for ${key}:`, result ? "found" : "not found");
          return result;
        } catch (error) {
          this.debug.warn(`Query to ${peerId.substring(0, 8)} failed:`, error.message);
          return null;
        }
      });
      const results = await Promise.allSettled(queryPromises);
      for (const result of results) {
        if (result.status === "fulfilled" && result.value) {
          const data = result.value;
          this.storage.set(namespacedKey, data);
          this.debug.log(`GET: Found ${key} from network ${this.mesh.networkName}`);
          return data.value;
        }
      }
      this.debug.log(`GET: ${key} not found after querying ${targetPeers.length} peers`);
      return null;
    }
    /**
     * Query a specific peer for a key
     */
    async queryPeer(peerId, key) {
      return new Promise((resolve, reject) => {
        const requestId = Math.random().toString(36).substring(7);
        const timeout = setTimeout(() => {
          this.responseHandlers.delete(requestId);
          reject(new Error("Query timeout"));
        }, 5e3);
        this.responseHandlers.set(requestId, (response) => {
          clearTimeout(timeout);
          this.responseHandlers.delete(requestId);
          if (response.found) {
            resolve(response.data);
          } else {
            resolve(null);
          }
        });
        this.sendMessage(peerId, "dht_query", { key, requestId });
      });
    }
    /**
     * Send message to peer through connection manager
     */
    sendMessage(peerId, type, data) {
      const message = {
        type: "dht",
        messageType: type,
        data,
        from: this.peerId,
        timestamp: Date.now()
      };
      const peer = this.mesh.connectionManager.peers.get(peerId);
      if (peer && peer.getStatus() === "connected") {
        peer.sendMessage(message);
      } else {
        throw new Error(`Peer ${peerId} not connected`);
      }
    }
    /**
     * Setup message handling
     */
    setupMessageHandling() {
      this.responseHandlers = /* @__PURE__ */ new Map();
    }
    /**
     * Handle incoming DHT message
     */
    async handleMessage(message, fromPeerId) {
      const { messageType, data } = message;
      switch (messageType) {
        case "dht_store":
          this.handleStore(data, fromPeerId);
          break;
        case "dht_query":
          await this.handleQuery(data, fromPeerId);
          break;
        case "dht_query_response":
          this.handleQueryResponse(data);
          break;
        default:
          this.debug.warn(`Unknown DHT message type: ${messageType}`);
      }
    }
    /**
     * Handle store request from peer with network filtering
     */
    handleStore(data, fromPeerId) {
      const { key, value, timestamp, publisher, networkName, space } = data;
      const messageNetwork = networkName || "global";
      if (messageNetwork !== this.mesh.networkName) {
        this.debug.log(`Filtering DHT store from different network: ${messageNetwork} (current: ${this.mesh.networkName})`);
        return;
      }
      try {
        if (this.storage.has(key)) {
          const existing = this.storage.get(key);
          if (existing.timestamp >= timestamp) {
            return;
          }
        }
        this.storage.set(key, { key, value, timestamp, publisher, space, networkName });
        this.debug.log(`STORE: Received ${key} from ${fromPeerId.substring(0, 8)}`);
      } catch (error) {
        this.debug.warn(`Store failed for ${key}:`, error.message);
      }
    }
    /**
     * Handle query request from peer
     */
    async handleQuery(data, fromPeerId) {
      const { key, requestId } = data;
      const response = {
        requestId,
        found: false,
        data: null
      };
      if (this.storage.has(key)) {
        response.found = true;
        response.data = this.storage.get(key);
      }
      this.sendMessage(fromPeerId, "dht_query_response", response);
    }
    /**
     * Handle query response
     */
    handleQueryResponse(data) {
      const { requestId } = data;
      const handler = this.responseHandlers.get(requestId);
      if (handler) {
        handler(data);
      }
    }
    /**
     * Update closest peers for efficient routing
     */
    updateClosestPeers() {
      const connectedPeers = Array.from(this.mesh.connectionManager.peers.keys()).filter((peerId) => this.mesh.connectionManager.peers.get(peerId).getStatus() === "connected");
      const peersWithDistance = connectedPeers.map((peerId) => ({
        peerId,
        distance: this.ringDistance(this.hashPosition, this.hashPeerId(peerId))
      }));
      peersWithDistance.sort((a, b) => a.distance - b.distance);
      this.closestPeers = new Set(
        peersWithDistance.slice(0, 10).map((p) => p.peerId)
      );
    }
    /**
     * Periodic maintenance
     */
    startMaintenance() {
      setInterval(() => {
        this.updateClosestPeers();
      }, 3e4);
      setInterval(() => {
        this.cleanupOldData();
      }, 3e5);
    }
    /**
     * Clean up old data (optional TTL support)
     */
    cleanupOldData() {
      const now = Date.now();
      const maxAge = 24 * 60 * 60 * 1e3;
      for (const [key, data] of this.storage) {
        if (now - data.timestamp > maxAge) {
          this.storage.delete(key);
          this.debug.log(`Cleaned up old data: ${key}`);
        }
      }
    }
    /**
     * Get DHT statistics
     */
    getStats() {
      return {
        localKeys: this.storage.size,
        connectedPeers: this.mesh.connectionManager.getConnectedPeerCount(),
        closestPeers: this.closestPeers.size,
        hashPosition: this.hashPosition.toString(16).substring(0, 8)
      };
    }
  };

  // src/CryptoManager.js
  var unsea = null;
  async function initializeUnsea() {
    if (unsea) return unsea;
    try {
      const isNode = typeof process !== "undefined" && process.versions && process.versions.node;
      const isBrowser3 = !isNode && typeof window !== "undefined" && typeof document !== "undefined";
      if (isNode) {
        unsea = await Promise.resolve().then(() => (init_unsea(), unsea_exports));
        console.log("\u2705 Loaded unsea from npm package (Node.js)");
      } else if (isBrowser3) {
        if (typeof globalThis !== "undefined" && globalThis.__PEERPIGEON_UNSEA__ || typeof window !== "undefined" && window.__PEERPIGEON_UNSEA__) {
          unsea = globalThis.__PEERPIGEON_UNSEA__ || window.__PEERPIGEON_UNSEA__;
          console.log("\u2705 Using bundled unsea (self-contained)");
        } else {
          try {
            unsea = await import("https://cdn.jsdelivr.net/npm/unsea@latest/+esm");
            console.log("\u2705 Loaded unsea from jsDelivr CDN");
          } catch (jsDelivrError) {
            console.warn("Failed to load from jsDelivr, trying unpkg:", jsDelivrError);
            try {
              unsea = await import("https://unpkg.com/unsea@latest/dist/unsea.esm.js");
              console.log("\u2705 Loaded unsea from unpkg CDN");
            } catch (unpkgError) {
              console.warn("Failed to load from unpkg, trying Skypack:", unpkgError);
              unsea = await import("https://cdn.skypack.dev/unsea");
              console.log("\u2705 Loaded unsea from Skypack CDN");
            }
          }
        }
      } else {
        throw new Error("Unknown environment - cannot load unsea");
      }
      if (!unsea) {
        throw new Error("Unsea not found after loading");
      }
      return unsea;
    } catch (error) {
      console.error("Failed to load unsea:", error);
      throw error;
    }
  }
  var CryptoManager = class extends EventEmitter {
    constructor() {
      super();
      this.debug = DebugLogger_default.create("CryptoManager");
      this.unsea = null;
      this.keypair = null;
      this.peerKeys = /* @__PURE__ */ new Map();
      this.encryptionEnabled = false;
      this.initialized = false;
      this.groupKeys = /* @__PURE__ */ new Map();
      this.messageNonces = /* @__PURE__ */ new Set();
      this.maxNonceAge = 3e5;
      this.nonceCleanupInterval = null;
      this.stats = {
        messagesEncrypted: 0,
        messagesDecrypted: 0,
        encryptionTime: 0,
        decryptionTime: 0,
        keyExchanges: 0
      };
    }
    /**
       * Initialize the crypto manager
       * @param {Object} options - Configuration options
       * @param {string} options.alias - Optional user alias for persistent identity
       * @param {string} options.password - Optional password for user account
       * @param {boolean} options.generateKeypair - Whether to generate a new keypair if no credentials
       * @param {string} options.peerId - Peer ID to use for automatic key storage
       * @returns {Promise<Object>} The generated or loaded keypair
       */
    async init(options = {}) {
      try {
        this.unsea = await initializeUnsea();
        if (options.alias && options.password) {
          await this.createOrAuthenticateUser(options.alias, options.password);
        } else if (options.peerId) {
          await this.initWithPeerId(options.peerId);
        } else if (options.generateKeypair !== false) {
          this.keypair = await this.unsea.generateRandomPair();
        }
        if (this.keypair) {
          this.encryptionEnabled = true;
          this.initialized = true;
          this.emit("cryptoReady", { publicKey: this.getPublicKey() });
          this.startNonceCleanup();
        }
        return this.keypair;
      } catch (error) {
        this.debug.error("CryptoManager initialization failed:", error);
        this.emit("cryptoError", { error: error.message });
        throw error;
      }
    }
    /**
       * Create or authenticate a persistent user account
       */
    async createOrAuthenticateUser(alias, password) {
      try {
        if (typeof window !== "undefined") {
          try {
            const existingKeys = await this.unsea.loadKeys(alias, password);
            if (existingKeys) {
              this.keypair = existingKeys;
            } else {
              this.keypair = await this.unsea.generateRandomPair();
              setTimeout(async () => {
                try {
                  await this.unsea.saveKeys(alias, this.keypair, password);
                } catch (saveError) {
                  this.debug.warn("Failed to save persistent keys:", saveError);
                }
              }, 0);
            }
          } catch (error) {
            this.debug.warn("Failed to use persistent storage, generating ephemeral keys:", error);
            this.keypair = await this.unsea.generateRandomPair();
          }
        } else {
          this.keypair = await this.unsea.generateRandomPair();
        }
        this.emit("userAuthenticated", { alias, publicKey: this.getPublicKey() });
      } catch (error) {
        this.debug.error("User authentication failed:", error);
        throw error;
      }
    }
    /**
       * Initialize with automatic key persistence using peer ID
       * @param {string} peerId - The peer ID to use as storage alias
       */
    async initWithPeerId(peerId) {
      try {
        if (!this.unsea) {
          this.unsea = await initializeUnsea();
        }
        const keyAlias = `peerpigeon-${peerId}`;
        this.debug.log(`\u{1F510} Initializing crypto with automatic key persistence for peer ${peerId.substring(0, 8)}...`);
        try {
          const loadKeysPromise = this.unsea.loadKeys(keyAlias);
          const timeoutPromise = new Promise((resolve, reject) => {
            setTimeout(() => reject(new Error("LoadKeys timeout")), 5e3);
          });
          const existingKeys = await Promise.race([loadKeysPromise, timeoutPromise]);
          if (existingKeys && existingKeys.pub && existingKeys.priv) {
            this.keypair = existingKeys;
            this.debug.log(`\u{1F510} Loaded existing keypair for peer ${peerId.substring(0, 8)}...`);
            this.initialized = true;
            this.encryptionEnabled = true;
            this.emit("cryptoReady", {
              hasKeypair: !!this.keypair,
              publicKey: this.getPublicKey()
            });
            return;
          }
        } catch (error) {
          this.debug.log(`\u{1F510} No existing keys found for peer ${peerId.substring(0, 8)}..., will generate new ones`);
        }
        const generateKeysPromise = this.unsea.generateRandomPair();
        const generateTimeoutPromise = new Promise((resolve, reject) => {
          setTimeout(() => reject(new Error("GenerateKeys timeout")), 5e3);
        });
        this.keypair = await Promise.race([generateKeysPromise, generateTimeoutPromise]);
        setTimeout(async () => {
          try {
            await this.unsea.saveKeys(keyAlias, this.keypair);
            this.debug.log(`\u{1F510} Generated and saved new keypair for peer ${peerId.substring(0, 8)}...`);
          } catch (saveError) {
            this.debug.warn(`\u{1F510} Failed to save keypair for peer ${peerId.substring(0, 8)}..., using ephemeral keys:`, saveError.message);
          }
        }, 0);
        this.initialized = true;
        this.encryptionEnabled = true;
        this.emit("cryptoReady", {
          hasKeypair: !!this.keypair,
          publicKey: this.getPublicKey()
        });
      } catch (error) {
        this.debug.error("Failed to initialize crypto with peer ID:", error);
        if (this.unsea) {
          this.keypair = await this.unsea.generateRandomPair();
          this.debug.log("\u{1F510} Using ephemeral keypair as fallback");
        } else {
          throw error;
        }
      }
      this.initialized = true;
      this.encryptionEnabled = true;
      this.emit("cryptoReady", {
        hasKeypair: !!this.keypair,
        publicKey: this.getPublicKey()
      });
    }
    /**
       * Get the public key for sharing
       * @returns {string} The public key
       */
    getPublicKey() {
      return this.keypair?.pub || this.keypair?.publicKey;
    }
    /**
       * Get crypto status information
       * @returns {Object} Status information
       */
    getStatus() {
      const groups = {};
      this.groupKeys.forEach((groupKey, groupId) => {
        groups[groupId] = {
          publicKey: groupKey.pub,
          created: groupKey.created || Date.now()
          // Use stored creation time or fallback to current time
        };
      });
      return {
        initialized: this.initialized,
        enabled: this.encryptionEnabled,
        hasKeypair: !!this.keypair,
        publicKey: this.getPublicKey(),
        peerCount: this.peerKeys.size,
        groupCount: this.groupKeys.size,
        groups,
        stats: { ...this.stats }
      };
    }
    /**
       * Store a peer's public keys (both pub and epub)
       * @param {string} peerId - The peer ID
       * @param {string|Object} publicKey - The peer's public key(s) - can be string (pub) or object with {pub, epub}
       */
    addPeerKey(peerId, publicKey) {
      if (!publicKey) return false;
      let keyData;
      if (typeof publicKey === "string") {
        keyData = { pub: publicKey, epub: null };
      } else if (typeof publicKey === "object" && (publicKey.pub || publicKey.epub)) {
        keyData = publicKey;
      } else {
        return false;
      }
      const existingKey = this.peerKeys.get(peerId);
      if (existingKey) {
        const pubMatches = existingKey.pub === keyData.pub;
        const epubMatches = existingKey.epub === keyData.epub;
        if (pubMatches && epubMatches) {
          return false;
        }
      }
      this.peerKeys.set(peerId, keyData);
      this.stats.keyExchanges++;
      this.emit("peerKeyAdded", { peerId, publicKey: keyData });
      return true;
    }
    /**
       * Remove a peer's public key
       * @param {string} peerId - The peer ID
       */
    removePeerKey(peerId) {
      const removed = this.peerKeys.delete(peerId);
      if (removed) {
        this.emit("peerKeyRemoved", { peerId });
      }
      return removed;
    }
    /**
       * Encrypt a message for a specific peer
       * @param {any} message - The message to encrypt
       * @param {string} peerId - The target peer ID
       * @returns {Promise<Object>} Encrypted message object
       */
    async encryptForPeer(message, peerId) {
      if (!this.encryptionEnabled) {
        return { encrypted: false, data: message };
      }
      const peerKeyData = this.peerKeys.get(peerId);
      if (!peerKeyData) {
        throw new Error(`No public key found for peer ${peerId}`);
      }
      if (!peerKeyData.epub) {
        throw new Error(`No encryption public key (epub) found for peer ${peerId}. Only regular public key (pub) available.`);
      }
      const startTime = Date.now();
      try {
        const nonce = await this.generateNonce();
        const serialized = JSON.stringify(message);
        const peerKeypair = {
          pub: peerKeyData.pub,
          epub: peerKeyData.epub
        };
        const encrypted = await this.unsea.encryptMessageWithMeta(serialized, peerKeypair);
        const result = {
          encrypted: true,
          data: encrypted,
          from: this.getPublicKey(),
          nonce,
          timestamp: Date.now()
        };
        this.stats.messagesEncrypted++;
        this.stats.encryptionTime += Date.now() - startTime;
        return result;
      } catch (error) {
        this.debug.error("Peer encryption failed:", error);
        throw error;
      }
    }
    /**
       * Decrypt a message from a peer
       * @param {Object} encryptedData - The encrypted message object
       * @returns {Promise<any>} The decrypted message
       */
    async decryptFromPeer(encryptedData) {
      if (!this.encryptionEnabled || !encryptedData.encrypted) {
        return encryptedData.data || encryptedData;
      }
      if (encryptedData.nonce && this.messageNonces.has(encryptedData.nonce)) {
        throw new Error("Replay attack detected: duplicate nonce");
      }
      const startTime = Date.now();
      try {
        const decrypted = await this.unsea.decryptMessageWithMeta(encryptedData.data, this.keypair.epriv);
        const parsed = JSON.parse(decrypted);
        if (encryptedData.nonce) {
          this.messageNonces.add(encryptedData.nonce);
        }
        this.stats.messagesDecrypted++;
        this.stats.decryptionTime += Date.now() - startTime;
        return parsed;
      } catch (error) {
        this.debug.error("Peer decryption failed:", error);
        throw error;
      }
    }
    /**
       * Sign data with our private key
       * @param {any} data - The data to sign
       * @returns {Promise<string>} The signature
       */
    async sign(data) {
      if (!this.encryptionEnabled) return null;
      try {
        const serialized = typeof data === "string" ? data : JSON.stringify(data);
        return await this.unsea.signMessage(serialized, this.keypair.priv);
      } catch (error) {
        this.debug.error("Signing failed:", error);
        throw error;
      }
    }
    /**
       * Verify a signature
       * @param {string} signature - The signature to verify
       * @param {any} data - The original data
       * @param {string} publicKey - The signer's public key
       * @returns {Promise<boolean>} Whether the signature is valid
       */
    async verify(signature, data, publicKey) {
      if (!this.encryptionEnabled) return true;
      try {
        const serialized = typeof data === "string" ? data : JSON.stringify(data);
        return await this.unsea.verifyMessage(serialized, signature, publicKey);
      } catch (error) {
        this.debug.error("Signature verification failed:", error);
        return false;
      }
    }
    /**
       * Generate a shared group key
       * @param {string} groupId - The group identifier
       * @returns {Promise<Object>} The group key pair
       */
    async generateGroupKey(groupId) {
      try {
        const groupKey = await this.unsea.generateRandomPair();
        const groupKeyWithMeta = {
          ...groupKey,
          created: Date.now(),
          groupId
        };
        this.groupKeys.set(groupId, groupKeyWithMeta);
        this.emit("groupKeyGenerated", { groupId, publicKey: groupKey.pub });
        return groupKeyWithMeta;
      } catch (error) {
        this.debug.error("Group key generation failed:", error);
        throw error;
      }
    }
    /**
       * Add an existing group key
       * @param {string} groupId - The group identifier
       * @param {Object} groupKey - The group key pair
       */
    addGroupKey(groupId, groupKey) {
      this.groupKeys.set(groupId, groupKey);
      this.emit("groupKeyAdded", { groupId, publicKey: groupKey.pub });
    }
    /**
       * Encrypt a message for a group
       * @param {any} message - The message to encrypt
       * @param {string} groupId - The group identifier
       * @returns {Promise<Object>} Encrypted message object
       */
    async encryptForGroup(message, groupId) {
      if (!this.encryptionEnabled) {
        return { encrypted: false, data: message };
      }
      const groupKey = this.groupKeys.get(groupId);
      if (!groupKey) {
        throw new Error(`No group key found for group ${groupId}`);
      }
      const startTime = Date.now();
      try {
        const nonce = await this.generateNonce();
        const serialized = JSON.stringify(message);
        const encrypted = await this.unsea.encryptMessageWithMeta(serialized, groupKey);
        const result = {
          encrypted: true,
          group: true,
          groupId,
          data: encrypted,
          from: this.getPublicKey(),
          nonce,
          timestamp: Date.now()
        };
        this.stats.messagesEncrypted++;
        this.stats.encryptionTime += Date.now() - startTime;
        return result;
      } catch (error) {
        this.debug.error("Group encryption failed:", error);
        throw error;
      }
    }
    /**
       * Decrypt a group message
       * @param {Object} encryptedData - The encrypted message object
       * @returns {Promise<any>} The decrypted message
       */
    async decryptFromGroup(encryptedData) {
      if (!this.encryptionEnabled || !encryptedData.encrypted || !encryptedData.group) {
        return encryptedData.data || encryptedData;
      }
      const groupKey = this.groupKeys.get(encryptedData.groupId);
      if (!groupKey) {
        throw new Error(`No group key found for group ${encryptedData.groupId}`);
      }
      if (encryptedData.nonce && this.messageNonces.has(encryptedData.nonce)) {
        throw new Error("Replay attack detected: duplicate nonce");
      }
      const startTime = Date.now();
      try {
        const decrypted = await this.unsea.decryptMessageWithMeta(encryptedData.data, groupKey.epriv);
        const parsed = JSON.parse(decrypted);
        if (encryptedData.nonce) {
          this.messageNonces.add(encryptedData.nonce);
        }
        this.stats.messagesDecrypted++;
        this.stats.decryptionTime += Date.now() - startTime;
        return parsed;
      } catch (error) {
        this.debug.error("Group decryption failed:", error);
        throw error;
      }
    }
    /**
       * Generate a cryptographically secure nonce
       * @returns {Promise<string>} A unique nonce
       */
    async generateNonce() {
      const timestamp = Date.now().toString();
      const random = Math.random().toString(36).substring(2);
      const combined = `${timestamp}-${random}-${Math.floor(Math.random() * 1e6)}`;
      if (typeof crypto !== "undefined" && crypto.subtle) {
        try {
          const encoder = new TextEncoder();
          const data = encoder.encode(combined);
          const hashBuffer = await crypto.subtle.digest("SHA-256", data);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").substring(0, 16);
        } catch (error) {
          this.debug.warn("Could not use crypto.subtle for nonce generation:", error);
        }
      }
      return combined;
    }
    /**
       * Start periodic cleanup of old nonces
       */
    startNonceCleanup() {
      this.nonceCleanupInterval = setInterval(() => {
        try {
          if (this.messageNonces.size > 1e3) {
            this.messageNonces.clear();
          }
        } catch (error) {
          console.error("Error during nonce cleanup:", error);
        }
      }, 6e4);
    }
    /**
       * Export public key for sharing
       * @returns {Object} Export data
       */
    exportPublicKey() {
      if (!this.keypair) return null;
      return {
        pub: this.keypair.pub,
        epub: this.keypair.epub,
        algorithm: "ECDSA",
        created: Date.now()
      };
    }
    /**
       * Clear all stored keys and reset state
       */
    reset() {
      if (this.nonceCleanupInterval) {
        clearInterval(this.nonceCleanupInterval);
        this.nonceCleanupInterval = null;
      }
      this.keypair = null;
      this.peerKeys.clear();
      this.groupKeys.clear();
      this.messageNonces.clear();
      this.encryptionEnabled = false;
      this.initialized = false;
      this.stats = {
        messagesEncrypted: 0,
        messagesDecrypted: 0,
        encryptionTime: 0,
        decryptionTime: 0,
        keyExchanges: 0
      };
      this.emit("cryptoReset");
    }
    /**
       * Test crypto functionality
       * @returns {Promise<Object>} Test results
       */
    async runSelfTest() {
      const results = {
        keypairGeneration: false,
        encryption: false,
        decryption: false,
        signing: false,
        verification: false,
        groupEncryption: false,
        errors: []
      };
      if (!this.unsea) {
        results.errors.push("Unsea library not loaded");
        return results;
      }
      if (!this.initialized) {
        results.errors.push("CryptoManager not initialized");
        return results;
      }
      this.debug.log("\u{1F50D} Debug: unsea object:", this.unsea);
      this.debug.log("\u{1F50D} Debug: available methods:", Object.keys(this.unsea));
      try {
        this.debug.log("\u{1F9EA} Testing keypair generation...");
        const testKeypair = await this.unsea.generateRandomPair();
        this.debug.log("\u{1F50D} Generated keypair:", testKeypair);
        results.keypairGeneration = !!(testKeypair && (testKeypair.pub || testKeypair.publicKey));
        this.debug.log("\u{1F9EA} Testing encryption...");
        const testMessage = "Hello, crypto world!";
        const peerKeypair = await this.unsea.generateRandomPair();
        const encrypted = await this.unsea.encryptMessageWithMeta(testMessage, peerKeypair);
        this.debug.log("\u{1F50D} Encrypted result:", encrypted);
        results.encryption = !!encrypted;
        this.debug.log("\u{1F9EA} Testing decryption...");
        const decrypted = await this.unsea.decryptMessageWithMeta(encrypted, peerKeypair.epriv);
        this.debug.log("\u{1F50D} Decrypted result:", decrypted);
        results.decryption = decrypted === testMessage;
        this.debug.log("\u{1F9EA} Testing signing...");
        const signature = await this.unsea.signMessage(testMessage, this.keypair.priv);
        this.debug.log("\u{1F50D} Signature:", signature);
        results.signing = !!signature;
        this.debug.log("\u{1F9EA} Testing verification...");
        const verified = await this.unsea.verifyMessage(testMessage, signature, this.keypair.pub);
        this.debug.log("\u{1F50D} Verification result:", verified);
        results.verification = verified === true;
        this.debug.log("\u{1F9EA} Testing group encryption...");
        const groupKey = await this.unsea.generateRandomPair();
        const groupEncrypted = await this.unsea.encryptMessageWithMeta(testMessage, groupKey);
        const groupDecrypted = await this.unsea.decryptMessageWithMeta(groupEncrypted, groupKey.epriv);
        results.groupEncryption = groupDecrypted === testMessage;
      } catch (error) {
        this.debug.error("\u{1F50D} Self-test error:", error);
        results.errors.push(error.message);
      }
      this.debug.log("\u{1F50D} Final test results:", results);
      return results;
    }
  };

  // src/LexicalStorageInterface.js
  var LexicalStorageInterface = class _LexicalStorageInterface extends EventEmitter {
    constructor(distributedStorage, path = []) {
      super();
      this.debug = DebugLogger_default.create("LexicalStorageInterface");
      this.storage = distributedStorage;
      this.path = path.slice();
      this.subscriptions = /* @__PURE__ */ new Map();
      this._isMap = false;
    }
    /**
     * Navigate to a key (creates a new interface instance)
     * @param {string} key - The key to navigate to
     * @returns {LexicalStorageInterface} New interface for the key
     */
    get(key) {
      const newInterface = new _LexicalStorageInterface(this.storage, [...this.path, key]);
      return newInterface;
    }
    /**
     * Store data at the current path
     * @param {any} value - Value to store
     * @param {Object} options - Storage options
     * @returns {Promise<LexicalStorageInterface>} This interface for chaining
     */
    async put(value, options = {}) {
      const fullKey = this.path.join(":");
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        const promises = Object.entries(value).map(([prop, val]) => {
          const propKey = `${fullKey}:${prop}`;
          return this.storage.store(propKey, val, options);
        });
        await Promise.all(promises);
        await this.storage.store(fullKey, { _keys: Object.keys(value), _type: "object" }, options);
      } else {
        await this.storage.store(fullKey, value, options);
      }
      this.emit("put", { key: fullKey, value });
      return this;
    }
    /**
     * Retrieve the current value
     * @param {Object} options - Retrieval options
     * @returns {Promise<any>} The stored value
     */
    async val(options = {}) {
      const fullKey = this.path.join(":");
      const value = await this.storage.retrieve(fullKey, options);
      if (value && typeof value === "object" && value._keys && value._type === "object") {
        const reconstructed = {};
        const promises = value._keys.map(async (key) => {
          const keyValue = await this.storage.retrieve(`${fullKey}:${key}`, options);
          reconstructed[key] = keyValue;
        });
        await Promise.all(promises);
        return reconstructed;
      }
      return value;
    }
    /**
     * Set multiple key-value pairs (like GUN's set)
     * @param {Object} obj - Object with key-value pairs to set
     * @param {Object} options - Storage options
     * @returns {Promise<LexicalStorageInterface>} This interface for chaining
     */
    async set(obj, options = {}) {
      const fullKey = this.path.join(":");
      const promises = Object.entries(obj).map(([key, value]) => {
        const setKey = `${fullKey}:${key}`;
        return this.storage.store(setKey, value, options);
      });
      await Promise.all(promises);
      const existingSet = await this.storage.retrieve(`${fullKey}:_set`) || {};
      const updatedSet = { ...existingSet, ...obj };
      await this.storage.store(`${fullKey}:_set`, updatedSet, options);
      this.emit("set", { key: fullKey, values: obj });
      return this;
    }
    /**
     * Map over a set (like GUN's map)
     * @returns {LexicalStorageInterface} New interface for mapping
     */
    map() {
      const mapInterface = new _LexicalStorageInterface(this.storage, this.path);
      mapInterface._isMap = true;
      return mapInterface;
    }
    /**
     * Subscribe to changes (like GUN's on)
     * @param {Function} callback - Callback for changes
     * @returns {Function} Unsubscribe function
     */
    on(callback) {
      const fullKey = this.path.join(":");
      if (this._isMap) {
        const setKey = `${fullKey}:_set`;
        const handleChange = async () => {
          const setData = await this.storage.retrieve(setKey);
          if (setData) {
            Object.entries(setData).forEach(([key, value]) => {
              callback(value, key);
            });
          }
        };
        if (this.storage.subscribe) {
          this.storage.subscribe(setKey).then(() => {
            this.storage.on("dataUpdated", (event) => {
              if (event.key === setKey) {
                handleChange();
              }
            });
          });
        }
        handleChange();
        return () => {
          if (this.storage.unsubscribe) {
            this.storage.unsubscribe(setKey);
          }
        };
      } else {
        if (this.storage.subscribe) {
          this.storage.subscribe(fullKey).then((currentValue) => {
            callback(currentValue, fullKey);
          });
          this.storage.on("dataUpdated", (event) => {
            if (event.key === fullKey) {
              this.storage.retrieve(fullKey).then((value) => {
                callback(value, fullKey);
              });
            }
          });
        }
        return () => {
          if (this.storage.unsubscribe) {
            this.storage.unsubscribe(fullKey);
          }
        };
      }
    }
    /**
     * Once - listen for a single change
     * @param {Function} callback - Callback for the change
     * @returns {Promise} Promise that resolves with the value
     */
    async once(callback) {
      return new Promise((resolve) => {
        const unsubscribe = this.on((value, key) => {
          if (callback) callback(value, key);
          unsubscribe();
          resolve(value);
        });
      });
    }
    /**
     * Delete the current path
     * @returns {Promise<boolean>} Success status
     */
    async delete() {
      const fullKey = this.path.join(":");
      const value = await this.storage.retrieve(fullKey);
      if (value && typeof value === "object" && value._keys && value._type === "object") {
        const deletePromises = value._keys.map((key) => {
          const propKey = `${fullKey}:${key}`;
          return this.storage.delete(propKey);
        });
        await Promise.all(deletePromises);
      }
      const result = await this.storage.delete(fullKey);
      this.emit("delete", { key: fullKey });
      return result;
    }
    /**
     * Update with merge semantics
     * @param {any} value - Value to merge
     * @param {Object} options - Update options
     * @returns {Promise<LexicalStorageInterface>} This interface for chaining
     */
    async update(value, options = {}) {
      const fullKey = this.path.join(":");
      const currentValue = await this.storage.retrieve(fullKey);
      let mergedValue;
      if (typeof value === "object" && value !== null && !Array.isArray(value) && typeof currentValue === "object" && currentValue !== null && !Array.isArray(currentValue)) {
        if (currentValue._keys && currentValue._type === "object") {
          const reconstructed = {};
          const promises = currentValue._keys.map(async (key) => {
            const keyValue = await this.storage.retrieve(`${fullKey}:${key}`, options);
            reconstructed[key] = keyValue;
          });
          await Promise.all(promises);
          mergedValue = { ...reconstructed, ...value };
        } else {
          mergedValue = { ...currentValue, ...value };
        }
      } else {
        mergedValue = value;
      }
      await this.put(mergedValue, options);
      this.emit("update", { key: fullKey, value: mergedValue });
      return this;
    }
    /**
     * Create a proxied interface that allows property access
     * @returns {Proxy} Proxied interface
     */
    proxy() {
      return new Proxy(this, {
        get(target, prop) {
          if (typeof target[prop] === "function") {
            return target[prop].bind(target);
          }
          if (typeof prop === "string" && !prop.startsWith("_") && prop !== "constructor") {
            return target.get(prop).proxy();
          }
          return target[prop];
        }
      });
    }
    /**
     * Get the current path as a string
     * @returns {string} The path
     */
    getPath() {
      return this.path.join(":");
    }
    /**
     * Check if a value exists at the current path
     * @returns {Promise<boolean>} Whether the value exists
     */
    async exists() {
      const fullKey = this.path.join(":");
      const value = await this.storage.retrieve(fullKey);
      return value !== null && value !== void 0;
    }
    /**
     * Get all keys under the current path (for object-like structures)
     * @returns {Promise<string[]>} Array of keys
     */
    async keys() {
      const fullKey = this.path.join(":");
      const value = await this.storage.retrieve(fullKey);
      if (value && typeof value === "object" && value._keys && value._type === "object") {
        return value._keys;
      }
      return [];
    }
  };
  function createLexicalInterface(distributedStorage) {
    const lexicalInterface = new LexicalStorageInterface(distributedStorage);
    return lexicalInterface.proxy();
  }

  // src/DistributedStorageManager.js
  var unsea2 = null;
  async function initializeUnsea2() {
    if (unsea2) return unsea2;
    try {
      if (typeof window !== "undefined" && window.__PEERPIGEON_UNSEA__) {
        unsea2 = window.__PEERPIGEON_UNSEA__;
        console.log("\u2705 Using bundled UnSEA crypto for storage");
        return unsea2;
      }
      if (typeof globalThis !== "undefined" && globalThis.__PEERPIGEON_UNSEA__) {
        unsea2 = globalThis.__PEERPIGEON_UNSEA__;
        console.log("\u2705 Using bundled UnSEA crypto for storage");
        return unsea2;
      }
      const isNode = typeof process !== "undefined" && process.versions && process.versions.node;
      if (isNode) {
        unsea2 = await Promise.resolve().then(() => (init_unsea(), unsea_exports));
        console.log("\u2705 Loaded unsea from npm package (Node.js) for storage");
      } else {
        try {
          unsea2 = await import("https://cdn.jsdelivr.net/npm/unsea@latest/+esm");
          console.log("\u2705 Loaded unsea from jsDelivr CDN for storage");
        } catch (jsDelivrError) {
          console.warn("Failed to load from jsDelivr, trying unpkg:", jsDelivrError);
          try {
            unsea2 = await import("https://unpkg.com/unsea@latest/dist/unsea.esm.js");
            console.log("\u2705 Loaded unsea from unpkg CDN for storage");
          } catch (unpkgError) {
            console.warn("Failed to load from unpkg, trying Skypack:", unpkgError);
            unsea2 = await import("https://cdn.skypack.dev/unsea");
            console.log("\u2705 Loaded unsea from Skypack CDN for storage");
          }
        }
      }
      if (!unsea2) {
        throw new Error("Unsea not found after loading");
      }
      return unsea2;
    } catch (error) {
      console.error("Failed to load unsea for storage:", error);
      throw error;
    }
  }
  var DistributedStorageManager = class extends EventEmitter {
    constructor(mesh) {
      super();
      this.debug = DebugLogger_default.create("DistributedStorageManager");
      this.mesh = mesh;
      this.webDHT = mesh.webDHT;
      this.cryptoManager = mesh.cryptoManager;
      this.unsea = null;
      this.storageKeypair = null;
      this.initializeCrypto();
      this.config = {
        encryptionEnabled: true,
        defaultTTL: null,
        // No expiration by default
        maxValueSize: 1024 * 1024,
        // 1MB default max size
        enableCRDT: true,
        conflictResolution: "last-write-wins",
        // or 'crdt-merge'
        spaceEnforcement: true
        // Enable space-based access control
      };
      this.spaces = {
        PRIVATE: "private",
        // Only owner can read/write, encrypted
        PUBLIC: "public",
        // Anyone can read, only owner can write
        FROZEN: "frozen"
        // Immutable once set, anyone can read
      };
      this.storageMetadata = /* @__PURE__ */ new Map();
      this.accessControl = /* @__PURE__ */ new Map();
      this.crdtStates = /* @__PURE__ */ new Map();
      this.ownedKeys = /* @__PURE__ */ new Set();
      this.spaceOwnership = /* @__PURE__ */ new Map();
      this.keyToSpaceMapping = /* @__PURE__ */ new Map();
      this.enabled = true;
      this.debug.log(`DistributedStorageManager initialized for peer ${this.mesh.peerId?.substring(0, 8)}...`);
    }
    /**
     * Initialize unsea encryption for storage
     * @private
     */
    async initializeCrypto() {
      try {
        this.unsea = await initializeUnsea2();
        if (this.cryptoManager && this.cryptoManager.keypair) {
          this.storageKeypair = this.cryptoManager.keypair;
        } else {
          this.storageKeypair = await this.unsea.generateRandomPair();
        }
        this.debug.log("\u{1F4E6} Storage encryption initialized with unsea");
      } catch (error) {
        this.debug.warn("\u{1F4E6} Failed to initialize storage encryption:", error);
        this.config.encryptionEnabled = false;
      }
    }
    /**
     * Wait for crypto initialization to complete
     * @returns {Promise<void>}
     */
    async waitForCrypto() {
      if (this.unsea && this.storageKeypair) {
        return;
      }
      const timeout = 5e3;
      const start = Date.now();
      while ((!this.unsea || !this.storageKeypair) && Date.now() - start < timeout) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    /**
     * Resolve a key to its actual storage location across spaces
     * @param {string} key - The storage key (base key only)
     * @returns {Object} - {space, baseKey, keyId}
     */
    async resolveKey(key) {
      const baseKey = key;
      const keyId = await this.webDHT.hash(baseKey);
      const mapping = this.keyToSpaceMapping.get(baseKey);
      if (mapping) {
        return {
          space: mapping.space,
          baseKey,
          keyId
        };
      }
      if (this.storageMetadata.has(keyId)) {
        const metadata = this.storageMetadata.get(keyId);
        const space = metadata.space || this.spaces.PRIVATE;
        this.keyToSpaceMapping.set(baseKey, { space, storageKey: baseKey });
        return {
          space,
          baseKey,
          keyId
        };
      }
      const defaultSpace = this.spaces.PRIVATE;
      this.keyToSpaceMapping.set(baseKey, { space: defaultSpace, storageKey: baseKey });
      return {
        space: defaultSpace,
        baseKey,
        keyId
      };
    }
    /**
     * Check if a peer can access a key in a specific space
     * @param {string} space - The storage space
     * @param {string} key - The storage key
     * @param {string} peerId - The peer ID requesting access
     * @param {string} operation - The operation (read, write)
     * @returns {boolean} - Whether access is allowed
     */
    canAccessSpace(space, key, peerId, operation = "read") {
      if (!this.config.spaceEnforcement) {
        return true;
      }
      const spaceKey = `${space}:${key}`;
      const owner = this.spaceOwnership.get(spaceKey);
      switch (space) {
        case this.spaces.PRIVATE:
          return !owner || owner === peerId;
        case this.spaces.PUBLIC:
          if (operation === "read") {
            return true;
          } else {
            return !owner || owner === peerId;
          }
        case this.spaces.FROZEN:
          if (operation === "read") {
            return true;
          } else {
            return !owner || owner === peerId;
          }
        default:
          return false;
      }
    }
    /**
     * Determine appropriate space and access control from options
     * @param {Object} options - Storage options
     * @returns {Object} - {space, isPublic, isImmutable}
     */
    determineSpaceFromOptions(options = {}) {
      if (options.space && Object.values(this.spaces).includes(options.space)) {
        const space = options.space;
        return {
          space,
          isPublic: space !== this.spaces.PRIVATE,
          isImmutable: space === this.spaces.FROZEN
        };
      }
      if (options.isImmutable) {
        return {
          space: this.spaces.FROZEN,
          isPublic: true,
          isImmutable: true
        };
      } else if (options.isPublic) {
        return {
          space: this.spaces.PUBLIC,
          isPublic: true,
          isImmutable: false
        };
      } else {
        return {
          space: this.spaces.PRIVATE,
          isPublic: false,
          isImmutable: false
        };
      }
    }
    /**
     * Find if a base key exists in a different space
     * @param {string} baseKey - The base key to search for
     * @param {string} excludeSpace - The space to exclude from search
     * @returns {string|null} - The space where the key exists, or null if not found
     */
    findKeyInDifferentSpace(baseKey, excludeSpace) {
      for (const metadata of this.storageMetadata.values()) {
        if (metadata.baseKey === baseKey && metadata.space !== excludeSpace) {
          return metadata.space;
        }
      }
      if (this.spaceOwnership.has(baseKey)) {
        const mapping = this.keyToSpaceMapping.get(baseKey);
        if (mapping && mapping.space !== excludeSpace) {
          return mapping.space;
        }
      }
      return null;
    }
    /**
     * Check if the current peer has read access to a key with space awareness
     * @param {string} keyId - The key ID
     * @param {Object} metadata - The metadata object
     * @param {string} space - The storage space
     * @returns {boolean} - Whether access is allowed
     */
    hasReadAccessWithSpace(keyId, metadata, space) {
      const accessControl = this.accessControl.get(keyId);
      if (!accessControl && metadata) {
        this.accessControl.set(keyId, {
          isPublic: metadata.isPublic,
          owner: metadata.owner,
          allowedPeers: new Set(metadata.allowedPeers || []),
          isImmutable: metadata.isImmutable,
          space: metadata.space || space
        });
        return this.hasReadAccessWithSpace(keyId, metadata, space);
      }
      if (!accessControl) {
        return false;
      }
      if (accessControl.owner === this.mesh.peerId) {
        return true;
      }
      switch (space) {
        case this.spaces.PRIVATE:
          return accessControl.allowedPeers.has(this.mesh.peerId);
        case this.spaces.PUBLIC:
        case this.spaces.FROZEN:
          return true;
        default:
          return false;
      }
    }
    /**
     * Store data with encryption and access control
     * @param {string} key - The storage key
     * @param {any} value - The value to store
     * @param {Object} options - Storage options
     * @param {string} options.space - Storage space ('private', 'public', 'frozen')
     * @param {boolean} options.isPublic - Whether data is publicly readable (legacy, use space instead)
     * @param {boolean} options.isImmutable - Whether data is immutable (legacy, use frozen space instead)
     * @param {boolean} options.enableCRDT - Whether to enable CRDT for collaborative editing (default: false)
     * @param {number} options.ttl - Time to live in milliseconds
     * @param {Array<string>} options.allowedPeers - Specific peers allowed to read private data
     * @returns {Promise<boolean>} Success status
     */
    async store(key, value, options = {}) {
      if (!this.enabled) {
        return false;
      }
      if (!this.webDHT) {
        throw new Error("WebDHT not available - ensure it is enabled in mesh configuration");
      }
      if (this.config.encryptionEnabled) {
        await this.waitForCrypto();
      }
      const spaceConfig = this.determineSpaceFromOptions(options);
      const baseKey = key;
      const space = options.space || spaceConfig.space;
      const storageKey = baseKey;
      if (!this.canAccessSpace(space, baseKey, this.mesh.peerId, "write")) {
        throw new Error(`Write access denied for space "${space}" and key "${baseKey}"`);
      }
      const keyId = await this.webDHT.hash(storageKey);
      const timestamp = Date.now();
      this.debug.log(`\u{1F4E6} Storing key: ${storageKey} in ${space} space, keyId: ${keyId.toString(16).substring(0, 8)}...`);
      const serializedValue = JSON.stringify(value);
      if (serializedValue.length > this.config.maxValueSize) {
        throw new Error(`Value size exceeds maximum allowed size of ${this.config.maxValueSize} bytes`);
      }
      const metadata = {
        key: baseKey,
        // Just the base key, no prefixes - space is its own attribute
        baseKey,
        space,
        keyId,
        owner: this.mesh.peerId,
        isPublic: spaceConfig.isPublic,
        isImmutable: spaceConfig.isImmutable,
        enableCRDT: options.enableCRDT || false,
        allowedPeers: options.allowedPeers || [],
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1,
        ttl: options.ttl || this.config.defaultTTL,
        type: "storage",
        // Mark this as storage data type
        dataType: "distributed-storage"
        // Specific storage system identifier
      };
      this.storageMetadata.set(keyId, metadata);
      this.ownedKeys.add(keyId);
      this.spaceOwnership.set(baseKey, this.mesh.peerId);
      this.keyToSpaceMapping.set(baseKey, { space, storageKey });
      this.accessControl.set(keyId, {
        isPublic: metadata.isPublic,
        owner: metadata.owner,
        allowedPeers: new Set(metadata.allowedPeers),
        isImmutable: metadata.isImmutable,
        space
      });
      if (metadata.enableCRDT) {
        this.crdtStates.set(keyId, {
          vectorClock: { [this.mesh.peerId]: 1 },
          operations: [],
          lastMerged: timestamp
        });
      }
      let storagePayload = {
        value,
        metadata,
        encrypted: false
      };
      if (space === this.spaces.PRIVATE && this.config.encryptionEnabled && this.unsea && this.storageKeypair) {
        try {
          const encryptedValue = await this.unsea.encryptMessageWithMeta(serializedValue, this.storageKeypair);
          storagePayload = {
            value: encryptedValue,
            metadata,
            encrypted: true,
            encryptedBy: this.mesh.peerId
            // Track who encrypted it
          };
          this.debug.log(`\u{1F4E6} Encrypted private space storage data for key: ${storageKey} (owner-only access)`);
        } catch (error) {
          this.debug.warn(`Failed to encrypt private space storage data for key ${storageKey}:`, error);
        }
      } else {
        this.debug.log(`\u{1F4E6} Storing ${space} space data for key: ${storageKey}`);
      }
      this.debug.log(`\u{1F4E6} STORING PAYLOAD STRUCTURE for key ${storageKey}:`, {
        hasValue: !!storagePayload.value,
        hasMetadata: !!storagePayload.metadata,
        valueType: typeof storagePayload.value,
        metadataType: typeof storagePayload.metadata,
        metadataKeys: storagePayload.metadata ? Object.keys(storagePayload.metadata) : "none",
        encrypted: storagePayload.encrypted,
        payloadKeys: Object.keys(storagePayload)
      });
      try {
        this.debug.log(`\u{1F4E6} Storing payload for key ${storageKey}:`, {
          hasValue: !!storagePayload.value,
          hasMetadata: !!storagePayload.metadata,
          encrypted: storagePayload.encrypted,
          space
        });
        await this.webDHT.put(storageKey, storagePayload, {
          ttl: metadata.ttl,
          space
          // Pass space for space-aware replication
        });
        this.debug.log(`\u{1F4E6} Stored ${space} space data for key: ${storageKey}`);
        this.emit("dataStored", {
          key: storageKey,
          baseKey,
          space,
          keyId,
          isPublic: metadata.isPublic,
          isImmutable: metadata.isImmutable,
          enableCRDT: metadata.enableCRDT
        });
        return true;
      } catch (error) {
        this.debug.error(`Failed to store data for key ${storageKey}:`, error);
        this.storageMetadata.delete(keyId);
        this.ownedKeys.delete(keyId);
        this.accessControl.delete(keyId);
        this.crdtStates.delete(keyId);
        this.spaceOwnership.delete(baseKey);
        this.keyToSpaceMapping.delete(baseKey);
        throw error;
      }
    }
    /**
     * Retrieve data with access control and decryption
     * @param {string} key - The storage key (base key only, no prefixes)
     * @param {Object} options - Retrieval options
     * @param {string} options.space - Specific space to look in (optional)
     * @param {boolean} options.forceRefresh - Force refresh from network
     * @returns {Promise<any>} The stored value or null if not accessible
     */
    async retrieve(key, options = {}) {
      if (!this.webDHT) {
        throw new Error("WebDHT not available - ensure it is enabled in mesh configuration");
      }
      if (this.config.encryptionEnabled) {
        await this.waitForCrypto();
      }
      const baseKey = key;
      this.debug.log(`\u{1F4E6} Retrieving data for base key: ${baseKey}`);
      try {
        const webDHTPayload = await this.webDHT.get(baseKey, {
          forceRefresh: options.forceRefresh,
          space: options.space
          // Pass space for space-aware replication
        });
        this.debug.log(`\u{1F4E6} Retrieved WebDHT payload for key ${baseKey}:`, {
          payloadExists: !!webDHTPayload,
          payloadType: typeof webDHTPayload,
          keys: webDHTPayload ? Object.keys(webDHTPayload) : "none"
        });
        if (!webDHTPayload || typeof webDHTPayload !== "object") {
          this.debug.log(`\u{1F4E6} No data found for key: ${baseKey}`);
          return null;
        }
        return await this.processRetrievedData(baseKey, webDHTPayload);
      } catch (error) {
        this.debug.error(`Failed to retrieve data for key ${baseKey}:`, error);
        return null;
      }
    }
    /**
     * Process retrieved data payload with decryption and access control
     * @private
     */
    async processRetrievedData(baseKey, webDHTPayload) {
      try {
        const keyId = await this.webDHT.hash(baseKey);
        const storagePayload = webDHTPayload;
        console.log(`\u{1F4E6} CRITICAL DEBUG: WebDHT payload structure for ${baseKey}:`, {
          webDHTKeys: Object.keys(webDHTPayload),
          payloadType: typeof webDHTPayload,
          directValue: !!webDHTPayload.value,
          directMetadata: !!webDHTPayload.metadata,
          directEncrypted: webDHTPayload.encrypted
        });
        if (!storagePayload || typeof storagePayload !== "object") {
          console.log(`\u{1F4E6} CRITICAL: Invalid storage payload for key: ${baseKey}`);
          this.debug.log(`\u{1F4E6} Invalid storage payload for key: ${baseKey}`);
          return null;
        }
        const value = storagePayload.value;
        const metadata = storagePayload.metadata;
        const encrypted = storagePayload.encrypted || false;
        const encryptedBy = storagePayload.encryptedBy;
        if (!metadata) {
          this.debug.warn(`\u{1F4E6} Invalid storage payload for key ${baseKey}: missing metadata`);
          return null;
        }
        if (!metadata.type || metadata.type !== "storage") {
          this.debug.log(`\u{1F4E6} Data for key ${baseKey} is not storage data (type: ${metadata.type || "unknown"}) - ignoring`);
          return null;
        }
        const space = metadata.space;
        this.debug.log("\u{1F4E6} Payload components:", {
          hasValue: value !== void 0,
          valueType: typeof value,
          hasMetadata: metadata !== void 0,
          metadataType: typeof metadata,
          encrypted,
          space: space || "unknown",
          encryptedBy: encryptedBy?.substring(0, 8) + "..." || "unknown"
        });
        if (!this.canAccessSpace(space, baseKey, this.mesh.peerId, "read")) {
          this.debug.warn(`\u{1F4E6} Access denied for key: ${baseKey} in space: ${space}`);
          return null;
        }
        if (!this.hasReadAccessWithSpace(keyId, metadata, space)) {
          this.debug.warn(`\u{1F4E6} Access denied for key: ${baseKey} in space: ${space}`);
          return null;
        }
        let finalValue = value;
        if (encrypted && this.unsea && this.storageKeypair) {
          if (encryptedBy && encryptedBy !== this.mesh.peerId) {
            this.debug.warn(`\u{1F4E6} Cannot decrypt data for key ${baseKey}: encrypted by different peer (${encryptedBy.substring(0, 8)}...), current peer: ${this.mesh.peerId.substring(0, 8)}...`);
            if (!metadata.isPublic) {
              this.debug.warn(`Access denied for key: ${baseKey} - private data encrypted by different peer`);
              return null;
            }
          }
          try {
            const decryptedValue = await this.unsea.decryptMessageWithMeta(value, this.storageKeypair.epriv);
            finalValue = JSON.parse(decryptedValue);
            this.debug.log(`\u{1F513} Decrypted storage data for key: ${baseKey}`);
          } catch (error) {
            this.debug.error(`Failed to decrypt data for key ${baseKey}:`, error);
            if (!metadata.isPublic) {
              return null;
            }
            this.debug.warn(`\u{1F4E6} Using raw value for public key ${baseKey} due to decryption failure`);
            finalValue = value;
          }
        }
        if (!this.storageMetadata.has(keyId)) {
          this.storageMetadata.set(keyId, metadata);
          this.accessControl.set(keyId, {
            isPublic: metadata.isPublic,
            owner: metadata.owner,
            allowedPeers: new Set(metadata.allowedPeers),
            isImmutable: metadata.isImmutable,
            space: metadata.space || space
          });
          if (metadata.owner && !this.spaceOwnership.has(baseKey)) {
            this.spaceOwnership.set(baseKey, metadata.owner);
          }
          this.keyToSpaceMapping.set(baseKey, { space, storageKey: baseKey });
        }
        this.debug.log(`\u{1F4E6} Retrieved ${space} space data for key: ${baseKey}`);
        this.emit("dataRetrieved", {
          key: baseKey,
          baseKey,
          space,
          keyId,
          isPublic: metadata.isPublic,
          owner: metadata.owner
        });
        return finalValue;
      } catch (error) {
        this.debug.error(`Failed to retrieve data for key ${baseKey}:`, error);
        return null;
      }
    }
    /**
     * Update existing data (only allowed for owners or if mutable)
     * @param {string} key - The storage key
     * @param {any} newValue - The new value
     * @param {Object} options - Update options
     * @param {boolean} options.forceCRDTMerge - Force CRDT merge even if not owner
     * @returns {Promise<boolean>} Success status
     */
    async update(key, newValue, options = {}) {
      if (!this.webDHT) {
        throw new Error("WebDHT not available - ensure it is enabled in mesh configuration");
      }
      const resolved = await this.resolveKey(key);
      const { baseKey, keyId } = resolved;
      const timestamp = Date.now();
      let accessControl = this.accessControl.get(keyId);
      let metadata = this.storageMetadata.get(keyId);
      if (!accessControl || !metadata) {
        const existingData = await this.retrieve(baseKey);
        if (!existingData) {
          throw new Error(`Key ${key} does not exist or is not accessible`);
        }
        const updatedAccessControl = this.accessControl.get(keyId);
        const updatedMetadata = this.storageMetadata.get(keyId);
        if (!updatedAccessControl || !updatedMetadata) {
          throw new Error(`Key ${key} metadata could not be loaded - unable to update`);
        }
        accessControl = updatedAccessControl;
        metadata = updatedMetadata;
      }
      const isOwner = accessControl.owner === this.mesh.peerId;
      const canUpdate = isOwner || !accessControl.isImmutable || metadata.enableCRDT && options.forceCRDTMerge;
      if (!canUpdate) {
        throw new Error(`Update not allowed for key ${key}: immutable data and not owner`);
      }
      if (metadata.enableCRDT && !isOwner) {
        return this.applyCRDTUpdate(key, keyId, newValue, options);
      }
      metadata.updatedAt = timestamp;
      metadata.version += 1;
      let storagePayload = {
        value: newValue,
        metadata,
        encrypted: false
      };
      if (!metadata.isPublic && this.config.encryptionEnabled && this.unsea && this.storageKeypair) {
        try {
          const serializedValue = JSON.stringify(newValue);
          const encryptedValue = await this.unsea.encryptMessageWithMeta(serializedValue, this.storageKeypair);
          storagePayload = {
            value: encryptedValue,
            metadata,
            encrypted: true,
            encryptedBy: this.mesh.peerId
            // Track who encrypted it
          };
          this.debug.log(`\u{1F4E6} Encrypted updated storage data for key: ${key}`);
        } catch (error) {
          this.debug.warn(`Failed to encrypt updated storage data for key ${key}:`, error);
        }
      }
      try {
        await this.webDHT.update(baseKey, storagePayload, {
          ttl: metadata.ttl
        });
        this.storageMetadata.set(keyId, metadata);
        this.debug.log(`\u{1F4E6} Updated ${metadata.isPublic ? "public" : "private"} data for key: ${baseKey}`);
        this.emit("dataUpdated", {
          key: baseKey,
          keyId,
          isPublic: metadata.isPublic,
          version: metadata.version,
          isOwner
        });
        return true;
      } catch (error) {
        this.debug.error(`Failed to update data for key ${baseKey}:`, error);
        throw error;
      }
    }
    /**
     * Apply CRDT-based update for collaborative editing
     * @private
     */
    async applyCRDTUpdate(key, keyId, operation, options = {}) {
      const crdtState = this.crdtStates.get(keyId);
      const metadata = this.storageMetadata.get(keyId);
      if (!crdtState || !metadata) {
        throw new Error(`CRDT state not found for key ${key}`);
      }
      const currentClock = crdtState.vectorClock[this.mesh.peerId] || 0;
      crdtState.vectorClock[this.mesh.peerId] = currentClock + 1;
      const crdtOperation = {
        peerId: this.mesh.peerId,
        timestamp: Date.now(),
        vectorClock: { ...crdtState.vectorClock },
        operation,
        type: options.operationType || "replace"
      };
      crdtState.operations.push(crdtOperation);
      crdtState.lastMerged = Date.now();
      const mergedValue = this.mergeCRDTOperations(crdtState.operations);
      return this.update(key, mergedValue, { ...options, forceCRDTMerge: false });
    }
    /**
     * Simple CRDT merge implementation (can be extended for more sophisticated CRDTs)
     * @private
     */
    mergeCRDTOperations(operations) {
      const sortedOps = operations.sort((a, b) => a.timestamp - b.timestamp);
      let result = null;
      for (const op of sortedOps) {
        switch (op.type) {
          case "replace":
            result = op.operation;
            break;
          case "merge":
            if (result && typeof result === "object" && typeof op.operation === "object") {
              result = { ...result, ...op.operation };
            } else {
              result = op.operation;
            }
            break;
          default:
            result = op.operation;
        }
      }
      return result;
    }
    /**
     * Delete data (only allowed for owners)
     * @param {string} key - The storage key
     * @returns {Promise<boolean>} Success status
     */
    async delete(key) {
      if (!this.webDHT) {
        throw new Error("WebDHT not available - ensure it is enabled in mesh configuration");
      }
      const resolved = await this.resolveKey(key);
      const { baseKey, keyId } = resolved;
      const accessControl = this.accessControl.get(keyId);
      if (!accessControl || accessControl.owner !== this.mesh.peerId) {
        throw new Error(`Delete not allowed for key ${key}: not owner`);
      }
      try {
        const tombstone = {
          deleted: true,
          deletedAt: Date.now(),
          deletedBy: this.mesh.peerId
        };
        await this.webDHT.update(baseKey, tombstone);
        this.storageMetadata.delete(keyId);
        this.ownedKeys.delete(keyId);
        this.accessControl.delete(keyId);
        this.crdtStates.delete(keyId);
        this.spaceOwnership.delete(baseKey);
        this.keyToSpaceMapping.delete(baseKey);
        this.debug.log(`\u{1F4E6} Deleted data for key: ${baseKey}`);
        this.emit("dataDeleted", { key: baseKey, keyId });
        return true;
      } catch (error) {
        this.debug.error(`Failed to delete data for key ${baseKey}:`, error);
        throw error;
      }
    }
    /**
     * Subscribe to changes for a storage key
     * @param {string} key - The storage key
     * @returns {Promise<any>} Current value or null
     */
    async subscribe(key) {
      if (!this.webDHT) {
        throw new Error("WebDHT not available - ensure it is enabled in mesh configuration");
      }
      const currentValue = await this.webDHT.subscribe(key);
      this.debug.log(`\u{1F4E6} Subscribed to storage key: ${key}`);
      return currentValue;
    }
    /**
     * Unsubscribe from changes for a storage key
     * @param {string} key - The storage key
     */
    async unsubscribe(key) {
      if (!this.webDHT) {
        return;
      }
      await this.webDHT.unsubscribe(key);
      this.debug.log(`\u{1F4E6} Unsubscribed from storage key: ${key}`);
    }
    /**
     * Check if the current peer has read access to a key
     * @private
     */
    hasReadAccess(keyId, metadata) {
      const accessControl = this.accessControl.get(keyId);
      if (!accessControl && metadata) {
        this.accessControl.set(keyId, {
          isPublic: metadata.isPublic,
          owner: metadata.owner,
          allowedPeers: new Set(metadata.allowedPeers || []),
          isImmutable: metadata.isImmutable
        });
        return this.hasReadAccess(keyId, metadata);
      }
      if (!accessControl) {
        return false;
      }
      if (accessControl.owner === this.mesh.peerId) {
        return true;
      }
      if (accessControl.isPublic) {
        return true;
      }
      return accessControl.allowedPeers.has(this.mesh.peerId);
    }
    /**
     * Grant access to a peer for a private key (only owner can do this)
     * @param {string} key - The storage key
     * @param {string} peerId - The peer to grant access to
     * @returns {Promise<boolean>} Success status
     */
    async grantAccess(key, peerId) {
      const resolved = await this.resolveKey(key);
      const { baseKey, keyId } = resolved;
      const accessControl = this.accessControl.get(keyId);
      const metadata = this.storageMetadata.get(keyId);
      if (!accessControl || !metadata || accessControl.owner !== this.mesh.peerId) {
        throw new Error(`Cannot grant access for key ${key}: not owner`);
      }
      if (accessControl.isPublic) {
        throw new Error(`Cannot grant access for key ${key}: already public`);
      }
      accessControl.allowedPeers.add(peerId);
      metadata.allowedPeers.push(peerId);
      metadata.updatedAt = Date.now();
      try {
        const currentPayload = await this.webDHT.get(baseKey);
        if (currentPayload) {
          currentPayload.metadata = metadata;
          await this.webDHT.update(baseKey, currentPayload);
        }
        this.debug.log(`\u{1F4E6} Granted access to peer ${peerId.substring(0, 8)}... for key: ${baseKey}`);
        this.emit("accessGranted", { key: baseKey, keyId, peerId });
        return true;
      } catch (error) {
        accessControl.allowedPeers.delete(peerId);
        metadata.allowedPeers = metadata.allowedPeers.filter((p) => p !== peerId);
        throw error;
      }
    }
    /**
     * Revoke access from a peer for a private key (only owner can do this)
     * @param {string} key - The storage key
     * @param {string} peerId - The peer to revoke access from
     * @returns {Promise<boolean>} Success status
     */
    async revokeAccess(key, peerId) {
      const resolved = await this.resolveKey(key);
      const { baseKey, keyId } = resolved;
      const accessControl = this.accessControl.get(keyId);
      const metadata = this.storageMetadata.get(keyId);
      if (!accessControl || !metadata || accessControl.owner !== this.mesh.peerId) {
        throw new Error(`Cannot revoke access for key ${key}: not owner`);
      }
      accessControl.allowedPeers.delete(peerId);
      metadata.allowedPeers = metadata.allowedPeers.filter((p) => p !== peerId);
      metadata.updatedAt = Date.now();
      try {
        const currentPayload = await this.webDHT.get(baseKey);
        if (currentPayload) {
          currentPayload.metadata = metadata;
          await this.webDHT.update(baseKey, currentPayload);
        }
        this.debug.log(`\u{1F4E6} Revoked access from peer ${peerId.substring(0, 8)}... for key: ${baseKey}`);
        this.emit("accessRevoked", { key: baseKey, keyId, peerId });
        return true;
      } catch (error) {
        accessControl.allowedPeers.add(peerId);
        metadata.allowedPeers.push(peerId);
        throw error;
      }
    }
    /**
     * List all keys owned by this peer
     * @returns {Array<Object>} Array of owned key metadata
     */
    getOwnedKeys() {
      const ownedKeys = [];
      for (const keyId of this.ownedKeys) {
        const metadata = this.storageMetadata.get(keyId);
        if (metadata) {
          ownedKeys.push({
            key: metadata.key,
            keyId,
            isPublic: metadata.isPublic,
            isImmutable: metadata.isImmutable,
            enableCRDT: metadata.enableCRDT,
            createdAt: metadata.createdAt,
            updatedAt: metadata.updatedAt,
            version: metadata.version
          });
        }
      }
      return ownedKeys;
    }
    /**
     * Get statistics about the storage manager
     * @returns {Promise<Object>} Storage statistics
     */
    async getStats() {
      let totalSize = 0;
      let itemCount = 0;
      for (const keyId of this.ownedKeys) {
        const metadata = this.storageMetadata.get(keyId);
        if (metadata) {
          try {
            const value = await this.retrieve(metadata.key);
            if (value !== null) {
              const serializedSize = JSON.stringify(value).length;
              totalSize += serializedSize;
              itemCount++;
            }
          } catch (error) {
          }
        }
      }
      return {
        enabled: this.enabled,
        itemCount,
        totalSize,
        ownedKeys: this.ownedKeys.size,
        totalKeys: this.storageMetadata.size,
        crdtKeys: this.crdtStates.size,
        encryptionEnabled: this.config.encryptionEnabled && !!this.unsea && !!this.storageKeypair,
        maxValueSize: this.config.maxValueSize
      };
    }
    /**
     * Clean up expired data and old CRDT operations
     */
    cleanup() {
      const now = Date.now();
      for (const [keyId, metadata] of this.storageMetadata.entries()) {
        if (metadata.ttl && metadata.createdAt + metadata.ttl < now) {
          this.storageMetadata.delete(keyId);
          this.accessControl.delete(keyId);
          this.ownedKeys.delete(keyId);
          this.debug.log(`\u{1F4E6} Cleaned up expired metadata for key: ${metadata.key}`);
        }
      }
      for (const [keyId, crdtState] of this.crdtStates.entries()) {
        if (crdtState.operations.length > 100) {
          crdtState.operations = crdtState.operations.slice(-100);
          this.debug.log(`\u{1F4E6} Cleaned up old CRDT operations for key: ${keyId.substring(0, 8)}...`);
        }
      }
    }
    /**
     * Backup all owned data to a serializable format
     * @returns {Object} Backup data that can be restored later
     */
    async backup() {
      const backupData = {
        version: "1.0.0",
        timestamp: Date.now(),
        peerId: this.mesh.peerId,
        keys: []
      };
      for (const keyId of this.ownedKeys) {
        const metadata = this.storageMetadata.get(keyId);
        if (metadata) {
          try {
            const value = await this.retrieve(metadata.key);
            if (value !== null) {
              backupData.keys.push({
                key: metadata.key,
                value,
                metadata: {
                  isPublic: metadata.isPublic,
                  isImmutable: metadata.isImmutable,
                  enableCRDT: metadata.enableCRDT,
                  allowedPeers: metadata.allowedPeers,
                  ttl: metadata.ttl
                }
              });
            }
          } catch (error) {
            this.debug.warn(`Failed to backup key ${metadata.key}:`, error);
          }
        }
      }
      this.debug.log(`\u{1F4E6} Created backup with ${backupData.keys.length} keys`);
      return backupData;
    }
    /**
     * Restore data from a backup
     * @param {Object} backupData - Backup data created by backup()
     * @param {Object} options - Restore options
     * @param {boolean} options.overwrite - Whether to overwrite existing keys (default: false)
     * @returns {Promise<Object>} Restore results
     */
    async restore(backupData, options = {}) {
      if (!backupData || !backupData.keys || !Array.isArray(backupData.keys)) {
        throw new Error("Invalid backup data format");
      }
      const results = {
        restored: 0,
        skipped: 0,
        failed: 0,
        errors: []
      };
      for (const keyData of backupData.keys) {
        try {
          const { key, value, metadata } = keyData;
          const existing = await this.retrieve(key);
          if (existing !== null && !options.overwrite) {
            results.skipped++;
            continue;
          }
          await this.store(key, value, metadata);
          results.restored++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            key: keyData.key,
            error: error.message
          });
          this.debug.warn(`Failed to restore key ${keyData.key}:`, error);
        }
      }
      this.debug.log(`\u{1F4E6} Restore complete: ${results.restored} restored, ${results.skipped} skipped, ${results.failed} failed`);
      return results;
    }
    /**
     * List all accessible keys (owned + granted access)
     * @returns {Array<Object>} Array of accessible key metadata
     */
    async listAccessibleKeys() {
      const accessibleKeys = [];
      for (const keyId of this.ownedKeys) {
        const metadata = this.storageMetadata.get(keyId);
        if (metadata) {
          accessibleKeys.push({
            key: metadata.key,
            keyId,
            isPublic: metadata.isPublic,
            isImmutable: metadata.isImmutable,
            enableCRDT: metadata.enableCRDT,
            createdAt: metadata.createdAt,
            updatedAt: metadata.updatedAt,
            version: metadata.version,
            owned: true,
            accessible: true
          });
        }
      }
      for (const [keyId] of this.accessControl.entries()) {
        if (!this.ownedKeys.has(keyId) && this.hasReadAccess(keyId)) {
          const metadata = this.storageMetadata.get(keyId);
          if (metadata) {
            accessibleKeys.push({
              key: metadata.key,
              keyId,
              isPublic: metadata.isPublic,
              isImmutable: metadata.isImmutable,
              enableCRDT: metadata.enableCRDT,
              createdAt: metadata.createdAt,
              updatedAt: metadata.updatedAt,
              version: metadata.version,
              owned: false,
              accessible: true
            });
          }
        }
      }
      return accessibleKeys;
    }
    /**
     * Bulk store multiple key-value pairs
     * @param {Array<Object>} items - Array of {key, value, options} objects
     * @param {Object} globalOptions - Options to apply to all items
     * @returns {Promise<Object>} Results summary
     */
    async bulkStore(items, globalOptions = {}) {
      const results = {
        stored: 0,
        failed: 0,
        errors: []
      };
      const storePromises = items.map(async (item) => {
        try {
          const options = { ...globalOptions, ...item.options };
          await this.store(item.key, item.value, options);
          results.stored++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            key: item.key,
            error: error.message
          });
        }
      });
      await Promise.allSettled(storePromises);
      this.debug.log(`\u{1F4E6} Bulk store complete: ${results.stored} stored, ${results.failed} failed`);
      return results;
    }
    /**
     * Bulk retrieve multiple keys
     * @param {Array<string>} keys - Array of keys to retrieve
     * @param {Object} options - Retrieval options
     * @returns {Promise<Object>} Map of key -> value (null for inaccessible keys)
     */
    async bulkRetrieve(keys, options = {}) {
      const results = {};
      const retrievePromises = keys.map(async (key) => {
        try {
          const value = await this.retrieve(key, options);
          results[key] = value;
        } catch (error) {
          this.debug.warn(`Failed to retrieve key ${key}:`, error);
          results[key] = null;
        }
      });
      await Promise.allSettled(retrievePromises);
      return results;
    }
    /**
     * Search for keys by pattern or metadata
     * @param {Object} criteria - Search criteria
     * @param {string} criteria.keyPattern - Regex pattern to match keys
     * @param {boolean} criteria.isPublic - Filter by public/private
     * @param {boolean} criteria.owned - Filter by ownership
     * @param {string} criteria.owner - Filter by specific owner
     * @returns {Array<Object>} Matching keys
     */
    searchKeys(criteria = {}) {
      const matches = [];
      for (const [keyId, metadata] of this.storageMetadata.entries()) {
        let match = true;
        if (criteria.keyPattern) {
          const regex = new RegExp(criteria.keyPattern);
          if (!regex.test(metadata.key)) {
            match = false;
          }
        }
        if (criteria.isPublic !== void 0 && metadata.isPublic !== criteria.isPublic) {
          match = false;
        }
        if (criteria.owned !== void 0) {
          const isOwned = this.ownedKeys.has(keyId);
          if (isOwned !== criteria.owned) {
            match = false;
          }
        }
        if (criteria.owner && metadata.owner !== criteria.owner) {
          match = false;
        }
        if (match) {
          matches.push({
            key: metadata.key,
            keyId,
            isPublic: metadata.isPublic,
            isImmutable: metadata.isImmutable,
            enableCRDT: metadata.enableCRDT,
            owner: metadata.owner,
            createdAt: metadata.createdAt,
            updatedAt: metadata.updatedAt,
            version: metadata.version,
            owned: this.ownedKeys.has(keyId)
          });
        }
      }
      return matches;
    }
    /**
     * Watch for changes to multiple keys
     * @param {Array<string>} keys - Keys to watch
     * @param {Function} callback - Callback function for changes
     * @returns {Function} Unwatch function
     */
    async watchKeys(keys, callback) {
      const subscriptions = /* @__PURE__ */ new Set();
      for (const key of keys) {
        try {
          await this.subscribe(key);
          subscriptions.add(key);
        } catch (error) {
          this.debug.warn(`Failed to subscribe to key ${key}:`, error);
        }
      }
      const eventHandler = (event) => {
        if (keys.includes(event.key)) {
          callback(event);
        }
      };
      this.addEventListener("dataUpdated", eventHandler);
      this.addEventListener("dataDeleted", eventHandler);
      return async () => {
        for (const key of subscriptions) {
          try {
            await this.unsubscribe(key);
          } catch (error) {
            this.debug.warn(`Failed to unsubscribe from key ${key}:`, error);
          }
        }
        this.removeEventListener("dataUpdated", eventHandler);
        this.removeEventListener("dataDeleted", eventHandler);
      };
    }
    /**
     * Get detailed information about a key including access control
     * @param {string} key - The storage key
     * @returns {Promise<Object|null>} Key information or null if not found
     */
    async getKeyInfo(key) {
      const resolved = await this.resolveKey(key);
      const { baseKey, keyId } = resolved;
      let metadata = this.storageMetadata.get(keyId);
      if (!metadata) {
        try {
          const existingData = await this.retrieve(baseKey);
          if (existingData !== null) {
            metadata = this.storageMetadata.get(keyId);
          }
        } catch (error) {
          this.debug.warn(`Failed to retrieve metadata for key ${key}:`, error);
        }
      }
      if (!metadata) {
        return null;
      }
      return {
        key: metadata.key,
        keyId,
        owner: metadata.owner,
        isPublic: metadata.isPublic,
        isImmutable: metadata.isImmutable,
        enableCRDT: metadata.enableCRDT,
        allowedPeers: metadata.allowedPeers,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
        version: metadata.version,
        ttl: metadata.ttl,
        owned: this.ownedKeys.has(keyId),
        accessible: this.hasReadAccess(keyId, metadata),
        crdtEnabled: this.crdtStates.has(keyId)
      };
    }
    /**
     * Enable the distributed storage layer
     * @returns {Promise<void>}
     */
    async enable() {
      if (!this.webDHT) {
        throw new Error("WebDHT not available - ensure it is enabled in mesh configuration");
      }
      this.enabled = true;
      this.debug.log("\u{1F4E6} Distributed storage enabled");
      this.emit("storageEnabled");
    }
    /**
     * Disable the distributed storage layer
     * @returns {Promise<void>}
     */
    async disable() {
      this.enabled = false;
      this.debug.log("\u{1F4E6} Distributed storage disabled");
      this.emit("storageDisabled");
    }
    /**
     * Check if the distributed storage layer is enabled
     * @returns {boolean} Whether storage is enabled
     */
    isEnabled() {
      return this.enabled;
    }
    /**
     * Clear all stored data owned by this peer
     * @returns {Promise<void>}
     */
    async clear() {
      const ownedKeys = Array.from(this.ownedKeys);
      for (const keyId of ownedKeys) {
        const metadata = this.storageMetadata.get(keyId);
        if (metadata) {
          try {
            await this.delete(metadata.key);
          } catch (error) {
            this.debug.warn(`Failed to delete key ${metadata.key} during clear:`, error);
          }
        }
      }
      this.storageMetadata.clear();
      this.accessControl.clear();
      this.crdtStates.clear();
      this.ownedKeys.clear();
      this.spaceOwnership.clear();
      this.keyToSpaceMapping.clear();
      this.debug.log("\u{1F4E6} All stored data cleared");
      this.emit("storageCleared");
    }
    /**
     * List keys with optional prefix filter
     * @param {string} prefix - Optional prefix to filter keys
     * @returns {Promise<Array<string>>} Array of matching keys
     */
    async listKeys(prefix = "") {
      const keys = [];
      for (const keyId of this.ownedKeys) {
        const metadata = this.storageMetadata.get(keyId);
        if (metadata) {
          const storedKey = metadata.key;
          const baseKey = metadata.baseKey;
          if (storedKey.startsWith(prefix) || baseKey.startsWith(prefix)) {
            keys.push(baseKey);
          }
        }
      }
      return keys.sort();
    }
    /**
     * Bulk delete keys with a given prefix
     * @param {string} prefix - Prefix of keys to delete
     * @returns {Promise<number>} Number of keys deleted
     */
    async bulkDelete(prefix) {
      const keysToDelete = await this.listKeys(prefix);
      let deletedCount = 0;
      for (const key of keysToDelete) {
        try {
          await this.delete(key);
          deletedCount++;
        } catch (error) {
          this.debug.warn(`Failed to delete key ${key} during bulk delete:`, error);
        }
      }
      return deletedCount;
    }
    /**
     * Search for data by key, value, or metadata
     * @param {string} query - Search query
     * @param {string} type - Search type: 'key', 'value', or 'metadata'
     * @returns {Promise<Array<Object>>} Search results
     */
    async search(query, type = "key") {
      const results = [];
      const searchRegex = new RegExp(query, "i");
      for (const keyId of this.ownedKeys) {
        const metadata = this.storageMetadata.get(keyId);
        if (!metadata) continue;
        let match = false;
        if (type === "key" && searchRegex.test(metadata.key)) {
          match = true;
        } else if (type === "value") {
          try {
            const value = await this.retrieve(metadata.key);
            if (value && searchRegex.test(JSON.stringify(value))) {
              match = true;
            }
          } catch (error) {
          }
        } else if (type === "metadata") {
          const metadataStr = JSON.stringify({
            owner: metadata.owner,
            isPublic: metadata.isPublic,
            isImmutable: metadata.isImmutable,
            enableCRDT: metadata.enableCRDT
          });
          if (searchRegex.test(metadataStr)) {
            match = true;
          }
        }
        if (match) {
          try {
            const value = await this.retrieve(metadata.key);
            results.push({
              key: metadata.key,
              value,
              metadata: {
                owner: metadata.owner,
                isPublic: metadata.isPublic,
                isImmutable: metadata.isImmutable,
                enableCRDT: metadata.enableCRDT,
                createdAt: metadata.createdAt,
                updatedAt: metadata.updatedAt
              }
            });
          } catch (error) {
          }
        }
      }
      return results;
    }
    /**
     * Get a lexical interface for GUN-like chaining
     * @returns {Proxy} Lexical interface
     */
    lexical() {
      return createLexicalInterface(this);
    }
    /**
     * Alias for lexical() - more GUN-like naming
     * @returns {Proxy} Lexical interface
     */
    gun() {
      return this.lexical();
    }
  };

  // src/PeerPigeonMesh.js
  var PeerPigeonMesh = class _PeerPigeonMesh extends EventEmitter {
    constructor(options = {}) {
      super();
      this.debug = DebugLogger_default.create("PeerPigeonMesh");
      this.environmentReport = this.validateEnvironment(options);
      this.peerId = null;
      this.providedPeerId = options.peerId || null;
      this.signalingClient = null;
      this.peerDiscovery = null;
      this.networkName = options.networkName || "global";
      this.allowGlobalFallback = options.allowGlobalFallback !== false;
      this.isInFallbackMode = false;
      this.originalNetworkName = this.networkName;
      this.maxPeers = options.maxPeers !== void 0 ? options.maxPeers : 3;
      this.minPeers = options.minPeers !== void 0 ? options.minPeers : 2;
      const defaultFloor = Math.min(3, this.maxPeers ?? 3);
      this.connectivityFloor = options.connectivityFloor !== void 0 ? options.connectivityFloor : defaultFloor;
      this.autoConnect = options.autoConnect !== false;
      this.autoDiscovery = options.autoDiscovery !== false;
      this.evictionStrategy = options.evictionStrategy !== false;
      this.xorRouting = options.xorRouting !== false;
      this.enableWebDHT = options.enableWebDHT !== false;
      this.enableCrypto = options.enableCrypto !== false;
      this.connected = false;
      this.polling = false;
      this.signalingUrl = null;
      this.discoveredPeers = /* @__PURE__ */ new Map();
      this.ongoingKeyExchanges = /* @__PURE__ */ new Set();
      this.emittedPeerKeyEvents = /* @__PURE__ */ new Set();
      this.gossipStreams = /* @__PURE__ */ new Map();
      this.storageManager = new StorageManager(this);
      this.mediaManager = new MediaManager();
      this.connectionManager = new ConnectionManager(this);
      this.evictionManager = new EvictionManager(this, this.connectionManager);
      this.meshOptimizer = new MeshOptimizer(this, this.connectionManager, this.evictionManager);
      this.cleanupManager = new CleanupManager(this);
      this.signalingHandler = new SignalingHandler(this, this.connectionManager);
      this.gossipManager = new GossipManager(this, this.connectionManager);
      this.webDHT = null;
      this.distributedStorage = null;
      this.cryptoManager = null;
      if (this.enableCrypto) {
        this.cryptoManager = new CryptoManager();
      }
      this.setupManagerEventHandlers();
      this.cleanupManager.setupUnloadHandlers();
      this.storageManager.loadSignalingUrlFromStorage();
      this._connectivityEnforcementTimer = null;
    }
    setupManagerEventHandlers() {
      this.connectionManager.addEventListener("peersUpdated", () => {
        this.emit("peersUpdated");
      });
      this.addEventListener("peerDisconnected", (data) => {
        this.debug.log(`Peer ${data.peerId.substring(0, 8)}... disconnected: ${data.reason}`);
        this.emittedPeerKeyEvents.delete(data.peerId);
        this.ongoingKeyExchanges.delete(data.peerId);
      });
      this.gossipManager.addEventListener("messageReceived", (data) => {
        if (data.message && data.message.type === "mesh_signaling") {
          this._handleMeshSignalingMessage(data.message, data.from);
          return;
        }
        if (data.message && (data.message.type === "key_exchange" || data.message.type === "key_exchange_response")) {
          this._handleKeyExchange(data.message, data.from).catch((err) => {
            this.debug.error("Key exchange handling failed:", err);
          });
          return;
        }
        if (data.message && data.message.type === "dht" && this.webDHT) {
          this.webDHT.handleMessage(data.message, data.from);
          return;
        }
        if (data.message && data.message.type === "stream-chunk") {
          this._handleGossipStreamChunk(data.message, data.from);
          return;
        }
        if (data.message && data.message.type === "stream-control") {
          this._handleGossipStreamControl(data.message, data.from);
          return;
        }
        if (data.content && typeof data.content === "string") {
          try {
            const parsedContent = JSON.parse(data.content);
            const filteredTypes = ["signaling-relay", "peer-announce-relay", "bootstrap-keepalive", "client-peer-announcement", "cross-bootstrap-signaling"];
            if (filteredTypes.includes(parsedContent.type)) {
              console.debug(`\u{1F507} MESH FILTER: Blocked filtered message type '${parsedContent.type}' from UI emission`);
              return;
            }
          } catch (e) {
          }
        }
        this.emit("messageReceived", data);
      });
      this.addEventListener("remoteStreamAnnouncement", (data) => {
        this._handleRemoteStreamAnnouncement(data);
      });
      this.mediaManager.addEventListener("localStreamStarted", (data) => {
        this.emit("localStreamStarted", data);
        this.gossipManager.broadcastMessage({
          event: "streamStarted",
          peerId: this.peerId,
          hasVideo: data.hasVideo,
          hasAudio: data.hasAudio,
          timestamp: Date.now()
        }, "mediaEvent").catch((err) => {
          this.debug.error("Failed to broadcast stream started event:", err);
        });
      });
      this.mediaManager.addEventListener("localStreamStopped", () => {
        this.emit("localStreamStopped");
        this.gossipManager.broadcastMessage({
          event: "streamStopped",
          peerId: this.peerId,
          timestamp: Date.now()
        }, "mediaEvent").catch((err) => {
          this.debug.error("Failed to broadcast stream stopped event:", err);
        });
      });
      this.mediaManager.addEventListener("error", (data) => {
        this.emit("mediaError", data);
      });
      this.connectionManager.addEventListener("remoteStream", (data) => {
        this.emit("remoteStream", data);
      });
      if (this.cryptoManager) {
        this.cryptoManager.addEventListener("cryptoReady", (data) => {
          this.emit("cryptoReady", data);
        });
        this.cryptoManager.addEventListener("cryptoError", (data) => {
          this.emit("cryptoError", data);
        });
        this.cryptoManager.addEventListener("peerKeyAdded", (data) => {
          if (!this.emittedPeerKeyEvents.has(data.peerId)) {
            this.emittedPeerKeyEvents.add(data.peerId);
            this.emit("peerKeyAdded", data);
          }
        });
        this.cryptoManager.addEventListener("userAuthenticated", (data) => {
          this.emit("userAuthenticated", data);
        });
      }
    }
    validateEnvironment(options = {}) {
      const report = environmentDetector.getEnvironmentReport();
      const warnings = [];
      const errors = [];
      this.debug.log("\u{1F50D} PeerPigeon Environment Detection:", {
        runtime: `${report.runtime.isBrowser ? "Browser" : ""}${report.runtime.isNodeJS ? "Node.js" : ""}${report.runtime.isWorker ? "Worker" : ""}${report.runtime.isNativeScript ? "NativeScript" : ""}`,
        webrtc: report.capabilities.webrtc,
        websocket: report.capabilities.webSocket,
        browser: report.browser?.name || "N/A",
        nativescript: report.nativescript?.platform || "N/A"
      });
      if (!report.capabilities.webrtc) {
        if (report.runtime.isBrowser) {
          errors.push("WebRTC is not supported in this browser. PeerPigeon requires WebRTC for peer-to-peer connections.");
        } else if (report.runtime.isNodeJS) {
          warnings.push("WebRTC support not detected in Node.js environment. PeerPigeon includes @koush/wrtc for automatic WebRTC support - ensure it is properly installed.");
        } else if (report.runtime.isNativeScript) {
          warnings.push("WebRTC support not detected in NativeScript environment. Consider using a native WebRTC plugin.");
        }
      }
      if (!report.capabilities.webSocket) {
        if (report.runtime.isBrowser) {
          errors.push("WebSocket is not supported in this browser. PeerPigeon requires WebSocket for signaling.");
        } else if (report.runtime.isNodeJS) {
          warnings.push('WebSocket support not detected. Install the "ws" package for WebSocket support in Node.js.');
        } else if (report.runtime.isNativeScript) {
          warnings.push("WebSocket support not detected. Consider using a native WebSocket plugin or polyfill.");
        }
      }
      if ((report.runtime.isBrowser || report.runtime.isNativeScript) && !report.capabilities.localStorage && !report.capabilities.sessionStorage) {
        warnings.push("No storage mechanism available. Peer ID will not persist between sessions.");
      }
      if (!report.capabilities.randomValues) {
        warnings.push("Crypto random values not available. Peer ID generation may be less secure.");
      }
      if (report.runtime.isBrowser && !report.network.online) {
        warnings.push("Browser reports offline status. Mesh networking may not function properly.");
      }
      if (report.runtime.isBrowser) {
        const browser = report.browser;
        if (browser && browser.name === "ie") {
          errors.push("Internet Explorer is not supported. Please use a modern browser.");
        }
        if (typeof location !== "undefined" && location.protocol === "http:" && location.hostname !== "localhost") {
          warnings.push("Running on HTTP in production. Some WebRTC features may be limited. Consider using HTTPS.");
        }
      }
      if (report.runtime.isNativeScript) {
        const nativeScript = report.nativescript;
        if (nativeScript && nativeScript.platform) {
          this.debug.log(`\u{1F52E} Running on NativeScript ${nativeScript.platform} platform`);
          if (nativeScript.platform === "android") {
            warnings.push("Android WebRTC may require network permissions and appropriate security configurations.");
          } else if (nativeScript.platform === "ios" || nativeScript.platform === "visionos") {
            warnings.push("iOS/visionOS WebRTC may require camera/microphone permissions for media features.");
          }
        }
      }
      if (errors.length > 0) {
        const errorMessage = "PeerPigeon environment validation failed:\n" + errors.join("\n");
        this.debug.error(errorMessage);
        if (!options.ignoreEnvironmentErrors) {
          throw new Error(errorMessage);
        }
      }
      if (warnings.length > 0) {
        this.debug.warn("PeerPigeon environment warnings:\n" + warnings.join("\n"));
      }
      this.capabilities = report.capabilities;
      this.runtimeInfo = report.runtime;
      return report;
    }
    async init() {
      try {
        try {
          const webrtcInitialized = await environmentDetector.initWebRTCAsync();
          if (webrtcInitialized) {
            const adapterName = environmentDetector.getPigeonRTC()?.getAdapterName();
            this.debug.log(`\u{1F310} PigeonRTC initialized successfully (${adapterName})`);
          }
        } catch (error) {
          this.debug.warn("PigeonRTC initialization failed:", error.message);
        }
        if (environmentDetector.isBrowser) {
          try {
            const disableLocalhostMedia = typeof window !== "undefined" && window.DISABLE_LOCALHOST_MEDIA_REQUEST;
            const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || window.location.hostname === "";
            if (!disableLocalhostMedia && isLocalhost && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
              this.debug.log("\u{1F3A4} Requesting media permissions for localhost WebRTC (not disabled)...");
              const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: false
              }).catch((err) => {
                this.debug.warn("Media permission denied - connections may fail on localhost:", err.message);
                return null;
              });
              if (stream) {
                stream.getTracks().forEach((track) => track.stop());
                this.debug.log("\u2705 Media permissions granted - localhost connections will work");
              }
            } else if (disableLocalhostMedia) {
              this.debug.log("\u{1F6AB} Skipping localhost media permission request (DISABLE_LOCALHOST_MEDIA_REQUEST flag set)");
            }
          } catch (error) {
            this.debug.warn("Could not request media permissions:", error.message);
          }
        }
        if (this.providedPeerId) {
          if (_PeerPigeonMesh.validatePeerId(this.providedPeerId)) {
            this.peerId = this.providedPeerId;
            this.debug.log(`Using provided peer ID: ${this.peerId}`);
          } else {
            this.debug.warn(`Invalid peer ID provided: ${this.providedPeerId}. Must be 40-character SHA-1 hex string. Generating new one.`);
            this.peerId = await _PeerPigeonMesh.generatePeerId();
          }
        } else {
          this.peerId = await _PeerPigeonMesh.generatePeerId();
        }
        if (this.enableWebDHT) {
          this.webDHT = new WebDHT(this);
          this.debug.log("WebDHT (low-level DHT) initialized and enabled");
          this.setupWebDHTEventHandlers();
          this.distributedStorage = new DistributedStorageManager(this);
          this.debug.log("DistributedStorageManager (high-level encrypted storage) initialized");
          this.setupDistributedStorageEventHandlers();
        } else {
          this.debug.log("WebDHT disabled by configuration");
        }
        const savedUrl = this.storageManager.loadSignalingUrlFromQuery();
        if (savedUrl) {
          this.signalingUrl = savedUrl;
        }
        this.signalingClient = new SignalingClient(this.peerId, this.maxPeers, this);
        this.setupSignalingHandlers();
        this.peerDiscovery = new PeerDiscovery(this.peerId, {
          autoDiscovery: this.autoDiscovery,
          evictionStrategy: this.evictionStrategy,
          xorRouting: this.xorRouting,
          minPeers: this.minPeers,
          maxPeers: this.maxPeers
        });
        this.setupDiscoveryHandlers();
        this.startConnectivityEnforcement();
        if (this.cryptoManager) {
          try {
            this.debug.log("\u{1F510} Initializing crypto manager with automatic key persistence...");
            const cryptoInitPromise = this.cryptoManager.initWithPeerId(this.peerId);
            const timeoutPromise = new Promise((resolve, reject) => {
              setTimeout(() => reject(new Error("Crypto initialization timeout")), 1e4);
            });
            await Promise.race([cryptoInitPromise, timeoutPromise]);
            this.debug.log("\u{1F510} Crypto manager initialized successfully with persistent keys");
          } catch (error) {
            this.debug.error("Failed to initialize crypto manager:", error);
            this.enableCrypto = false;
            this.cryptoManager = null;
          }
        }
        this.emit("statusChanged", { type: "initialized", peerId: this.peerId });
      } catch (error) {
        this.debug.error("Failed to initialize mesh:", error);
        this.emit("statusChanged", { type: "error", message: `Initialization failed: ${error.message}` });
        throw error;
      }
    }
    setupSignalingHandlers() {
      this.signalingClient.addEventListener("connected", () => {
        this.connected = true;
        this.polling = false;
        this.peerDiscovery.start();
        this.emit("statusChanged", { type: "connected" });
      });
      this.signalingClient.addEventListener("disconnected", () => {
        this.connected = false;
        this.polling = false;
        this.peerDiscovery.stop();
        this.emit("statusChanged", { type: "disconnected" });
      });
      this.signalingClient.addEventListener("signalingMessage", (message) => {
        this.signalingHandler.handleSignalingMessage(message);
      });
      this.signalingClient.addEventListener("statusChanged", (data) => {
        this.emit("statusChanged", data);
      });
    }
    setupDiscoveryHandlers() {
      this.peerDiscovery.addEventListener("peerDiscovered", (data) => {
        this.emit("peerDiscovered", data);
        if (this.isInFallbackMode && this.originalNetworkName !== "global") {
          this._tryReturnToOriginalNetwork();
        }
      });
      this.peerDiscovery.addEventListener("connectToPeer", (data) => {
        this.debug.log(`PeerDiscovery requested connection to: ${data.peerId.substring(0, 8)}...`);
        this.connectionManager.connectToPeer(data.peerId);
      });
      this.peerDiscovery.addEventListener("evictPeer", (data) => {
        this.evictionManager.evictPeer(data.peerId, data.reason);
      });
      this.peerDiscovery.addEventListener("optimizeMesh", () => {
        this.peerDiscovery.optimizeMeshConnections(this.connectionManager.peers);
      });
      this.peerDiscovery.addEventListener("optimizeConnections", (data) => {
        this.meshOptimizer.handleOptimizeConnections(data.unconnectedPeers);
      });
      this.addEventListener("peersUpdated", () => {
        this._checkNetworkHealth();
      });
      this.peerDiscovery.addEventListener("peersUpdated", (data) => {
        this.emit("statusChanged", { type: "info", message: `Cleaned up ${data.removedCount} stale peer(s)` });
        this.emit("peersUpdated");
      });
      this.peerDiscovery.addEventListener("checkCapacity", () => {
        const canAccept = this.connectionManager.canAcceptMorePeers();
        const currentConnectionCount = this.connectionManager.getConnectedPeerCount();
        this.debug.log(`Capacity check: ${canAccept} (${currentConnectionCount}/${this.maxPeers} peers)`);
        this.peerDiscovery._canAcceptMorePeers = canAccept;
        this.peerDiscovery._currentConnectionCount = currentConnectionCount;
      });
      this.peerDiscovery.addEventListener("checkEviction", (data) => {
        const evictPeerId = this.evictionManager.shouldEvictForPeer(data.newPeerId);
        this.debug.log(`Eviction check for ${data.newPeerId.substring(0, 8)}...: ${evictPeerId ? evictPeerId.substring(0, 8) + "..." : "none"}`);
        this.peerDiscovery._shouldEvictForPeer = evictPeerId;
      });
    }
    async connect(signalingUrl) {
      this.signalingUrl = signalingUrl;
      this.storageManager.saveSignalingUrlToStorage(signalingUrl);
      this.polling = false;
      try {
        await this.signalingClient.connect(signalingUrl);
      } catch (error) {
        this.debug.error("Connection failed:", error);
        this.polling = false;
        this.emit("statusChanged", { type: "error", message: `Connection failed: ${error.message}` });
        throw error;
      }
    }
    disconnect() {
      if (this.connected) {
        this.cleanupManager.sendGoodbyeMessage();
      }
      this.connected = false;
      this.polling = false;
      if (this.signalingClient) {
        this.signalingClient.disconnect();
      }
      if (this.peerDiscovery) {
        this.peerDiscovery.cleanup();
      }
      if (this._connectivityEnforcementTimer) {
        clearInterval(this._connectivityEnforcementTimer);
        this._connectivityEnforcementTimer = null;
      }
      this.connectionManager.disconnectAllPeers();
      this.connectionManager.cleanup();
      this.evictionManager.cleanup();
      this.cleanupManager.cleanup();
      this.gossipManager.cleanup();
      this.emit("statusChanged", { type: "disconnected" });
    }
    /**
     * Periodically attempt extra connections for under-connected peers until reaching connectivityFloor.
     */
    startConnectivityEnforcement() {
      if (this._connectivityEnforcementTimer) return;
      const intervalMs = 4e3;
      this._connectivityEnforcementTimer = setInterval(() => {
        if (!this.connected || !this.peerDiscovery) return;
        const connectedCount = this.connectionManager.getConnectedPeerCount();
        if (connectedCount >= this.connectivityFloor) return;
        const discovered = this.peerDiscovery.getDiscoveredPeers().map((p) => p.peerId);
        const notConnected = discovered.filter(
          (pid) => !this.connectionManager.hasPeer(pid) && !this.peerDiscovery.isAttemptingConnection(pid)
        );
        if (notConnected.length === 0) return;
        const prioritized = notConnected.sort((a, b) => {
          const distA = this.peerDiscovery.calculateXorDistance(this.peerId, a);
          const distB = this.peerDiscovery.calculateXorDistance(this.peerId, b);
          return distA < distB ? -1 : 1;
        });
        const needed = this.connectivityFloor - connectedCount;
        const attemptLimit = Math.min(prioritized.length, Math.max(1, needed));
        const batch = prioritized.slice(0, attemptLimit);
        batch.forEach((pid) => {
          this.debug.log(`\u{1F527} CONNECTIVITY FLOOR (${connectedCount}/${this.connectivityFloor}) attempting extra connection to ${pid.substring(0, 8)}...`);
          this.connectionManager.connectToPeer(pid);
        });
      }, intervalMs);
    }
    // Configuration methods
    setMaxPeers(maxPeers) {
      this.maxPeers = Math.max(1, Math.min(50, maxPeers));
      if (this.connectionManager.peers.size > this.maxPeers) {
        this.evictionManager.disconnectExcessPeers();
      }
      return this.maxPeers;
    }
    setMinPeers(minPeers) {
      this.minPeers = Math.max(0, Math.min(49, minPeers));
      if (this.connectionManager.getConnectedPeerCount() < this.minPeers && this.autoDiscovery && this.connected) {
        this.peerDiscovery.optimizeMeshConnections(this.connectionManager.peers);
      }
      return this.minPeers;
    }
    setXorRouting(enabled) {
      this.xorRouting = enabled;
      this.emit("statusChanged", { type: "setting", setting: "xorRouting", value: enabled });
      if (!enabled && this.evictionStrategy) {
        this.emit("statusChanged", { type: "warning", message: "XOR routing disabled - eviction strategy effectiveness reduced" });
      }
    }
    setAutoDiscovery(enabled) {
      this.autoDiscovery = enabled;
      this.emit("statusChanged", { type: "setting", setting: "autoDiscovery", value: enabled });
    }
    setAutoConnect(enabled) {
      this.autoConnect = enabled;
      this.emit("statusChanged", { type: "setting", setting: "autoConnect", value: enabled });
    }
    setEvictionStrategy(enabled) {
      this.evictionStrategy = enabled;
      this.emit("statusChanged", { type: "setting", setting: "evictionStrategy", value: enabled });
    }
    // Network namespace management methods
    setNetworkName(networkName) {
      if (this.connected) {
        throw new Error("Cannot change network name while connected. Disconnect first.");
      }
      this.networkName = networkName || "global";
      this.originalNetworkName = this.networkName;
      this.isInFallbackMode = false;
      this.emit("statusChanged", {
        type: "setting",
        setting: "networkName",
        value: this.networkName
      });
      return this.networkName;
    }
    getNetworkName() {
      return this.networkName;
    }
    getOriginalNetworkName() {
      return this.originalNetworkName;
    }
    isUsingGlobalFallback() {
      return this.isInFallbackMode;
    }
    setAllowGlobalFallback(allow) {
      this.allowGlobalFallback = allow;
      this.emit("statusChanged", {
        type: "setting",
        setting: "allowGlobalFallback",
        value: allow
      });
      if (!allow && this.isInFallbackMode) {
        this._tryReturnToOriginalNetwork();
      }
      return this.allowGlobalFallback;
    }
    async _tryReturnToOriginalNetwork() {
      if (!this.isInFallbackMode || this.originalNetworkName === "global") {
        return;
      }
      const originalNetworkPeerCount = await this._getNetworkPeerCount(this.originalNetworkName);
      if (originalNetworkPeerCount > 0) {
        this.debug.log(`Returning from global fallback to original network: ${this.originalNetworkName}`);
        this.networkName = this.originalNetworkName;
        this.isInFallbackMode = false;
        this.emit("statusChanged", {
          type: "network",
          message: `Returned to network: ${this.networkName}`,
          networkName: this.networkName,
          fallbackMode: false
        });
        if (this.connected) {
          this.disconnect();
          setTimeout(() => {
            if (this.signalingUrl) {
              this.connect(this.signalingUrl);
            }
          }, 1e3);
        }
      }
    }
    async _activateGlobalFallback() {
      if (this.originalNetworkName === "global" || this.isInFallbackMode || !this.allowGlobalFallback) {
        return false;
      }
      this.debug.log(`Activating global fallback from network: ${this.originalNetworkName}`);
      this.networkName = "global";
      this.isInFallbackMode = true;
      this.emit("statusChanged", {
        type: "network",
        message: `Fallback to global network from: ${this.originalNetworkName}`,
        networkName: this.networkName,
        originalNetwork: this.originalNetworkName,
        fallbackMode: true
      });
      return true;
    }
    async _getNetworkPeerCount(networkName) {
      return 0;
    }
    _checkNetworkHealth() {
      return;
      if (this.originalNetworkName === "global" || !this.allowGlobalFallback) {
        return;
      }
      const connectedCount = this.connectionManager.getConnectedPeerCount();
      const discoveredCount = this.discoveredPeers.size;
      if (!this.isInFallbackMode && this.networkName === this.originalNetworkName) {
        if (connectedCount === 0 && discoveredCount === 0) {
          this.debug.log(`Network ${this.originalNetworkName} appears empty, activating global fallback`);
          this._activateGlobalFallback().then((activated) => {
            if (activated && this.connected && this.signalingUrl) {
              this.disconnect();
              setTimeout(() => {
                this.connect(this.signalingUrl);
              }, 1e3);
            }
          });
        }
      }
    }
    // Status and information methods
    getStatus() {
      const connectedCount = this.connectionManager.getConnectedPeerCount();
      const totalCount = this.connectionManager.peers.size;
      return {
        peerId: this.peerId,
        connected: this.connected,
        polling: false,
        // Only WebSocket is supported
        signalingUrl: this.signalingUrl,
        networkName: this.networkName,
        originalNetworkName: this.originalNetworkName,
        isInFallbackMode: this.isInFallbackMode,
        allowGlobalFallback: this.allowGlobalFallback,
        connectedCount,
        totalPeerCount: totalCount,
        // Include total count for debugging
        minPeers: this.minPeers,
        maxPeers: this.maxPeers,
        discoveredCount: this.discoveredPeers.size,
        autoConnect: this.autoConnect,
        autoDiscovery: this.autoDiscovery,
        evictionStrategy: this.evictionStrategy,
        xorRouting: this.xorRouting
      };
    }
    getPeers() {
      return this.connectionManager.getPeers();
    }
    getPeerStatus(peerConnection) {
      return peerConnection.getStatus();
    }
    getDiscoveredPeers() {
      if (!this.peerDiscovery) {
        return [];
      }
      const discoveredPeers = this.peerDiscovery.getDiscoveredPeers();
      return discoveredPeers.map((peer) => {
        const peerConnection = this.connectionManager.getPeer(peer.peerId);
        let isConnected = false;
        if (peerConnection) {
          const status = peerConnection.getStatus();
          isConnected = status === "connected" || status === "channel-connecting";
        }
        return {
          ...peer,
          isConnected
        };
      });
    }
    /**
       * Send a direct message to a specific peer via gossip routing
       * @param {string} targetPeerId - The destination peer's ID
       * @param {string|object} content - The message content
       * @returns {string|null} The message ID if sent, or null on error
       */
    async sendDirectMessage(targetPeerId, content) {
      if (!targetPeerId || typeof targetPeerId !== "string") {
        this.debug.error("Invalid targetPeerId for direct message");
        return null;
      }
      return await this.gossipManager.sendDirectMessage(targetPeerId, content);
    }
    /**
       * Send a broadcast (gossip) message to all peers
       * @param {string|object} content - The message content
       * @returns {string|null} The message ID if sent, or null on error
       */
    async sendMessage(content) {
      return await this.gossipManager.broadcastMessage(content, "chat");
    }
    /**
     * Send binary data to a specific peer
     * @param {string} targetPeerId - The destination peer's ID
     * @param {Uint8Array|ArrayBuffer} binaryData - The binary data to send
     * @returns {boolean} True if sent successfully
     */
    async sendBinaryData(targetPeerId, binaryData) {
      if (!targetPeerId || typeof targetPeerId !== "string") {
        this.debug.error("Invalid targetPeerId for binary message");
        return false;
      }
      const peerConnection = this.connectionManager.peers.get(targetPeerId);
      if (!peerConnection) {
        this.debug.error(`No connection to peer ${targetPeerId.substring(0, 8)}...`);
        return false;
      }
      return peerConnection.sendMessage(binaryData);
    }
    /**
     * Broadcast binary data to all connected peers
     * @param {Uint8Array|ArrayBuffer} binaryData - The binary data to broadcast
     * @returns {number} Number of peers the data was sent to
     */
    async broadcastBinaryData(binaryData) {
      const peers = this.getConnectedPeers();
      let sentCount = 0;
      for (const peer of peers) {
        if (await this.sendBinaryData(peer.peerId, binaryData)) {
          sentCount++;
        }
      }
      this.debug.log(`\u{1F4E6} Binary data broadcasted to ${sentCount}/${peers.length} peers`);
      return sentCount;
    }
    /**
     * Create a writable stream to send data to a specific peer
     * @param {string} targetPeerId - The destination peer's ID
     * @param {object} options - Stream options (filename, mimeType, totalSize, etc.)
     * @returns {WritableStream} A writable stream
     */
    createStreamToPeer(targetPeerId, options = {}) {
      if (!targetPeerId || typeof targetPeerId !== "string") {
        throw new Error("Invalid targetPeerId for stream");
      }
      const peerConnection = this.connectionManager.peers.get(targetPeerId);
      if (!peerConnection) {
        throw new Error(`No connection to peer ${targetPeerId.substring(0, 8)}...`);
      }
      return peerConnection.createWritableStream(options);
    }
    /**
     * Send a ReadableStream to a peer
     * @param {string} targetPeerId - The destination peer's ID
     * @param {ReadableStream} readableStream - The stream to send
     * @param {object} options - Stream options (filename, mimeType, etc.)
     * @returns {Promise<void>}
     */
    async sendStream(targetPeerId, readableStream, options = {}) {
      const writableStream = this.createStreamToPeer(targetPeerId, options);
      try {
        await readableStream.pipeTo(writableStream);
        this.debug.log(`\u2705 Stream sent successfully to ${targetPeerId.substring(0, 8)}...`);
      } catch (error) {
        this.debug.error(`\u274C Failed to send stream to ${targetPeerId.substring(0, 8)}...:`, error);
        throw error;
      }
    }
    /**
     * Send a File to a peer using streams
     * @param {string} targetPeerId - The destination peer's ID
     * @param {File} file - The file to send
     * @returns {Promise<void>}
     */
    async sendFile(targetPeerId, file) {
      this.debug.log(`\u{1F4C1} Sending file "${file.name}" (${file.size} bytes) to ${targetPeerId.substring(0, 8)}...`);
      const options = {
        filename: file.name,
        mimeType: file.type,
        totalSize: file.size,
        type: "file"
      };
      const stream = file.stream();
      await this.sendStream(targetPeerId, stream, options);
    }
    /**
     * Send a Blob to a peer using streams
     * @param {string} targetPeerId - The destination peer's ID
     * @param {Blob} blob - The blob to send
     * @param {object} options - Additional options
     * @returns {Promise<void>}
     */
    async sendBlob(targetPeerId, blob, options = {}) {
      this.debug.log(`\u{1F4E6} Sending blob (${blob.size} bytes) to ${targetPeerId.substring(0, 8)}...`);
      const streamOptions = {
        ...options,
        mimeType: blob.type,
        totalSize: blob.size,
        type: "blob"
      };
      const stream = blob.stream();
      await this.sendStream(targetPeerId, stream, streamOptions);
    }
    /**
     * Create a writable stream that broadcasts data to all peers in the mesh using gossip
     * @param {object} options - Stream options (filename, mimeType, totalSize, etc.)
     * @returns {WritableStream} A writable stream that broadcasts via gossip protocol
     */
    createBroadcastStream(options = {}) {
      const streamId = options.streamId || this._generateStreamId();
      const metadata = {
        streamId,
        type: options.type || "broadcast",
        filename: options.filename,
        mimeType: options.mimeType,
        totalSize: options.totalSize,
        timestamp: Date.now(),
        ...options
      };
      const chunks = [];
      let chunkIndex = 0;
      let totalBytesWritten = 0;
      const self2 = this;
      this.debug.log(`\u{1F4E1} Creating gossip broadcast stream: ${streamId}`);
      return new WritableStream({
        async write(chunk) {
          const chunkData = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
          const chunkId = chunkIndex++;
          chunks.push({
            index: chunkId,
            data: chunkData
          });
          totalBytesWritten += chunkData.length;
          try {
            await self2.gossipManager.broadcastMessage({
              streamId,
              chunkIndex: chunkId,
              data: Array.from(chunkData),
              // Convert to regular array for JSON
              totalSize: metadata.totalSize,
              metadata: chunkId === 0 ? metadata : void 0
              // Include metadata with first chunk
            }, "stream-chunk");
            self2.debug.log(`\u{1F4E1} Gossiped chunk ${chunkId} (${chunkData.length} bytes) for stream ${streamId.substring(0, 8)}...`);
          } catch (error) {
            self2.debug.error(`Failed to gossip chunk ${chunkId}:`, error);
            throw error;
          }
        },
        async close() {
          try {
            await self2.gossipManager.broadcastMessage({
              streamId,
              action: "end",
              totalChunks: chunkIndex,
              totalBytes: totalBytesWritten,
              metadata
            }, "stream-control");
            self2.debug.log(`\u{1F4E1} Broadcast stream completed via gossip: ${totalBytesWritten} bytes in ${chunkIndex} chunks`);
            self2.emit("broadcastStreamComplete", {
              streamId,
              totalBytes: totalBytesWritten,
              totalChunks: chunkIndex,
              metadata
            });
          } catch (error) {
            self2.debug.error("Failed to broadcast stream end:", error);
            throw error;
          }
        },
        async abort(reason) {
          try {
            await self2.gossipManager.broadcastMessage({
              streamId,
              action: "abort",
              reason: reason?.message || String(reason),
              metadata
            }, "stream-control");
            self2.debug.log(`\u274C Broadcast stream aborted via gossip: ${reason}`);
            self2.emit("broadcastStreamAborted", {
              streamId,
              reason: reason?.message || String(reason),
              metadata
            });
          } catch (error) {
            self2.debug.error("Failed to broadcast stream abort:", error);
          }
        }
      });
    }
    /**
     * Broadcast a ReadableStream to all connected peers
     * @param {ReadableStream} readableStream - The stream to broadcast
     * @param {object} options - Stream options (filename, mimeType, etc.)
     * @returns {Promise<void>}
     */
    async broadcastStream(readableStream, options = {}) {
      const writableStream = this.createBroadcastStream(options);
      try {
        await readableStream.pipeTo(writableStream);
        this.debug.log(`\u2705 Stream broadcasted successfully to all peers`);
      } catch (error) {
        this.debug.error(`\u274C Failed to broadcast stream:`, error);
        throw error;
      }
    }
    /**
     * Broadcast a File to all connected peers using streams
     * @param {File} file - The file to broadcast
     * @returns {Promise<void>}
     */
    async broadcastFile(file) {
      this.debug.log(`\u{1F4C1} Broadcasting file "${file.name}" (${file.size} bytes) to all peers`);
      const options = {
        filename: file.name,
        mimeType: file.type,
        totalSize: file.size,
        type: "file"
      };
      const stream = file.stream();
      await this.broadcastStream(stream, options);
    }
    /**
     * Broadcast a Blob to all connected peers using streams
     * @param {Blob} blob - The blob to broadcast
     * @param {object} options - Additional options
     * @returns {Promise<void>}
     */
    async broadcastBlob(blob, options = {}) {
      this.debug.log(`\u{1F4E6} Broadcasting blob (${blob.size} bytes) to all peers`);
      const streamOptions = {
        ...options,
        mimeType: blob.type,
        totalSize: blob.size,
        type: "blob"
      };
      const stream = blob.stream();
      await this.broadcastStream(stream, streamOptions);
    }
    /**
     * Generate a unique stream ID
     * @private
     */
    _generateStreamId() {
      return `stream_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    }
    // Helper methods for backward compatibility
    canAcceptMorePeers() {
      return this.connectionManager.canAcceptMorePeers();
    }
    getConnectedPeerCount() {
      return this.connectionManager.getConnectedPeerCount();
    }
    // Expose peers Map for backward compatibility
    get peers() {
      return this.connectionManager.peers;
    }
    // Get peer status method for UI compatibility
    getPeerUIStatus(peer) {
      if (!peer) return "unknown";
      return peer.getStatus ? peer.getStatus() : "unknown";
    }
    // Get connected peer IDs as array for UI compatibility
    getConnectedPeerIds() {
      return this.connectionManager.getPeers().filter((peer) => peer.status === "connected").map((peer) => peer.peerId);
    }
    // Advanced methods
    async cleanupStaleSignalingData() {
      return this.cleanupManager.cleanupStaleSignalingData();
    }
    forceConnectToAllPeers() {
      return this.meshOptimizer.forceConnectToAllPeers();
    }
    // Debugging and maintenance methods
    forceCleanupInvalidPeers() {
      this.debug.log("Force cleaning up peers not in connected state...");
      return this.connectionManager.forceCleanupInvalidPeers();
    }
    cleanupStalePeers() {
      this.debug.log("Manually cleaning up stale peers...");
      return this.connectionManager.cleanupStalePeers();
    }
    getPeerStateSummary() {
      return this.connectionManager.getPeerStateSummary();
    }
    debugConnectivity() {
      return this.meshOptimizer.debugConnectivity();
    }
    // Media management methods
    async initializeMedia() {
      return await this.mediaManager.init();
    }
    async startMedia(options = {}) {
      const { video = false, audio = false, deviceIds = {} } = options;
      try {
        const stream = await this.mediaManager.startLocalStream({ video, audio, deviceIds });
        const connections = this.connectionManager.getAllConnections();
        this.debug.log(`\u{1F4E1} MEDIA START: Applying stream to ${connections.length} connections (with crypto verification)`);
        for (const connection of connections) {
          let shouldShareMedia = true;
          if (this.enableCrypto && this.cryptoManager) {
            const hasKeys = this.cryptoManager.peerKeys && this.cryptoManager.peerKeys.has(connection.peerId);
            if (!hasKeys) {
              this.debug.log(`\uFFFD MEDIA START: Skipping media share with ${connection.peerId.substring(0, 8)}... - no crypto keys established`);
              shouldShareMedia = false;
            } else {
              this.debug.log(`\u{1F512} MEDIA START: Crypto keys verified for ${connection.peerId.substring(0, 8)}... - sharing media`);
            }
          }
          if (shouldShareMedia) {
            this.debug.log(`\u{1F4E1} MEDIA START: Setting stream for peer ${connection.peerId.substring(0, 8)}...`);
            await connection.setLocalStream(stream);
            this.debug.log(`\u2705 MEDIA START: Stream applied to ${connection.peerId.substring(0, 8)}...`);
          }
        }
        return stream;
      } catch (error) {
        this.debug.error("Failed to start media:", error);
        throw error;
      }
    }
    async stopMedia() {
      this.mediaManager.stopLocalStream();
      const connections = this.connectionManager.getAllConnections();
      for (const connection of connections) {
        await connection.setLocalStream(null);
      }
    }
    toggleVideo() {
      return this.mediaManager.toggleVideo();
    }
    toggleAudio() {
      return this.mediaManager.toggleAudio();
    }
    getMediaState() {
      return this.mediaManager.getMediaState();
    }
    getMediaDevices() {
      return this.mediaManager.devices;
    }
    async enumerateMediaDevices() {
      return await this.mediaManager.enumerateDevices();
    }
    getLocalStream() {
      return this.mediaManager.localStream;
    }
    // Get remote streams from all connected peers
    getRemoteStreams() {
      const streams = /* @__PURE__ */ new Map();
      const connections = this.connectionManager.getAllConnections();
      for (const connection of connections) {
        const remoteStream = connection.getRemoteStream();
        if (remoteStream) {
          streams.set(connection.peerId, remoteStream);
        }
      }
      return streams;
    }
    // === SELECTIVE STREAMING CONTROL METHODS ===
    /**
     * Enable streaming to specific peers only (1:1 or 1:many patterns)
     * @param {string|string[]} peerIds - Single peer ID or array of peer IDs to stream to
     * @param {Object} options - Stream options (video, audio, deviceIds)
     * @returns {Promise<MediaStream>} The local stream
     */
    async startSelectiveStream(peerIds, options = {}) {
      const targetPeerIds = Array.isArray(peerIds) ? peerIds : [peerIds];
      this.debug.log(`\u{1F3AF} SELECTIVE STREAM: Starting stream to ${targetPeerIds.length} specific peer(s)`);
      const stream = await this.mediaManager.startLocalStream(options);
      const connections = this.connectionManager.getAllConnections();
      for (const connection of connections) {
        if (targetPeerIds.includes(connection.peerId)) {
          this.debug.log(`\u{1F4E1} SELECTIVE STREAM: Enabling stream for target peer ${connection.peerId.substring(0, 8)}...`);
          if (connection.allowRemoteStreamEmission) {
            connection.allowRemoteStreamEmission();
          }
          await connection.setLocalStream(stream);
        } else {
          this.debug.log(`\u{1F6AB} SELECTIVE STREAM: Blocking stream for non-target peer ${connection.peerId.substring(0, 8)}...`);
          await connection.setLocalStream(null);
          if (connection.blockRemoteStreamEmission) {
            connection.blockRemoteStreamEmission();
          }
        }
      }
      this.emit("selectiveStreamStarted", {
        targetPeerIds,
        stream,
        streamType: targetPeerIds.length === 1 ? "1:1" : "1:many"
      });
      return stream;
    }
    /**
     * Stop selective streaming and return to broadcast mode or stop entirely
     * @param {boolean} returnToBroadcast - If true, switch to broadcast mode; if false, stop streaming entirely
     */
    async stopSelectiveStream(returnToBroadcast = false) {
      this.debug.log(`\u{1F6D1} SELECTIVE STREAM: Stopping selective streaming (broadcast mode: ${returnToBroadcast})`);
      if (returnToBroadcast) {
        await this.enableStreamingForAllPeers();
      } else {
        await this.stopMedia();
      }
      this.emit("selectiveStreamStopped", { returnToBroadcast });
    }
    /**
     * Enable streaming for all connected peers (broadcast mode)
     */
    async enableStreamingForAllPeers() {
      this.debug.log("\u{1F4E1} BROADCAST STREAM: Enabling streaming for ALL connected peers");
      const connections = this.connectionManager.getAllConnections();
      const currentStream = this.mediaManager.localStream;
      for (const connection of connections) {
        this.debug.log(`\u{1F4E1} BROADCAST STREAM: Enabling stream for peer ${connection.peerId.substring(0, 8)}...`);
        if (connection.allowRemoteStreamEmission) {
          connection.allowRemoteStreamEmission();
        }
        if (currentStream) {
          await connection.setLocalStream(currentStream);
        }
      }
      this.emit("broadcastStreamEnabled");
    }
    /**
     * Block streaming to specific peers while maintaining streams to others
     * @param {string|string[]} peerIds - Peer ID(s) to block streaming to
     */
    async blockStreamingToPeers(peerIds) {
      const targetPeerIds = Array.isArray(peerIds) ? peerIds : [peerIds];
      this.debug.log(`\u{1F6AB} BLOCK STREAM: Blocking streaming to ${targetPeerIds.length} peer(s)`);
      for (const peerId of targetPeerIds) {
        const connection = this.connectionManager.getPeer(peerId);
        if (connection) {
          this.debug.log(`\u{1F6AB} BLOCK STREAM: Blocking stream to peer ${peerId.substring(0, 8)}...`);
          await connection.setLocalStream(null);
          if (connection.blockRemoteStreamEmission) {
            connection.blockRemoteStreamEmission();
          }
        }
      }
      this.emit("streamingBlockedToPeers", { blockedPeerIds: targetPeerIds });
    }
    /**
     * Allow streaming to specific peers (unblock them)
     * @param {string|string[]} peerIds - Peer ID(s) to allow streaming to
     */
    async allowStreamingToPeers(peerIds) {
      const targetPeerIds = Array.isArray(peerIds) ? peerIds : [peerIds];
      this.debug.log(`\u2705 ALLOW STREAM: Allowing streaming to ${targetPeerIds.length} peer(s)`);
      const currentStream = this.mediaManager.localStream;
      for (const peerId of targetPeerIds) {
        const connection = this.connectionManager.getPeer(peerId);
        if (connection) {
          this.debug.log(`\u2705 ALLOW STREAM: Allowing stream to peer ${peerId.substring(0, 8)}...`);
          if (connection.allowRemoteStreamEmission) {
            connection.allowRemoteStreamEmission();
          }
          if (currentStream) {
            await connection.setLocalStream(currentStream);
          }
        }
      }
      this.emit("streamingAllowedToPeers", { allowedPeerIds: targetPeerIds });
    }
    /**
     * Get current streaming status for all connected peers
     * @returns {Map} Map of peer IDs to streaming status
     */
    getStreamingStatus() {
      const status = /* @__PURE__ */ new Map();
      const connections = this.connectionManager.getAllConnections();
      for (const connection of connections) {
        const hasLocalStream = connection.getLocalStream() !== null;
        const allowsRemoteStreams = connection.allowRemoteStreams;
        status.set(connection.peerId, {
          sendingStream: hasLocalStream,
          receivingStreams: allowsRemoteStreams,
          streamType: hasLocalStream ? this.isStreamingToAll() ? "broadcast" : "selective" : "none"
        });
      }
      return status;
    }
    /**
     * Check if currently streaming to all connected peers
     * @returns {boolean} True if streaming to all peers
     */
    isStreamingToAll() {
      const connections = this.connectionManager.getAllConnections();
      if (connections.length === 0) return false;
      return connections.every((connection) => connection.getLocalStream() !== null);
    }
    /**
     * Get list of peers currently receiving streams
     * @returns {string[]} Array of peer IDs receiving streams
     */
    getStreamingPeers() {
      const connections = this.connectionManager.getAllConnections();
      return connections.filter((connection) => connection.getLocalStream() !== null).map((connection) => connection.peerId);
    }
    /**
     * Get list of peers currently blocked from streaming
     * @returns {string[]} Array of peer IDs blocked from streaming
     */
    getBlockedStreamingPeers() {
      const connections = this.connectionManager.getAllConnections();
      return connections.filter((connection) => connection.getLocalStream() === null && this.mediaManager.localStream !== null).map((connection) => connection.peerId);
    }
    // Static utility methods
    static validatePeerId(peerId) {
      return typeof peerId === "string" && /^[a-fA-F0-9]{40}$/.test(peerId);
    }
    static async generatePeerId() {
      const array = new Uint8Array(20);
      if (typeof crypto !== "undefined" && crypto.getRandomValues) {
        crypto.getRandomValues(array);
      } else if (typeof process !== "undefined" && process.versions && process.versions.node) {
        try {
          const crypto3 = await import("crypto");
          const randomBytes2 = crypto3.randomBytes(20);
          array.set(randomBytes2);
        } catch (e) {
          console.warn("Could not use Node.js crypto, falling back to Math.random");
          for (let i = 0; i < array.length; i++) {
            array[i] = Math.floor(Math.random() * 256);
          }
        }
      } else {
        console.warn("Secure random values not available, using fallback method");
        for (let i = 0; i < array.length; i++) {
          array[i] = Math.floor(Math.random() * 256);
        }
      }
      return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    // WebDHT methods - Low-level Distributed Hash Table for raw key-value storage
    // Note: For encrypted storage with access control, use this.distributedStorage instead
    /**
       * Store a key-value pair in the distributed hash table (low-level, no encryption)
       * @param {string} key - The key to store
       * @param {any} value - The value to store
       * @param {object} options - Storage options (ttl, etc.)
       * @returns {Promise<boolean>} True if stored successfully
       */
    async dhtPut(key, value, options = {}) {
      if (!this.enableWebDHT) {
        throw new Error("WebDHT is disabled. Enable it by setting enableWebDHT: true in constructor options.");
      }
      if (!this.webDHT) {
        throw new Error("WebDHT not initialized");
      }
      return this.webDHT.put(key, value, options);
    }
    /**
       * Retrieve a value from the distributed hash table (low-level, no encryption)
       * @param {string} key - The key to retrieve
       * @param {object} options - Retrieval options (subscribe, etc.)
       * @returns {Promise<any>} The stored value or null if not found
       */
    async dhtGet(key, options = {}) {
      if (!this.enableWebDHT) {
        throw new Error("WebDHT is disabled. Enable it by setting enableWebDHT: true in constructor options.");
      }
      if (!this.webDHT) {
        throw new Error("WebDHT not initialized");
      }
      return this.webDHT.get(key, options);
    }
    /**
       * Subscribe to changes for a key in the DHT
       * @param {string} key - The key to subscribe to
       * @returns {Promise<any>} The current value
       */
    async dhtSubscribe(key) {
      if (!this.enableWebDHT) {
        throw new Error("WebDHT is disabled. Enable it by setting enableWebDHT: true in constructor options.");
      }
      if (!this.webDHT) {
        throw new Error("WebDHT not initialized");
      }
      return this.webDHT.subscribe(key);
    }
    /**
       * Unsubscribe from changes for a key in the DHT
       * @param {string} key - The key to unsubscribe from
       */
    async dhtUnsubscribe(key) {
      if (!this.enableWebDHT) {
        throw new Error("WebDHT is disabled. Enable it by setting enableWebDHT: true in constructor options.");
      }
      if (!this.webDHT) {
        throw new Error("WebDHT not initialized");
      }
      return this.webDHT.unsubscribe(key);
    }
    /**
       * Update a key's value and notify subscribers
       * @param {string} key - The key to update
       * @param {any} newValue - The new value
       * @param {object} options - Update options
       * @returns {Promise<boolean>} True if updated successfully
       */
    async dhtUpdate(key, newValue, options = {}) {
      if (!this.enableWebDHT) {
        throw new Error("WebDHT is disabled. Enable it by setting enableWebDHT: true in constructor options.");
      }
      if (!this.webDHT) {
        throw new Error("WebDHT not initialized");
      }
      return this.webDHT.update(key, newValue, options);
    }
    /**
       * Get DHT statistics
       * @returns {object} DHT statistics
       */
    getDHTStats() {
      if (!this.enableWebDHT) {
        return { error: "WebDHT is disabled. Enable it by setting enableWebDHT: true in constructor options." };
      }
      if (!this.webDHT) {
        return { error: "WebDHT not initialized" };
      }
      return this.webDHT.getStats();
    }
    /**
       * Check if WebDHT is enabled
       * @returns {boolean} True if WebDHT is enabled
       */
    isDHTEnabled() {
      return this.enableWebDHT;
    }
    /**
       * Setup WebDHT event handlers
       */
    setupWebDHTEventHandlers() {
      if (this.webDHT) {
        this.webDHT.addEventListener("valueChanged", (data) => {
          this.emit("dhtValueChanged", data);
        });
      }
    }
    /**
     * Setup event handlers for DistributedStorageManager
     */
    setupDistributedStorageEventHandlers() {
      if (this.distributedStorage) {
        this.distributedStorage.addEventListener("dataStored", (data) => {
          this.emit("storageDataStored", data);
        });
        this.distributedStorage.addEventListener("dataRetrieved", (data) => {
          this.emit("storageDataRetrieved", data);
        });
        this.distributedStorage.addEventListener("dataUpdated", (data) => {
          this.emit("storageDataUpdated", data);
        });
        this.distributedStorage.addEventListener("dataDeleted", (data) => {
          this.emit("storageDataDeleted", data);
        });
        this.distributedStorage.addEventListener("accessGranted", (data) => {
          this.emit("storageAccessGranted", data);
        });
        this.distributedStorage.addEventListener("accessRevoked", (data) => {
          this.emit("storageAccessRevoked", data);
        });
      }
    }
    /**
       * Connect to a specific peer by ID
       */
    connectToPeer(peerId) {
      if (!peerId || typeof peerId !== "string") {
        throw new Error("Valid peer ID is required");
      }
      if (peerId === this.peerId) {
        throw new Error("Cannot connect to yourself");
      }
      return this.connectionManager.connectToPeer(peerId);
    }
    /**
       * Get the current environment report
       * @returns {object} Complete environment detection report
       */
    getEnvironmentReport() {
      return this.environmentReport;
    }
    /**
       * Get runtime capabilities
       * @returns {object} Capabilities detected during initialization
       */
    getCapabilities() {
      return this.capabilities;
    }
    /**
       * Get runtime information
       * @returns {object} Runtime environment information
       */
    getRuntimeInfo() {
      return this.runtimeInfo;
    }
    /**
       * Check if a specific feature is supported
       * @param {string} feature - The feature to check (e.g., 'webrtc', 'websocket', 'localstorage')
       * @returns {boolean} True if the feature is supported
       */
    hasFeature(feature) {
      return environmentDetector.hasFeature(feature);
    }
    /**
       * Get environment-specific recommendations
       * @returns {object} Recommendations based on current environment
       */
    getEnvironmentRecommendations() {
      const recommendations = [];
      const report = this.environmentReport;
      if (report.runtime.isBrowser) {
        if (!report.network.online) {
          recommendations.push({
            type: "warning",
            message: "Browser is offline. Enable network connectivity for mesh functionality."
          });
        }
        if (typeof location !== "undefined" && location.protocol === "http:" && location.hostname !== "localhost") {
          recommendations.push({
            type: "security",
            message: "Consider using HTTPS for better WebRTC compatibility and security."
          });
        }
        if (report.browser && report.browser.name === "safari") {
          recommendations.push({
            type: "compatibility",
            message: "Safari has some WebRTC limitations. Test thoroughly for production use."
          });
        }
      }
      if (report.runtime.isNodeJS) {
        if (!report.capabilities.webSocket) {
          recommendations.push({
            type: "dependency",
            message: 'Install the "ws" package for WebSocket support: npm install ws'
          });
        }
        if (!report.capabilities.webrtc) {
          recommendations.push({
            type: "dependency",
            message: 'Install "node-webrtc" or similar for WebRTC support in Node.js: npm install node-webrtc'
          });
        }
      }
      if (!report.capabilities.localStorage && !report.capabilities.sessionStorage) {
        recommendations.push({
          type: "feature",
          message: "No persistent storage available. Peer ID will change on restart."
        });
      }
      return {
        environment: report.runtime,
        recommendations
      };
    }
    // ============================================
    // Cryptographic Methods (unsea integration)
    // ============================================
    /**
       * Initialize crypto with user credentials
       * @param {Object} options - Crypto initialization options
       * @param {string} options.alias - User alias for persistent identity
       * @param {string} options.password - User password
       * @returns {Promise<boolean>} True if crypto was initialized successfully
       */
    async initCrypto(options = {}) {
      if (!this.enableCrypto) {
        this.enableCrypto = true;
        this.cryptoManager = new CryptoManager();
      }
      if (!this.cryptoManager) {
        throw new Error("Crypto manager not available");
      }
      try {
        await this.cryptoManager.init(options);
        return true;
      } catch (error) {
        this.debug.error("Failed to initialize crypto:", error);
        throw error;
      }
    }
    /**
       * Get crypto status and information
       * @returns {Object} Crypto status information
       */
    getCryptoStatus() {
      if (!this.cryptoManager) {
        return {
          enabled: false,
          initialized: false,
          error: "Crypto not enabled. Enable with enableCrypto: true in constructor"
        };
      }
      return this.cryptoManager.getStatus();
    }
    /**
       * Enable/disable crypto functionality
       * @param {boolean} enabled - Whether to enable crypto
       */
    setCrypto(enabled) {
      if (enabled && !this.cryptoManager) {
        this.cryptoManager = new CryptoManager();
      }
      this.enableCrypto = enabled;
    }
    /**
       * Encrypt a message without sending it
       * @param {any} content - Message content to encrypt
       * @param {string} peerId - Optional target peer ID for peer-to-peer encryption
       * @param {string} groupId - Optional group ID for group encryption
       * @returns {Promise<Object>} Encrypted message object
       */
    async encryptMessage(content, peerId = null, groupId = null) {
      if (!this.enableCrypto || !this.cryptoManager) {
        throw new Error("Crypto not enabled or initialized");
      }
      try {
        if (groupId) {
          return await this.cryptoManager.encryptForGroup(content, groupId);
        } else if (peerId) {
          return await this.cryptoManager.encryptForPeer(content, peerId);
        } else {
          const ourPeerId = this.peerId;
          const ourKeypair = this.cryptoManager.keypair;
          if (ourKeypair && ourKeypair.pub && ourKeypair.epub) {
            this.cryptoManager.addPeerKey(ourPeerId, {
              pub: ourKeypair.pub,
              epub: ourKeypair.epub
            });
            return await this.cryptoManager.encryptForPeer(content, ourPeerId);
          } else {
            throw new Error("No complete keypair available for encryption (need both pub and epub)");
          }
        }
      } catch (error) {
        this.debug.error("Failed to encrypt message:", error);
        throw error;
      }
    }
    /**
     * Send a signaling message over the mesh (peer-to-peer) instead of the signaling server
     * This allows peers to coordinate without the signaling server after initial connection
     * @param {Object} message - The signaling message
     * @param {string} targetPeerId - Target peer ID (optional, for direct signaling)
     * @returns {Promise<boolean>} Success status
     */
    async sendMeshSignalingMessage(message, targetPeerId = null) {
      if (!this.connected) {
        this.debug.warn("Cannot send mesh signaling message - mesh not connected");
        return false;
      }
      const signalingMessage = {
        type: "mesh_signaling",
        meshSignalingType: message.type,
        data: message.data,
        fromPeerId: this.peerId,
        targetPeerId,
        timestamp: Date.now(),
        messageId: this.generateMessageId()
      };
      this.debug.log(`\u{1F4E1} Sending mesh signaling message: ${message.type} ${targetPeerId ? `to ${targetPeerId.substring(0, 8)}...` : "(broadcast)"}`);
      try {
        if (targetPeerId) {
          return await this.sendDirectMessage(targetPeerId, signalingMessage);
        } else {
          return this.broadcast(signalingMessage);
        }
      } catch (error) {
        this.debug.error("Failed to send mesh signaling message:", error);
        return false;
      }
    }
    /**
     * Handle incoming mesh signaling messages
     * @param {Object} message - The mesh signaling message
     * @param {string} from - Sender peer ID
     * @private
     */
    _handleMeshSignalingMessage(message, from) {
      if (!message.meshSignalingType || !message.data) {
        this.debug.warn("Invalid mesh signaling message format");
        return;
      }
      if (message.targetPeerId && message.targetPeerId !== this.peerId) {
        this.debug.log(`Ignoring mesh signaling message not intended for us (target: ${message.targetPeerId?.substring(0, 8)}...)`);
        return;
      }
      this.debug.log(`\u{1F4E1} Received mesh signaling message: ${message.meshSignalingType} from ${from.substring(0, 8)}...`);
      const reconstitutedMessage = {
        type: message.meshSignalingType,
        data: message.data,
        fromPeerId: from,
        targetPeerId: message.targetPeerId,
        timestamp: message.timestamp,
        messageId: message.messageId,
        viaWebSocket: false,
        // Mark as coming from mesh, not WebSocket
        viaMesh: true
      };
      this.signalingHandler.handleSignalingMessage(reconstitutedMessage);
    }
    /**
     * Handle incoming gossip stream chunk
     * @param {Object} message - The stream chunk message
     * @param {string} from - Sender peer ID
     * @private
     */
    _handleGossipStreamChunk(message, from) {
      const { streamId, chunkIndex, data, metadata } = message;
      if (!streamId || chunkIndex === void 0 || !data) {
        this.debug.error("Invalid gossip stream chunk format");
        return;
      }
      this.debug.log(`\u{1F4E5} Received gossip stream chunk ${chunkIndex} for ${streamId.substring(0, 8)}... from ${from.substring(0, 8)}...`);
      if (!this.gossipStreams.has(streamId)) {
        const chunks = /* @__PURE__ */ new Map();
        let controller;
        const readable = new ReadableStream({
          start(ctrl) {
            controller = ctrl;
          },
          cancel: (reason) => {
            this.debug.log(`\u{1F4E5} Gossip stream ${streamId.substring(0, 8)}... cancelled: ${reason}`);
          }
        });
        this.gossipStreams.set(streamId, {
          chunks,
          metadata: metadata || {},
          controller,
          stream: readable,
          from,
          totalChunks: null
        });
        this.emit("streamReceived", {
          peerId: from,
          streamId,
          stream: readable,
          metadata: metadata || {}
        });
      }
      const streamData = this.gossipStreams.get(streamId);
      streamData.chunks.set(chunkIndex, new Uint8Array(data));
      this._enqueueOrderedChunks(streamId);
    }
    /**
     * Handle incoming gossip stream control message
     * @param {Object} message - The stream control message
     * @param {string} from - Sender peer ID
     * @private
     */
    _handleGossipStreamControl(message, from) {
      const { streamId, action, totalChunks, totalBytes, metadata, reason } = message;
      if (!streamId || !action) {
        this.debug.error("Invalid gossip stream control format");
        return;
      }
      const streamData = this.gossipStreams.get(streamId);
      if (!streamData) {
        this.debug.warn(`Received control message for unknown stream: ${streamId.substring(0, 8)}...`);
        return;
      }
      if (action === "end") {
        this.debug.log(`\u{1F4E5} Gossip stream ${streamId.substring(0, 8)}... ended: ${totalBytes} bytes in ${totalChunks} chunks`);
        streamData.totalChunks = totalChunks;
        this._enqueueOrderedChunks(streamId);
        if (streamData.controller) {
          streamData.controller.close();
        }
        this.emit("streamCompleted", {
          peerId: from,
          streamId,
          totalChunks,
          totalBytes
        });
        setTimeout(() => {
          this.gossipStreams.delete(streamId);
        }, 5e3);
      } else if (action === "abort") {
        this.debug.log(`\u274C Gossip stream ${streamId.substring(0, 8)}... aborted: ${reason}`);
        if (streamData.controller) {
          streamData.controller.error(new Error(reason || "Stream aborted"));
        }
        this.emit("streamAborted", {
          peerId: from,
          streamId,
          reason
        });
        this.gossipStreams.delete(streamId);
      }
    }
    /**
     * Enqueue ordered chunks to the readable stream
     * @param {string} streamId - The stream ID
     * @private
     */
    _enqueueOrderedChunks(streamId) {
      const streamData = this.gossipStreams.get(streamId);
      if (!streamData || !streamData.controller) return;
      const { chunks, controller } = streamData;
      let nextIndex = streamData.nextIndex || 0;
      while (chunks.has(nextIndex)) {
        const chunk = chunks.get(nextIndex);
        try {
          controller.enqueue(chunk);
          chunks.delete(nextIndex);
          nextIndex++;
        } catch (error) {
          this.debug.error(`Failed to enqueue chunk ${nextIndex}:`, error);
          break;
        }
      }
      streamData.nextIndex = nextIndex;
    }
    /**
     * Send a signaling message, using mesh connections for renegotiation
     * @param {Object} message - The signaling message
     * @param {string} targetPeerId - Target peer ID (optional)
     * @returns {Promise<boolean>} Success status
     */
    async sendSignalingMessage(message, targetPeerId = null) {
      const isRenegotiation = message.type === "renegotiation-offer" || message.type === "renegotiation-answer";
      if (isRenegotiation && targetPeerId) {
        this.debug.log(`\u{1F504} MESH RENEGOTIATION: Sending ${message.type} via mesh to ${targetPeerId.substring(0, 8)}...`);
        const peerConnection = this.connectionManager.getPeer(targetPeerId);
        if (peerConnection && peerConnection.sendMessage) {
          const success = peerConnection.sendMessage({
            type: "signaling",
            data: message,
            fromPeerId: this.peerId,
            timestamp: Date.now()
          });
          if (success) {
            this.debug.log(`\u2705 MESH RENEGOTIATION: ${message.type} sent via mesh to ${targetPeerId.substring(0, 8)}...`);
            return true;
          } else {
            this.debug.error(`\u274C MESH RENEGOTIATION: Failed to send ${message.type} via mesh to ${targetPeerId.substring(0, 8)}...`);
          }
        } else {
          this.debug.error(`\u274C MESH RENEGOTIATION: No mesh connection to ${targetPeerId.substring(0, 8)}... for ${message.type}`);
        }
        this.debug.log(`\u{1F504} FALLBACK: Using WebSocket for ${message.type} to ${targetPeerId.substring(0, 8)}...`);
      }
      if (this.signalingClient && this.signalingClient.isConnected()) {
        this.debug.log(`\u{1F4E1} Using WebSocket signaling for ${message.type} to ${targetPeerId?.substring(0, 8) || "broadcast"}`);
        const messageWithTarget = { ...message };
        if (targetPeerId) {
          messageWithTarget.targetPeerId = targetPeerId;
        }
        return await this.signalingClient.sendSignalingMessage(messageWithTarget);
      }
      this.debug.warn(`\u{1F4E1} Cannot send signaling message ${message.type} - WebSocket not connected and mesh failed`);
      return false;
    }
    /**
       * Send an encrypted message to a specific peer
       * @param {string} peerId - Target peer ID
       * @param {any} content - Message content
       * @param {Object} options - Message options
       * @returns {Promise<string|null>} Message ID if sent successfully
       */
    async sendEncryptedMessage(peerId, content, _options = {}) {
      if (!this.enableCrypto || !this.cryptoManager) {
        throw new Error("Crypto not enabled or initialized");
      }
      try {
        const encryptedContent = await this.cryptoManager.encryptForPeer(content, peerId);
        return await this.sendDirectMessage(peerId, encryptedContent);
      } catch (error) {
        this.debug.error("Failed to send encrypted message:", error);
        throw error;
      }
    }
    /**
       * Send an encrypted broadcast message
       * @param {any} content - Message content
       * @param {string} groupId - Optional group ID for group encryption
       * @returns {Promise<string|null>} Message ID if sent successfully
       */
    async sendEncryptedBroadcast(content, groupId = null) {
      if (!this.enableCrypto || !this.cryptoManager) {
        throw new Error("Crypto not enabled or initialized");
      }
      try {
        let encryptedContent;
        if (groupId) {
          encryptedContent = await this.cryptoManager.encryptForGroup(content, groupId);
        } else {
          encryptedContent = {
            encrypted: true,
            broadcast: true,
            data: content,
            from: this.cryptoManager.getPublicKey(),
            timestamp: Date.now()
          };
        }
        return await this.gossipManager.broadcastMessage(encryptedContent, "encrypted");
      } catch (error) {
        this.debug.error("Failed to send encrypted broadcast:", error);
        throw error;
      }
    }
    /**
       * Decrypt a received message
       * @param {Object} encryptedData - Encrypted message data
       * @returns {Promise<any>} Decrypted content
       */
    async decryptMessage(encryptedData) {
      if (!this.enableCrypto || !this.cryptoManager) {
        return encryptedData;
      }
      try {
        if (encryptedData.group) {
          return await this.cryptoManager.decryptFromGroup(encryptedData);
        } else {
          return await this.cryptoManager.decryptFromPeer(encryptedData);
        }
      } catch (error) {
        this.debug.error("Failed to decrypt message:", error);
        throw error;
      }
    }
    /**
       * Exchange public keys with a peer
       * @param {string} peerId - Peer ID to exchange keys with
       */
    async exchangeKeysWithPeer(peerId) {
      if (!this.enableCrypto || !this.cryptoManager) {
        throw new Error("Crypto not enabled or initialized");
      }
      if (this.ongoingKeyExchanges.has(peerId)) {
        this.debug.log(`\u{1F510} Skipping key exchange with ${peerId.substring(0, 8)}... - exchange already in progress`);
        return;
      }
      const hasExistingKey = this.cryptoManager.peerKeys.has(peerId);
      if (hasExistingKey) {
        this.debug.log(`\u{1F510} Skipping key exchange with ${peerId.substring(0, 8)}... - key already exists`);
        return;
      }
      const keypair = this.cryptoManager.keypair;
      if (!keypair || !keypair.pub || !keypair.epub) {
        throw new Error("No complete keypair available (need both pub and epub)");
      }
      this.debug.log(`\u{1F510} Initiating key exchange with ${peerId.substring(0, 8)}...`);
      this.ongoingKeyExchanges.add(peerId);
      try {
        const result = await this.gossipManager.sendDirectMessage(peerId, {
          type: "key_exchange",
          publicKey: {
            pub: keypair.pub,
            epub: keypair.epub
          },
          timestamp: Date.now()
        }, "key_exchange");
        setTimeout(() => {
          this.ongoingKeyExchanges.delete(peerId);
        }, 5e3);
        return result;
      } catch (error) {
        this.ongoingKeyExchanges.delete(peerId);
        throw error;
      }
    }
    /**
       * Add a peer's public key
       * @param {string} peerId - Peer ID
       * @param {string} publicKey - Peer's public key
       * @returns {boolean} True if key was added successfully
       */
    addPeerPublicKey(peerId, publicKey) {
      if (!this.enableCrypto || !this.cryptoManager) {
        return false;
      }
      return this.cryptoManager.addPeerKey(peerId, publicKey);
    }
    /**
       * Generate a group key for encrypted group communications
       * @param {string} groupId - Group identifier
       * @returns {Promise<Object>} Generated group key
       */
    async generateGroupKey(groupId) {
      if (!this.enableCrypto || !this.cryptoManager) {
        throw new Error("Crypto not enabled or initialized");
      }
      return await this.cryptoManager.generateGroupKey(groupId);
    }
    /**
       * Add a group key for encrypted group communications
       * @param {string} groupId - Group identifier
       * @param {Object} groupKey - Group key object
       */
    addGroupKey(groupId, groupKey) {
      if (!this.enableCrypto || !this.cryptoManager) {
        throw new Error("Crypto not enabled or initialized");
      }
      this.cryptoManager.addGroupKey(groupId, groupKey);
    }
    /**
       * Sign data with our private key
       * @param {any} data - Data to sign
       * @returns {Promise<string>} Digital signature
       */
    async signData(data) {
      if (!this.enableCrypto || !this.cryptoManager) {
        throw new Error("Crypto not enabled or initialized");
      }
      return await this.cryptoManager.sign(data);
    }
    /**
       * Verify a signature
       * @param {string} signature - Signature to verify
       * @param {any} data - Original data
       * @param {string} publicKey - Signer's public key
       * @returns {Promise<boolean>} True if signature is valid
       */
    async verifySignature(signature, data, publicKey) {
      if (!this.enableCrypto || !this.cryptoManager) {
        return true;
      }
      return await this.cryptoManager.verify(signature, data, publicKey);
    }
    /**
       * Export our public key for sharing
       * @returns {Object|null} Public key export data
       */
    exportPublicKey() {
      if (!this.enableCrypto || !this.cryptoManager) {
        return null;
      }
      return this.cryptoManager.exportPublicKey();
    }
    /**
       * Run crypto self-tests
       * @returns {Promise<Object>} Test results
       */
    async runCryptoTests() {
      if (!this.enableCrypto || !this.cryptoManager) {
        throw new Error("Crypto not enabled or initialized");
      }
      return await this.cryptoManager.runSelfTest();
    }
    /**
       * Reset crypto state and clear all keys
       */
    resetCrypto() {
      if (this.cryptoManager) {
        this.cryptoManager.reset();
      }
      this.ongoingKeyExchanges.clear();
      this.emittedPeerKeyEvents.clear();
    }
    /**
       * Handle incoming key exchange messages
       * @param {Object} data - Key exchange message data
       * @param {string} from - Sender's peer ID
       * @private
       */
    async _handleKeyExchange(data, from) {
      if ((data.type === "key_exchange" || data.type === "key_exchange_response") && data.publicKey && this.cryptoManager) {
        const keyAdded = this.cryptoManager.addPeerKey(from, data.publicKey);
        if (keyAdded) {
          this.debug.log(`\u{1F510} Stored public key for peer ${from.substring(0, 8)}...`);
          this.ongoingKeyExchanges.delete(from);
        } else {
          this.debug.log(`\u{1F510} Key exchange ignored for peer ${from.substring(0, 8)}... - duplicate key`);
        }
        if (data.type === "key_exchange" && keyAdded) {
          const keypair = this.cryptoManager.keypair;
          if (keypair && keypair.pub && keypair.epub) {
            await this.gossipManager.sendDirectMessage(from, {
              type: "key_exchange_response",
              publicKey: {
                pub: keypair.pub,
                epub: keypair.epub
              },
              timestamp: Date.now()
            }, "key_exchange_response");
          }
        }
      }
    }
    /**
     * Handle remote stream announcements from gossip protocol
     * The actual stream forwarding is handled by ConnectionManager
     * @param {Object} data - Stream announcement data
     * @private
     */
    async _handleRemoteStreamAnnouncement(data) {
      const { peerId, event } = data;
      if (peerId === this.peerId) {
        return;
      }
      this.debug.log(`\u{1F3B5} GOSSIP STREAM: Received stream announcement - ${event} from ${peerId.substring(0, 8)}...`);
      this.emit("remoteStreamAnnouncementReceived", data);
    }
  };

  // src/browser-entry.js
  if (typeof globalThis !== "undefined" && globalThis.AUTOMATED_TEST === void 0) {
    globalThis.AUTOMATED_TEST = typeof window !== "undefined" && window.AUTOMATED_TEST === true ? true : false;
  }
  if (typeof globalThis !== "undefined") {
    globalThis.__PEERPIGEON_UNSEA__ = unsea_exports;
    globalThis.__PEERPIGEON_PIGEONRTC__ = {
      createPigeonRTC,
      PigeonRTC,
      BrowserRTCAdapter,
      RTCAdapter,
      default: createPigeonRTC
    };
  }
  if (typeof window !== "undefined") {
    window.__PEERPIGEON_UNSEA__ = unsea_exports;
    window.__PEERPIGEON_PIGEONRTC__ = {
      createPigeonRTC,
      PigeonRTC,
      BrowserRTCAdapter,
      RTCAdapter,
      default: createPigeonRTC
    };
    window.PeerPigeonMesh = PeerPigeonMesh;
  }
  console.log("\u{1F510} PeerPigeon browser bundle loaded with embedded UnSEA crypto and PigeonRTC");
  return __toCommonJS(browser_entry_exports);
})();
/*! Bundled license information:

unsea/dist/unsea.mjs:
  (*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) *)
  (*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) *)
*/
//# sourceMappingURL=peerpigeon-browser.js.map
