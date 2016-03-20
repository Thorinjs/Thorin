'use strict';
/**
 * Created by Adrian on 20-Mar-16.
 */

/* This is a ThorinError that extends the default Error  */
let msg = Symbol();
class ThorinGenericError extends Error {

  constructor(_code, _message) {
    super();
    this.code = (_code || "GENERIC_ERROR");
    this.message = (_message || "An error occurred.");
    this.statusCode = 400;
    // this.data -> the data attached.
    // this.source -> the parent error.
  }

  getStack() {
    if(!this.source) return this.stack;
    return this.source.stack;
  }

  toJSON() {
    let d = {
      error: true,
      code: this.code,
      message: this.message
    };
    if(this.data) {
      d['data'] = this.data;
    }
    return d;
  }
}

module.exports = {
  generic: ThorinGenericError
};