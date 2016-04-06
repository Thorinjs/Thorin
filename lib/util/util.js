'use strict';
const crypto = require('crypto'),
  path = require('path'),
  fs = require('fs'),
  extend = require('extend');
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
   * We generate x random bytes, then we select based on the byte's number, a char from the ALPHA_NUMERIC strings
   * @function randomString
   * @memberof crux.util
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
    } catch(e) {
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


  /**
   * Utility function that hashes the given text using SHA1 (128 bits)
   * @function sha1
   * @memberof crux.util
   * @param {string} - the string to be hashed
   * @returns {string}
   * */
  static sha1(text) {
    return crypto.createHash('sha1').update(text).digest('hex');
  }

  /**
   * Utility function that hashes the given text using SHA2 (256 bits)
   * @function sha2
   * @memberof crux.util
   * @param {string} - the string to be hashed
   * @param {number=1} - the number of times we want to perform the sha2
   * @returns {string}
   * */
  static sha2(text, _count) {
    var hash = crypto.createHash('sha256').update(text).digest('hex');
    if(typeof _count === 'number' && _count > 1) {
      for(var i=0; i < _count; i++) {
        hash = crypto.createHash('sha256').update(hash).digest('hex');
      }
    }
    return hash;
  }
}

module.exports = ThorinUtils;