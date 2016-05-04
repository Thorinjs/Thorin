'use strict';
/**
 * Created by Adrian on 19-Mar-16.
 * This is the Thorin Interface, specifying what dependencies and other
 * functions that can be extended a
 */
const async = require('async'),
  path = require('path'),
  ITransport = require('../interface/ITransport'),
  IStore = require('../interface/IStore'),
  ISanitizer = require('../interface/ISanitizer');

const errorParsers = Symbol(),
  transports = Symbol(),
  stores = Symbol(),
  libraries = Symbol(),
  sanitizers = Symbol(),
  plugins = Symbol(),
  onEventFns = Symbol(),
  componentEventStat = Symbol();

const THORIN_EVENTS = { // exposed under thorin.EVENT.INIT
  INIT: 'init',
  RUN: 'run',
  SETUP: 'setup'
};

class ThorinCore {

  constructor() {
    this[errorParsers] = [];  // an array of functions that can change an error's information
    this[transports] = [];
    this[stores] = [];
    this[libraries] = [];
    this[sanitizers] = [];
    this[plugins] = [];
    this[onEventFns] = {};  // hash of {thorinEvent:[fn, fn]} that wait for those events.
    this[componentEventStat] = {}; // a hash of {thorinEvent}:{fullComponentName}
    this.Interface = {};
  }

  /*
   * Fetch a given library by its name or throw because it does not exist.
   * */
  lib(name) {
    if (typeof name !== 'string') return null;
    name = name.trim();
    return this[libraries][name] || null;
  }

  store(name) {
    if (typeof name !== 'string') return null;
    return this[stores][name] || null;
  }

  plugin(name) {
    if (typeof name !== 'string') return null;
    name = name.trim();
    return this[plugins][name] || null;
  }

  transport(name) {
    if (typeof name !== 'string') return null;
    name = name.trim();
    return this[transports][name] || null;
  }

  /*
   * Adds a new error parser. Error parsers are used to mutate the error
   * information of any kind of thorin.error() call. This is useful to hide or
   * capture specific errors throughout the app.
   * */
  addErrorParser(fn) {
    if (typeof fn !== 'function') {
      console.error('Thorin.addErrorHandler: validator is not a function.');
      return this;
    }
    this[errorParsers].push(fn);
    return this;
  }

  /*
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
    if (this[errorParsers].length === 0) return exception;
    for (let i = 0; i < this[errorParsers].length; i++) {
      let fn = this[errorParsers][i];
      try {
        if (!fn(exception)) continue;
      } catch (e) {
        continue;
      }
      break;
    }
    return exception;
  }


  /*
   * Adds a new transport to the list.
   * All transports must implement the thorin.Interface.Transport interface.
   * */
  addTransport(transport, name) {
    if (typeof transport === 'string') {
      try {
        transport = _requireModule(this.root, transport);
      } catch (e) {
        if (e === 'NOT_FOUND') {
          console.error('Thorin.addTransport: transport %s not found.', transport);
        } else {
          console.error('Thorin.addTransport: failed to load transport %s:', transport, e);
        }
        return this;
      }
    }
    if (!ITransport.isPrototypeOf(transport) && typeof transport === 'function') {
      transport = transport(this);
    }
    if (!ITransport.isPrototypeOf(transport)) {
      console.error('Thorin.addTransport: transport %s does not implement Thorin.Interface.Transport', transport);
      return this;
    }
    if (typeof name !== 'string') {
      name = transport.name;
    }
    let item = {
      name: name,
      fn: transport
    };
    if (this.initialized) {
      _addTransport(item);
    } else {
      this[transports].push(item);
    }
    return this;
  }

