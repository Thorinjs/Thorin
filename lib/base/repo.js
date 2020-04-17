'use strict';

/**
 * This is a simple internal repository for various modules/libraries.
 * What it does is:
 *  - hold modules, libraries, stores, etc.
 *  - expose a get(), set(), remove()
 * */
const util = require('../util/common');
const Interface = require('./interface');
const TConfig = require('./configs');

const INIT_COMPONENTS = [
  'store',
  'module',
  'library',
  'transport',
  'plugin'
];
const SETUP_COMPONENTS = [
  'store',
  'transport',
  'plugin',
  'library',
  'module'
];

const RUN_COMPONENTS = [
  'store',
  'library',
  'plugin',
  'module',
  'transport'
];

module.exports = function init(info) {

  const BaseConfig = TConfig(info);

  class BaseRepo extends BaseConfig {
    // A map of registered components, to be instantiated.
    #created = false;
    #registered = {};

    // The below private fields are INSTANTIATED components.
    #transport = {};       // map of transports
    #store = {};           // map of stores
    #library = {};        // map of libs
    #sanitizer = {};       // map of sanitizers
    #plugin = {};          // map of plugins
    #module = {};          // map of modules
    #errorParsers = [];     // an array of functions that can change an error's information

    /**
     * Instantiates all our components, and verifies
     * that they correctly extends our interfaces.
     * Note:
     * the order of creation is:
     *  - Sanitizers
     *  - Stores
     *  - Modules
     *  - Libraries
     *  - Transports
     *  - Plugins
     *
     *  This will also call the init() function on all registered components.
     * If present, it will fetch their desired configuration.
     * This is a synchronous action as well.
     * The components that will have their init() function called are (and in this order):
     *     - Stores
     *     - Modules
     *     - Transports
     *     - Libraries
     *     - Plugins
     * NOTE:
     *   thorin.onInit("{componentType}.{componentName}", fn) will be called
     *   for each component that was initialized.
     * */
    createComponents() {
      if (this.#created) return;
      this.#created = true;
      let created = []; // an array of {item,name,config} created objects/items.
      for (let i = 0, len = INIT_COMPONENTS.length; i < len; i++) {
        let kind = INIT_COMPONENTS[i];
        let items = this.#registered[kind] || [];
        if (items.length === 0) continue;
        for (let j = 0, jlen = items.length; j < jlen; j++) {
          let r = this.#constructComponent(items[j], kind);
          if (r) created.push(r);
        }
      }
      // Now, once everything is created, we will try and call the init() function for every single registered component.
      for (let i = 0, len = created.length; i < len; i++) {
        let { item, config, id } = created[i];
        if (typeof item.init === 'function') {
          item.init(config);
        }
        this._triggerThorinEvent(this.EVENT.INIT, id);
      }
      this._triggerThorinEvent(this.EVENT.INIT);
      this._removeThorinEvents(this.EVENT.INIT);
    }

    /**
     * IF the thorin app starts up with the --setup= argv, we will look for
     * all the loaded components that match the setup names and call
     * their setup() function and trigger thorin.EVENT.SETUP for that component.
     * Note: the --setup argument will have to have the exact name of the component,
     * eg:
     *   node app.js --setup=store.sql,transport.tcp,library.myLib
     *   NOTE: if you want to install all the components, simply run
     *   node app.js --setup=all => this will execute the setup() function of all registered components.
     *   Note:
     *   The order of setup is:
     *    - Stores
     *    - Modules
     *    - Transports
     *    - Plugins
     *    - Libraries
     * */
    async setupComponents() {
      let setups = this.argv('setup', null);
      if (!setups) { // nothing to setup
        this._removeThorinEvents(this.EVENT.SETUP);
        return;
      }
      setups = (setups instanceof Array ? setups : [setups]);
      let setupKinds = [];  // array of kind of setups.
      for (let i = 0, len = setups.length; i < len; i++) {
        let k = setups[i].split('.')[0];
        setupKinds.push(k);
      }
      let isAllSetup = setups === 'all';
      for (let i = 0, len = SETUP_COMPONENTS.length; i < len; i++) {
        let kind = SETUP_COMPONENTS[i];
        if (!isAllSetup && setupKinds.indexOf(kind) === -1) continue;
        let registered = this.#getKind(kind);
        let items = Object.keys(registered);
        for (let j = 0, jlen = items.length; j < jlen; j++) {
          let name = items[j],
            id = `${kind}.${name}`;
          if (isAllSetup || setups.indexOf(id) !== -1) {
            await this.#setupComponent(registered[name], id);
          }
        }
      }
      this._triggerThorinEvent(this.EVENT.SETUP);
      this._removeThorinEvents(this.EVENT.SETUP);
    }

    /**
     * Calls the run() function of all registered items.
     * For all items that have the run() function defined, we weill call it
     * and pass a callback. The callback will HAVE to be called(async way)
     * If it is called with an error, we stop the app.
     * The components that will have their run() function called are (and in this order):
     *   - Stores
     *   - Modules
     *   - Transports
     *   - Libraries
     *   - Plugins
     * */
    async runComponents() {
      for (let i = 0, len = RUN_COMPONENTS.length; i < len; i++) {
        let kind = RUN_COMPONENTS[i],
          registered = this.#getKind(kind);
        let items = Object.keys(registered);
        if (items.length === 0) continue;
        for (let i = 0, len = items.length; i < len; i++) {
          let name = items[i],
            item = registered[name];
          await this.#runComponent({ item, name }, kind);
        }
      }
      this._triggerThorinEvent(this.EVENT.RUN);
      this._removeThorinEvents(this.EVENT.RUN);
    }


    /**
     * Private function that instantiates the given component.
     * */
    #constructComponent = ({ fn, name, config } = {}, kind) => {
      name = name.trim();
      let fullName = `${kind}.${name}`;
      let mConfig = this.util.extend(this.config(fullName) || {}, config || {});
      try {
        let item = fn(this, mConfig, name);
        if (typeof item === 'undefined' || item === null) return false; // we stop there, we do not register.
        let newName = getName(item);
        if (newName) {
          fullName = `${kind}.${newName}`;
          mConfig = this.util.extend(this.config(fullName) || {}, mConfig);
          name = newName;
        }
        if (util.isClass(item)) {
          // if the callback returned a class, we instantiate it.
          item = new item(mConfig, this, name);
          newName = getName(item);
          if (newName) {
            fullName = `${kind}.${newName}`;
            mConfig = this.util.extend(this.config(fullName) || {}, mConfig);
            name = newName;
          }
        }
        if (!util.isFunction(item) && !util.isObject(item)) return false;
        let id = `${kind}.${clean(name)}`,
          kindMap = this.#getKind(kind);
        if (!kindMap) {
          console.log(`Thorin.createComponent: ${kind} ${name} cannot be registered.`);
          return false;
        }
        if (kindMap[name]) {
          console.log(`Thorin.createComponent: ${kind} ${name} was previously registered.`);
          return false;
        }
        kindMap[name] = item;
        return {
          id,
          name,
          item,
          config: mConfig
        };
      } catch (e) {
        console.log(`Thorin.createComponent: could not instantiate [${kind}]`, fn, e);
        return false;
      }
    }

    /**
     * Private function that runs() the given component.
     * */
    #runComponent = async ({ item, name } = {}, kind) => {
      name = name.trim();
      let id = `${kind}.${name}`;
      if (typeof item.run === 'function') {
        try {
          await ensurePromiseCall(item, 'run');
        } catch (e) {
          console.log(`Thorin.run: failed on [${id}]`);
          throw e;
        }
      }
      this._triggerThorinEvent(this.EVENT.RUN, id);
      return true;
    }

    /**
     * Private function that calls the setup() and triggers the thorin event
     * */
    #setupComponent = async (obj, id) => {
      if (typeof obj.setup === 'function') {
        try {
          await ensurePromiseCall(obj, 'setup');
        } catch (e) {
          console.log(`Thorin.setup: failed on [${id}]`, e);
          return false;
        }
      }
      this._triggerThorinEvent(this.EVENT.SETUP, id);
    }

    /**
     * Private function to register a component and its data.
     * */
    #register = (component, fn, opt = {}) => {
      let item = {
        fn,
        name: opt.name,
        config: {}
      };
      if (typeof opt === 'object' && opt) {
        if (typeof opt.config === 'object' && opt.config) item.config = opt.config;
      }
      if (this.initialized) {
        let r = this.#constructComponent(item, component);
        if (typeof r.item.init === 'function') {
          r.item.init(r.config);
        }
        this._triggerThorinEvent(this.EVENT.INIT, r.id);
        return r.item;
      } else {
        if (!this.#registered[component]) this.#registered[component] = [];
        this.#registered[component].push(item);
      }
      return this;
    }

    /**
     * Private function that returns the private object namespace for the given comp type
     * */
    #getKind = (type) => {
      switch (type) {
        case 'transport':
          return this.#transport;
        case 'store':
          return this.#store;
        case 'library':
          return this.#library;
        case 'sanitizer':
          return this.#sanitizer;
        case 'plugin':
          return this.#plugin;
        case 'module':
          return this.#module;
        default:
          return null;
      }
    }

    /**
     * Fetch a library by its name.
     * */
    lib(name = '') {
      return this.#library[clean(name)] || null;
    }

    /**
     * Fetch a store by its name.
     * */
    store(name = '') {
      return this.#store[clean(name)] || null;
    }

    /**
     * Fetch a plugin by its name.
     * */
    plugin(name = '') {
      return this.#plugin[clean(name)] || null;
    }

    /**
     * Fetch a transport by its name.
     * */
    transport(name = '') {
      return this.#transport[clean(name)] || null;
    }

    /**
     * Fetch a module by its name.
     * */
    module(name = '') {
      return this.#module[clean(name)] || null;
    }

    /**
     * Fetch a sanitizer by its name
     * */
    sanitizer(name) {
      return this.#sanitizer[clean(name)] || null;
    }

    /**
     * Adds a new error parser. Error parsers are used to mutate the error
     * information of any kind of thorin.error() call. This is useful to hide or
     * capture specific errors throughout the app.
     * */
    addErrorParser(fn) {
      if (typeof fn !== 'function') {
        console.log('Thorin.addErrorParser: validator is not a function.');
        return this;
      }
      this.#errorParsers.push(fn);
      return this;
    }

    /**
     * Adds a new module to work with Thorin.
     * When adding a module to Thorin, we need to provide:
     * @Arguments
     *  - module - the module function, or class.
     *  - opt.name - the module name, or the module's publicName()
     *  - opt.config - the additional config to use for this module, merged on init
     * */
    addModule(m, opt = {}) {
      if (util.isUndefined(m)) {
        console.log(`Thorin.addModule: ${m} is not valid`);
        return this;
      }
      let fn = getComponentFn(m);
      if (!fn) {
        throw new Error(`Thorin.addModule: module is not a class/function`);
      }
      let name = getName(module, opt);
      if (!util.isObject(opt)) opt = {};
      opt.name = name;
      return this.#register('module', fn, opt);
    }

    /**
     * Adds a new transport to work with Thorin.
     * When adding a transport to Thorin, we need to provide:
     * @Arguments
     *  - transport - the transport class that extends ITransport.
     *  - opt.name - optional, the transport name
     *  - opt.config - the additional config to use for this transport, merged on init
     * */
    addTransport(transport, opt = {}) {
      if (util.isUndefined(transport)) {
        console.log(`Thorin.addTransport: ${transport} is not valid`);
        return this;
      }
      let fn = getComponentFn(transport);
      if (!fn) {
        throw new Error(`Thorin.addTransport: transport is not a class/function`);
      }
      let name = getName(transport, opt);
      if (!util.isObject(opt)) opt = {};
      opt.name = name;
      return this.#register('transport', fn, opt);
    }

    /**
     * Adds a new store to work with Thorin.
     * When adding a store to Thorin, we need to provide:
     * @Arguments
     *  - store - the store class that extends IStore.
     *  - opt.name - optional, the store name
     *  - opt.config - the additional config to use for this transport, merged on init
     * */
    addStore(store, opt = {}) {
      if (util.isUndefined(store)) {
        console.log(`Thorin.addStore: ${store} is not valid`);
        return this;
      }
      let fn = getComponentFn(store);
      if (!fn) {
        throw new Error(`Thorin.addStore: store is not a class/function`);
      }
      let name = getName(store, opt);
      if (!util.isObject(opt)) opt = {};
      opt.name = name;
      return this.#register('store', fn, opt);
    }

    /**
     * Adds a new plugin to work with Thorin.
     * When adding a plugin to Thorin, we need to provide:
     * @Arguments
     *  - plugin - the plugin class or function.
     *  - opt.name - optional, the store name
     *  - opt.config - the additional config to use for this transport, merged on init
     * */
    addPlugin(plugin, opt = {}) {
      if (util.isUndefined(plugin)) {
        console.log(`Thorin.addPlugin: ${plugin} is not valid`);
        return this;
      }
      let fn = getComponentFn(plugin);
      if (!fn) {
        throw new Error(`Thorin.addPlugin: plugin is not a class/function`);
      }
      let name = getName(plugin, opt);
      if (!util.isObject(opt)) opt = {};
      opt.name = name;
      return this.#register('plugin', fn, opt);
    }

    /**
     * Adds a new library to work with Thorin.
     * When adding a library to Thorin, we need to provide:
     * @Arguments
     *  - library - the library class or function.
     *  - opt.name - optional, the library name
     *  - opt.config - the additional config to use for this transport, merged on init
     * */
    addLibrary(lib, opt = {}) {
      if (util.isUndefined(lib)) {
        console.log(`Thorin.addLibrary: ${lib} is not valid`);
        return this;
      }
      let fn = getComponentFn(lib);
      if (!fn) {
        throw new Error(`Thorin.addLibrary: lib is not a class/function`);
      }
      let name = getName(lib, opt);
      if (!util.isObject(opt)) opt = {};
      opt.name = name;
      return this.#register('library', fn, opt);
    }

    /**
     * Adds one or multiple sanitizers to Thorin.
     * When adding a library to Thorin, we need to provide:
     * @Arguments
     *  - items - a Sanitizer function, or an array of sanitizers.
     * */
    addSanitizer(items) {
      items = (util.isArray(items) ? items : [items]);
      let self = this;

      function add(s, opt = {}) {
        if (!s) return;
        if (!util.isImplemented(s, Interface.Sanitizer)) {
          console.log(`Thorin.addSanitizer: item ${s} does not implement Interface.Sanitizer`);
          return;
        }
        if (!opt.name) {
          if (typeof s.code === 'string') {
            opt.name = s.code;
          } else if (typeof s.code === 'function') {
            opt.name = s.code();
          } else if (typeof s.publicName === 'function') {
            opt.name = s.publicName();
          } else if (typeof s.publicName === 'string') {
            opt.name = s.publicName;
          }
        }
        if (!opt.name || opt.name === 'DEFAULT') {
          console.log(`Thorin.addSanitizer: name is not set for`, s);
          return false;
        }
        // Sanitizers are added automatically.
        self.#sanitizer[opt.name.toUpperCase()] = util.isClass(s) ? new s(this, opt.name) : s;
        let aliases = util.isFunction(s.aliases) ? s.aliases() : [];
        for (let i = 0, len = aliases.length; i < len; i++) {
          let a = aliases[i].toUpperCase();
          if (self.#sanitizer[a]) continue; // already set alias
          self.#sanitizer[a] = s;
        }
      }

      for (let i = 0, len = items.length; i < len; i++) {
        let itm = items[i];
        if (util.isFunction(itm)) {
          add(itm);
        } else if (util.isObject(itm)) {
          Object.keys(itm).forEach((k) => add(itm[k], {
            name: k
          }));
        } else if (util.isArray(itm)) {
          for (let j = 0, jlen = itm.length; j < jlen; j++) {
            add(itm[j]);
          }
        } else {
          console.log(`Thorin.addSanitizer: unrecognized sanitizer`, itm);
        }
      }
      return this;
    }


    /**
     * Given an error, it will try and apply all the error handlers on it, to mutate
     * its information. The first error parser that returns a truthy value will stop the
     * calling chain and return the parsed error.
     * NOTE: because errors are actually object, the parsers must mutate the error's properties,
     * in stead of creating a new error.
     *
     * Example:
     *   parsers = fn1, fn2, fn3
     *   ex = new Error("SomeCustomError")
     *   thorin.parseError(ex) => fn1(ex)=false, fn2(ex)=true => return ex;
     * */
    parseError(exception) {
      for (let i = 0, len = this.#errorParsers.length; i < len; i++) {
        let fn = this.#errorParsers[i];
        try {
          if (!fn(exception)) continue;
          break;
        } catch (e) {
        }
      }
      return exception;
    }


  }

  return BaseRepo;
}

