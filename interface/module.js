'use strict';
const EventEmitter = require('events').EventEmitter;
/**
 * Created by Adrian on 19-Mar-16.
 */

module.exports = class IModule extends EventEmitter {

  constructor() {
    super();
    this.setMaxListeners(Infinity);
    this.name = "module";
  }

  /* Should return an array of thorin dependencies, if any */
  static dependencies() {
    return [];
  }

  /* Manually stop the module */
  stop(done) {
    done();
  }
};