  /*
   * Adds a new store to the list.
   * All stores must implement the thorin.Interface.Store class.
   * Note: when adding a root thorin store, it must be installed at the root level.
   * */
  addStore(store, name) {
    if (typeof store === 'string') {
      try {
        store = _requireModule(this.root, store);
      } catch (e) {
        if (e === 'NOT_FOUND') {
          console.error('Thorin.addStore: store %s not found.', store);
        } else {
          console.error('Thorin.addStore: failed to load transport %s:', store, e);
          console.trace(e);
        }
        return this;
      }
    }
    if (!IStore.isPrototypeOf(store) && typeof store === 'function') {
      store = store(this);
    }
    if (!IStore.isPrototypeOf(store)) {
      console.error('Thorin.addStore: store %s does not implement Thorin.Interface.Store', store);
      return this;
    }
    let names = Array.prototype.slice.call(arguments),
      self = this;

    function doAdd(item) {
      if (self.initialized) {
        _addStore(self, item);
      } else {
        self[stores].push(item);
      }
    }

    names.splice(0, 1);
    if (names.length === 0) {
      let name = store.name;
      if (typeof store.publicName === 'function') {
        name = store.publicName();
      }
      doAdd({
        name: name,
        fn: store
      });
    } else {
      for (let i = 0; i < names.length; i++) {
        if (typeof names[i] !== 'string') continue;
        doAdd({
          name: names[i],
          fn: store
        });
      }
    }
    return this;
  }

  /*
   * Connects a new plugin to the app
   * All plugins must implement the thorin.Interface.Plugin class.
   * Note: when adding a root thorin plugin, it must be installed at the root level.
   * */
  addPlugin(itemName, alias, opt) {
    let item;
    if (typeof alias === 'object') {
      opt = alias;
      alias = undefined;
    }
    if (typeof opt !== 'object') opt = {};
    if (typeof itemName === 'string') {
      try {
        item = {
          name: alias || itemName,
          fn: itemName,
          opt: opt
        };
      } catch (e) {
        if (e === 'NOT_FOUND') {
          console.error('Thorin.addPlugin: plugin %s not found. Please use: npm i --save ' + itemName, itemName);
          return;
        }
        throw e;
      }
    } else {
      item = {
        name: alias || itemName.name,
        fn: itemName,
        opt: opt || {}
      };
    }
    if (this.initialized) {
      _addPlugin(this, item);
    } else {
      this[plugins].push(item);
    }
    return this;
  }

  /*
   * Thorin works with a set of sanitizers. These sanitizers are used
   * to sanitize input data. By default, we include the default thorin-sanitizers.
   * but additional ones can be added.
   * */
  addSanitizer(_items) {
    let items = (_items instanceof Array ? _items : Array.prototype.slice.call(arguments)),
      self = this;

    function doAdd(item) {
      if (!item) return;
      if (!ISanitizer.isPrototypeOf(item)) {
        console.error('Thorin.addSanitizer: item %s does not implement Thorin.Interface.Sanitize', item);
        return;
      }
      if (self.initialized) {
        _addSanitizer(self, item);
      } else {
        self[sanitizers].push(item);
      }
    }

    items.forEach((itemName) => {
      if (typeof itemName === 'string') {
        try {
          let required = _requireModule(this.root, itemName);
          if (typeof required === 'function') {
            required = required(self);
          }
          if (required instanceof Array) {
            for (let i = 0; i < required.length; i++) {
              doAdd(required[i]);
            }
          } else {
            doAdd(required);
          }
        } catch (e) {
          if (e === 'NOT_FOUND') {
            console.error('Thorin.addSanitizer: sanitizer %s not found', itemName);
            return;
          }
          throw e;
        }
      } else if (itemName instanceof Array) {
        for (let i = 0; i < itemName.length; i++) {
          doAdd(itemName[i]);
        }
      } else if (typeof itemName === 'object' && itemName) {
        Object.keys(itemName).forEach((k) => {
          doAdd(itemName[k]);
        });
      } else {
        console.error('Thorin.addSanitizer: unrecognized arguments for: %s.', itemName);
      }
    });
    return this;
  }

