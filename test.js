'use strict';
/**
 * Created by Adrian on 19-Mar-16.
 */
var thorin = require('./lib/thorin');
//thorin.name = "api";  // defaults to the fileName.
//thorin.env; // the app environment. first is --env=, next is NODE_ENV, default to development.
//thorin.root; //
//thorin.version; // the app version in package.json
//thorin.id;  // return the thorin unique app id. (thorin.name + persistedUniqueId)


class MyTransport extends thorin.Interface.Transport {

  init(config) {
    console.log("HUPH", config);
  }
}


thorin
  .addTransport(MyTransport)
  .addLibrary(function myLib() {

  });

class johnLib {

}
function john() {

}
thorin.addLibrary(johnLib);


//thorin.addPlugin("myPlugin")

thorin.run((err) => {
  console.log("RUN");
});
