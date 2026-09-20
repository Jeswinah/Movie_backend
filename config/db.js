const mongoose = require("mongoose");
const dns = require("dns");
require("dotenv").config();

const connectDb = async () => {
  if (process.env.MONGO_DNS_SERVERS) {
    dns.setServers(process.env.MONGO_DNS_SERVERS.split(",").map((server) => server.trim()));
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to Database");
};

module.exports = connectDb;