  /*
   * Registers a new library to Thorin. Libraries can perform a lot of stuff in the background,
   * therefore it is crucial that we give them the thorin reference.
   * Ways to add libraries:
   * addLibrary(module=string)
   * addLibrary(module=func, name=string)
   * addLibrary(module=string, name=string);
   * addLibrary(module=func) (name defaults to the proto name.)
   * */
  addLibrary(a, b) {
    let self = this;

    function doAdd(item) {
      if (typeof item.name !== 'string' || item.name === '') {
        console.warn('Thorin.addLibrary: library has no name:', item.fn);
        return self;
      }
      if (self.initialized) {
        _addLibrary(self, item);
      } else {
        self[libraries].push(item);
      }
      return self;
    }

    // module=string
    if (typeof a === 'string' && typeof b === 'undefined') {
      let moduleFn;
      try {
        moduleFn = _requireModule(this.root, a);
      } catch (e) {
        if (e === 'NOT_FOUND') {
          let errMsg = 'Thorin.addLibrary: library ' + a + ' not found.';
          if (a.indexOf('thorin') === 0) {
            errMsg += " Try using npm i --save " + a;
          }
          console.error(errMsg);
          return this;
        }
        throw e;
      }
      if (moduleFn == null) return this;
      if (typeof moduleFn !== 'function' && typeof moduleFn !== 'object') {
        console.warn('Thorin.addLibrary: library %s not a function.', a);
        return this;
      }
      return doAdd({
        name: moduleFn.name,
        fn: moduleFn
      });
    }
    // module=fn, name=string
    if (typeof b === 'string' && (typeof a === 'function' || (typeof a === 'object' && a))) {
      return doAdd({
        name: b,
        fn: a
      });
    }
    // module=string name=string
    if (typeof a === 'string' && typeof b === 'string') {
      let moduleFn;
      try {
        moduleFn = require(a);
      } catch (e) {
        if (e.code === 'MODULE_NOT_FOUND' && e.message.indexOf(b) !== -1) {
          console.error('Thorin.addLibrary: library %s not found', b);
          console.debug(e);
          return this;
        }
        throw e;
      }
      return doAdd({
        name: b,
        fn: moduleFn
      });
    }
    // module=fn
    if (typeof a === 'function' || (typeof a === 'object' && a != null)) {
      let name = a.name;
      return doAdd({
        name: name,
        fn: a
      });
    }
    return this;
  }

  /*
   * Creates all the loaded thorin components.
   * */
  createComponents(onDone) {
    let calls = [];
    /*
     * Create all sanitizers. Switch from an array to a hash of sanitizers with code:obj
     * */
    calls.push((done) => {
      let items = this[sanitizers];
      this[sanitizers] = {};
      items.forEach((SanitizeClass) => _addSanitizer(this, SanitizeClass));
      done();
    });

    /*
     * Create all stores.
     * */
    calls.push((done) => {
      let items = this[stores];
      this[stores] = {};
      items.forEach((item) => _addStore(this, item));
      done();
    });

    /*
     * Creates all libraries
     * */
    calls.push((done) => {
      let items = this[libraries];
      this[libraries] = {};
      items.forEach((item) => _addLibrary(this, item));
      done();
    });

    /*
     * Create all transports. Switching from an array to a hash of transports with code:obj
     * */
    calls.push((done) => {
      let items = this[transports];
      this[transports] = {};
      items.forEach((item) => _addTransport(this, item));
      done();
    });

    /*
     * Create all plugins.
     * */
    calls.push((done) => {
      let items = this[plugins];
      this[plugins] = {};
      items.forEach((item) => _addPlugin(this, item));
      done();
    });
    async.series(calls, onDone);
  }

