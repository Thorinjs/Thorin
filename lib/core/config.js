'use strict';

const fs = require('fs'),
  dotObject = require('dot-object'),
  extend = require('extend'),
  path = require('path'),
  util = require('../util/util'),
  async = require('async');

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
    if(typeof opt === 'string') {
      opt = {
        path: [opt]
      };
    }
    opt = app.util.extend({
      path: [],
      absolute: false,
      required: true
    }, opt);
    if(typeof opt.path === 'string') opt.path = [opt.path];
    let calls = [];
    opt.path.forEach((configPath) => {
      if(!opt.absolute) {
        configPath = path.normalize(app.root + '/' + configPath);
      }
      /* IF the file is a .json one, we parse it. */
      if(path.extname(configPath) === ".json") {
        calls.push((done) => {
          fs.readFile(configPath, { encoding: 'utf8' }, (err, diskConfig) => {
            if(err) {
              if(opt.required) {
                console.error('Thorin.config.disk: failed to load config from file: %s', configPath);
                return done(err);
              }
              return done();
            }
            try {
              diskConfig = JSON.parse(diskConfig);
            } catch(e) {
              console.error('Thorin.config.disk: failed to parse config from file: %s', configPath);
              return done(e);
            }
            extend(true, config, diskConfig);
            done();
          });
        });
      }
      /* IF the file is a .js one, we require it and merge export. */
      if(path.extname(configPath) === ".js") {
        calls.push((done) => {
          let diskConfig;
          try {
            diskConfig = require(configPath);
          } catch(e) {
            if(e.code === 'MODULE_NOT_FOUND' && !opt.required) return done();
            if(opt.required) {
              console.error('Thorin.config.disk: failed to require config from file: %s', configPath);
              return done(e);
            }
          }
          if(typeof diskConfig === 'object' && diskConfig) {
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
  * */
  static sconfig(config, opt, onLoad) {
    // TODO
    console.warn('Thorin.sconfig: not implemented yet.');
    onLoad();
  }

  /*
  * Processes all the $ENV and $ARG variables and looks for them, or
  * it will call out a warning if not present.
  * */
  static __processConfiguration(app, config, done) {
    let tmp = (typeof _tmp === 'object' ? _tmp : {});
    Object.keys(config).forEach((keyName) => {
      if(keyName.indexOf('.') === -1) return;
      tmp[keyName] = config[keyName];
      delete config[keyName];
    });
    let innerObj = dotObject.object(tmp);
    config = extend(true, config, innerObj);
    /* Step two, search for $ENV and $ARG */
    function doReplace(str) {
      if(typeof str !== 'string' || !str) return str;
      str = str.trim();
      let tmp = str.toUpperCase();
      if(tmp.indexOf('$ENV:') !== -1) {
        let keyName = str.substr(5);
        if(typeof process.env[keyName] === 'undefined') {
          console.warn('Thorin.config: environment variable: %s not found', keyName);
          return '';
        }
        return process.env[keyName];
      }

      if(tmp.indexOf("$ARG:") !== -1) {
        let argName = str.substr(5),
          argVal = app.argv(argName, null);
        if(!argVal) {
          console.warn('Thorin.config: argument variable: %s not found', argName);
          return '';
        }
        return argVal;
      }
      return str;
    }
    function checkEnvArg(data) {
      Object.keys(data).forEach((keyName) => {
        if(typeof data[keyName] === 'string') {
          data[keyName] = doReplace(data[keyName]);
          return;
        }
        if(data[keyName] instanceof Array) {
          for(let i=0; i < data[keyName].length; i++) {
            data[keyName][i] = doReplace(data[keyName][i]);
          }
          return;
        }
        if(typeof data[keyName] === 'object' && data[keyName]) {
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
      if(typeof keyName === 'undefined') {
        return rootConfig;
      }

      _defaultValue = (typeof _defaultValue === 'undefined' ? null : _defaultValue);
      if(typeof keyName !== 'string' || !keyName) return _defaultValue;
      let val = dotObject.pick(keyName, rootConfig);
      if(typeof val === 'undefined') return _defaultValue;
      return val;
    }
    /*
    * Override a configuration setting.
    * */
    config.set = function SetConfig(keyName, keyValue) {
      if(typeof keyName !== 'string' || !keyName || typeof keyValue === 'undefined') return this;
      dotObject.str(keyName, keyValue, rootConfig);
      return this;
    };
    /*
    * Merges the given configuration with the current one.
    * */
    config.merge = function MergeConfig(targetConfig) {
      if(typeof targetConfig !== 'object' || !targetConfig) return this;
      rootConfig = util.extend(rootConfig, targetConfig);
      return this;
    };

    /* Clears the given configuration keys. */
    config.clear = function ClearConfigurationKeys(_arg) {
      let keys = (_arg instanceof Array ? _arg : Array.prototype.slice.call(arguments));
      for(let i=0; i < keys.length; i++) {
        if(typeof keys[i] === 'string' && keys[i]) {
          dotObject.remove(keys[i], rootConfig);
        }
      }
      return this;
    };
    return config;
  }
}

module.exports = ThorinConfig;