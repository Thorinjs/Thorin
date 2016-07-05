'use strict';

const fs = require('fs'),
  dotObject = require('dot-object'),
  extend = require('extend'),
  fetch = require('node-fetch'),
  path = require('path'),
  util = require('../util/util'),
  async = require('async');

const SCONFIG_URL = 'https://api.sconfig.io/config';
let SCONFIG_KEY = null;

/**
 * Created by Adrian on 19-Mar-16.
 * This contains information regarding how we actually load the configuration
 * for our process.
 * We can aggregate configuration from multiple sources.
 */
class ThorinConfig {

  /*
   * Loads up all the configuration from the "app/config" folder.
   * */
  static disk(app, config, opt, onLoad) {
    if (typeof opt === 'string') {
      opt = {
        path: [opt]
      };
    }
    opt = app.util.extend({
      path: [],
      absolute: false,
      required: true
    }, opt);
    if (typeof opt.path === 'string') opt.path = [opt.path];
    let calls = [];
    opt.path.forEach((configPath) => {
      if (!opt.absolute) {
        configPath = path.normalize(app.root + '/' + configPath);
      }
      /* IF the file is a .json one, we parse it. */
      if (path.extname(configPath) === ".json") {
        calls.push((done) => {
          fs.readFile(configPath, {encoding: 'utf8'}, (err, diskConfig) => {
            if (err) {
              if (opt.required) {
                console.error('Thorin.config.disk: failed to load config from file: %s', configPath);
                return done(err);
              }
              return done();
            }
            try {
              diskConfig = JSON.parse(diskConfig);
            } catch (e) {
              console.error('Thorin.config.disk: failed to parse config from file: %s', configPath);
              return done(e);
            }
            extend(true, config, diskConfig);
            done();
          });
        });
      }
      /* IF the file is a .js one, we require it and merge export. */
      if (path.extname(configPath) === ".js") {
        calls.push((done) => {
          let diskConfig;
          try {
            diskConfig = require(configPath);
          } catch (e) {
            if (e.code === 'MODULE_NOT_FOUND' && !opt.required) return done();
            if (opt.required) {
              console.error('Thorin.config.disk: failed to require config from file: %s', configPath);
              return done(e);
            }
          }
          if (typeof diskConfig === 'object' && diskConfig) {
            extend(true, config, diskConfig);
          }
          done();
        });
      }
      /* Otherwise, unsupported config. */
      async.series(calls, onLoad);
    });
  }

  /*
   * Calls SConfig with the given token, and places all the $ENV and $ARGV sources
   * in the final config.
   * OPTIONS:
   *   - version: the version to fetch (defaults to latest)
   *
   *   - key (32char) -> the 32 char key
   *   - secret (32char) => the 32 char secret of the app
   *   OR
   *   - key (100+char) -> the full access token.
   * */
  static sconfig(app, config, opt, done) {
    if (typeof opt !== 'object' || !opt) {
      console.error('Thorin.sconfig: missing key from options.');
      return done();
    }
    let key = (typeof opt.key === 'string' ? opt.key : process.env.SCONFIG_KEY),
      secret = (typeof opt.secret === 'string' ? opt.secret : process.env.SCONFIG_SECRET),
      version = (typeof opt.version === 'string' ? opt.version : process.env.SCONFIG_VERSION);
    if (typeof key !== 'string' || !key) {
      console.error('Thorin.sconfig: missing key.');
      return done();
    }
    // fetch the key from process env.
    if (key.indexOf('$ENV:') === 0) {
      let tmp = key.substr(5);
      key = process.env[tmp];
      if (!key) {
        console.warn(`Thorin.config: environment variable "${tmp}" does not exist.`);
        return done();
      }
    } else if (key.indexOf('$ARGV:') === 0) {
      let tmp = key.substr(6);
      key = app.argv(tmp);
      if (!key) {
        console.warn(`Thorin.config: argv variable ${tmp} does not exist.`);
        return done();
      }
    }
    let url = SCONFIG_URL,
      configType = 'env'; // by default, environment key=value pairs
    if (typeof version !== 'undefined') {
      url += '?v=' + version;
    }

    function parseThorinConfig(type, tconfig, shouldExtend) {
      let res = {};
      switch (type) {
        case 'json':
          res = tconfig;
          if (shouldExtend) {
            extend(true, config, res);
          }
          break;
        case 'env':
          const items = tconfig.split('\n');
          for (let i = 0; i < items.length; i++) {
            let item = items[i].trim();
            if (item == '' || item.indexOf('=') === -1) continue;
            if (item.charAt(0) === '#' || (item.charAt(0) === '/' && item.charAt(1) === '/')) continue;  // comments
            let tmp = item.split('='),
              key = tmp[0],
              val = tmp[1] || null;
            res[key] = val;
          }
          if (shouldExtend) {
            Object.keys(res).forEach((key) => {
              process.env[key] = res[key];
            });
          }
          break;
      }
      return res;
    }
    SCONFIG_KEY = key;
    let status;
    fetch(url, {
      headers: {
        Authorization: 'Bearer ' + key
      }
    }).then((res) => {
      status = res.status;
      if (res.status !== 200) {
        return res.json();
      }
      let contentType = res.headers.get('content-type');
      if (contentType.indexOf('json') !== -1) {
        configType = 'json';
      }
      return res.text();
    }).then((config) => {
      if (status !== 200) {
        let err = (typeof config === 'object' ? config : app.error('SCONFIG', 'Could not finalize configuration request', res.status));
        throw err;
      }
      // check if we have a secret
      if (secret) {
        let decrypted = app.util.decrypt(config, secret);
        if (!decrypted) {
          console.error(`Thorin.sconfig: could not decrypt configuration data with secret`);
          throw 1;
        }
        config = decrypted;
      }
      if (configType === 'json') {
        try {
          config = JSON.parse(config);
        } catch (e) {
          console.warn(`Thorin.sconfig: could not parse configuration as JSON: ${config}`);
          throw 1;
        }
      }
      app.persist('sconfig_data', {
        type: configType,
        data: config
      });
      parseThorinConfig(configType, config, true);
      done();
    }).catch((err) => {
      const persistedData = app.persist('sconfig_data');
      if (persistedData) {
        parseThorinConfig(persistedData.type, persistedData.data, true);
      } else {
        console.warn(`Thorin.sconfig: could not fallback to previously persisted configuration.`);
      }
      if (err === 1) {
        return done();
      }
      console.error(`Thorin.sconfig: could not fetch configuration data.`);
      console.trace(err);
      done();
    });
  }

