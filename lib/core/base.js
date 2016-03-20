'use strict';
/**
 * Created by Adrian on 19-Mar-16.
 * This is the Thorin Interface, specifying what dependencies and other
 * functions that can be extended a
 */
const ITransport = require('../interface/ITransport'),
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
    if(!ITransport.isPrototypeOf(transport)) {
      console.error('Thorin.addTransport: transport %s does not implement Thorin.Interface.Transport', transport);
      return this;
    }
    if(typeof name !== 'string') {
      name = transport.name;
    }
    this[transports].push({
      name: name,
      fn: transport
    });
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
    if(!IStore.isPrototypeOf(store)) {
      console.error('Thorin.addStore: store %s does not implement Thorin.Interface.Store', store);
      return this;
    }
    let names = Array.prototype.slice.call(arguments);
    names.splice(0, 1);
    if(names.length === 0) {
      this[stores].push({
        name: store.name,
        fn: store
      });
    } else {
      for(let i=0; i < names.length; i++) {
        if(typeof names[i] !== 'string') continue;
        this[stores].push({
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
      if(!IPlugin.isPrototypeOf(item)) {
        console.error('Thorin.addPlugin: plugin %s does not implement Thorin.Interface.Plugin', itemName);
        return;
      }
      this[plugins].push(item);
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
      self[sanitizers].push(item);
    }
    items.forEach((itemName) => {
      if(typeof itemName === 'string') {
        try {
          let required = require(itemName);
          if(typeof required === 'function') {
            required = required(self.Interface.Sanitizer, self);
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
  * Mounts all the loaded thorin components.
  * */
  mountComponents() {
    /*
    * Mount all sanitizers. Switch from an array to a hash of sanitizers with code:obj
    * */
    (() => {
      let items = this[sanitizers];
      this[sanitizers] = {};
      items.forEach((SanitizeClass) => {
        let sanitizerCode = SanitizeClass.code(),
          sanitizerName = SanitizeClass.publicName(),
          sanitizerObj = new SanitizeClass();
        if(sanitizerCode === 'DEFAULT') {
          throw new Error('Thorin.mountComponents: sanitizer ' + sanitizerCode + ' must have its code defined.');
        }
        if(sanitizerName === 'DEFAULT') {
          sanitizerName = sanitizerCode.toLowerCase();
          sanitizerName[0] = sanitizerName[0].toUpperCase();
        }
        this[sanitizers][sanitizerCode] = sanitizerObj;
      });
    })();
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