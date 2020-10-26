'use strict';
const fs = require('fs'),
  path = require('path');
/**
 * Loads up all the config found in the given file. on the disk.
 * @Arguments
 *  - opt.path - the path of the file
 *  - opt.required=true - is it required? or if it fails, we just silently return empty string
 *  Currently, we support:
 *    - .json
 *    - .js files
 * */
module.exports = async function sourceDisk(opt = {}, info) {
  let filePath = opt.path,
    isRequired = typeof opt.required === 'boolean' ? opt.required : true;
  if (typeof filePath !== 'string' || !filePath) {
    throw new Error(`File path is required`);
  }
  if (!path.isAbsolute(filePath)) {
    filePath = path.normalize(info.root + '/' + filePath);
  }
  let fileExt = path.basename(filePath).split('.').pop();
  // Load a .js file.
  let configObj = {};
  if (fileExt === 'js') {
    try {
      let fileRes = require(filePath);
      if (typeof fileRes === 'function') {
        let q = fileRes(info);
        if (typeof q === 'object' && q) {}
        configObj = q;
      } else if (typeof fileRes === 'object' && fileRes && !(fileRes instanceof Array)) {
        configObj = fileRes;
      }
    } catch (e) {
      if (isRequired) {
        if (e.code === 'MODULE_NOT_FOUND') {
          throw new Error(`File [${filePath}] does not exist`);
        }
        throw e;
      }
      if (e.code !== 'MODULE_NOT_FOUND') {
        console.log(`Thorin: could not load [${filePath}]`, e);
      }
    }
    return configObj;
  }
  // Load a .json file
  if (fileExt === 'json') {
    try {
      let fileContent = fs.readFileSync(filePath, 'utf8');
      let q = JSON.parse(fileContent);
      if (typeof q === 'object' && q && !(q instanceof Array)) {
        configObj = q;
      }
    } catch (e) {
      if (e.code === 'ENOENT') {
        throw new Error(`File [${filePath}] does not exist`);
      }
      if (isRequired) {
        throw new Error(`File [${filePath}] contains no JSON`);
      } else {
        console.log(`Thorin: could not load [${filePath}]`);
      }
    }
    return configObj;
  }
  throw new Error(`File [${filePath}] type not supported: ${fileExt}`);
}
