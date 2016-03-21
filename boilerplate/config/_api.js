/*
* the API App specific configuration.
* */

module.exports = {
  transport: {
    MyTransport: {
      port: "$ENV:API_PORT",
      cors: true
    },
    ws: "http"  // attach the ws to the http server. Otherwise, use the same config.
  },
  store: {
    sql: {
      database: "myDatabase",
      models: "app/models",
      patch: "app/models/patches"
    },
    mongo: {
      database: 'myDb'
    },
    redis: {
      reconnect: true
    }
  },
  lib: {
    myLibrary: {
      custom: "configuration"
    },
    coreLibrary: {
      someOther: "config"
    }
  }
};