  /*
   * Registers a callback for a specific thorin event.
   * Valid components are: store, transport, library, plugin
   * Syntax:
   *   thorin.on(thorin.EVENT.INIT, 'store.sql', fn);
   *   thorin.on(thorin.EVENT.RUN, 'plugin.myName', fn)
   *   thorin.on(thorin.EVENT.INIT, fn)  -> right after we've initialized all items.
   * */
  on(eventName, name, fn) {
    if (typeof eventName !== 'string') {
      console.error('Thorin.on: received invalid event: ' + eventName + ' for ' + name);
      return this;
    }
    if (typeof name === 'function' && typeof fn === 'undefined') {
      fn = name;
      name = "thorin.core";
    }
    if (typeof name !== 'string' || !name || name.indexOf('.') === -1) {
      console.error('Thorin.on: component name is not valid: ' + name);
      return this;
    }
    if (typeof fn !== 'function') {
      console.error('Thorin.on: callback is not a function for: ' + eventName + '.' + name);
      return this;
    }
    if (typeof this[componentEventStat][eventName + ':' + name] !== 'undefined') {
      return fn(getComponentByFullName.call(this, name));
    }
    if (typeof this[onEventFns][eventName] === 'undefined') {
      this[onEventFns][eventName] = {};
    }
    if (typeof this[onEventFns][eventName][name] === 'undefined') {
      this[onEventFns][eventName][name] = [];
    }
    this[onEventFns][eventName][name].push(fn);
    return this;
  }


  /*
   * Calls the init() function of all registered items.
   * If present, it will fetch their desired configuration.
   * This is a synchronous action as well.
   * The components that will have their init() function called are (and in this order):
   *     - stores
   *     - transports
   *     - libraries
   *     - plugins
   * NOTE:
   *   thorin.onInit("{componentType}.{componentName}", fn) will be called
   *   for each component that was initialized.
   * */
  initComponents(onDone) {
    let calls = [],
      self = this;
    /* Call the onInit handlers for the given component name. */
    function onComponentInit(name) {
      self._triggerThorinEvent(THORIN_EVENTS.INIT, name);
    }

    /* init stores */
    calls.push((done) => {
      Object.keys(this[stores]).forEach((name) => {
        let sObj = this[stores][name],
          fullName = 'store.' + name;
        if (typeof sObj.init === 'function') {
          let config = this.config(fullName, {});
          sObj.init(config);
        }
        onComponentInit(fullName);
      });
      done();
    });

    /* init transports */
    calls.push((done) => {
      Object.keys(this[transports]).forEach((name) => {
        let tObj = this[transports][name],
          fullName = 'transport.' + name;
        if (typeof tObj.init === 'function') {
          let config = this.config(fullName, {});
          tObj.init(config);
        }
        onComponentInit(fullName);
      });
      done();
    });

    /* init libraries */
    calls.push((done) => {
      Object.keys(this[libraries]).forEach((name) => {
        let libObj = this[libraries][name];
        if (typeof libObj.init === 'function') {
          let config = this.config(name, {});
          libObj.init(config);
        }
        onComponentInit('library.' + name);
      });
      done();
    });

    /* init plugins */
    calls.push((done) => {
      Object.keys(this[plugins]).forEach((name) => {
        let pluginObj = this[plugins][name];
        if (typeof pluginObj.init === 'function') {
          let config = this.config(name, {});
          pluginObj.init(config);
        }
        onComponentInit('plugin.' + name);
      });
      done();
    });

    async.series(calls, (e) => {
      if (!e) {
        onComponentInit("thorin.core");
      }
      self._removeThorinEvents(THORIN_EVENTS.INIT);
      onDone(e);
    });
  }