function clean(name) {
  if (typeof name !== 'string' || !name) return '';
  name = name.trim();
  return name;
}

function getName(m, opt = {}) {
  if (typeof opt === 'string' && opt) {
    return clean(opt);
  }
  if (typeof opt.name === 'string' && opt.name) {
    return clean(opt.name);
  }
  try {
    if (typeof m.publicName === 'function') {
      return clean(m.publicName());
    } else if (typeof m.publicName === 'string') {
      return clean(m.publicName);
    }
  } catch (e) {}
  // If we have a class, we try to extract the class name.
  if (typeof m === 'function' && typeof m.name === 'string') {
    return m.name;
  }
  return null;
}

/*
* If the specified component is a function, we return it as is.
* If the specified component is a class, we wrap a function(){} on it, that will instantiate it on demand.
* */
function getComponentFn(ComponentClass) {
  let _isClass = util.isClass(ComponentClass),
    _isObject = util.isObject(ComponentClass);
  if (_isClass || _isObject) {
    // return a warp function, with the standard (thorin, opt, name)
    return (thorin, opt, name) => {
      if (_isClass) return new ComponentClass(thorin, opt, name);
      return ComponentClass;
    };
  }
  if (util.isFunction(ComponentClass)) {
    return ComponentClass;
  }
  return null;
}


/**
 * Tries to run the given function.
 * If the function returns a promise, we return the promise.
 * If the function does not return a promise, we provide a callback()
 * The first one that is resolved, will resolve the big promise.
 * NOTE:
 * - we need to do deep inspection of the function, to check if the given fnName() is run with the callback arg or with none.
 * */
function ensurePromiseCall(obj, fnName) {
  return new Promise((resolve, reject) => {
    let isDone = false;

    function onDone(err) {
      if (isDone) return;
      isDone = true;
      if (err) return reject(err);
      resolve();
    }

    let isWithCallback = util.hasFunctionArgument(obj[fnName]);
    try {
      let fnRes = obj[fnName](onDone);
      if (!isWithCallback && util.isPromise(fnRes)) {
        fnRes.then(onDone).catch(onDone);
      }
    } catch (e) {
      return onDone(e);
    }
  });
}

