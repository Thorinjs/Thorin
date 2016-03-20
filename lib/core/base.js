'use strict';
/**
 * Created by Adrian on 19-Mar-16.
 * This is the Thorin Interface, specifying what dependencies and other
 * functions that can be extended a
 */
const ITransport = require('../interface/ITransport'),
  IStore = require('../interface/IStore'),
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
};