  /*
   * IF the thorin app starts up with the --setup= argv, we will look for
   * all the loaded components that match the setup names and call
   * their setup() function and trigger thorin.EVENT.SETUP for that component.
   * Note: the --setup argument will have to have the exact name of the component,
   * eg:
   *   node app.js --setup=store.sql,transport.tcp,library.myLib
   *   NOTE: if you want to install all the components, simply run
   *   node app.js --setup=all => this will execute the setup() function of all registered components.
   * */
  setupComponents(onDone) {
    let setups = this.argv('setup', null);
    if (!setups) return onDone();
    if(setups === "all") {
      setups = [];
      // step one: setup stores
      Object.keys(this[stores]).forEach((name) => {
        setups.push('store.' + name);
      });
      // next: transport.
      Object.keys(this[transports]).forEach((name) => {
        setups.push('transport.' + name);
      });
      // next: plugin
      Object.keys(this[plugins]).forEach((name) => {
        setups.push('plugin.' + name);
      });
      // next: library
      Object.keys(this[libraries]).forEach((name) => {
        setups.push('library.' + name);
      });
    } else if (typeof setups === 'string') setups = [setups];
    if (setups.length === 0) return onDone();
    let calls = [],
      self = this;

    setups.forEach((name) => {
      if (name.indexOf('.') === -1) {
        console.error('Thorin.setup: invalid component name in --setup argument: ', name);
        return;
      }
      let compObj = getComponentByFullName.call(self, name);
      if (!compObj) {
        console.error('Thorin.setup: component ' + name + ' is not loaded.');
        return;
      }
      calls.push((done) => {
        if (typeof compObj.setup !== 'function') {
          onComponentSetup(name);
          return done();
        }
        compObj.setup((e) => {
          if (e) return done(e);
          onComponentSetup(name);
          done();
        });
      });
    });

    async.series(calls, (e) => {
      self._removeThorinEvents(THORIN_EVENTS.SETUP);
      onDone(e);
    });

    /* Emit the thorin.EVENT.SETUP for the given component. */
    function onComponentSetup(name) {
      self._triggerThorinEvent(THORIN_EVENTS.SETUP, name);
    }
  }

  /*
   * Calls the run() function of all registered items.
   * For all items that have the run() function defined, we weill call it
   * and pass a callback. The callback will HAVE to be called(async way)
   * If it is called with an error, we stop the app.
   * The components that will have their run() function called are (and in this order):
   *   - stores
   *   - transports
   *   - libraries
   *   - plugins
   * */
  runComponents(onDone) {
    let calls = [],
      self = this;

    /* Call the onRun handlers for the given component name */
    function onComponentRun(name) {
      self._triggerThorinEvent(THORIN_EVENTS.RUN, name);
    }

    /* run stores */
    Object.keys(this[stores]).forEach((name) => {
      let sObj = this[stores][name],
        fullName = 'store.' + name;
      calls.push((done) => {
        if (typeof sObj.run !== 'function') {
          onComponentRun(fullName);
          return done();
        }
        sObj.run((e) => {
          if (e) return done(e);
          onComponentRun(fullName);
          done();
        });
      });
    });

    /* run libraries */
    Object.keys(this[libraries]).forEach((name) => {
      let libObj = this[libraries][name],
        fullName = 'library.' + name;
      calls.push((done) => {
        if (typeof libObj.run !== 'function') {
          onComponentRun(fullName);
          return done();
        }
        libObj.run((e) => {
          if (e) return done(e);
          onComponentRun(fullName);
          done();
        });
      });
    });

    /* run plugins */
    Object.keys(this[plugins]).forEach((name) => {
      let pluginObj = this[plugins][name],
        fullName = 'plugin.' + name;
      calls.push((done) => {
        if (typeof pluginObj.run !== 'function') {
          onComponentRun(fullName);
          return done();
        }
        pluginObj.run((e) => {
          if (e) return done(e);
          onComponentRun(fullName);
          done();
        });
      });
    });

    /* run transports */
    Object.keys(this[transports]).forEach((name) => {
      let tObj = this[transports][name],
        fullName = 'transport.' + name;
      calls.push((done) => {
        if (typeof tObj.run !== 'function') {
          onComponentRun(fullName);
          return done();
        }
        tObj.run((e) => {
          if (e) return done(e);
          onComponentRun(fullName);
          done();
        });
      });
    });

    async.series(calls, (e) => {
      onDone(e);
    });
  }

