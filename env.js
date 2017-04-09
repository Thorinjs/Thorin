'use strict';
const path = require('path'),
  fs = require('fs'),
  fse = require('fs-extra');
/**
 * Manually set data to the .thorin config file.
 * */
const THORIN_ROOT = process.cwd(),
  PERSIST_FILE = path.normalize(THORIN_ROOT + '/config/.thorin');

function getConfig() {
  try {
    fse.ensureFileSync(PERSIST_FILE);
  } catch (e) {
    console.warn(`thorin-env: could not ensure file exists: ${PERSIST_FILE}`);
    return false;
  }
  let config = '';
  try {
    config = fs.readFileSync(PERSIST_FILE, {encoding: 'utf8'});
  } catch (e) {
    console.warn(`thorin-env: could not read file: ${PERSIST_FILE}`);
    return false;
  }
  if (typeof config === 'string' && config) {
    try {
      config = JSON.parse(config);
      if (typeof config !== 'object' || !config) config = {};
    } catch (e) {
      config = {};
    }
  }
  if (typeof config !== 'object' || !config) config = {};
  return config;
}

/* Manually set the config data in the file. NOTE THIS DOES NOT MERGE, JUST REPLACE. */
function setConfig(config) {
  let oldConfig = getConfig();  // to check if the file exists.
  if (!oldConfig) return false;
  if (typeof config !== 'object' || !config) return false;
  let configData = '';
  try {
    configData = JSON.stringify(config, null, 1);
  } catch (e) {
    console.warn(`thorin-env: failed to serialize configuration`, e);
    return false;
  }
  try {
    fs.writeFileSync(PERSIST_FILE, configData, {encoding: 'utf8'});
  } catch (e) {
    console.warn(`thorin-env: failed to persist new config in .thorin file`);
    console.debug(e);
    return false;
  }
  return true;
}

module.exports.env = function SetEnv(key, value) {
  let config = getConfig();
  if (typeof config._APP_ENV !== 'object' || !config._APP_ENV) {
    config._APP_ENV = {};
  }
  if (typeof key === 'object' && key) {
    Object.keys(key).forEach((name) => {
      config._APP_ENV[name] = key[name];
    });
  } else if (typeof key === 'string' && typeof value !== 'undefined') {
    config._APP_ENV[key] = value;
  }
  return setConfig(config);
};
