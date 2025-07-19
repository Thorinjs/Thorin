'use strict';
const crypto = require('crypto'),
  dotObject = require('dot-object'),
  path = require('path'),
  url = require('url'),
  uuid = require('uuid'),
  http = require('http'),
  https = require('https'),
  async = require('async'),
  nodeFetch = require('node-fetch'),
  fs = require('fs'),
  fse = require('fs-extra'),
  extend = require('extend'),
  Event = require('./event.js');
/**
 * Utilities used globally.
 */
var ALPHA_NUMERIC_CHARS = "AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz1234567890",
  ALPHA_NUMERIC_SPECIAL = ALPHA_NUMERIC_CHARS + '@#$^&()[]+-.',
  RANDOM_STRING = '',
  RANDOM_STRING_ALPHA = '';

(() => {
  for (var i = 0; i <= 255; i++) {
    var q = Math.floor(Math.random() * ALPHA_NUMERIC_SPECIAL.length);
    RANDOM_STRING += ALPHA_NUMERIC_SPECIAL.charAt(q);
    var r = Math.floor(Math.random() * ALPHA_NUMERIC_CHARS.length);
    RANDOM_STRING_ALPHA += ALPHA_NUMERIC_CHARS.charAt(r);
  }
})();

class ThorinUtils {

  /**
   * Generate a random number between {a,b}
   * This is a cryptographically-safe function that does not use Math.random (lol)
   * @param {a}
   * @param {b}
   * NOTE:
   * - If a is given and b is not given, we do random(length)
   * - If a AND b is given, we do random(a,b) - number between a and b
   * */
  static randomNumber(length, b) {
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
    let buff = crypto.randomBytes(length);
    for (let i = 0; i < length; i++) {
      let t = buff.readUInt8(i).toString(),
        pos = Math.floor(Math.random() * t.length);
      if (pos > 0) pos--;
      res += t.substr(pos);
      if (res.length >= length) {
        res = res.substr(0, length);
        break;
      }
    }
    return parseInt(res);
  }

