'use strict';
const path = require('path'),
  async = require('async'),
  cluster = require('cluster'),
  fs = require('fs');
const TRepo = require('./repo'),
  util = require('../util/common'),
  envUtil = require('../util/env'),
  TSanitize = require('thorin-sanitize'),
  TError = require('../util/error'),
  TLogger = require('../util/logger');

/**
 * This is our base ThorinApp class.
 * */
module.exports = function init(info) {

  const BaseRepo = TRepo(info);

  class ThorinApp extends BaseRepo {

    #bootstrapped = false;
    #loadedPaths = {};

    constructor() {
      super();
      this.initialized = false;
      this.running = false;
      util.expose(this, {
        logger: TLogger(this, info)
      });
    }

    /**
     * Starts listening for process-level events,
     * to handle the exit gracefully.
     * */
    #bindProcessEvents = () => {
      if (info.env === 'development' || info.env === 'test') return;
      let self = this,
        _exitSignal;

      function onSignal(code) {
        if (_exitSignal) {
          return process.exit(0);
        }
        console.log(`Received signal: ${code || 'unknown'}, preparing to shut down in ${info.shutdownTimeout / 1000} sec`);
        self._triggerThorinEvent(self.EVENT.EXIT, 'thorin.core');
        _exitSignal = setTimeout(() => {
          process.exit(0);
        }, info.shutdownTimeout);
      }

      ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((e) => {
        process.on(e, onSignal);
      });
    }

    /**
     * Internally load the actual path name
     * */
    #loadFile = (item = {}) => {
      if (typeof item === 'string') {
        item = {
          path: item
        };
      }
      if (typeof item.path !== 'string') return;
      let toLoad = [];
      if (!path.isAbsolute(item.path)) {
        item.path = path.normalize(info.root + '/' + item.path);
      }
      if (path.extname(item.path) === '.js') {
        toLoad.push(item.path);
      } else {
        let files = this.util.readDirectory(item.path, {
          ext: '.js'
        });
        for (let i = 0, len = files.length; i < len; i++) {
          toLoad.push(files[i]);
        }
      }
      for (let i = 0, len = toLoad.length; i < len; i++) {
        let filePath = toLoad[i];
        if (this.#loadedPaths[filePath]) continue;
        try {
          let stat = fs.statSync(filePath);
          if (!stat.isFile()) {
            let e = new Error("");
            e.code = "NOT_FILE";
            throw e;
          }
        } catch (e) {
          if (e.code === 'ENOENT') {
            console.warn(`Thorin.loadPath: module path ${filePath} not found.`);
            return;
          }
          if (e.code === 'NOT_FILE') {
            console.warn(`Thorin.loadPath: module path ${filePath} is not a file.`);
            return;
          }
        }
        let itemFn = require(filePath);
        if (typeof itemFn === 'function' && itemFn.autoload !== false) {
          // call the function passing the arguments.
          if (!item.args) {
            itemFn(this);
          } else {
            itemFn.apply(global, item.args);
          }
        }
        this.#loadedPaths[filePath] = true;
      }
    }

    /**
     * Bootstraps the app, on initialization, with various stuff.
     * - adds default sanitizers
     * - checks if we're in docker.
     * */
    #bootstrap = async () => {
      if (this.#bootstrapped) return;
      this.#bootstrapped = true;
      this.#bindProcessEvents();
      // Inject our default sanitizers.
      let sanitizers = TSanitize(this);
      this.addSanitizer(sanitizers);
      // Add .thorin to the .gitignore
      this.util.addIgnore('.thorin', info.root);
      /* Load our thorin config and check if we have to set any ENV variables */
      let thorinConfig = this.readConfig(true);
      if (thorinConfig._APP_ENV) {
        Object.keys(thorinConfig._APP_ENV).forEach((name) => process.env[name] = thorinConfig._APP_ENV[name]);
      }
      // Load our app registered configuration
      await this.addConfig('disk', {
        path: 'config/app.js',
        required: false
      }, true);
      // Load our env-specific config
      await this.addConfig('disk', {
        path: `config/env/${info.env}.js`,
        required: false
      }, true);
    }

    /**
     * Initializes the Thorin app, creating every registered component
     * and calling their init() function.
     * */
    async init() {
      if (this.initialized) return this;
      if (!this.#bootstrapped) {
        await this.#bootstrap();
      }
      this.initialized = true;
      // Read any pre-registered configs.
      if (info.configSources && info.configSources.length > 0) {
        for (let i = 0, len = info.configSources.length; i < len; i++) {
          let c = info.configSources[i];
          await this.addConfig(c.type, c.opt);
        }
      }
      // Check if we have a --config= argv.
      let cmdConfig = this.argv('config');
      if (cmdConfig) {
        cmdConfig = path.isAbsolute(cmdConfig) ? cmdConfig : path.normalize(info.root + '/' + cmdConfig);
        await this.addConfig('disk', {
          path: path.normalize(cmdConfig),
          required: true
        });
      }
      // Create all registered components and call their init() with their config
      this._triggerThorinEvent(this.EVENT.CONFIG);
      this._removeThorinEvents(this.EVENT.CONFIG);
      this.createComponents();
      // Load any actions, middleware and other paths.
      if (info.modulePaths && info.modulePaths.length > 0) {
        this.initialized = false;
        for (let i = 0, len = info.modulePaths.length; i < len; i++) {
          this.#loadFile(info.modulePaths[i]);
        }
        this.createComponents();
        this.initialized = true;
      }
      this._triggerThorinEvent(this.EVENT.INIT);
      this._removeThorinEvents(this.EVENT.INIT);
    }

    /**
     * Boots up the thorin app
     * */
    async run(done) {
      if (this.running) {
        if (typeof done === 'function') return done();
        return true;
      }
      try {
        await this.init();
        // Check and see if any component has any setup() to do.
        await this.setupComponents();
        this.dispatcher.start();
        // Actually start all the components, by calling their run.
        await this.runComponents();
        this._triggerThorinEvent(this.EVENT.RUN);
        this._removeThorinEvents(this.EVENT.RUN);
        if (typeof done === 'function') return done();
        return true;
      } catch (e) {
        console.log(`Thorin.run: could not complete run`);
        if (typeof done === 'function') return done(e);
        throw e;
      }
    }


    /**
     * Utility function that will log the fatal error and exit the program.
     * */
    exit(err) {
      if (!err) {
        err = this.error('THORIN_EXIT', 'An error occurred and process was terminated.');
      } else {
        let stack = err.stack;
        err = this.error(err);
        err.stack = stack;
      }
      console.error(err.stack);
      this._triggerThorinEvent(this.EVENT.EXIT, 'thorin.core', err);
      setTimeout(() => {
        process.exit(1);
      }, 100);
    }

    /**
     * This is our error constructor. It will basically create an error,
     * with an errorCode, message and additional options.
     * Ways to call:
     *   thorin.error(code=string)
     *   thorin.error(code=string, message=string)
     *   thorin.error(code=string, message=string, statusCode=number)
     *   thorin.error(code=string, message=string, errorInstance=error)
     *   thorin.error(errorInstance) -> this will not expose any error messages.
     * */
    error(a, b, c, d) {
      let err;
      if (a instanceof TError) {
        err = a;
      } else if (a instanceof Error) {
        err = new TError(a.code || 'GENERIC_ERROR');
        err.source = a;
        if (a.statusCode) {
          err.statusCode = a.statusCode;
          if (a.message) {
            err.message = a.message;
          }
        } else {
          err.statusCode = 500;
        }
        if (typeof a.data !== 'undefined') {
          err.data = a.data;
        }
      } else if (typeof a === 'string' && !b && !c) { // code
        err = new TError(a);
      } else if (typeof a === 'string' && typeof b === 'string' && !c) {  //code,message
        err = new TError(a, b);
        if (typeof d === 'number') {
          err.statusCode = d;
        }
      } else if (typeof a === 'string' && typeof b === 'string' && typeof c === 'number') { // code,message,statusCode
        err = new TError(a, b);
        err.statusCode = c;
        if (typeof d === 'object' && d != null) {
          err.data = d;
        }
      } else if (typeof a === 'string' && typeof b === 'string') {
        err = new TError(a, b);
        if (c instanceof Error) {
          err.source = c;
        } else if (typeof c === 'object' && c != null) {
          err.data = c;
        }
        if (typeof d === 'number') {
          err.statusCode = d;
        }
      } else {
        err = new TError();
      }
      return this.parseError(err);
    }

    /**
     * This will sanitize the given input, based on the sanitizer type.
     * */
    sanitize(type, input, opt, _defaultValue) {
      if (typeof _defaultValue === 'undefined') _defaultValue = null;
      if (!this.initialized) {
        console.warn(`Thorin.sanitize(${type}): app not yet initialized.`);
        return _defaultValue;
      }
      if (typeof type !== 'string') return _defaultValue;
      type = type.toUpperCase();
      let sanitizer = this.sanitizer(type);
      if (!sanitizer) {
        console.log(`Thorin.sanitize: type ${type} is not loaded`);
        return _defaultValue;
      }
      if (typeof opt !== 'object' || !opt) opt = {};
      let res = sanitizer.validate(input, opt);
      if (!res) return _defaultValue;
      /* IF the sanitizer is a promise, we proxy it. */
      if (util.isPromise(res)) {
        return new Promise((resolve, reject) => {
          res.then((r) => {
            if (typeof r === 'undefined') return resolve(_defaultValue);
            resolve(r);
          }, reject).catch(reject);
        });
      }
      /* This is sync */
      if (typeof res !== 'object' || !res) return _defaultValue;
      if (typeof res.value === 'undefined') return _defaultValue;
      return res.value;
    }

    /**
     * Loads all the node.js components (or the actual file) for the given path.
     * This is done recursively for directories.
     * NOTE:
     *  when calling loadPath, all arguments except the first one are proxied to the require(), if the require
     *  exposes a function.
     * */
    loadPath(fullPath, ignoreInitialized = false) {
      if (typeof fullPath === 'string') {
        fullPath = [fullPath];
      }
      let args = Array.prototype.slice.call(arguments);
      args.splice(0, 1);  // remove the first path
      if (!(fullPath instanceof Array)) {
        console.warn('Thorin.loadPath: works with loadPath(path:string)');
        return this;
      }
      fullPath.forEach((p) => {
        if (typeof p !== 'string') {
          console.warn('Thorin.loadPath: path ' + p + ' is not a string.');
          return;
        }
        if (this.initialized || ignoreInitialized === true) {
          if (ignoreInitialized === true) {
            args.splice(1, 1);  // remove ignoreInitialized
          }
          this.#loadFile({
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


    /** Searches the proces's argv array for the given key. If not found,
     * returns the default avlue provided or null
     * */
    argv(keyName, _default) {
      if (typeof keyName !== 'string' || !keyName) return _default || null;
      keyName = keyName.replace(/-/g, '');
      if (info.argv[keyName.toLowerCase()]) return info.argv[keyName] || _default || null;
      return null;
    }

    /**
     * Retirnes a copy of the argv objects available.
     * @Options
     *  - opt.separator - the separator used for "-" splitting. Defaults ""
     * */
    getArgv(opt = {}) {
      const res = {
        argv: {}
      };
      envUtil.parseArgv(res, opt.separator);
      return res.argv;
    }


    /**
     * GETTERS/SETTERS OF INFORMATION
     * */

    get docker() {
      return info.docker;
    }

    set docker(v) {
    }

    /*
     * Sets or gets the thorin app's name, defaulting to the js file name.
     * */
    get app() {
      return info.app;
    }

    set app(_name) {
      if (typeof _name === 'string' && _name) {
        info.app = _name;
        this.writeConfig({
          app: info.app
        });
      }
    }

    /**
     * Returns the unique app ID.
     * */
    get id() {
      if (!info.id) {
        let appData = this.readConfig();
        if (!appData) appData = {};
        if (appData.id) {
          info.id = appData.id;
        } else {
          let appId = this.util.randomString(12);
          info.id = this.app + "-" + appId;
          this.writeConfig({
            id: info.id
          });
        }
        // IF we're clustered, we will add the worker id in the thorin id.
        if (cluster.isWorker) {
          info.id += '-' + cluster.worker.id;
        }
      }
      return info.id;
    }

    set id(v) {
      info.id = v;
      this.writeConfig({
        id: v
      });
    }

    /**
     * Returns the application's environment.
     * Looks into:
     *   --env= or --environment= in argv
     *   NODE_ENV in env variables
     *   development, as default
     * */
    get env() {
      return info.env;
    }

    set env(v) {
      info.env = v;
      process.env.NODE_ENV = v;
    }


    /**
     * Returns the application's version found under package.json, or set's the given one.
     *  */
    get version() {
      if (!info.version) info.version = info.pkg.version;
      return info.version;
    }

    set version(v) {
      if (typeof v === 'string' || typeof v === 'number') {
        info.version = v;
      }
      return this;
    }

    /**
     * Returns your application's package.json content
     * */
    get package() {
      return info.pkg;
    }

    set package(v) {}

    /**
     * Returns the project's root path
     * */
    get root() {
      return info.root;
    }

    set root(v) {
      info.root = v;
    }

    /**
     * Returns the .thorin file that we use for persistence.
     * */
    get persistFile() {
      if (info.persistFile && path.isAbsolute(info.persistFile)) return info.persistFile;
      let root = (typeof process.pkg === 'undefined' ? info.root : process.cwd());
      info.persistFile = path.normalize(root + '/' + info.persistFile);
      return info.persistFile;
    }

    set persistFile(v) {
      info.persistFile = v;
    }

    /**
     * Performs a series call through the array of items.
     * The items can contain:
     *   a. functions that return promises, in which case we wait for their resolving.
     *   b. undefined, in which case we just call and forget.
     *   Ways to call:
     *     thorin.series(items=[], stopOnError=false) - we will call all the items, regardless if they fail or not. By default, we stop on errors.
     *     thorin.series(items=[], onComplete=function(), stopOnError=false) -> will not return a promise, but work with callbacks.
     *     if you call thorin.series([arrayOfItems], true)
     *  @Deprecated
     * */
    series(items, _onComplete, _stopOnError) {
      if (!(items instanceof Array)) throw new Error('thorin.series: requires an array as the first argument.');
      let onComplete = (typeof _onComplete === 'function' ? _onComplete : false),
        stopOnError = (_onComplete === false ? false : (_stopOnError !== false));
      if (onComplete) {
        return doSeries(items, stopOnError, (e, r) => {
          try {
            onComplete(e, r);
          } catch (err) {
            console.error(`Thorin.series() encountered an error in final callback`);
            console.trace(err);
          }
        });
      }
      return new Promise((resolve, reject) => {
        doSeries(items, stopOnError, (e) => {
          if (e) {
            reject(e);
            return null;
          }
          resolve();
          return null;
        });
      });
    };

  }

  function doSeries(items, stopOnError, finalFn) {
    if (items.length === 0) return finalFn();
    let calls = [],
      isStopped = false,
      currentNext,
      stopError;

    function stopSeries(e) {
      isStopped = true;
      if (typeof e !== 'undefined') {
        stopError = new TError(e);
      }
      if (currentNext) {
        currentNext();
      }
      return null;
    }

    items.forEach((fn) => {
      if (typeof fn !== 'function') return;
      calls.push((done) => {
        if (isStopped) return done();
        let promiseObj;
        currentNext = done;
        try {
          promiseObj = fn(stopSeries);
        } catch (e) {
          if (stopOnError) {
            return done(e);
          }
          return done();
        }
        let isDone = false;
        if (typeof promiseObj === 'object' && promiseObj && typeof promiseObj.then === 'function' && typeof promiseObj.catch === 'function') {
          promiseObj.then((res) => {
            if (isDone || isStopped) return null;
            isDone = true;
            done(null, res);
            return null;
          }, (e) => {
            if (isDone || isStopped) return null;
            isDone = true;
            if (stopOnError) {
              isStopped = true;
              if (typeof e !== 'undefined') {
                stopError = new TError(e);
              }
              done(e);
              return null;
            }
            done();
            return null;
          });
          promiseObj.catch((e) => {
            if (isDone || isStopped) return null;
            isDone = true;
            if (stopOnError) {
              isStopped = true;
              if (typeof e !== 'undefined') {
                stopError = new TError(e);
              }
              done(e);
              return null;
            }
            done();
            return null;
          });
          return null;
        } else {
          if (isDone || isStopped) return;
          isDone = true;
          done();
          return null;
        }
      });
    });
    async.series(calls, (e) => {
      if (isStopped) {
        if (stopError) {
          finalFn(stopError);
          return null;
        }
        finalFn();
        return null;
      }
      if (e) {
        finalFn(e);
        return null;
      }
      finalFn();
      return null;
    });
  }

  return ThorinApp;

}
