'use strict';
const fse = require('fs-extra'),
  fs = require('fs'),
  TConfig = require('../util/config'),
  TEvents = require('./events'),
  util = require('../util/common');
/**
 * This is our basic Thorin.js interface
 * that handles configs, loading them and other.
 * */
module.exports = function init(info) {

  const SOURCE_TYPES = {
    secret: require('./configSource/secret'),
    disk: require('./configSource/disk'),
    env: require('./configSource/env')
  };
  const ThorinEvent = TEvents(info);

  class ThorinConfig extends ThorinEvent {
    #config = {};

    constructor() {
      super();
      util.expose(this, {
        config: TConfig(this),
        EVENT: TEvents.EVENT
      });
    }

    /**
     * Actually load the content of a config source
     * @Arguments
     *  - item.type - the type of config
     *  - item.opt - options for that type.
     * */
    #fetchConfig = async (item = {}) => {
      const { type, opt } = item;
      let sourceFn = SOURCE_TYPES[type];
      if (!sourceFn) {
        throw new Error(`thorin.addConfig: type ${type} not supported`);
      }
      try {
        let sourceConfig = await sourceFn(opt, info);
        if (typeof sourceConfig !== 'object' || !sourceConfig) sourceConfig = {};
        if (Object.keys(sourceConfig).length > 0) {
          this.config.attach(sourceConfig);
        }
        return true;
      } catch (e) {
        console.log(`thorin.addConfig: could not load type: ${type} [${e.message}]`);
      }
      return false;
    }

    /**
     * This will register a new configuration source.
     * Configuration sources load config from different places.
     * @Arguments
     *  - type - the type of config, see various config loaders below
     *  - opt{} - the options for each config source.
     * */
    async addConfig(type, opt = {}, force = false) {
      if (typeof type !== 'string') {
        throw new Error('Thorin.addConfig: type must be a string.');
      }
      if (!SOURCE_TYPES[type]) throw new Error(`Thorin.addConfig: ${type} not supported`);
      let item = {
        type,
        opt
      };
      if (this.initialized || force) {
        await this.#fetchConfig(item);
      } else {
        info.configSources.push(item);
      }
      return this;
    }

    /**
     * Manually write in the .thorin file, some kind of config object
     * */
    writeConfig(data = {}) {
      try {
        fse.ensureFileSync(this.persistFile);
      } catch (e) {
        console.log(`Thorin.writeConfig() failed to ensure file: ${this.persistFile}`);
        return this;
      }
      let oldConfig = this.readConfig(true),
        newConfig = {};
      newConfig[info.configName] = data;
      let finalConfig = this.util.extend(oldConfig, newConfig),
        oldString = JSON.stringify(oldConfig, null, 1),
        newString = JSON.stringify(finalConfig, null, 1);
      if (oldString === newString) return this;
      try {
        fs.writeFileSync(this.persistFile, newString, { encoding: 'utf8' });
      } catch (e) {
        console.warn(`Thorin.writeConfig() failed to persist file: ${this.persistFile}`);
      }
      return finalConfig;
    }

    /**
     * Reads config from the .thorin file
     * */
    readConfig(_allConfig = false) {
      let oldConfig;
      try {
        fse.ensureFileSync(this.persistFile);
      } catch (e) {
        console.warn('Thorin: failed to read .thorin config file:', e);
      }
      try {
        oldConfig = fs.readFileSync(this.persistFile, 'utf8');
      } catch (e) {
        console.warn('Thorin: failed to read old .thorin config: ', e);
        oldConfig = null;
      }
      if (typeof oldConfig === 'string') {
        oldConfig = oldConfig.trim();
        if (oldConfig.length > 0 && oldConfig.charAt(0) !== '{' && oldConfig.charAt(0) !== '[') {
          console.log(this.persistFile + ' file was corrupted.');
          return {};
        }
        try {
          oldConfig = JSON.parse(oldConfig);
        } catch (e) {
        }
      }
      if (!oldConfig) oldConfig = {};
      if (_allConfig === true) {
        return oldConfig;
      }
      return oldConfig[info.configName] || {};
    }


    /** Persists the given thorin data to the .thorin file.
     * This will be mainly used by plugins that require some kind of state
     * between restarts.
     * */
    persist(configKey, configData) {
      if (typeof configKey !== 'string') return this;
      /* IF we do not have configData, we return the previous data. */
      if (typeof configData === 'undefined') {
        let oldConfig = this.readConfig();
        if (typeof oldConfig !== 'object' || !oldConfig) return null;
        return oldConfig[configKey] || null;
      }
      let toWrite = {};
      toWrite[configKey] = configData;
      this.writeConfig(toWrite);
      return this;
    }

  }

  return ThorinConfig;
}
