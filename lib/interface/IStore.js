'use strict';
const EventEmitter = require('events').EventEmitter;
/**
 * Created by Adrian on 19-Mar-16.
 */

module.exports = class IStore extends EventEmitter{

  constructor() {
    super();
    this.setMaxListeners(Infinity);
    this.type = "store";  // the store type.
    this.name = "store";
  }

  /* Sets the name's instance. */
  setName(name) {
    this.name = name;
  }
};