  /*
   * Processes all the $ENV and $ARG variables and looks for them, or
   * it will call out a warning if not present.
   * */
  static __processConfiguration(app, config, done) {
    let parsedConfig = {};
    Object.keys(config).forEach((keyName) => {
      if(keyName.indexOf('.') === -1) {
        parsedConfig[keyName] = config[keyName];
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

    /* Step two, search for $ENV and $ARG */
    function doReplace(str) {
      if (typeof str !== 'string' || !str) return str;
      str = str.trim();
      let tmp = str.toUpperCase();
      if (tmp.indexOf('$ENV:') !== -1) {
        let keyName = str.substr(5);
        if (typeof process.env[keyName] === 'undefined') {
          console.warn('Thorin.config: environment variable: %s not found', keyName);
          return '';
        }
        return process.env[keyName];
      }

      if (tmp.indexOf("$ARG:") !== -1) {
        let argName = str.substr(5),
          argVal = app.argv(argName, null);
        if (!argVal) {
          console.warn('Thorin.config: argument variable: %s not found', argName);
          return '';
        }
        return argVal;
      }
      return str;
    }

    function checkEnvArg(data) {
      Object.keys(data).forEach((keyName) => {
        if (typeof data[keyName] === 'string') {
          data[keyName] = doReplace(data[keyName]);
          return;
        }
        if (data[keyName] instanceof Array) {
          for (let i = 0; i < data[keyName].length; i++) {
            data[keyName][i] = doReplace(data[keyName][i]);
          }
          return;
        }
        if (typeof data[keyName] === 'object' && data[keyName]) {
          return checkEnvArg(data[keyName]);
        }
      });
    }

    checkEnvArg(config);
    done();
  }

  /* The ThorinConfigInstance is used in thorin.config("configKey"), mounted on the actual thorin app. */
  static Instance(rootConfig) {
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
    config.set = function SetConfig(keyName, keyValue) {
      if (typeof keyName !== 'string' || !keyName || typeof keyValue === 'undefined') return this;
      if (keyName.indexOf('.') === -1) {
        rootConfig[keyName] = keyValue;
      } else {
        dotObject.str(keyName, keyValue, rootConfig);
      }
      return this;
    };
    /*
     * Merges the given configuration with the current one.
     * */
    config.merge = function MergeConfig(targetConfig) {
      if (typeof targetConfig !== 'object' || !targetConfig) return this;
      rootConfig = util.extend(rootConfig, targetConfig);
      return this;
    };

    /* Clears the given configuration keys. */
    config.clear = function ClearConfigurationKeys(_arg) {
      let keys = (_arg instanceof Array ? _arg : Array.prototype.slice.call(arguments));
      for (let i = 0; i < keys.length; i++) {
        if (typeof keys[i] === 'string' && keys[i]) {
          dotObject.remove(keys[i], rootConfig);
        }
      }
      return this;
    };

    /* Returns the sconfig Authorization key. */
    config.getSconfigKey = () => SCONFIG_KEY;
    return config;
  }
}

module.exports = ThorinConfig;