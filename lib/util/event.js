'use strict';
const EventEmitter = require('events').EventEmitter;
/*
 * This is simply a wrapper over the EventEmitter that
 * */
module.exports = class Event extends EventEmitter {
  constructor() {
    super();
  }

  destroy() {
    for(let ev in this._events) {
      this.removeAllListeners(ev);
    }
  }
}