  /**
   * We generate x random bytes, then we select based on the byte's number, a char from the ALPHA_NUMERIC strings
   * @function randomString
   * @param {number} length - the length of the string to be generated.
   * @param {Function} callback - the callback to call when it's ready.
   * */
  static randomString(length, _onlyAlpha) {
    if (typeof length !== 'number') length = 16; // random 16 by default.
    var gen = Math.abs(parseInt(length)),
      onlyAlpha = (_onlyAlpha !== false);
    try {
      var buf = crypto.randomBytes(gen);
    } catch (e) {
      console.warn('Thorin.util.randomString: failed to generate crypto random buffer: ', e);
      return null;
    }
    var res = '';
    for (var i = 0; i < gen; i++) {
      var _poz = buf.readUInt8(i);
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
  static extend(sources) {
    let target = {};
    let args = Array.prototype.slice.call(arguments);
    args.reverse();
    args.push(target);
    args.push(true);
    args = args.reverse();
    return extend.apply(extend, args);
  }

  /*
   * Recursively reads the contents of the given folder path and returns an array with file paths.
   * Options:
   *   opt.ext - the extension to search for, OR
   *   opt.dirs - if set to true, returns only directories.
   *   opts.levels - if set, the number of levels to go in.
   *   opt.modules=false - if set to true, we will go through node_modules.
   *   opt.relative= false - if set true, we will convert all paths to be relative to the root path, EXCLUDING the first "/"
   * */
  static readDirectory(dirPath, opt, __res, __level) {
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
          ThorinUtils.readDirectory(itemPath, opt, __res, __level);
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

  /*
   * Checks if the given path is a file. Simple check with try catch and returns true/false
   * */
  static isFile(fpath) {
    try {
      let stat = fs.lstatSync(path.normalize(fpath));
      if (stat.isFile()) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  /*
   * Checks if the given path is a directory.
   * */
  static isDirectory(dpath) {
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
  static sha1(text) {
    return crypto.createHash('sha1').update(text).digest('hex');
  }

  /**
   * Utility function that hashes the given text using SHA2 (256 bits)
   * @function sha2
   * @param {string} - the string to be hashed
   * @param {number=1} - the number of times we want to perform the sha2
   * @returns {string}
   * */
  static sha2(text, _count) {
    var hash = crypto.createHash('sha256').update(text).digest('hex');
    if (typeof _count === 'number' && _count > 1) {
      for (var i = 0; i < _count - 1; i++) {
        hash = crypto.createHash('sha256').update(hash).digest('hex');
      }
    }
    return hash;
  }

  /**
   *  Utility function that creates a sha2 HMAC with a secret seed
   * */
  static hmac(text, secret, _alg) {
    if (!_alg) _alg = 'sha256';
    var hash = crypto.createHmac(_alg, secret)
      .update(text)
      .digest('hex');
    return hash;
  }

  /*
   * Safely compares two strings, by performing an XOR on them.
   * We use this to mitigate string comparison hack
   * */
  static compare(a, b) {
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
  static encrypt(data, encryptionKey, _useIv = true) {
    try {
      let cipher,
        iv;
      if (_useIv === true) {
        iv = crypto.randomBytes(16);
      } else if (typeof _useIv === 'string') {
        try {
          iv = new Buffer(_useIv, 'hex');
        } catch (e) {
        }
      } else if (typeof _useIv === 'object') {
        iv = _useIv;
      }
      if (encryptionKey.length > 32) {
        encryptionKey = encryptionKey.substr(0, 32);
      }
      if (global.THORIN_DISABLE_IV_KEY) iv = undefined;
      let shouldExcludeIv = false;
      // Deprecation fix.
      if (!iv) {
        const tmp = extractKeyIv(encryptionKey, 32, 16);
        encryptionKey = tmp.key;
        iv = tmp.iv;
        shouldExcludeIv = true;
      }
      cipher = crypto.createCipheriv('aes-256-cbc', encryptionKey, iv);

      if (!(data instanceof Buffer) && typeof data !== 'string') {
        if (typeof data === 'object' && data != null) {
          data = JSON.stringify(data);
        } else {
          data = data.toString();
        }
      }
      var encrypted = cipher.update(data, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      if (!shouldExcludeIv && iv) {
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
  static decrypt(data, encryptionKey, _iv) {
    if (typeof data !== 'string' || !data || typeof encryptionKey !== 'string' || !encryptionKey) {
      return false;
    }
    try {
      let decipher, iv;
      if (data.charAt(32) === '$' && typeof _iv === 'undefined') {
        iv = data.substr(0, 32);
        data = data.substr(33);
        try {
          iv = new Buffer(iv, 'hex');
        } catch (e) {
        }
      } else if (typeof _iv !== 'undefined') {
        try {
          iv = new Buffer(_iv, 'hex');
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
   * Downloads a given static css/js resource from the given url and returns the string.
   * */
  static downloadFile(urlPath, done) {
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
  }

  /**
   * Given an object and a key composed of multiple dots, it will return the inner key or null.
   * Ex:
   * setting.notify.id will try and return setting[notify][id]
   * */
  static innerKey(obj, key, _val, _forceVal) {
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
    var s = key.split('.');
    var tmp = obj;
    try {
      for (var i = 0; i < s.length; i++) {
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
  static dotObject(obj, _key) {
    if (typeof obj !== 'object' || !obj) return {};
    let src = {};
    try {
      src = dotObject.object(obj);
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
  static flattenObject(obj) {
    if (typeof obj !== 'object' || !obj) {
      return [];
    }
    try {
      return dotObject.dot(obj);
    } catch (e) {
      return [];
    }
  }

  /**
   * Given a number and a max length, it will format the number and retrieve the 0-prefixed string
   * EG:
   * numberPrefix(5, 999999) => 000005
   * */
  static numberPrefix(number, maxNumber, _prefix) {
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

  /*
   * Given an array of items (string/number), returns the unique ones.
   * */
  static unique(items, field) {
    if (!(items instanceof Array)) return [];
    let uMap = {},
      result = [];
    if (typeof field !== 'string' || !field) field = 'id';
    for (let i = 0, len = items.length; i < len; i++) {
      let itm = items[i];
      if (typeof itm === 'object' && itm) {
        itm = itm[field];
      }
      if (typeof itm !== 'string' && typeof itm !== 'number') continue;
      if (typeof uMap[itm] !== 'undefined') continue;
      uMap[itm] = true;
      result.push(itm);
    }
    return result;
  }

  /**
   * Given an array with objects, a key name and another array with objects, and another key name, it will map them together
   * Example:
   * source = [{
   *  id: 1,
   *  device_id: '1'
   * }];
   * devices = [{
   *  id: '1',
   *  name: 'test'
   * }]
   * mergeItems(source, 'device', devices, 'id')
   * =>
   *  source = [{
   *    id: 1,
   *    device: {
   *      id: '1',
   *      name: 'test'
   *    }
   *  }]
   * */
  static mergeItems(source, sourceField, items, itemField, _separator) {
    if (typeof sourceField !== 'string' || !sourceField) return false;
    if (typeof source === 'undefined') return false;
    if (typeof items === 'undefined') return false;
    if (!(source instanceof Array)) source = [source];
    if (!(items instanceof Array)) items = [items];
    if (typeof itemField !== 'string' || !itemField) itemField = 'id';
    if (typeof _separator !== 'string' || !_separator) _separator = '_';
    let targetMap = {},
      sourceId = sourceField + _separator + itemField;
    // loop over items
    for (let i = 0, len = items.length; i < len; i++) {
      let itm = items[i];
      if (typeof itm !== 'object' || !itm) continue;
      let tid = itm[itemField];
      if (typeof tid === 'number') tid = tid.toString();
      if (typeof tid !== 'string' || !tid) continue;
      targetMap[tid] = itm;
    }

    // loop over source.
    for (let i = 0, len = source.length; i < len; i++) {
      let itm = source[i];
      if (typeof itm !== 'object' || !itm) continue;
      let sid = itm[sourceId];
      if (typeof sid === 'number') sid = sid.toString();
      if (typeof sid !== 'string' || !sid) continue;
      let targetObj = targetMap[sid];
      if (typeof targetObj !== 'object' || !targetObj) continue;
      itm[sourceField] = targetObj;
    }
    // next loop over targets
    targetMap = null;
  }

  /**
   * Similar with mergeItems() but works with arrays in stead of source_id/items mapping
   * Example:
   * let items = [{
      id: '1',
      name: 'Item one'
    }, {
      id: '2',
      name: 'Item two'
    }];
   let sourceField = 'profiles';
   let items = [{
      id: 'something',
      account_id: '1',
      name: 'John'
    }, {
      id: 'something2',
      account_id: '2',
      name: 'Doe'
    }];
   let itemKeyName = 'account_id';
   let sourceKeyName = 'id';
   let result = [{
      id: '1',
      name: 'Item one',
      profiles: [{
        id: '1',
        account_id: '1',
        name: 'John'
      }]
    }, {
      id: '2',
      name: 'Item two',
      profiles: [{
        id: '2',
        account_id: '2',
        name: 'Doe'
      }]
    }]*/
  static mergeArrayItems(sources, sourceField, items, itemKeyName, sourceKeyName) {
    if (!(sources instanceof Array)) return false;
    if (typeof sourceField !== 'string') return false;
    if (!(items instanceof Array)) return false;
    if (typeof itemKeyName !== 'string') return false;
    if (typeof sourceKeyName !== 'string') sourceKeyName = 'id';
    let sourceMap = {};
    // loop over our items to match and map the source field.
    for (let i = 0, len = items.length; i < len; i++) {
      let id = items[i][itemKeyName];
      if (typeof id === 'number') id = id.toString();
      if (typeof id !== 'string') continue;
      if (typeof sourceMap[id] === 'undefined') sourceMap[id] = [];
      sourceMap[id].push(items[i]);
    }
    // loop over the sources and search through the searchMap to map the items.
    for (let i = 0, len = sources.length; i < len; i++) {
      let id = sources[i][sourceKeyName];
      if (typeof id === 'number') id = id.toString();
      if (typeof id !== 'string') continue;
      if (typeof sourceMap[id] !== 'undefined') {
        sources[i][sourceField] = sourceMap[id];
      } else {
        sources[i][sourceField] = [];
      }
    }
    sourceMap = null;
    return true;
  }

  /**
   * Similar to mergeItems, it will essentially check if the given array items are objects and contain the field as an object.
   * EG:
   * items=[{
   *    id: '1',
   *    asset: {
   *      id: 2
   *    }
   * }, {
   *    id: 3
   * }]
   * field=asset
   * => items=[{id: '1', asset: {id: 2}}]
   * */
  static cleanItems(items, field) {
    if (!(items instanceof Array)) items = [items];
    let i = 0;
    if (typeof field !== 'string' || !field) return items;
    while (i < items.length) {
      let item = items[i];
      if (typeof item !== 'object' || !item || typeof item[field] !== 'object' || !item[field]) {
        items.splice(i, 1);
      } else {
        i++;
      }
    }
    return items;
  }

  /**
   * Utility function that can be used to clean arrays.
   * Arguments:
   *  - items[] -> an array of objects/strings/numbers (not booleans)
   *  - fn-> a callback function to check every item.
   * */
  static mapItems(items, fn) {
    let clean = [];
    if (!(items instanceof Array)) return clean;
    for (let i = 0, len = items.length; i < len; i++) {
      let item = items[i];
      if (typeof item === 'undefined' || item == null) continue;
      if (item === false || item === true) continue;
      try {
        let tmp = fn(item);
        if (typeof tmp === 'undefined' || tmp == null || tmp === false) continue;
        if (tmp === true) {
          clean.push(items);
        } else {
          clean.push(tmp);
        }
      } catch (e) {
      }
    }
    return clean;
  }

  /**
   * Utility function that will search for the given needle
   * in all the given arguments.
   * Eg:
   *  let match = thorin.util.matchText('hi!', 'john', 'doe', 'will say hi!'); // true
   * */
  static matchText(needle) {
    let args = Array.prototype.slice.call(arguments);
    args.splice(0, 1);
    if (typeof needle !== 'string' || !needle) return false;
    if (args[0] instanceof Array) args = args[0];
    if (args.length === 0) return false;
    needle = needle.toLowerCase().trim();
    let clean = [];
    // First, match entire string
    for (let i = 0, len = args.length; i < len; i++) {
      if (typeof args[i] === 'number') args[i] = args[i].toString();
      if (typeof args[i] !== 'string') continue;
      args[i] = args[i].trim().toLowerCase();
      if (args[i].indexOf(needle) !== -1) return true;
      clean.push(args[i]);
    }
    // Next, split needle into words.
    if (clean.length === 0) return false;
    let words = needle.split(' ');
    for (let i = 0; i < words.length; i++) {
      let word = words[i].trim();
      if (!word) continue;
      for (let j = 0; j < clean.length; j++) {
        if (clean[j].indexOf(word) !== -1) return true;
      }
    }
    return false;
  }
}

/**
 * Expose the fs-extra library in thorin.util.fs
 * */
ThorinUtils.fs = fse;
/*
 * Expose the thorin.util.Event class
 * */
ThorinUtils.Event = Event;
/**
 * Expose the async library in thorin.util.async
 * */
ThorinUtils.async = async;

/**
 * Expose the node-fetch library in thorin.util.fetch
 * */
ThorinUtils.fetch = nodeFetch;

/**
 *  Expose the uuid library in thorin.util.uuid
 * */
ThorinUtils.uuid = uuid;
ThorinUtils.dot = dotObject;
module.exports = ThorinUtils;


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