  /*
   * This will sanitize the given input, based on the sanitizer type.
   * */
  sanitize(type, input, opt, _defaultValue) {
    if (typeof _defaultValue === 'undefined') _defaultValue = null;
    if (!this.initialized) {
      console.warn('Thorin.sanitize: app not yet initialized.');
      return _defaultValue;
    }
    if (typeof type !== 'string') return _defaultValue;
    type = type.toUpperCase();
    let sanitizer = this[sanitizers][type];
    if (typeof sanitizer === 'undefined') {
      console.warn('Thorin.sanitize: type %s is not loaded.', type);
      return _defaultValue;
    }
    if (typeof opt !== 'object' || !opt) opt = {};
    let res = sanitizer.validate(input, opt);
    if (!res) return _defaultValue;
    /* IF the sanitizer is a promise, we proxy it. */
    if (typeof res === 'object' && res.then && res.catch) {
      return new Promise((resolve, reject) => {
        res.then((r) => {
          if (typeof r === 'undefined') return resolve(_defaultValue);
          resolve(r);
        }).catch((e) => reject(e));
      });
    }
    /* This is sync */
    if (typeof res !== 'object') return _defaultValue;
    if (typeof res.value === 'undefined') return _defaultValue;
    return res.value;
  }

  /*
   * Triggers a thorin event for the given component.
   * */
  _triggerThorinEvent(eventName, name) {
    this[componentEventStat][eventName + ':' + name] = true;
    if (typeof this[onEventFns][eventName] === 'undefined' || typeof this[onEventFns][eventName][name] === 'undefined') return;
    for (let i = 0; i < this[onEventFns][eventName][name].length; i++) {
      this[onEventFns][eventName][name][i](getComponentByFullName.call(this, name));
    }
  }
  /*
  * Removes any thorin events that were previously binded.
  * */
  _removeThorinEvents(which) {
    delete this[onEventFns][which];
  }
}

ThorinCore.EVENT = THORIN_EVENTS;
module.exports = ThorinCore;
/*------------------------------- PRIVATE FUNCTIONS --------------------------*/

/*
 * Registers a new sanitizer to the Thorin app. This is a private function.
 * This is automatically called if the app was initialized.
 * */
function _addSanitizer(app, SanitizeClass) {
  let sanitizerCode = SanitizeClass.code(),
    sanitizerName = SanitizeClass.publicName(),
    aliases = SanitizeClass.aliases(),
    sanitizerObj = new SanitizeClass();
  if (sanitizerCode === 'DEFAULT') {
    throw new Error('Thorin.createComponents: sanitizer ' + sanitizerCode + ' must have its code defined.');
  }
  if (sanitizerName === 'DEFAULT') {
    sanitizerName = sanitizerCode.toLowerCase();
    sanitizerName[0] = sanitizerName[0].toUpperCase();
  }
  app[sanitizers][sanitizerCode] = sanitizerObj;
  for (let i = 0; i < aliases.length; i++) {
    let alias = aliases[i].toUpperCase();
    if (typeof app[sanitizers][alias] !== 'undefined') {
      console.warn('Thorin.addSanitizer: alias "' + alias + '" of sanitizer ' + sanitizerCode + ' already exists. Skipping.');
      continue;
    }
    app[sanitizers][alias] = sanitizerObj;
  }
}

/*
 * Registers a new transport to the Thorin app. This is a private function.
 * // TODO: handle init() and run() if the app is already
 * */
function _addTransport(app, item) {
  if(!item.name || item.name === '') {
    try {
      if(typeof item.fn.publicName === 'string') item.name = item.fn.publicName;
    } catch(e) {}
  }
  item.name = item.name.trim();
  if (item.name.indexOf('thorin-transport-') === 0) {
    item.name = item.name.substr(17);
  }
  if (typeof app[transports][item.name] !== 'undefined') {
    throw new Error('Thorin.addTransport: transport ' + item.name + " is already registered. Please use a different name.");
  }
  let transportObj = new item.fn(app);
  app[transports][item.name] = transportObj;
}

/*
 * Registers a new store to the Thorin app.
 * // TODO: handle init() and run() if the app is already
 * */
function _addStore(app, item) {
  if(!item.name || item.name === '') {
    try {
      if(typeof item.fn.publicName === 'string') item.name = item.fn.publicName;
    } catch(e) {}
  }
  if (item.name.indexOf('thorin-store-') === 0) {  // we trim it.
    item.name = item.name.substr(13);
  }
  if (typeof app[stores][item.name] !== 'undefined') {
    throw new Error('Thorin.addStore: store ' + item.name + " is already registered. Please use a different name.");
  }
  let storeObj = new item.fn(app);
  storeObj.setName(item.name);
  app[stores][item.name] = storeObj;
}

