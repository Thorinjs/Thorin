'use strict';
const path = require('path'),
  fs = require('fs');
/**
 * Loads up all secrets found inside the given folder.
 * Since we are preparing for docker secrets, we are looking at:
 * {fileName = the KEY}
 * {fileContent} = the VALUE
 * OPTIONS:
 *   - path = the default is /run/secrets
 * NOTES:
 *  - this will place the key/values in process.env
 * */

module.exports = async function sourceSecret(opt) {
  if (!opt.path) opt.path = '/run/secrets';
  opt.path = path.normalize(opt.path);
  opt.required = opt.required === true;
  let envObj = {};
  try {
    let files = fs.readdirSync(opt.path);
    if (files.length === 0) return;
    files.forEach((fpath) => {
      let filePath = path.normalize(opt.path + '/' + fpath),
        fileContent;
      try {
        let stat = fs.lstatSync(filePath);
        if (!stat.isFile()) return;
      } catch (e) { // not a file.
        return;
      }
      try {
        fileContent = fs.readFileSync(filePath, 'utf8');
        if (!fileContent) return;
      } catch (e) {
        return;
      }
      envObj[fpath] = fileContent;
    });
    Object.keys(envObj).forEach((keyName) => {
      process.env[keyName] = envObj[keyName];
    });

  } catch (e) {
    if (opt.required === true) throw new Error(`Could not read from secret file`);
  }
}
