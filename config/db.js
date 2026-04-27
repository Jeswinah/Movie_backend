const mongoose = require("mongoose");
const dns = require("dns");
require("dotenv").config();

const connectDb = async () => {
    try {
        // Optional DNS override helps in networks where SRV lookups are blocked.
        if (process.env.MONGO_DNS_SERVERS) {
            const servers = process.env.MONGO_DNS_SERVERS.split(",")
                .map((v) => v.trim())
                .filter(Boolean);
            if (servers.length) {
                dns.setServers(servers);
                console.log("Using custom DNS servers for MongoDB:", servers.join(", "));
            }
        }

        await mongoose.connect(process.env.MONGO_URI);
        console.log("Connected to Database");
    } catch (error) {
        if (error?.code === "ECONNREFUSED" && error?.syscall === "querySrv") {
            console.error("MongoDB SRV DNS lookup failed. Check network/DNS or use a non-SRV Atlas URI.");
        }
        throw error;
    }
};

module.exports = connectDb;