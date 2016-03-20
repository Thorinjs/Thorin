'use strict';
require('promise.prototype.finally'); // .finally() polyfill
const fs = require('fs'),
  path = require('path'),
  fse = require('fs-extra'),
  async = require('async'),
  utils = require('./util/util'),
  ThorinBase = require('./core/base'),
  ThorinConfig = require('./core/config'),
  ThorinBoot = require('./core/boot');

const info = {
  version: null,    // the app's version, defaults to the one found under package.json
  root: path.dirname(process.argv[1]), // the current working dir.
  id: null,
  app: null,  // the current app name, defaults to the js file name.
  env: null,   // the current application environment.
  argv: {},    // hash of startup options, with no -- or -
  pkg: {},     // the application's package.json file.
  persistFile: 'config/.thorin', // the default location where we can persist framework specific stuff.
  configSources: [],     // array of configuration sources to look for configs.
  rootConfig: {}        // the main configuration of the Thorin app.
};

class ThorinApp extends ThorinBase {

  constructor() {
    super();
    this.initialized = false;
    this.globalize('thorin');
  }


  /* Returns the project's root path */
  get root() { return info.root; }

  /* Returns the application's version found under package.json, or set's the given one. */
  get version() {
    if(!info.version) info.version = info.pkg.version;
    return info.version;
  }
  set version(v) {
    if(typeof v === 'string' || typeof v === 'number') {
      info.version = v;
    }
    return this;
  }

  /*
  * Returns the application's environment.
  * Looks into:
  *   --env= or --environment= in argv
  *   NODE_ENV in env variables
  *   development, as default
  * */
  get env() {
    if(info.env) return info.env;
    let e = this.argv('env', null) || this.argv('environment', null);
    if(e) {
      info.env = e;
    } else {
      info.env = 'development';
    }
    return info.env;
  }

  /*
  * Returns the unique app ID.
  * */
  get id() {
    if(info.id) return info.id;
    let appData = bootObj.readConfig();
    if(appData.id) {
      info.id = appData.id;
    } else {
      let appId = utils.randomString(12);
      info.id = info.app + "-" + appId;
      bootObj.writeConfig({
        id: info.id
      });
    }
    return info.id;
  }

  /*
   * Sets or gets the thorin app's name, defaulting to the js file name.
   * */
  app(_name) {
    let isChanged = false;
    if(typeof _name === 'string' && _name !== info.app) {
      info.app = _name;
      isChanged = true;
    } else if(!info.app) {
      info.app = path.basename(process.argv[1]).split('.');
      info.app.pop();
      info.app = info.app.join('.');
      isChanged = true;
    }
    if(isChanged) {
      bootObj.writeConfig({
        app: info.app
      });
    }
    return info.app;
  }

  /* Searches the proces's argv array for the given key. If not found,
  * returns the default avlue provided or null
  * */
  argv(keyName, _default) {
    if(typeof keyName !== 'string' || !keyName) return _default || null;
    if(info.argv[keyName.toLowerCase()]) return info.argv[keyName] || _default || null;
    return null;
  }

  /*
  * Globalizes the thorin framework. By default, we do so under global['thorin']
  * */
  globalize(_val) {
    if(_val === false && typeof global['thorin'] !== 'undefined') {
      delete global['thorin'];
      delete global['async'];
    } else if(typeof _val === 'string') {
      global[_val] = this;
      global['async'] = async;
    }
    return this;
  }

  /* Persists the given thorin data to the .thorin file.
   * This will be mainly used by plugins that require some kind of state
   * between restarts.
    * */
  persist(configKey, configData) {
    if(typeof configKey !== 'string') return this;
    /* IF we do not have configData, we return the previous data. */
    if(typeof configData === 'undefined') {
      let oldConfig = bootObj.readConfig();
      return oldConfig[configKey] || null;
    }
    let toWrite = {};
    toWrite[configKey] = configData;
    bootObj.writeConfig(toWrite);
    return this;
  }

  /*
  * This will register a new configuration source.
  * Configuration sources load config from different places.
  * The default one is from the local app/config "disk".
  * */
  configSource(name, _opt) {
    if(typeof name !== 'string' && typeof name !== 'function') {
      throw new Error('Thorin.configSource: name must be either a string or a function.');
    }
    if(!_opt) _opt = {};
    let item = {
      options: _opt
    };
    if(typeof name === 'string') {
      item.name = name;
      item.type = "thorin"; // this is a thorin config, we look into ThorinConfig
    } else {
      item.type = "fn";
      item.fn = name;
    }
    info.configSources.push(item);
    return this;
  }

  /*
  * Runs the Thorin app.
  * */
  run(onDone) {
    if(this.initialized) return onDone && onDone();
    this.initialized = true;
    /* Mount all the components. */
    this.mountComponents();

    let calls = [];
    /* Step one: read all the configuration from all its sources. */
    calls.push((done) => {
      bootObj.loadAppConfig(info.configSources, (e, rootConfig) => {
        if(e) return done(e);
        this.config = ThorinConfig.Instance(rootConfig);
        done();
      });
    });

    /* Next, load up all dependencies. */

    async.series(calls, (err) => {
      onDone && onDone(err || null);
    });
  }

}

const appObj = new ThorinApp();
const bootObj = new ThorinBoot(appObj);
bootObj.init(info);
bootObj.bootstrap();


module.exports = appObj;