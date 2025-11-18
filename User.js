const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    uniqueId: { type: Number, required: true, unique: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    birthday: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    occupation: { type: String, required: true },
    password: { type: String, required: true },
    address: {
        street: String,
        city: String,
        state: String,
        zip: String
    },
    education: {
        college: String,
        certificate: String,
        gradDate: String
    },
    registeredAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("User", userSchema);
