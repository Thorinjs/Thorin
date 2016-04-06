'use strict';
/**
 * Created by Adrian on 20-Mar-16.
 */

/* This is a ThorinError that extends the default Error  */
class ThorinGenericError extends Error {

  constructor(_code, _message) {
    super();
    this.code = (_code || "GENERIC_ERROR");
    this.message = (_message || "An error occurred.");
    this.statusCode = 400;
    this.ns = (this.code.indexOf('.') === -1 ? 'GLOBAL' : this.code.split('.')[0]);
    // this.data -> the data attached.
    // this.source -> the parent error.
  }

  get name() { return 'ThorinGenericError' }

  getStack() {
    if(!this.source) return this.stack;
    return this.source.stack;
  }

  toJSON() {
    let d = {
      code: this.code,
      ns: this.ns,
      message: this.message
    };
    if(this.data) {
      d['data'] = this.data;
    }
    return d;
  }
}

/*
* Prepares to get attached to thorin.error
* */


module.exports = {
  generic: ThorinGenericError
};