'use strict';
const dotObject = require('dot-object'),
  extend = require('extend');
dotObject.override = true;
/**
 * This is our thorin.config() functionality
 * */
module.exports = function init(app) {
  let rootConfig = {};

  function config(keyName, _defaultValue) {
    if (typeof keyName === 'undefined') {
      return rootConfig;
    }

    _defaultValue = (typeof _defaultValue === 'undefined' ? null : _defaultValue);
    if (typeof keyName !== 'string' || !keyName) return _defaultValue;
    let val = dotObject.pick(keyName, rootConfig);
    if (typeof val === 'undefined') return _defaultValue;
    return val;
  }

  /*
   * Override a configuration setting.
   * */
  config.set = function setConfig(keyName, keyValue) {
    if (typeof keyName !== 'string' || !keyName || typeof keyValue === 'undefined') return this;
    if (keyName.indexOf('.') === -1) {
      rootConfig[keyName] = keyValue;
    } else {
      let newSetting;
      if (typeof keyValue === 'object' && keyValue) {
        newSetting = dotObject.object(keyValue);
      } else {
        newSetting = keyValue;
      }
      try {
        dotObject.remove(keyName, rootConfig);
      } catch (e) {
      }
      dotObject.str(keyName, newSetting, rootConfig);
    }
    return this;
  };
  /*
   * Merges the given configuration with the current one.
   * */
  config.merge = function mergeConfig(targetConfig) {
    if (typeof targetConfig !== 'object' || !targetConfig) return this;
    rootConfig = app.util.extend(rootConfig, targetConfig);
    return this;
  };

  /* Clears the given configuration keys. */
  config.clear = function clearConfigurationKeys(_arg) {
    let keys = (_arg instanceof Array ? _arg : Array.prototype.slice.call(arguments));
    for (let i = 0; i < keys.length; i++) {
      if (typeof keys[i] === 'string' && keys[i]) {
        dotObject.remove(keys[i], rootConfig);
      }
    }
    return this;
  };

  /* Attach the given configuration to our root config, processing it. */
  config.attach = function attachConfig(config) {
    let parsedConfig = rootConfig;
    Object.keys(config).forEach((keyName) => {
      if (keyName.indexOf('.') === -1) {
        let subConfig = config[keyName];
        if ((typeof config[keyName] === 'object' && config[keyName] && !(config[keyName] instanceof Array))) {
          subConfig = dotObject.dot(subConfig);
          subConfig = dotObject.object(subConfig);
          parsedConfig[keyName] = extend(true, parsedConfig[keyName] || {}, subConfig);
        } else {
          parsedConfig[keyName] = subConfig;
        }
      } else {
        let tmp = {};
        dotObject.str(keyName, config[keyName], tmp);
        parsedConfig = extend(true, parsedConfig, tmp);
      }
      delete config[keyName];
    });
    Object.keys(parsedConfig).forEach((keyName) => {
      config[keyName] = parsedConfig[keyName];
    });
    checkEnvVars(config);
    rootConfig = config;
  }


  function replaceEnvVars(str) {
    if (typeof str !== 'string' || !str) return str;
    str = str.trim();
    let tmp = str.toUpperCase();
    if (tmp.indexOf('$ENV:') !== -1) {
      let keyName = str.substr(5);
      if (typeof process.env[keyName] === 'undefined') {
        console.log(`Thorin.config:  [ENV ${keyName}] not found`);
        return '';
      }
      return process.env[keyName];
    }

    if (tmp.indexOf("$ARG:") !== -1) {
      let argName = str.substr(5),
        argVal = app.argv(argName, null);
      if (!argVal) {
        console.log(`Thorin.config: [ARG ${argName}] not found`);
        return '';
      }
      return argVal;
    }
    return str;
  }

  function checkEnvVars(data) {
    Object.keys(data).forEach((keyName) => {
      if (typeof data[keyName] === 'string') {
        data[keyName] = replaceEnvVars(data[keyName]);
        return;
      }
      if (data[keyName] instanceof Array) {
        for (let i = 0; i < data[keyName].length; i++) {
          data[keyName][i] = replaceEnvVars(data[keyName][i]);
        }
        return;
      }
      if (typeof data[keyName] === 'object' && data[keyName]) {
        return checkEnvVars(data[keyName]);
      }
    });
  }

  return config;
}


