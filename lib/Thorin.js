'use strict';
const finallyPolyfill = require('promise.prototype.finally'); // .finally() polyfill
finallyPolyfill.shim();
const fs = require('fs'),
  path = require('path'),
  cluster = require('cluster'),
  fse = require('fs-extra'),
  async = require('async'),
  utils = require('./util/util'),
  ThorinCore = require('./core/thorinCore'),
  ThorinConfig = require('./core/config'),
  ThorinBoot = require('./core/boot'),
  dispatcherInit = require('./routing/dispatcher'),
  intentInit = require('./core/intent'),
  initLogger = require('./core/logger'),
  initAction = require('./routing/action'),
  initMiddleware = require('./routing/middleware'),
  initAuthorization = require('./routing/authorization');

const info = {
  modulePaths: [],
  version: null,    // the app's version, defaults to the one found under package.json
  root: process.cwd(), // the current working dir.
  id: null,
  app: null,  // the current app name, defaults to the js file name.
  env: null,   // the current application environment.
  argv: {},    // hash of startup options, with no -- or -
  pkg: {},     // the application's package.json file.
  persistFile: 'config/.thorin', // the default location where we can persist framework specific stuff.
  configSources: [],     // array of configuration sources to look for configs.
  rootConfig: {}        // the main configuration of the Thorin app.
};

class ThorinApp extends ThorinCore {

  constructor() {
    super();
    this.dispatcher = dispatcherInit(this);  // give it a thorin reference.
    this.Intent = intentInit(this);         // this is a thorin intent, used by transports.
    this.Action = initAction(this);         // this is a thorin Action (or route) defining a chain of middleware for it.
    this.Middleware = initMiddleware(this); // this is the middleware class.
    this.Authorization = initAuthorization(this); // this is the authorization class.
    this.logger = initLogger(this);         // logger repository
    this.initialized = false;
    this.running = false;
    this.globalize('thorin');
  }

  /*
   * Loads all the node.js components (or the actual file) for the given path.
   * This is done recursively for directories.
   * NOTE:
   *  when calling loadPath, all arguments except the first one are proxied to the require(), if the require
   *  exposes a function.
   * */
  loadPath(fullPath, ignoreInitialized) {
    if(typeof fullPath === 'string') {
      fullPath = [fullPath];
    }
    let args = Array.prototype.slice.call(arguments);
    args.splice(0, 1);  // remove the first path
    if(!(fullPath instanceof Array)) {
      console.warn('Thorin.loadPath: works with loadPath(path:string)');
      return this;
    }
    fullPath.forEach((p) => {
      if(typeof p !== 'string') {
        console.warn('Thorin.loadPath: path ' + p + ' is not a string.');
        return;
      }
      if(this.initialized || ignoreInitialized === true) {
        if(ignoreInitialized === true) {
          args.splice(1, 1);  // remove ignoreInitialized
        }
        bootObj.loadPath({
          path: p,
          args: args
        });
      } else {
        info.modulePaths.push({
          path: p,
          args: args
        });
      }
    });
    return this;
  }

  /* Returns the project's root path */
  get root() { return info.root; }

