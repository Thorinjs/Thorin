'use strict';
const crypto = require('crypto'),
  _dotObject = require('dot-object'),
  path = require('path'),
  url = require('url'),
  os = require('os'),
  uuid = require('uuid'),
  http = require('http'),
  https = require('https'),
  async = require('async'),
  fs = require('fs'),
  fse = require('fs-extra'),
  _extend = require('extend');

let nodeFetch = global.fetch;
if (typeof nodeFetch !== 'function') {
  nodeFetch = require('node-fetch');
}

/**
 * Utilities used globally.
 */
let ALPHA_NUMERIC_CHARS = "AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz1234567890",
  ALPHA_NUMERIC_SPECIAL = ALPHA_NUMERIC_CHARS + '@#$^&()[]+-.',
  RANDOM_STRING = '',
  RANDOM_STRING_ALPHA = '';

(() => {
  for (let i = 0; i <= 255; i++) {
    let q = Math.floor(Math.random() * ALPHA_NUMERIC_SPECIAL.length);
    RANDOM_STRING += ALPHA_NUMERIC_SPECIAL.charAt(q);
    let r = Math.floor(Math.random() * ALPHA_NUMERIC_CHARS.length);
    RANDOM_STRING_ALPHA += ALPHA_NUMERIC_CHARS.charAt(r);
  }
})();

