'use strict';
const EVENT = {
  CONFIG: 'config',
  INIT: 'init',
  RUN: 'run',
  SETUP: 'setup',
  EXIT: 'exit'
};
const commonUtil = require('../util/common');

module.exports = function init(info) {
  /**
   * This is a simple event handler for our Thorin app
   * It is used to attach ThorinEvent functionality.
   * */
  class BaseEvents {
    #onEventFns = {};       // map of {thorinEvent:[fn, fn]} that wait for those events.
    #componentEventStat = {}; // a map of {thorinEvent}:{fullComponentName}
    #removedFns = {};         // map of removed/already triggered events.

    /**
     * Registers a callback for a specific thorin event.
     * Valid components are: store, transport, library, plugin
     * Syntax:
     *   thorin.on(thorin.EVENT.INIT, 'store.sql', fn);
     *   thorin.on(thorin.EVENT.RUN, 'plugin.myName', fn)
     *   thorin.on(thorin.EVENT.INIT, fn)  -> right after we've initialized all items.
     * */
    on(eventName, name, fn) {
      if (typeof eventName !== 'string') {
        console.log(`Thorin.on: received invalid event ${eventName} for ${name}`);
        return this;
      }
      if (typeof name === 'function' && typeof fn === 'undefined') {
        fn = name;
        name = "thorin.core";
      }
      if (typeof name !== 'string' || !name || name.indexOf('.') === -1) {
        console.log(`Thorin.on: component name is not valid for ${name}`);
        return this;
      }
      if (typeof fn !== 'function') {
        console.log(`Thorin.on: callback fn is not a function for ${eventName}`);
        return this;
      }
      let keyName = `${eventName}:${name}`;
      if (this.#removedFns[keyName]) {
        return this._triggerThorinEvent(eventName, name);
      }
      if (typeof this.#componentEventStat[keyName] !== 'undefined') {
        return fn(commonUtil.getComponentByName(this, name));
      }
      if (typeof this.#onEventFns[eventName] === 'undefined') {
        this.#onEventFns[eventName] = {};
      }
      if (typeof this.#onEventFns[eventName][name] === 'undefined') {
        this.#onEventFns[eventName][name] = [];
      }
      this.#onEventFns[eventName][name].push(fn);
      return this;
    }

    /**
     * Triggers a thorin event for the given component.
     * */
    _triggerThorinEvent(eventName, name = 'thorin.core') {
      let keyName = `${eventName}:${name}`;
      this.#componentEventStat[keyName] = true;
      if (typeof this.#onEventFns[eventName] === 'undefined' || typeof this.#onEventFns[eventName][name] === 'undefined') return;
      for (let i = 0; i < this.#onEventFns[eventName][name].length; i++) {
        this.#onEventFns[eventName][name][i](commonUtil.getComponentByName(this, name));
      }
    }

    /**
     * Removes any thorin events that were previously binded.
     * */
    _removeThorinEvents(which) {
      this.#removedFns[which] = true;
      delete this.#onEventFns[which];
    }

  }

  return BaseEvents;
}
module.exports.EVENT = EVENT;