/*
 * Registers a new plugin.
 * // TODO: handle init() and run() if the app is already
 * */
function _addPlugin(app, item) {
  if(!item.name || item.name === '') {
    try {
      if(typeof item.fn.publicName === 'string') item.name = item.fn.publicName;
    } catch(e) {}
  }
  item.name = item.name.trim();
  if (item.name.indexOf('thorin-plugin-') === 0) {  // thorin plugins have their name trimmed.
    item.name = item.name.substr(14);
  }
  let pluginConfig = app.config('plugin.' + item.name);
  if (pluginConfig) {
    item.opt = app.util.extend(pluginConfig, item.opt);
  }
  if (typeof item.fn === 'string') {
    item.fn = _requireModule(app.root, item.fn, item.opt);
  }
  if (typeof app[plugins][item.name] !== 'undefined') {
    throw new Error('Thorin.addPlugin: plugin ' + item.name + " is already registered. Please use a different name.");
  }
  /* Check if we have a constructor or an already created obj. */
  let pluginType = Object.prototype.toString.call(item.fn),
    pluginObj;
  if (pluginType === '[object Undefined]') {
    return; // we do not add it.
  }
  if (pluginType === '[object Object]') {
    pluginObj = item.fn;
    item.name = item.fn.name;
  } else {
    pluginObj = new item.fn(app, item.opt, item.name);
  }
  app[plugins][item.name] = pluginObj;
}

/*
 * Registers a new library.
 * // TODO: handle init() and run() if the app is already
 * */
function _addLibrary(app, item) {
  if(!item.name || item.name === '') {
    try {
      if(typeof item.fn.publicName === 'string') item.name = item.fn.publicName;
    } catch(e) {}
  }
  item.name = item.name.trim();
  if (item.name.indexOf('thorin-lib-') === 0) {
    item.name = item.name.substr(11);
  }
  if (typeof app[libraries][item.name] !== 'undefined') {
    throw new Error('Thorin.addLibrary: library ' + item.name + " is already registered. Please use a different name.");
  }
  /* Check if we have a constructor or an already created object. */
  let libType = Object.prototype.toString.call(item.fn);
  let itemObj;
  if (libType === '[object Object]') {
    itemObj = item.fn;
  } else {
    itemObj = new item.fn(app);
  }
  app[libraries][item.name] = itemObj;
}

/*
 * Normalizes the require path of the modules, so that they are at the app level required.
 * */
function _normalizeRequire(rootPath, name) {
  if (typeof name !== 'string') return name;
  name = name.trim();
  if (name.indexOf('thorin-') === 0) {
    if (name !== 'thorin-sanitize') {
      name = path.normalize(rootPath + '/node_modules/' + name);
    }
  }
  return name;
}

/*
 * Tries to require a thorin module, from the root node_modules, or the simple require(one)
 * */
function _requireModule(rootPath, name) {
  let modulePath = _normalizeRequire(rootPath, name),
    moduleRes;
  try {
    moduleRes = require(modulePath);
  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND' && e.message.indexOf(name) !== -1) {
      try {
        moduleRes = require(name);
      } catch (e) {
        if (e.code === 'MODULE_NOT_FOUND' && e.message.indexOf(name) !== -1) {
          throw "NOT_FOUND";
        }
        throw e;
      }
    } else {
      throw e;
    }
  }
  return moduleRes;
}

/*
 * Returns a component by its full name.
 * Names:
 * store.{name}, transport.{name}, library.{name}, plugin.{name}
 * */
function getComponentByFullName(name) {
  let componentType = name.substr(0, name.indexOf('.')).toLowerCase(),
    compName = name.substr(name.indexOf('.') + 1);
  switch (componentType) {
    case 'store':
      return this.store(compName);
    case 'transport':
      return this.transport(compName);
    case 'library':
      return this.lib(compName);
    case 'plugin':
      return this.plugin(compName);
    default:
      return null;
  }
}