module.exports = function initUtils(app) {

  /**
   * These are Thorin.js utilities.
   * */
  const util = {};

  /**
   * Based on the given IP type, we will scan the server's IP addresses
   * and return the one that matches best.
   * VALUES:
   *   internal
   *   public
   *   {CIDR block}
   *   {IP address} (will simply return it)
   *   {domain} {will return the domain}
   *    internal -> 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
   public -> fetch the publicly accessible IP address. We will scan all network interfaces.
   {CIDR block} -> match our interfaces against the CIDR and place the first one.
   {any other IP} -> we will use this as the IP address of the node
   {any domain} -> we will use the domain as the host.
   * */
  util.getIp = function getIp(type) {
    if (typeof type !== 'string' || !type) type = 'public';
    const ifaces = os.networkInterfaces();
    let names = Object.keys(ifaces);
    let isIp = app.sanitize('IP', type);
    if (isIp) {
      return isIp;
    }
    let isDomain = app.sanitize('DOMAIN', type, {
      underscore: true
    });
    if (isDomain) {
      return isDomain;
    }
    let isCidr = app.sanitize('IP_RANGE', type);
    for (let i = 0; i < names.length; i++) {
      let items = ifaces[names[i]];
      for (let j = 0; j < items.length; j++) {
        let item = items[j];
        if (item.family !== 'IPv4' || item.internal) continue;
        // Check if we have an internal type. If so, we return the first internal IP we find.
        if (type === 'internal') {
          let bVal = app.sanitize('IP', item.address, {
            private: true
          });
          if (bVal) {
            return item.address;
          }
        }
        // Check if we have public IPs. If so, we return the first public item.
        if (type === 'public') {
          let bVal = app.sanitize('IP', item.address, {
            public: true
          });
          if (bVal) {
            return item.address;
          }
        }
        // CHECK if we have a CIDR
        if (isCidr) {
          let isOk = app.sanitize('IP', item.address, {
            range: isCidr
          });
          if (isOk) {
            return item.address;
          }
        }
      }
    }
    if (type === 'public') {
      return util.getIp('internal');
    }
    return null;
  }

  /**
   * Generate a random number between {a,b}
   * This is a cryptographically-safe function that does not use Math.random (lol)
   * @param {a}
   * @param {b}
   * NOTE:
   * - If a is given and b is not given, we do random(length)
   * - If a AND b is given, we do random(a,b) - number between a and b
   * */
  util.randomNumber = function randomNumber(length, b) {
    let res = '';
    if (typeof length === 'number' && typeof b === 'number') {
      let a = length;
      if (a >= b) throw new Error('A must be smaller than b.');
      let rl = Math.max(a.toString().length, b.toString().length);
      let r = crypto.randomBytes(rl),
        bigRand = '';
      for (let i = 0, len = rl; i < len; i++) {
        bigRand += r.readUInt8(i).toString();
        if (bigRand.length > rl * 2) break;
      }
      bigRand = parseFloat('0.' + bigRand);
      res = Math.floor(bigRand * (a - b + 1) + b);
      return res;
    }
    if (typeof length !== 'number' || !length || length <= 0) length = 6;
    let start = Math.pow(10, length - 1),
      end = Math.pow(10, length) - 1;
    return util.randomNumber(start, end);
  }

  /**
   * We generate x random bytes, then we select based on the byte's number, a char from the ALPHA_NUMERIC strings
   * @function randomString
   * @param {number} length - the length of the string to be generated.
   * @param {Function} callback - the callback to call when it's ready.
   * */
  util.randomString = function randomString(length = 16, onlyAlpha = true) {
    let gen = Math.abs(parseInt(length)),
      buf;
    try {
      buf = crypto.randomBytes(gen);
    } catch (e) {
      console.warn('Thorin.util.randomString: failed to generate crypto random buffer: ', e);
      return null;
    }
    let res = '';
    for (let i = 0; i < gen; i++) {
      let _poz = buf.readUInt8(i);
      if (onlyAlpha) {
        res += RANDOM_STRING_ALPHA.charAt(_poz);
      } else {
        res += RANDOM_STRING.charAt(_poz);
      }
    }
    return res;
  }

  /*
   * Wrapper over the deep extend(). Same as Object.extend() but deep copies.
   * It should not be called with a target, because the target will be returned.
   * */
  util.extend = function extend(sources) {
    let target = {};
    let args = [...arguments];
    args.reverse();
    args.push(target);
    args.push(true);
    args = args.reverse();
    return _extend.apply(_extend, args);
  }

  /**
   * Recursively reads the contents of the given folder path and returns an array with file paths.
   * Options:
   *   opt.ext - the extension to search for, OR
   *   opt.dirs - if set to true, returns only directories.
   *   opts.levels - if set, the number of levels to go in.
   *   opt.modules=false - if set to true, we will go through node_modules.
   *   opt.relative= false - if set true, we will convert all paths to be relative to the root path, EXCLUDING the first "/"
   * */
  util.readDirectory = function readDirectory(dirPath, opt, __res, __level) {
    dirPath = path.normalize(dirPath);
    if (typeof opt !== 'object' || !opt) opt = {};
    if (typeof __level !== 'number') __level = 0;
    if (typeof __res === 'undefined') __res = [];
    let items = [],
      ext = null;
    try {
      items = fs.readdirSync(dirPath);
    } catch (e) {
      return __res;
    }
    if (opt.ext) {
      ext = opt.ext;
      delete opt.dirs;
      if (ext && ext.charAt(0) !== '.') ext = '.' + ext;
    }

    if (opt.levels && __level >= opt.levels) {
      return __res;
    } else {
      __level++;
    }
    // sort items with files first.
    items = items.sort((a, b) => {
      if (a.indexOf('.') === -1) return 1;
      return -1;
    });
    for (let i = 0; i < items.length; i++) {
      let itemPath = path.normalize(dirPath + "/" + items[i]),
        item = fs.lstatSync(itemPath);
      if (opt.dirs !== true && item.isFile()) {
        if (!ext || (ext && path.extname(itemPath) === ext || items[i] === ext)) {
          __res.push(itemPath);
        }
      } else if (item.isDirectory()) {
        let shouldGoDeeper = true;
        // Check if the dir starts with ".", If so, ignore.
        if (items[i].charAt(0) === '.') {
          shouldGoDeeper = false;
        } else {
          if (opt.dirs && items[i] !== 'node_modules') {
            __res.push(itemPath);
          }
          if (items[i] === 'node_modules' && opt.modules !== true) {
            shouldGoDeeper = false;
          }
        }
        if (shouldGoDeeper) {
          util.readDirectory(itemPath, opt, __res, __level);
        }
      }
    }
    if (opt.relative === true && __level === 1) {
      for (let i = 0; i < __res.length; i++) {
        __res[i] = __res[i].replace(dirPath, '');
        if (__res[i].charAt(0) === path.sep) {
          __res[i] = __res[i].substr(1);
        }
      }
    }
    return __res;
  }

  /**
   * Checks if the given path is a file. Simple check with try catch and returns true/false
   * */
  util.isFile = function isFile(fpath) {
    try {
      let stat = fs.lstatSync(path.normalize(fpath));
      if (stat.isFile()) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  /**
   * Checks if the given path is a directory.
   * */
  util.isDirectory = function isDirectory(dpath) {
    try {
      let stat = fs.lstatSync(path.normalize(dpath));
      if (stat.isDirectory()) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  /**
   * Utility function that hashes the given text using SHA1 (128 bits)
   * @function sha1
   * @param {string} - the string to be hashed
   * @returns {string}
   * */
  util.sha1 = function sha1(text) {
    return crypto.createHash('sha1').update(text).digest('hex');
  }

  /**
   * Utility function that hashes the given text using SHA2 (256 bits)
   * @function sha2
   * @param {string} - the string to be hashed
   * @param {number=1} - the number of times we want to perform the sha2
   * @returns {string}
   * */
  util.sha2 = function sha2(text, _count = 1) {
    let hash = crypto.createHash('sha256').update(text).digest('hex');
    if (_count > 1) {
      for (let i = 0; i < _count - 1; i++) {
        hash = crypto.createHash('sha256').update(hash).digest('hex');
      }
    }
    return hash;
  }

  /**
   *  Utility function that creates a sha2 HMAC with a secret seed
   * */
  util.hmac = function hmac(text, secret, _alg = 'sha256') {
    let hash = crypto.createHmac(_alg, secret)
      .update(text)
      .digest('hex');
    return hash;
  }

  /**
   * Safely compares two strings, by performing an XOR on them.
   * We use this to mitigate string comparison hack
   * */
  util.compare = function compare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    let wrong = 0,
      max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i++) {
      if (a[i] !== b[i]) wrong++;
    }
    return wrong === 0;
  }

  /**
   * Synchronously encrypts the given data with the given key, by default WITH NO INITIALIZATION VECTOR.
   * If the IV is specified and present, it will be used.
   * IF the IV is present, we hex encode it and prepend it to the ciphertext, followed by a $
   * Returns hex-encrypted text or false, if failed.
   * */
  util.encrypt = function encrypt(data, encryptionKey, _useIv = true) {
    try {
      let cipher,
        iv,
        useType = typeof _useIv;
      if (_useIv === true && encryptionKey.length >= 32) {
        iv = crypto.randomBytes(16);
      } else if (useType === 'string') {
        try {
          iv = Buffer.from(_useIv, 'hex');
        } catch (e) {
        }
      } else if (useType === 'object') {
        iv = _useIv;
      }
      if (encryptionKey.length > 32) {
        encryptionKey = encryptionKey.substr(0, 32);
      }
      let hasIv = typeof iv !== 'undefined';
      // Deprecation fix.
      if (!iv) {
        const tmp = extractKeyIv(encryptionKey, 32, 16);
        encryptionKey = tmp.key;
        iv = tmp.iv;
      }
      cipher = crypto.createCipheriv('aes-256-cbc', encryptionKey, iv);
      if (!(data instanceof Buffer) && typeof data !== 'string') {
        if (typeof data === 'object' && data != null) {
          data = JSON.stringify(data);
        } else {
          data = data.toString();
        }
      }
      let encrypted = cipher.update(data, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      if (hasIv) {
        encrypted = iv.toString('hex') + '$' + encrypted;
      }
      return encrypted;
    } catch (err) {
      console.warn('Thorin.util.encrypt: Failed to synchronously encrypt data', err);
      return false;
    }
  }

  /**
   * Synchronously tries to decrypt the given data with the given encryption key. By default,
   * it will not make use of any IV, but if specified, it will be used.
   * Returns the decrypted string, or false, if failed to decrypt.
   * */
  util.decrypt = function decrypt(data, encryptionKey, _iv) {
    if (typeof data !== 'string' || !data || typeof encryptionKey !== 'string' || !encryptionKey) {
      return false;
    }
    try {
      let decipher,
        iv;
      if (data.charAt(32) === '$' && typeof _iv === 'undefined') {
        iv = data.substr(0, 32);
        data = data.substr(33);
        try {
          iv = Buffer.from(iv, 'hex');
        } catch (e) {
        }
      } else if (typeof _iv !== 'undefined') {
        try {
          iv = Buffer.from(_iv, 'hex');
        } catch (e) {
        }
      }
      if (encryptionKey.length > 32) {
        encryptionKey = encryptionKey.substr(0, 32);
      }
      // Deprecation fix.
      if (!iv) {
        const tmp = extractKeyIv(encryptionKey, 32, 16);
        encryptionKey = tmp.key;
        iv = tmp.iv;
      }
      decipher = crypto.createDecipheriv('aes-256-cbc', encryptionKey, iv);
      let decoded = decipher.update(data, 'hex', 'utf8');
      decoded += decipher.final('utf8');
      return decoded;
    } catch (e) {
      return false;
    }
  };

  /**
   * Promisifies the given function, using the last arg as the callback, or returns a promise,
   * */
  util.promisify = function promisify(fn) {
    return function promisified() {
      let args = [...arguments];
      let callbackFn = (typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null);
      if (!callbackFn) {
        return new Promise((resolve, reject) => {
          args.push(function onDone(err, res) {
            if (err) return reject(err);
            resolve(res);
          });
          fn.apply(this, args);
        });
      }
      return fn.apply(this, args);
    }
  }

  /**
   * Downloads a given static css/js resource from the given url and returns the string.
   * Works with either callback or promise.
   * */
  util.downloadFile = util.promisify(function downloadFile(urlPath, done) {
    let opt;
    try {
      opt = url.parse(urlPath);
    } catch (e) {
      return done(e);
    }
    let hLib = (opt.protocol === 'http:' ? http : https),
      downloadOpt = {
        hostname: opt.hostname,
        port: opt.port,
        path: opt.path
      };
    hLib.get(downloadOpt, (res) => {
      let data = '';
      if (res.statusCode < 200 || res.statusCode > 299) {
        res.on('error', () => {
        });
        return done(new Error('The requested resource is not available.'));
      }
      let contentType = res.headers['content-type'];
      if (typeof contentType !== 'string' || !contentType) {
        return done(new Error("The requested resource type is not supported."));
      }
      if (contentType.indexOf('text/') !== 0) {  // check for application/javascript, application/xml only.
        if (contentType !== 'application/javascript' && contentType !== 'application/xml') {
          res.on('error', () => {
          });
          return done(new Error("The requested resource type is not supported."));
        }
      }
      let wasSent = false;
      res
        .on('data', (d) => {
          if (wasSent) return;
          data += d;
        })
        .on('end', () => {
          if (wasSent) return;
          wasSent = true;
          done(null, data);
        })
        .on('error', (e) => {
          if (wasSent) return;
          wasSent = true;
          done(e);
        });
    }).on('error', done);
  });

  /**
   * Given an object and a key composed of multiple dots, it will return the inner key or null.
   * Ex:
   * setting.notify.id will try and return setting[notify][id]
   * */
  util.innerKey = function key(obj, key, _val, _forceVal) {
    if (typeof obj !== 'object' || !obj) return null;
    if (typeof key !== 'string' || key === '') return null;
    if (key.indexOf('.') === -1) {
      if (typeof _val !== 'undefined' || _forceVal) {
        if (_forceVal) {
          delete obj[key];
        } else {
          obj[key] = _val;
        }
      }
      return obj[key];
    }
    let s = key.split('.');
    let tmp = obj;
    try {
      for (let i = 0; i < s.length; i++) {
        tmp = tmp[s[i]];
        if ((typeof _val !== 'undefined' || _forceVal) && i === s.length - 2) {
          if (_forceVal) {
            delete tmp[s[i + 1]];
          } else {
            // this is the inner setter.
            tmp[s[i + 1]] = _val;
          }
        }
      }
      if (typeof tmp === 'undefined') return null;
      return tmp;
    } catch (e) {
      return null;
    }
  }

  /**
   * Given an object that contains dotted-keys, we will convert
   * the dot keys into objects.
   * Arguments:
   *  - obj - the object with keys containing .
   * */
  util.dotObject = function dotObject(obj, _key) {
    if (typeof obj !== 'object' || !obj) return {};
    let src = {};
    try {
      src = _dotObject.object(obj);
    } catch (e) {
      if (typeof _key === 'string' && _key) {
        return null;
      }
      return src;
    }
    if (typeof _key === 'string' && _key && _key.trim() !== '') {
      return this.innerKey(obj, _key);
    }
    return src;
  }

  /**
   * Given an object, it will flatten it and return an array with dotted-keys and their values
   * */
  util.flattenObject = function flattenObject(obj) {
    if (typeof obj !== 'object' || !obj) {
      return [];
    }
    try {
      return _dotObject.dot(obj);
    } catch (e) {
      return [];
    }
  }

  /**
   * Given a number and a max length, it will format the number and retrieve the 0-prefixed string
   * EG:
   * numberPrefix(5, 999999) => 000005
   * */
  util.numberPrefix = function numberPrefix(number, maxNumber, _prefix) {
    let parsed = (typeof _prefix === 'string' ? _prefix : '');
    if (typeof number === 'number') number = number.toString();
    if (typeof number !== 'string' || !number) return parsed;
    if (typeof maxNumber === 'number' && maxNumber >= 0) {
      if (parseInt(number, 10) > maxNumber) return '';
      maxNumber = maxNumber.toString();
    }
    if (typeof maxNumber === 'string' && maxNumber) {
      for (let i = 0; i < (maxNumber.length - number.length); i++) {
        parsed += '0';
      }
    }
    parsed += number;
    return parsed;
  }


  /**
   * Adds a new entry to the .gitignore file, if it does not exist.
   * By default, we look to the project's root dir.
   * */
  util.addIgnore = (entry, rootDir = process.cwd()) => {
    if (typeof process.pkg !== 'undefined') return true;
    let gitIgnore = path.normalize(rootDir + '/.gitignore'),
      ignoreContent = '';
    try {
      ignoreContent = fs.readFileSync(gitIgnore, { encoding: 'utf8' });
    } catch (e) {
    }
    if (ignoreContent.indexOf(entry) === -1) {
      ignoreContent += '\n' + entry + '\n';
      try {
        fs.writeFileSync(gitIgnore, ignoreContent, { encoding: 'utf8' });
      } catch (e) {
        console.warn('Thorin: failed to update .gitignore file:', e);
      }
    }
    return true;
  }

  /**
   * Given an array, it will divide it into an array of arrays of x size, essentially creating batches of the initial array.
   * */
  util.createBatches = (items = [], size = 100) => {
    if (items.length === 0) return [];
    if (items.length <= size) {
      return [items];
    }
    let i = 0,
      n = items.length,
      chunks = [];
    while (i < n) {
      chunks.push(items.slice(i, i += size));
    }
    return chunks;
  }


  /**
   * Expose our fs-extra instance.
   * */
  util.fs = fse;

  /**
   * Expose our async library
   * */
  util.async = async;

  /**
   * Expose the node-fetch library in thorin.util.fetch
   * */
  util.fetch = nodeFetch;

  /**
   * Expose the UUID lib
   * */
  util.uuid = uuid;

  /**
   * Expose the dotObject library
   * */
  util.dot = _dotObject;

  return util;
}

/**
 * Backward-compatibility for crypto.createCipher which has been deprecated in node v22.
 * @Returns
 * iv - the IV for the key.
 * */
function extractKeyIv(password, keySize, ivSize) {
  const bytes = Buffer.alloc(keySize + ivSize);
  let lastHash = null,
    nBytes = 0;
  while (nBytes < keySize + ivSize) {
    const hash = crypto.createHash('md5');
    if (lastHash) hash.update(lastHash);
    hash.update(password);
    lastHash = hash.digest();
    lastHash.copy(bytes, nBytes);
    nBytes += lastHash.length;
  }

  const key = bytes.slice(0, keySize);
  const iv = bytes.slice(keySize, keySize + ivSize);
  return {
    key,
    iv
  }
}
