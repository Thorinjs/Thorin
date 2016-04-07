'use strict';
/**
 * Created by Adrian on 20-Mar-16.
 */
module.exports = class ISanitizer {
  static code() { return "DEFAULT"; } // this is the code of the sanitizer that will be attached to thorin.sanitize
  static publicName() { return "DEFAULT"; } // this is the user friendly name of the sanitizer.
  static aliases() { return []; } // if we have the same validator for multiple names, we can return an array of capital codes to map

  /*
  * The validate() function will be called with the input data. It must only
  * check if the input is of actual type and if it fits the input criteria.
  * IF the validation fails, it can return a falsy value (false, null, etc).
  * IF the input is valid, it MUST return an object containing:
  * IF the sanitizer is promise-based, it MUST return a promise and resolve with the actual result.
  * {
  *   value: "sanitizedValue"
  * }
  * */
  validate(input, opt) {
    throw new Error("Thorin.ISanitizer: " + this.code + " validate() not implemented.");
  }

};