  /* Returns your application's package.json content */
  get package() {
    return info.pkg;
  }

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
    let e = this.argv('env', null) || this.argv('environment', null) || process.env.NODE_ENV;
    if(e) {
      info.env = e;
    } else {
      info.env = 'development';
    }
    process.env.NODE_ENV = info.env;
    return info.env;
  }

  /*
  * Returns the unique app ID.
  * */
  get id() {
    if(!info.id) {
      let appData = bootObj.readConfig();
      if(!appData) appData = {};
      if(appData.id) {
        info.id = appData.id;
      } else {
        let appId = utils.randomString(12);
        info.id = this.app + "-" + appId;
        bootObj.writeConfig({
          id: info.id
        });
      }
      // IF we're clustered, we will add the worker id in the thorin id.
      if(cluster.isWorker) {
        info.id += '-' + cluster.worker.id;
      }
    }
    return info.id;
  }

  /*
   * Sets or gets the thorin app's name, defaulting to the js file name.
   * */
  get app() {
    if(!info.app) {
      info.app = global.THORIN_APP || path.basename(process.mainModule.filename).replace('.js','');
      bootObj.writeConfig({
        app: info.app
      });
    }
    return info.app;
  }

  set app(_name) {
    if(typeof _name === 'string' && _name) {
      info.app = _name;
      bootObj.writeConfig({
        app: info.app
      });
    }
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
  * Adds a new entry to the .gitignore file, if it does not exist.
  * */
  addIgnore(entry) {
    let gitIgnore = path.normalize(this.root + '/.gitignore'),
      ignoreContent = '';
    try {
      ignoreContent = fs.readFileSync(gitIgnore, { encoding: 'utf8' });
    } catch (e) {
    }
    if (ignoreContent.indexOf(entry) === -1) {
      ignoreContent += '\n'+entry+'\n';
      try {
        fs.writeFileSync(gitIgnore, ignoreContent, { encoding: 'utf8' });
      } catch (e) {
        console.warn('Thorin: failed to update .gitignore file:', e);
      }
    }
    return true;
  }

  /*
  * This will register a new configuration source.
  * Configuration sources load config from different places.
  * The default one is from the local app/config "disk".
  * */
  addConfig(name, _opt, done) {
    if(typeof name !== 'string' && typeof name !== 'function') {
      throw new Error('Thorin.addConfig: name must be either a string or a function.');
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
    if(!this.initialized) {
      info.configSources.push(item);
    } else {
      bootObj.loadAppConfig(item, (e, newConfig) => {
        if(e) return done && done(e);
        if(this.config) {
          this.config.merge(newConfig);
          return done && done();
        }
        process.nextTick(() => {
          this.config.merge(newConfig);
          done && done();
        });
      });
    }
    return this;
  }

  /*
  * Runs the Thorin app.
  * */
  run(onDone) {
    if(this.initialized) return onDone && onDone();
    let calls = [],
      self = this;

    /* Next, read all the configuration from all its sources. */
    calls.push((done) => {
      bootObj.loadAppConfig(info.configSources, (e, rootConfig) => {
        if(e) return done(e);
        this.config = ThorinConfig.Instance(rootConfig);
        this.initialized = true;
        this._triggerThorinEvent(ThorinCore.EVENT.CONFIG, "thorin.core");
        done();
      });
    });

    /* Mount all the components. */
    calls.push((done) => {
      this.createComponents(done);
    });



    /* Next, mount the components with access to their configuration. */
    calls.push((done) => {
      this.initComponents(done);
    });

    /* Next, load all the app's middleware and actions. */
    calls.push((done) => {
      info.modulePaths.forEach((p) => {
        bootObj.loadPath(p);
      });
      done();
    });

    /* Next, if we have any kind of --setup= argument, we will call the setup() function of the components */
    calls.push((done) => {
      this.setupComponents(done);
    });

    /* Finally, run all the components. */
    calls.push((done) => {
      this.runComponents(done);
    });


    async.series(calls, (err) => {
      if(err) {
        console.error('Thorin: failed to initialize application:');
        console.trace(err);
        return onDone && onDone(err);
      }
      // finally, tell the dispatcher to run.
      this.dispatcher.start();
      this.running = true;
      this._triggerThorinEvent(ThorinCore.EVENT.RUN, "thorin.core");
      this._removeThorinEvents(ThorinCore.EVENT.RUN);
      onDone && onDone();
    });
  }

}

const appObj = new ThorinApp();
process.on('uncaughtException', (e) => appObj.exit(e));
/* perpetuate the statics */
Object.keys(ThorinCore).forEach((key) => {
  appObj[key] = ThorinCore[key];
});
const bootObj = new ThorinBoot(appObj);
bootObj.init(info);
bootObj.bootstrap();

module.exports = appObj;
