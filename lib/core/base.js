'use strict';
/**
 * Created by Adrian on 19-Mar-16.
 * This is the Thorin Interface, specifying what dependencies and other
 * functions that can be extended a
 */
const async = require('async'),
  ITransport = require('../interface/ITransport'),
  IStore = require('../interface/IStore'),
  ISanitizer = require('../interface/ISanitizer'),
  IPlugin = require('../interface/IPlugin');

const transports = Symbol(),
  stores = Symbol(),
  libraries = Symbol(),
  sanitizers = Symbol(),
  plugins = Symbol();

module.exports = class ThorinBase {

  constructor() {
    this[transports] = [];
    this[stores] = [];
    this[libraries] = [];
    this[sanitizers] = [];
    this[plugins] = [];
    this.Interface = {};
  }

  /*
  * Adds a new transport to the list.
  * All transports must implement the thorin.Interface.Transport interface.
  * */
  addTransport(transport, name) {
    if(typeof transport === 'string') {
      try {
        transport = require(transport);
      } catch(e) {
        if(e.code === 'MODULE_NOT_FOUND') {
          console.error('Thorin.addTransport: transport %s not found.', transport);
        } else {
          console.error('Thorin.addTransport: failed to load transport %s:', transport, e);
        }
        return this;
      }
    }
    if(!ITransport.isPrototypeOf(transport) && typeof transport === 'function') {
      transport = transport(ITransport, this);
    }
    if(!ITransport.isPrototypeOf(transport)) {
      console.error('Thorin.addTransport: transport %s does not implement Thorin.Interface.Transport', transport);
      return this;
    }
    if(typeof name !== 'string') {
      name = transport.name;
    }
    let item = {
      name: name,
      fn: transport
    };
    if(this.initialized) {
      _addTransport(item);
    } else {
      this[transports].push(item);
    }
    return this;
  }

  /*
  * Adds a new store to the list.
  * All stores must implement the thorin.Interface.Store class.
  * */
  addStore(store, name) {
    if(typeof store === 'string') {
      try {
        store = require('store');
      } catch(e) {
        if(e.code === 'MODULE_NOT_FOUND') {
          console.error('Thorin.addStore: store %s not found.', store);
        } else {
          console.error('Thorin.addStore: failed to load transport %s:', store, e);
        }
        return this;
      }
    }
    if(!IStore.isPrototypeOf(store) && typeof store === 'function') {
      store = store(IStore, this);
    }
    if(!IStore.isPrototypeOf(store)) {
      console.error('Thorin.addStore: store %s does not implement Thorin.Interface.Store', store);
      return this;
    }
    let names = Array.prototype.slice.call(arguments),
      self = this;
    function doAdd(item) {
      if(self.initialized) {
        _addStore(self, item);
      } else {
        self[stores].push(item);
      }
    }
    names.splice(0, 1);
    if(names.length === 0) {
      doAdd({
        name: store.name,
        fn: store
      });
    } else {
      for(let i=0; i < names.length; i++) {
        if(typeof names[i] !== 'string') continue;
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
   * */
  addPlugin() {
    let items = Array.prototype.slice.call(arguments);
    items.forEach((itemName) => {
      let item;
      if(typeof itemName === 'string') {
        try {
          item = require(itemName);
        } catch(e) {
          if(e.code === 'MODULE_NOT_FOUND') {
            console.error('Thorin.addPlugin: plugin %s not found.', itemName);
            return;
          }
          throw e;
        }
      } else {
        item = itemName;
      }
      if(!IPlugin.isPrototypeOf(item) && typeof item === 'function') {
        item = item(IPlugin, this);
      }
      if(!IPlugin.isPrototypeOf(item)) {
        console.error('Thorin.addPlugin: plugin %s does not implement Thorin.Interface.Plugin', itemName);
        return;
      }
      if(this.initialized) {
        _addPlugin(this, item);
      } else {
        this[plugins].push(item);
      }
    });
    return this;
  }

  /*
  * Thorin works with a set of sanitizers. These sanitizers are used
  * to sanitize input data. By default, we include the default thorin-sanitizers.
  * but additional ones can be added.
  * */
  addSanitizer(_items) {
    let items =(_items instanceof Array ? _items : Array.prototype.slice.call(arguments)),
      self = this;
    function doAdd(item) {
      if(!item) return;
      if(!ISanitizer.isPrototypeOf(item)) {
        console.error('Thorin.addSanitizer: item %s does not implement Thorin.Interface.Sanitize', item);
        return;
      }
      if(self.initialized) {
        _addSanitizer(self, item);
      } else {
        self[sanitizers].push(item);
      }
    }
    items.forEach((itemName) => {
      if(typeof itemName === 'string') {
        try {
          let required = require(itemName);
          if(typeof required === 'function') {
            required = required(ISanitizer, self);
          }
          if(required instanceof Array) {
            for(let i=0; i < required.length; i++) {
              doAdd(required[i]);
            }
          } else {
            doAdd(required);
          }
        } catch(e) {
          if(e.code === 'MODULE_NOT_FOUND') {
            console.error('Thorin.addSanitizer: sanitizer %s not found', itemName);
            return;
          }
          throw e;
        }
      } else if(itemName instanceof Array) {
        for(let i=0; i < itemName.length; i++) {
          doAdd(itemName[i]);
        }
      } else if(typeof itemName === 'object' && itemName) {
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
  * addLibrary(name=string, module=func)
  * addLibrary(name=string, module=string);
  * addLibrary(module=func) (name defaults to the proto name.)
  * */
  addLibrary(a, b) {
    let self = this;
    function doAdd(item) {
      if(self.initialized) {
        _addLibrary(self, item);
      } else {
        self[libraries].push(item);
      }
      return self;
    }
    // module=string
    if(typeof a === 'string' && typeof b === 'undefined') {
      let moduleFn;
      try {
        moduleFn = require(a);
      } catch(e) {
        if(e.code === 'MODULE_NOT_FOUND') {
          console.error('Thorin.addLibrary: library %s not found', a);
          return this;
        }
        throw e;
      }
      if(moduleFn == null) return this;
      if(typeof moduleFn !== 'function' && typeof moduleFn !== 'object') {
        console.warn('Thorin.addLibrary: library %s not a function.', a);
        return this;
      }
      return doAdd({
        name: moduleFn.name,
        fn: moduleFn
      });
    }
    // name=string, module=fn
    if(typeof a === 'string' && (typeof b === 'function' || (typeof b === 'object' && b))) {
      return doAdd({
        name: a,
        fn: b
      });
    }
    // name=string, module=string
    if(typeof a === 'string' && typeof b === 'string') {
      let moduleFn;
      try {
        moduleFn = require(b);
      } catch(e) {
        if(e.code === "MODULE_NOT_FOUND") {
          console.error('Thorin.addLibrary: library %s not found', b);
          return this;
        }
        throw e;
      }
      return doAdd({
        name: a,
        fn: moduleFn
      });
    }
    // module=fn
    if(typeof a === 'function' || (typeof a === 'object' && a != null)) {
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
  * Calls the init() function of all registered items.
  * If present, it will fetch their desired configuration.
  * This is a synchronous action as well.
  * The components that will have their init() function called are (and in this order):
  *     - stores
  *     - transports
  *     - libraries
  *     - plugins
  * */
  initComponents(onDone) {
    let calls = [];

    /* init stores */
    calls.push((done) => {
      Object.keys(this[stores]).forEach((name) => {
        let sObj = this[stores][name];
        if(typeof sObj.init !== 'function') return;
        let config = this.config('store.' + name, {});
        sObj.init(config);
      });
    });

    /* init transports */
    calls.push((done) => {
      Object.keys(this[transports]).forEach((name) => {
        let tObj = this[transports][name];
        if(typeof tObj.init !== 'function') return;
        let config = this.config('transport.' + name, {});
        tObj.init(config);
      });
      done();
    });

    /* init libraries */
    calls.push((done) => {
      Object.keys(this[libraries]).forEach((name) => {
        let libObj = this[libraries][name];
        if(typeof libObj.init !== 'function') return;
        let config = this.config(name, {});
        libObj.init(config);
      });
      done();
    });

    /* init plugins */
    calls.push((done) => {
      Object.keys(this[plugins]).forEach((name) => {
        let pluginObj = this[plugins][name];
        if(typeof pluginObj.init !== 'function') return;
        let config = this.config(name, {});
        pluginObj.init(config);
      });
      done();
    });

    async.series(calls, onDone);
  }

  /*
  * This will sanitize the given input, based on the sanitizer type.
  * */
  sanitize(type, input, opt, _defaultValue) {
    if(typeof _defaultValue === 'undefined') _defaultValue = null;
    if(!this.initialized) {
      console.warn('Thorin.sanitize: app not yet initialized.');
      return _defaultValue;
    }
    if(typeof type !== 'string') return _defaultValue;
    type = type.toUpperCase();
    let sanitizer = this[sanitizers][type];
    if(typeof sanitizer === 'undefined') {
      console.warn('Thorin.sanitize: type %s is not loaded.', type);
      return _defaultValue;
    }
    if(typeof opt !== 'object' || !opt) opt = {};
    let res = sanitizer.validate(input, opt);
    if(!res) return _defaultValue;
    /* IF the sanitizer is a promise, we proxy it. */
    if(typeof res === 'object' && res.then && res.catch) {
      return new Promise((resolve, reject) => {
        res.then((r) => {
          if(typeof r === 'undefined') return resolve(_defaultValue);
          resolve(r);
        }).catch((e) => reject(e));
      });
    }
    /* This is sync */
    if(typeof res !== 'object') return _defaultValue;
    if(typeof res.value === 'undefined') return _defaultValue;
    return res.value;
  }
};

/*------------------------------- PRIVATE FUNCTIONS --------------------------*/

/*
* Registers a new sanitizer to the Thorin app. This is a private function.
* This is automatically called if the app was initialized.
* */
function _addSanitizer(app, SanitizeClass) {
  let sanitizerCode = SanitizeClass.code(),
    sanitizerName = SanitizeClass.publicName(),
    sanitizerObj = new SanitizeClass();
  if(sanitizerCode === 'DEFAULT') {
    throw new Error('Thorin.createComponents: sanitizer ' + sanitizerCode + ' must have its code defined.');
  }
  if(sanitizerName === 'DEFAULT') {
    sanitizerName = sanitizerCode.toLowerCase();
    sanitizerName[0] = sanitizerName[0].toUpperCase();
  }
  app[sanitizers][sanitizerCode] = sanitizerObj;
}

/*
* Registers a new transport to the Thorin app. This is a private function.
* */
function _addTransport(app, item) {
  if(typeof app[transports][item.name] !== 'undefined') {
    throw new Error('Thorin.addTransport: transport ' + item.name + " is already registered. Please use a different name.");
  }
  let transportObj = new item.fn(app);
  app[transports][item.name] = transportObj;
}

/*
* Registers a new store to the Thorin app.
* */
function _addStore(app, item) {
  if(typeof app[stores][item.name] !== 'undefined') {
    throw new Error('Thorin.addStore: store ' + item.name + " is already registered. Please use a different name.");
  }
  let storeObj = new item.fn(app);
  app[stores][item.name] = storeObj;
}

/*
* Registers a new plugin.
* */
function _addPlugin(app, item) {
  if(typeof app[plugins][item.name] !== 'undefined') {
    throw new Error('Thorin.addPlugin: plugin ' + item.name + " is already registered. Please use a different name.");
  }
  /* Check if we have a constructor or an already created obj. */
  let pluginType = Object.prototype.toString.call(item.fn),
    pluginObj;
  if(pluginType === '[object Object]') {
    pluginObj = item.fn;
  } else {
    pluginObj = new item.fn(app);
  }
  app[plugins][item.name] = pluginObj;
}

/*
* Registers a new library.
* */
function _addLibrary(app, item) {
  if(typeof app[libraries][item.name] !== 'undefined') {
    throw new Error('Thorin.addLibrary: library ' + item.name + " is already registered. Please use a different name.");
  }
  /* Check if we have a constructor or an already created object. */
  let libType = Object.prototype.toString.call(item.fn);
  let itemObj;
  if(libType === '[object Object]') {
    itemObj = item.fn;
  } else {
    itemObj = new item.fn();
  }
  app[libraries][item.name] = itemObj;
}